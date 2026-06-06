import Foundation
import CoreSpotlight
import UniformTypeIdentifiers

final class SpotlightBridge {
    static let shared = SpotlightBridge()
    private let domainId = "com.dayglance.tasks"

    /// Index an array of items. JSON: [{id, title, date?, notes?}]
    func indexItems(_ json: String) {
        guard let data = json.data(using: .utf8),
              let items = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }

        let searchableItems = items.compactMap { item -> CSSearchableItem? in
            guard let id = item["id"] as? String,
                  let title = item["title"] as? String else { return nil }
            let attrs = CSSearchableItemAttributeSet(contentType: .text)
            attrs.title = title
            attrs.contentDescription = item["notes"] as? String
            if let dateStr = item["date"] as? String {
                attrs.contentCreationDate = ISO8601DateFormatter().date(from: dateStr + "T00:00:00Z")
            }
            return CSSearchableItem(uniqueIdentifier: id, domainIdentifier: domainId, attributeSet: attrs)
        }

        CSSearchableIndex.default().indexSearchableItems(searchableItems) { _ in }
    }

    /// Remove indexed items by ID array. JSON: ["id1","id2",...]
    func deindexItems(_ json: String) {
        guard let data = json.data(using: .utf8),
              let ids = try? JSONSerialization.jsonObject(with: data) as? [String] else { return }
        CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ids) { _ in }
    }

    /// Delete all indexed items for this app.
    func deindexAll() {
        CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domainId]) { _ in }
    }
}
