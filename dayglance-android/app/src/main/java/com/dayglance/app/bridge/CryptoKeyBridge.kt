package com.dayglance.app.bridge

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.webkit.JavascriptInterface
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.security.KeyStore

/**
 * Stores and retrieves the JS-layer sync encryption key using the Android Keystore.
 *
 * The JS side exports its AES-256-GCM key bytes as a base64 JSON blob and hands
 * them to [storeSyncKey]. We wrap (encrypt) those bytes with a device-bound
 * Keystore key and persist the ciphertext in SharedPreferences. On retrieval,
 * [getSyncKey] unwraps and returns the original base64 blob to JS.
 *
 * Slots: the app has more than one independent key (the WebDAV file-tier key and
 * the GLANCEvault DB root key derive differently and must NOT share storage, or
 * each would clobber the other on this single bridge). [storeSyncKey]/[getSyncKey]
 * operate on the legacy default slot (the file tier, preserving keys written by
 * older builds). [storeSyncKeyForSlot]/[getSyncKeyForSlot] namespace the
 * SharedPreferences entry by `slot` so each tier gets isolated storage. All slots
 * are wrapped by the same device-bound Keystore key.
 *
 * The Keystore key never leaves the hardware security module. Even if
 * SharedPreferences were extracted from a device backup, the ciphertext is
 * useless without the device's Keystore key.
 *
 * These methods run on a background thread (Android's JavascriptInterface
 * dispatch) — Keystore operations are synchronous and safe to call there.
 */
class CryptoKeyBridge(private val context: Context) {

    companion object {
        private const val KEYSTORE_PROVIDER  = "AndroidKeyStore"
        private const val KEY_ALIAS          = "dayglance_sync_key_v1"
        private const val AES_GCM            = "AES/GCM/NoPadding"
        private const val GCM_TAG_LENGTH     = 128 // bits

        private const val PREFS_NAME         = "dayglance_crypto"
        private const val PREF_CIPHERTEXT    = "sync_key_ciphertext"
        private const val PREF_IV            = "sync_key_iv"
    }

    private val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).also { it.load(null) }

    // Returns the existing Keystore key, or generates a fresh one on first call.
    private fun getOrCreateKey(): SecretKey {
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (keyStore.getEntry(KEY_ALIAS, null) as KeyStore.SecretKeyEntry).secretKey
        }
        val keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        keyGen.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return keyGen.generateKey()
    }

    // SharedPreferences keys for a slot. The default slot (null/empty) keeps the
    // original key names so keys written by older builds stay readable; named
    // slots get a per-slot suffix.
    private fun ciphertextKey(slot: String?): String =
        if (slot.isNullOrEmpty()) PREF_CIPHERTEXT else "${PREF_CIPHERTEXT}_$slot"
    private fun ivKey(slot: String?): String =
        if (slot.isNullOrEmpty()) PREF_IV else "${PREF_IV}_$slot"

    // Wrap [b64] with the device-bound Keystore key and persist it under [slot],
    // or clear that slot when [b64] is null.
    private fun storeForSlot(slot: String?, b64: String?) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (b64 == null) {
            prefs.edit().remove(ciphertextKey(slot)).remove(ivKey(slot)).apply()
            return
        }
        val plaintext = Base64.decode(b64, Base64.DEFAULT)
        val key       = getOrCreateKey()
        val cipher    = Cipher.getInstance(AES_GCM)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val ciphertext = cipher.doFinal(plaintext)
        prefs.edit()
            .putString(ciphertextKey(slot), Base64.encodeToString(ciphertext, Base64.DEFAULT))
            .putString(ivKey(slot),         Base64.encodeToString(cipher.iv,  Base64.DEFAULT))
            .apply()
    }

    // Unwrap and return the blob stored under [slot], or "" when absent or
    // undecryptable (e.g. the Keystore key was replaced by a reinstall).
    private fun loadForSlot(slot: String?): String {
        val prefs          = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val ciphertextB64  = prefs.getString(ciphertextKey(slot), null) ?: return ""
        val ivB64          = prefs.getString(ivKey(slot),          null) ?: return ""
        return try {
            val ciphertext = Base64.decode(ciphertextB64, Base64.DEFAULT)
            val iv         = Base64.decode(ivB64,          Base64.DEFAULT)
            val key        = getOrCreateKey()
            val cipher     = Cipher.getInstance(AES_GCM)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_LENGTH, iv))
            val plaintext  = cipher.doFinal(ciphertext)
            Base64.encodeToString(plaintext, Base64.DEFAULT)
        } catch (_: Exception) {
            // Keystore key was replaced (reinstall, etc.) — JS will show passphrase prompt.
            ""
        }
    }

    /**
     * Encrypts [b64] (the JS sync key blob) with the Keystore key and persists
     * the ciphertext in the default slot. Pass null to clear the stored key
     * (e.g. when encryption is disabled).
     *
     * Called from JS as: `window.DayGlanceNative.storeSyncKey(b64)`
     */
    @JavascriptInterface
    fun storeSyncKey(b64: String?) = storeForSlot(null, b64)

    /**
     * Decrypts and returns the default-slot key blob, or "" if nothing is stored
     * or decryption fails (e.g. after an app reinstall that cleared the Keystore).
     *
     * Called from JS as: `window.DayGlanceNative.getSyncKey()`
     */
    @JavascriptInterface
    fun getSyncKey(): String = loadForSlot(null)

    /**
     * Like [storeSyncKey] but persists into the named [slot], isolated from the
     * default slot and from every other slot. Used so the GLANCEvault DB root key
     * never shares storage with the WebDAV file-tier key.
     *
     * Called from JS as: `window.DayGlanceNative.storeSyncKeyForSlot(slot, b64)`
     */
    @JavascriptInterface
    fun storeSyncKeyForSlot(slot: String, b64: String?) = storeForSlot(slot, b64)

    /**
     * Like [getSyncKey] but reads the named [slot].
     *
     * Called from JS as: `window.DayGlanceNative.getSyncKeyForSlot(slot)`
     */
    @JavascriptInterface
    fun getSyncKeyForSlot(slot: String): String = loadForSlot(slot)
}
