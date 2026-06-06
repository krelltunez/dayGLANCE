import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: UIViewController {

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        extractContent { [weak self] text in
            if let text {
                self?.saveToAppGroup(text: text)
            }
            self?.extensionContext?.completeRequest(returningItems: nil)
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
        guard let defaults = UserDefaults(suiteName: "group.com.dayglance.app") else { return }
        var pending = defaults.stringArray(forKey: "shareExtensionPending") ?? []
        pending.append(text)
        defaults.set(pending, forKey: "shareExtensionPending")
    }
}
