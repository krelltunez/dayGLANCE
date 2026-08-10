import UIKit
import Social
import UniformTypeIdentifiers

/// Share Extension entry point. Receives text / links shared into dayGLANCE from
/// the iOS share sheet, appends them to the App Group queue under
/// "shareExtensionPending", and confirms to the user. The app drains that queue
/// via WidgetBridge.getPendingShares() when it next comes to the foreground and
/// opens a pre-filled Add-task form.
///
/// NOTE ON WHY THIS SHOWS UI: the extension deliberately does not try to open
/// dayGLANCE. App extensions are barred from opening URLs — the responder-chain
/// openURL: trick stopped working in iOS 18 and Apple is explicit that this is by
/// design, not an oversight to route around. (Android differs: its ACTION_SEND
/// intent-filter really does launch MainActivity, so sharing there opens the app.
/// The platforms genuinely behave differently and that is not a bug.)
///
/// So a share can only land quietly in the App Group. Without UI this presented as
/// an empty white sheet flashing on screen and vanishing — the default
/// UIViewController view, shown for however long the async extraction took — which
/// reads as a failure. This confirmation is that missing feedback.
class ShareViewController: UIViewController {

    private let appGroup = "group.com.dayglance.app"
    private let pendingKey = "shareExtensionPending"

    // dayGLANCE brand orange, plus neutrals matching the app's light/dark themes
    // (Tailwind gray-800/gray-50). Resolved per trait collection so the sheet
    // follows the system appearance like the rest of the app.
    private let brand = UIColor(red: 0xFE / 255, green: 0x8B / 255, blue: 0x00 / 255, alpha: 1)
    private let cardColor = UIColor(dynamicProvider: { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x1F / 255, green: 0x29 / 255, blue: 0x37 / 255, alpha: 1)
            : UIColor.white
    })
    private let titleColor = UIColor(dynamicProvider: { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0xF9 / 255, green: 0xFA / 255, blue: 0xFB / 255, alpha: 1)
            : UIColor(red: 0x11 / 255, green: 0x18 / 255, blue: 0x27 / 255, alpha: 1)
    })
    private let subtitleColor = UIColor(red: 0x9C / 255, green: 0xA3 / 255, blue: 0xAF / 255, alpha: 1)

    private let card = UIView()
    private let headline = UILabel()
    private let detail = UILabel()
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        buildUI()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        extractContent { [weak self] text in
            guard let self else { return }
            // loadItem's completion is not guaranteed to be on the main queue.
            DispatchQueue.main.async {
                if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    self.saveToAppGroup(text: text)
                    self.show(saved: text)
                } else {
                    self.show(saved: nil)
                }
            }
        }
    }

    private func extractContent(completion: @escaping (String?) -> Void) {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            completion(nil); return
        }
        // Prefer plain text; fall back to URL string
        let providers = item.attachments ?? []
        if let textProvider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            textProvider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { data, _ in
                let text = (data as? String) ?? (data as? URL)?.absoluteString
                completion(text)
            }
        } else if let urlProvider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            urlProvider.loadItem(forTypeIdentifier: UTType.url.identifier) { data, _ in
                let url = (data as? URL)?.absoluteString ?? (data as? String)
                completion(url)
            }
        } else {
            completion(nil)
        }
    }

    private func saveToAppGroup(text: String) {
        guard let defaults = UserDefaults(suiteName: appGroup) else { return }
        var pending = defaults.stringArray(forKey: pendingKey) ?? []
        pending.append(text)
        defaults.set(pending, forKey: pendingKey)
    }

    // MARK: - UI

    private func buildUI() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

        card.backgroundColor = cardColor
        card.layer.cornerRadius = 16
        card.translatesAutoresizingMaskIntoConstraints = false
        card.alpha = 0
        view.addSubview(card)

        headline.font = .systemFont(ofSize: 17, weight: .semibold)
        headline.textColor = titleColor
        headline.numberOfLines = 1
        headline.textAlignment = .center

        detail.font = .systemFont(ofSize: 14)
        detail.textColor = subtitleColor
        detail.numberOfLines = 3
        detail.textAlignment = .center

        doneButton.setTitle("Done", for: .normal)
        doneButton.setTitleColor(brand, for: .normal)
        doneButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [headline, detail, doneButton])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
        ])
    }

    /// `saved` is the shared text we captured, or nil when there was nothing usable.
    private func show(saved: String?) {
        if let saved {
            let oneLine = saved
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "\n", with: " ")
            headline.text = "Saved to dayGLANCE"
            detail.text = "\(oneLine)\n\nIt'll be waiting as a new task next time you open the app."
        } else {
            headline.text = "Nothing to save"
            detail.text = "This item didn't contain any text or link dayGLANCE could use."
        }
        UIView.animate(withDuration: 0.2) { self.card.alpha = 1 }
    }

    @objc private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
