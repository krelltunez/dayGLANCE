import Foundation
import WebKit

/// Native GLANCEvault SSE reader for iOS — the Swift mirror of Android's
/// `VaultSseClient` (dayglance-android/.../sse/VaultSseClient.kt) and the renderer's
/// `createVaultEventClient` (src/sync/vaultEventStream.js).
///
/// WHY A NATIVE READER: the WebView cannot stream `text/event-stream`. Its vault
/// HTTP goes through the buffered `httpRequest` bridge (whole body as one string),
/// and a direct `fetch` from the `dg://` app origin to the vault is CORS-blocked —
/// the same reason Android has this. So the SHELL opens the stream: an authenticated
/// `GET {vaultUrl}/events?accountId=…` with the Bearer device token, read
/// incrementally via `URLSession.bytes(for:)`, framed into SSE event blocks, and
/// each block pushed into the renderer via `window.__glanceVaultSseReceive`. The
/// renderer reuses its EXISTING `parseSseFrame` + coalescer + drains — this class
/// owns ONLY the socket, its lifecycle, and reconnect. A native HTTP client has no
/// browser origin, so it needs NO vault CORS change. POLLING in the renderer stays
/// the correctness backstop; these pushes only add instant drains on top.
///
/// BRIDGE CONTRACT (see vaultEventStream.js). JS → native (via dgbridge://):
///   • isVaultSseSupported() → true   capability probe (detectSseTransport).
///   • startVaultSse(url, token, accountId)   "SSE desired ON" + params.
///   • stopVaultSse()                 "SSE desired OFF".
/// native → JS (window.__glanceVaultSseReceive(msg)):
///   • {type:"open"}                  a (re)connection was established.
///   • {type:"frame", block:"<raw SSE event block>"}   one SSE event; the renderer
///     runs it through parseSseFrame → {seq,kind} → coalescer.
///   • {type:"closed"}                the stream dropped (we will reconnect).
///   • {type:"error", message}        a connect/read error (we own the retry).
///
/// LIFECYCLE — the reader runs only when BOTH are true: the renderer declared SSE
/// desired ([start]/[stop]) AND the scene is foreground ([setForeground], wired from
/// ContentView's scenePhase). It drops on background and reconnects with capped
/// exponential backoff on any drop. Every transition funnels through [reconcile],
/// which starts or cancels the SINGLE reader Task, so there is never more than one
/// connection. On each (re)connect the vault sends an initial `{seq,kind:"connected"}`
/// frame; it flows through as a normal frame, so the coalescer reconciles anything
/// missed while disconnected.
final class VaultSseBridge {

    static let shared = VaultSseBridge()

    /// Set by WebView.swift after the WKWebView is created so we can push frames.
    weak var webView: WKWebView?

    // ── State (guarded by `lock`, mirroring Android's @Synchronized) ─────────────
    private let lock = NSLock()
    // Framing-buffer cap (both the raw byte buffer and the decoded remainder). Real
    // vault events are tiny nudges; anything approaching 1 MB without a frame delimiter
    // is a misbehaving/hostile server, so we drop the connection rather than grow
    // unboundedly. Mirrors Android's SseFraming cap.
    private static let maxBufferBytes = 1_048_576
    private var desired = false
    // Foreground defaults true: the WebView only runs (and thus only calls
    // startVaultSse) when the scene is active, and scenePhase.onChange won't fire
    // for the initial .active value. Background transitions flip it false.
    private var foreground = true
    private var vaultUrl: String?
    private var token: String?
    private var accountId: String?
    private var readerTask: Task<Void, Never>?
    // Bumped on every (re)configure / stop so a stale reader that is mid-await
    // notices it is no longer the current generation and exits.
    private var generation = 0

    // Dedicated session: a request-idle timeout longer than the ~25s server
    // heartbeat (a healthy idle stream never trips it, a silently-dead one is
    // detected within the window), and never a cached response. A stored `let`
    // (not lazy) so its first use from the reader Task can't race initialization.
    // waitsForConnectivity is OFF: our own reconnect + backoff (SseBackoff) owns
    // retries, matching Android's fail-and-reconnect model — so a drop surfaces
    // promptly instead of parking the request on the connectivity monitor.
    private let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }()

    private init() {}

    // MARK: - Bridge API (called from BridgeSchemeHandler on a background thread)

    func isSupported() -> Bool { true }

    /// Renderer → "SSE desired ON", with the vault connection params.
    func start(vaultUrl: String, token: String, accountId: String) {
        lock.lock()
        self.vaultUrl = trimTrailingSlashes(vaultUrl)
        self.token = token
        self.accountId = accountId
        self.desired = true
        reconcileLocked()
        lock.unlock()
    }

    /// Renderer → "SSE desired OFF".
    func stop() {
        lock.lock()
        desired = false
        reconcileLocked()
        lock.unlock()
    }

    /// Scene foreground/background (wired from ContentView's scenePhase).
    func setForeground(_ fg: Bool) {
        lock.lock()
        foreground = fg
        reconcileLocked()
        lock.unlock()
    }

    // MARK: - Reconcile (start/stop the single reader) — call with `lock` held

    private func reconcileLocked() {
        let shouldRun = desired && foreground
            && vaultUrl != nil && token != nil && accountId != nil
        if shouldRun {
            guard readerTask == nil, let url = vaultUrl, let bearer = token, let account = accountId else { return }
            generation += 1
            let gen = generation
            readerTask = Task { [weak self] in
                await self?.runLoop(url: url, bearer: bearer, account: account, generation: gen)
                self?.clearReaderTask(ifGeneration: gen)
            }
        } else if let task = readerTask {
            // Bump the generation so the (possibly mid-await) reader exits, and cancel
            // to unblock the byte stream. java.io needed a socket close on Android;
            // URLSession's async iteration throws on Task cancellation.
            generation += 1
            task.cancel()
            readerTask = nil
        }
    }

    // MARK: - Reader loop (reconnect + backoff)

    private func runLoop(url: String, bearer: String, account: String, generation gen: Int) async {
        var backoff = SseBackoff()
        while !Task.isCancelled && currentGeneration() == gen {
            let openedAt = Date()
            do {
                try await connectAndRead(url: url, bearer: bearer, account: account, generation: gen)
            } catch is CancellationError {
                return
            } catch let term as SseTerminalError {
                // TERMINAL (auth failure / insecure URL): stop the reader entirely, no
                // reconnect. Push a coded event so the renderer surfaces it exactly once
                // instead of every 30s. A later start() (user fixed the token/URL) spins
                // up a fresh reader normally.
                if Task.isCancelled || currentGeneration() != gen { return }
                push(["type": "error", "code": term.code, "message": term.message])
                return
            } catch {
                if Task.isCancelled || currentGeneration() != gen { return }
                push(["type": "error", "message": error.localizedDescription])
            }
            if Task.isCancelled || currentGeneration() != gen { return }
            // The stream ended (server close / idle timeout / drop). Tell the
            // renderer, then reconnect with backoff — reset only if it had been
            // healthy long enough.
            push(["type": "closed"])
            backoff.onClosed(openDurationMs: Date().timeIntervalSince(openedAt) * 1000)
            try? await Task.sleep(nanoseconds: UInt64(backoff.nextDelayMs()) * 1_000_000)
        }
    }

    private func connectAndRead(url: String, bearer: String, account: String, generation gen: Int) async throws {
        guard var comps = URLComponents(string: "\(url)/events") else { throw URLError(.badURL) }
        comps.queryItems = [URLQueryItem(name: "accountId", value: account)]
        guard let target = comps.url else { throw URLError(.badURL) }

        // Belt-and-braces (the settings form is the primary gate): never send the
        // Bearer token over cleartext http on the public internet. https is always
        // fine; http is allowed only for loopback/LAN hosts. A refusal is TERMINAL —
        // reconnecting can't fix a bad scheme — so it takes the no-retry path below.
        guard Self.isSecureOrLanUrl(target) else {
            throw SseTerminalError(code: "insecure", message: "vault SSE refused: insecure http URL")
        }

        var req = URLRequest(url: target)
        req.httpMethod = "GET"
        req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 60

        let (bytes, response) = try await session.bytes(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        // 401/403 are auth failures — a revoked/invalid device token. Retrying can't
        // fix them (it would just reconnect forever at the 30s cap and re-hit the same
        // 401), so this is TERMINAL: stop the reader, push a distinct coded event so
        // the renderer surfaces it once. A fresh start() (after the user fixes the
        // token) begins a new reader normally.
        if status == 401 || status == 403 {
            throw SseTerminalError(code: "auth", message: "vault SSE auth failed: \(status)")
        }
        guard (200...299).contains(status) else {
            throw NSError(domain: "VaultSse", code: status,
                          userInfo: [NSLocalizedDescriptionKey: "vault SSE connect failed: \(status)"])
        }
        push(["type": "open"])

        // SSE framing at the BYTE level. We deliberately do NOT use bytes.lines
        // (AsyncLineSequence): it does not reliably yield the EMPTY lines that
        // delimit SSE event blocks, so a blank-line boundary is never seen and no
        // frame is ever emitted. Instead we accumulate the stream, normalize CRLF/CR
        // to LF, and split on the "\n\n" blank-line boundary ourselves — exactly like
        // Android's SseFraming and the renderer's drainSseBuffer. Decoding only at a
        // "\n" byte (0x0A, never part of a multibyte UTF-8 sequence) keeps UTF-8 safe
        // across chunk boundaries. Comment-only / heartbeat blocks (no data: line)
        // are dropped — matches Android's SseFraming.hasDataLine.
        var byteBuf = [UInt8]()
        var pending = ""
        for try await byte in bytes {
            if Task.isCancelled || currentGeneration() != gen { break }
            byteBuf.append(byte)
            // Cap the un-decoded byte buffer: a server that streams bytes but NEVER a
            // 0x0A ('\n') would otherwise grow this without bound (memory exhaustion).
            // Real events are tiny. Treat a breach as a stream failure (generic error →
            // backoff/reconnect), NOT terminal — a transient bad peer may recover.
            if byteBuf.count > Self.maxBufferBytes {
                throw SseStreamOverflowError()
            }
            guard byte == 0x0A else { continue }
            // Decode with String(decoding:as:) which NEVER fails: invalid UTF-8 is
            // replaced with U+FFFD (matching Android's InputStreamReader). The previous
            // failable init returned nil and `continue`d WITHOUT clearing byteBuf, so a
            // single bad byte permanently stalled the stream (every later '\n'
            // re-decoded a growing buffer, no frame ever emitted, and the socket looked
            // healthy so reconnect never fired). byteBuf is now ALWAYS cleared here.
            let chunk = String(decoding: byteBuf, as: UTF8.self)
            byteBuf.removeAll(keepingCapacity: true)
            pending += chunk.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            while let boundary = pending.range(of: "\n\n") {
                let block = String(pending[pending.startIndex..<boundary.lowerBound])
                pending = String(pending[boundary.upperBound...])
                if block.split(separator: "\n", omittingEmptySubsequences: false).contains(where: { $0.hasPrefix("data:") }) {
                    push(["type": "frame", "block": block])
                }
            }
            // Cap the framing remainder too: a server that sends '\n' bytes but never
            // the "\n\n" block delimiter would grow `pending` without bound. Same
            // treatment: fail the stream into backoff/reconnect.
            if pending.utf8.count > Self.maxBufferBytes {
                throw SseStreamOverflowError()
            }
        }
    }

    // MARK: - Push to the renderer

    private func push(_ msg: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(msg),
              let data = try? JSONSerialization.data(withJSONObject: msg),
              let json = String(data: data, encoding: .utf8) else { return }
        // JSON is valid JS object-literal syntax, so the renderer receives an object
        // (createBridgeSseClient.receive accepts an object OR a JSON string). Building
        // via JSONSerialization escapes quotes/newlines/unicode in the block safely.
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "window.__glanceVaultSseReceive && window.__glanceVaultSseReceive(\(json))",
                completionHandler: nil
            )
        }
    }

    // MARK: - Helpers

    private func currentGeneration() -> Int {
        lock.lock(); defer { lock.unlock() }
        return generation
    }

    private func clearReaderTask(ifGeneration gen: Int) {
        lock.lock(); defer { lock.unlock() }
        // Only clear if we're still the current generation — a newer reconcile may
        // have already replaced the task.
        if generation == gen { readerTask = nil }
    }

    private func trimTrailingSlashes(_ s: String) -> String {
        var out = s
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }

    // MARK: - URL transport-security allowlist (mirrors src/sync/vaultUrlPolicy.js)

    /// https is always allowed; http only for loopback/LAN hosts. Any other scheme is
    /// rejected. Keep in agreement with classifyVaultUrl (renderer) and Android.
    private static func isSecureOrLanUrl(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "https" { return true }
        if scheme != "http" { return false }
        return isLocalOrLanHost(url.host ?? "")
    }

    /// True for loopback / private-LAN / *.local hosts, for which cleartext http is
    /// acceptable. Foundation's URL.host already strips IPv6 brackets; the bracket
    /// strip below is defensive.
    private static func isLocalOrLanHost(_ rawHost: String) -> Bool {
        var host = rawHost.lowercased()
        if host.hasPrefix("[") && host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if host.isEmpty { return false }
        if host == "localhost" || host.hasSuffix(".localhost") { return true }
        if host == "::1" { return true }
        if host.hasSuffix(".local") { return true }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 4 else { return false }
        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ $0 >= 0 && $0 <= 255 }) else { return false }
        let a = octets[0], b = octets[1]
        if a == 127 { return true }              // 127.0.0.0/8 loopback
        if a == 10 { return true }               // 10.0.0.0/8
        if a == 192 && b == 168 { return true }  // 192.168.0.0/16
        if a == 172 && (16...31).contains(b) { return true } // 172.16.0.0/12
        return false
    }
}

/// A TERMINAL stream error: the reader must stop and NOT reconnect (retrying can't
/// help). `code` distinguishes the cause for the renderer ('auth' = revoked/invalid
/// token; 'insecure' = refused cleartext URL). Mirrors Android's SseTerminalException.
private struct SseTerminalError: Error {
    let code: String
    let message: String
}

/// A NON-terminal stream failure: the SSE framing buffer exceeded its cap. Handled
/// like any read error — backoff + reconnect (a transient bad peer may recover).
private struct SseStreamOverflowError: Error {}

/// Capped exponential backoff with a stability reset — the Swift mirror of Android's
/// `SseBackoff` and the renderer's reconnect policy in `createVaultEventClient`.
///
/// A connection open at least `minStableMs` is treated as healthy and resets the
/// attempt counter, so a long-lived stream that finally drops reconnects promptly.
/// A connection that opens then drops immediately (a flap) keeps backing off, up to
/// `maxMs`, so a broken endpoint can never storm the vault with reconnects.
private struct SseBackoff {
    private let baseMs: Double
    private let maxMs: Double
    private let minStableMs: Double
    private var attempt = 0

    init(baseMs: Double = 1000, maxMs: Double = 30000, minStableMs: Double = 5000) {
        self.baseMs = baseMs
        self.maxMs = maxMs
        self.minStableMs = minStableMs
    }

    /// The delay before the NEXT reconnect, then advances the counter. `base * 2^attempt`,
    /// capped at `maxMs`; the shift is clamped so a large attempt count can't overflow.
    mutating func nextDelayMs() -> Double {
        let shift = min(max(attempt, 0), 30)
        let delay = min(maxMs, baseMs * Double(1 << shift))
        attempt += 1
        return delay
    }

    /// Reset the backoff only when the connection was open at least `minStableMs`
    /// (a healthy stream); a flap leaves the counter climbing.
    mutating func onClosed(openDurationMs: Double) {
        if openDurationMs >= minStableMs { attempt = 0 }
    }
}
