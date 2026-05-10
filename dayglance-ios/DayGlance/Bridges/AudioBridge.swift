import Foundation
import AVFoundation

/// Records voice input via AVAudioRecorder and returns it as a base64 MP4 data URL,
/// matching the Android MediaRecorder bridge contract exactly.
///
/// Called synchronously from the JS bridge on a WKURLSchemeHandler background thread.
/// All AVAudioSession / AVAudioRecorder interactions are marshalled to the main thread.
final class AudioBridge {

    static let shared = AudioBridge()

    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?

    // MARK: - Public API

    /// Activates the record audio session, creates the recorder, and starts capture.
    /// Returns "ok" on success or {"error":"…"} on failure.
    func startRecording() -> String {
        var result = "ok"
        DispatchQueue.main.sync {
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.record, mode: .default)
                try session.setActive(true)

                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("dayglance_voice.m4a")
                recordingURL = url

                let settings: [String: Any] = [
                    AVFormatIDKey:         Int(kAudioFormatMPEG4AAC),
                    AVSampleRateKey:       16000.0,
                    AVEncoderBitRateKey:   32000,
                    AVNumberOfChannelsKey: 1,
                ]

                let rec = try AVAudioRecorder(url: url, settings: settings)
                rec.prepareToRecord()

                guard rec.record() else {
                    // record() returns false when permission is denied; iOS shows
                    // the system dialog automatically on the first attempt.
                    result = #"{"error":"Could not start recording — grant microphone access in Settings and try again"}"#
                    return
                }
                recorder = rec
            } catch {
                result = #"{"error":"\#(esc(error.localizedDescription))"}"#
            }
        }
        return result
    }

    /// Stops the recorder, restores the ambient audio session, and returns the
    /// captured audio as a data:audio/mp4;base64,… string (matching Android).
    /// Returns {"error":"…"} if no recording is active or if file I/O fails.
    func stopRecording() -> String {
        var result = #"{"error":"no active recording"}"#
        DispatchQueue.main.sync {
            guard let rec = recorder, let url = recordingURL else { return }
            rec.stop()
            recorder = nil
            recordingURL = nil

            // Restore ambient session so background audio can resume.
            try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
            try? AVAudioSession.sharedInstance().setActive(true)

            do {
                let data = try Data(contentsOf: url)
                try? FileManager.default.removeItem(at: url)
                result = "data:audio/mp4;base64,\(data.base64EncodedString())"
            } catch {
                result = #"{"error":"\#(esc(error.localizedDescription))"}"#
            }
        }
        return result
    }

    // MARK: - Helpers

    private func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "\\", with: "\\\\")
         .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
