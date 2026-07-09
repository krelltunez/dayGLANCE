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

    // Dedicated session: a request-idle timeout longer than the ~25s server
    // heartbeat (a healthy idle stream never trips it, a silently-dead one is
    // detected within the window), and never a cached response. A stored `let`
    // (not lazy) so its first use from the reader Task can't race initialization.
    private let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        cfg.waitsForConnectivity = true
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

        var req = URLRequest(url: target)
        req.httpMethod = "GET"
        req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 60

        let (bytes, response) = try await session.bytes(for: req)
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200...299).contains(status) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            throw NSError(domain: "VaultSse", code: code,
                          userInfo: [NSLocalizedDescriptionKey: "vault SSE connect failed: \(code)"])
        }
        push(["type": "open"])

        // SSE framing: `.lines` decodes UTF-8 and splits on newlines; a blank line is
        // the block delimiter (SSE dispatch boundary). We rebuild each block by
        // joining its lines with "\n" so the renderer's parseSseFrame sees exactly
        // the raw block it expects. Comment-only / heartbeat blocks (no `data:` line)
        // are dropped here — matches Android's SseFraming.hasDataLine, saving a
        // renderer wakeup for a frame it would only parse to null anyway.
        var blockLines: [String] = []
        for try await line in bytes.lines {
            if Task.isCancelled || currentGeneration() != gen { break }
            if line.isEmpty {
                if !blockLines.isEmpty {
                    if blockLines.contains(where: { $0.hasPrefix("data:") }) {
                        push(["type": "frame", "block": blockLines.joined(separator: "\n")])
                    }
                    blockLines.removeAll(keepingCapacity: true)
                }
            } else {
                blockLines.append(line)
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
