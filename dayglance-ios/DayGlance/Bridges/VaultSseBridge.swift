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

    // ── TEMP diagnostic counters (read via debugState() / the vaultSseDebugState
    // bridge method). They disambiguate a stuck reader without native-log access:
    // reader-not-running vs connect-hang vs bad-status vs frames-not-reaching-JS.
    // Strip once the iOS SSE path is confirmed healthy.
    private var connectAttempts = 0
    private var lastStatus: Int?
    private var lastError: String?
    private var opensPushed = 0
    private var framesPushed = 0
    private var pushDropped = 0
    private var startCalls = 0
    private var bytesReceived = 0

    // Dedicated session: a request-idle timeout longer than the ~25s server
    // heartbeat (a healthy idle stream never trips it, a silently-dead one is
    // detected within the window), and never a cached response. A stored `let`
    // (not lazy) so its first use from the reader Task can't race initialization.
    // waitsForConnectivity is OFF so a stalled connect surfaces as an error/timeout
    // (visible in debugState) rather than parking indefinitely.
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
        startCalls += 1
        self.vaultUrl = trimTrailingSlashes(vaultUrl)
        self.token = token
        self.accountId = accountId
        self.desired = true
        reconcileLocked()
        lock.unlock()
    }

    /// TEMP diagnostic snapshot of the reader's internal state, as a JSON string.
    /// Read from the web console via window.DayGlanceNative.vaultSseDebugState().
    /// Disambiguates a stuck reader: reader-not-running vs connect-hang (attempts
    /// but no status) vs bad-status vs frames-not-reaching-JS (hasWebView false /
    /// pushDropped > 0). Strip once the iOS SSE path is confirmed healthy.
    func debugState() -> String {
        lock.lock(); defer { lock.unlock() }
        let dict: [String: Any] = [
            "startCalls": startCalls,
            "desired": desired,
            "foreground": foreground,
            "readerRunning": readerTask != nil,
            "generation": generation,
            "hasWebView": webView != nil,
            "haveParams": vaultUrl != nil && token != nil && accountId != nil,
            "connectAttempts": connectAttempts,
            "lastStatus": lastStatus as Any,
            "lastError": lastError as Any,
            "bytesReceived": bytesReceived,
            "opensPushed": opensPushed,
            "framesPushed": framesPushed,
            "pushDropped": pushDropped,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
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
            } catch {
                if Task.isCancelled || currentGeneration() != gen { return }
                recordError(error.localizedDescription)
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

        var req = URLRequest(url: target)
        req.httpMethod = "GET"
        req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 60

        recordConnectAttempt()
        let (bytes, response) = try await session.bytes(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        recordStatus(status)
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
            guard byte == 0x0A else { continue }
            guard let chunk = String(bytes: byteBuf, encoding: .utf8) else { continue }
            recordBytes(byteBuf.count)
            byteBuf.removeAll(keepingCapacity: true)
            pending += chunk.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            while let boundary = pending.range(of: "\n\n") {
                let block = String(pending[pending.startIndex..<boundary.lowerBound])
                pending = String(pending[boundary.upperBound...])
                if block.split(separator: "\n", omittingEmptySubsequences: false).contains(where: { $0.hasPrefix("data:") }) {
                    push(["type": "frame", "block": block])
                }
            }
        }
    }

    // MARK: - Push to the renderer

    private func push(_ msg: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(msg),
              let data = try? JSONSerialization.data(withJSONObject: msg),
              let json = String(data: data, encoding: .utf8) else { return }
        // Count by type and detect a dropped push (weak webView gone) BEFORE the
        // async hop, so debugState() reflects the real delivery outcome.
        let type = msg["type"] as? String ?? "?"
        lock.lock()
        let wv = webView
        if wv == nil { pushDropped += 1 }
        else if type == "open" { opensPushed += 1 }
        else if type == "frame" { framesPushed += 1 }
        lock.unlock()
        guard let webView = wv else { return }
        // JSON is valid JS object-literal syntax, so the renderer receives an object
        // (createBridgeSseClient.receive accepts an object OR a JSON string). Building
        // via JSONSerialization escapes quotes/newlines/unicode in the block safely.
        DispatchQueue.main.async {
            webView.evaluateJavaScript(
                "window.__glanceVaultSseReceive && window.__glanceVaultSseReceive(\(json))",
                completionHandler: nil
            )
        }
    }

    // TEMP diagnostic recorders (lock-guarded so debugState reads a consistent view).
    private func recordConnectAttempt() { lock.lock(); connectAttempts += 1; lock.unlock() }
    private func recordStatus(_ s: Int) { lock.lock(); lastStatus = s; lock.unlock() }
    private func recordError(_ e: String) { lock.lock(); lastError = e; lock.unlock() }
    private func recordBytes(_ n: Int) { lock.lock(); bytesReceived += n; lock.unlock() }

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
}

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
