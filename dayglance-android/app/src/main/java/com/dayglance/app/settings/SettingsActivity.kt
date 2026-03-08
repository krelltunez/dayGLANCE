package com.dayglance.app.settings

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore
import com.google.android.material.textfield.TextInputEditText

/**
 * Phase 4: Settings screen.
 *
 * Allows the user to configure their Obsidian vault for daily note sync:
 *  - Vault root folder (selected via Storage Access Framework directory picker)
 *  - Daily note subfolder (relative path inside the vault, e.g. "Daily Notes")
 *  - Daily note filename pattern (Java DateTimeFormatter, e.g. "yyyy-MM-dd")
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var dataStore: SharedDataStore

    // Storage Access Framework directory picker
    private val vaultPicker = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri ->
        if (uri != null) {
            // Persist read/write access across reboots
            contentResolver.takePersistableUriPermission(
                uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
            dataStore.vaultPath = uri.toString()
            updateVaultPathDisplay()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        dataStore = SharedDataStore(this)

        supportActionBar?.apply {
            title = "Settings"
            setDisplayHomeAsUpEnabled(true)
        }

        updateVaultPathDisplay()

        // Populate daily note fields from stored prefs
        val folderField = findViewById<TextInputEditText>(R.id.et_daily_note_folder)
        val patternField = findViewById<TextInputEditText>(R.id.et_daily_note_pattern)

        folderField.setText(dataStore.dailyNoteFolder)
        patternField.setText(dataStore.dailyNotePattern)

        findViewById<Button>(R.id.btn_select_vault)?.setOnClickListener {
            vaultPicker.launch(null)
        }

        findViewById<Button>(R.id.btn_save_daily_note_settings)?.setOnClickListener {
            dataStore.dailyNoteFolder = folderField.text?.toString()?.trim() ?: ""
            val pattern = patternField.text?.toString()?.trim()
                .takeIf { !it.isNullOrBlank() }
                ?: SharedDataStore.DEFAULT_DAILY_NOTE_PATTERN
            dataStore.dailyNotePattern = pattern
            Toast.makeText(this, "Settings saved", Toast.LENGTH_SHORT).show()
        }
    }

    private fun updateVaultPathDisplay() {
        val path = dataStore.vaultPath ?: "Not configured"
        findViewById<TextView>(R.id.tv_vault_path)?.text = path
    }

    override fun onSupportNavigateUp(): Boolean {
        onBackPressedDispatcher.onBackPressed()
        return true
    }
}
