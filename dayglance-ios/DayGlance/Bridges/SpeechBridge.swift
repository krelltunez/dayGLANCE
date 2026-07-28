import Foundation
import AVFoundation
import Speech
import WebKit

/// On-device speech recognition via SFSpeechRecognizer — lets the voice
/// quick-add work without any AI provider configured, matching the Android
/// SpeechRecognizer bridge contract exactly.
///
/// JS contract (see native.js in the web app):
///   DayGlanceNative.supportsSpeechRecognition() → "true" | "false"
///   DayGlanceNative.startSpeechRecognition()    → "ok" | {"error":"..."}
///   DayGlanceNative.stopSpeechRecognition()     → "ok" (final text via event)
///   DayGlanceNative.cancelSpeechRecognition()   → "ok" (no final event)
/// Events are pushed into the WebView as
///   window.__speechEvent({ status: 'partial'|'final'|'error', text?, message? })
/// — the same callback pattern SubscriptionBridge uses for __billingEvent.
///
/// Bridge calls arrive on a WKURLSchemeHandler background thread; all
/// AVAudioEngine / recognizer work is marshalled to the main thread.
/// Authorization (speech + microphone) is driven asynchronously after
/// start() returns "ok": denials surface as {status:'error'} events.
final class SpeechBridge {

    static let shared = SpeechBridge()

    weak var webView: WKWebView?

    private var recognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    // Mirrors the Android bridge: SFSpeech often errors ("no speech detected")
    // when the user taps stop mid-utterance even though partials arrived fine —
    // in that case the last partial IS the result.
    private var lastPartial = ""
    private var stopRequested = false
    private var cancelled = false

    // MARK: - Public API (called from BridgeSchemeHandler)

    func isAvailable() -> String {
        // Recognition support for the current locale; authorization is asked
        // for lazily on first start.
        let available = SFSpeechRecognizer(locale: Locale.current)?.isAvailable ?? false
        return available ? "true" : "false"
    }

    func start() -> String {
        DispatchQueue.main.async { [weak self] in
            self?.requestAuthorizationsThenStart()
        }
        return "ok"
    }

    func stop() -> String {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.audioEngine != nil else { return }
            self.stopRequested = true
            self.stopEngine()
            // endAudio() lets the recognizer flush; the final result (or the
            // error we translate into one) arrives in the task callback.
            self.request?.endAudio()
        }
        return "ok"
    }

    func cancel() -> String {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.cancelled = true
            self.stopEngine()
            self.task?.cancel()
            self.cleanup()
        }
        return "ok"
    }

    // MARK: - Internals (main thread)

    private func requestAuthorizationsThenStart() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    self?.emit(status: "error", message: "speech recognition permission denied — enable it in Settings")
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        guard granted else {
                            self?.emit(status: "error", message: "microphone permission denied — enable it in Settings")
                            return
                        }
                        self?.startListening()
                    }
                }
            }
        }
    }

    private func startListening() {
        // Tear down any stale session first (mirrors Android's busy-guard).
        if audioEngine != nil {
            stopEngine()
            task?.cancel()
            cleanup()
        }
        lastPartial = ""
        stopRequested = false
        cancelled = false

        guard let rec = SFSpeechRecognizer(locale: Locale.current), rec.isAvailable else {
            emit(status: "error", message: "speech recognition not available")
            return
        }
        recognizer = rec

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let engine = AVAudioEngine()
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            // requiresOnDeviceRecognition stays at its default (false): iOS uses
            // the on-device model when installed and Apple's recognition service
            // otherwise — forcing on-device would break devices without the model.

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                req.append(buffer)
            }
            engine.prepare()
            try engine.start()

            audioEngine = engine
            request = req
            task = rec.recognitionTask(with: req) { [weak self] result, error in
                DispatchQueue.main.async {
                    self?.handleRecognition(result: result, error: error)
                }
            }
        } catch {
            cleanup()
            emit(status: "error", message: esc(error.localizedDescription))
        }
    }

    private func handleRecognition(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result {
            let text = result.bestTranscription.formattedString
            if result.isFinal {
                finish(with: text.isEmpty ? lastPartial : text)
                return
            }
            if !text.isEmpty {
                lastPartial = text
                emit(status: "partial", text: text)
            }
            return
        }
        if error != nil {
            if cancelled { cleanup(); return }
            if stopRequested {
                // "No speech detected" after a deliberate stop — the partials
                // we already have are the result.
                finish(with: lastPartial)
            } else {
                let message = error.map { esc($0.localizedDescription) } ?? "unknown"
                stopEngine()
                cleanup()
                emit(status: "error", message: message)
            }
        }
    }

    private func finish(with text: String) {
        stopEngine()
        cleanup()
        emit(status: "final", text: text.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func stopEngine() {
        guard let engine = audioEngine else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        // Restore ambient session so background audio can resume (same as AudioBridge).
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    private func cleanup() {
        audioEngine = nil
        request = nil
        task = nil
    }

    // MARK: - Event emission

    private func emit(status: String, text: String? = nil, message: String? = nil) {
        var payload: [String: Any] = ["status": status]
        if let text { payload["text"] = text }
        if let message { payload["message"] = message }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(
                "if(typeof window.__speechEvent==='function'){window.__speechEvent(\(json));}",
                completionHandler: nil
            )
        }
    }

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
