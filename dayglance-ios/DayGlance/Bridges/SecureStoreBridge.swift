import Foundation
import Security

/// Device-local secure store behind the `secureGet` / `secureSet` bridge methods.
///
/// The web layer keeps everything in WKWebView storage, and iOS treats that
/// storage as evictable: a routine reboot purged it (2026-09-09) and the phone
/// came back on onboarding with no vault connection. This store is the native
/// mirror the web layer restores from on launch: the GLANCEvault connection,
/// the cloud sync preference, and the cached encryption-key records
/// (src/utils/nativeSecureStore.js names the slots).
///
/// Items are generic passwords under one service, one per slot, protected by
/// kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: readable in the background
/// once the device has been unlocked since boot, and never carried to iCloud
/// Keychain (the vault device token is per device, and the app never puts a
/// secret where another copy could read it). The sync passphrase itself is
/// not stored here; only what the web layer already cached on the device.
///
/// Called synchronously from the JS bridge on a WKURLSchemeHandler thread.
final class SecureStoreBridge {

    static let shared = SecureStoreBridge()

    private let service = "com.dayglance.app.securestore"

    /// The stored value, or "" when the slot is empty or unreadable. The JS
    /// wrapper treats "" as "no value", so the empty string is never a value.
    func get(slot: String) -> String {
        var query = baseQuery(slot: slot)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else { return "" }
        return value
    }

    /// Writes the value, or deletes the slot when the value is nil or empty.
    /// Returns "true" on success, "false" otherwise.
    func set(slot: String, value: String?) -> String {
        guard let value, !value.isEmpty, let data = value.data(using: .utf8) else {
            let status = SecItemDelete(baseQuery(slot: slot) as CFDictionary)
            return (status == errSecSuccess || status == errSecItemNotFound) ? "true" : "false"
        }
        let query = baseQuery(slot: slot)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return "true" }
        if updateStatus != errSecItemNotFound { return "false" }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess ? "true" : "false"
    }

    private func baseQuery(slot: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: slot,
        ]
    }
}
