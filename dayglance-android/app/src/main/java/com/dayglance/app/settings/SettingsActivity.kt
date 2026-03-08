package com.dayglance.app.settings

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.dayglance.app.R
import com.dayglance.app.data.SharedDataStore

/**
 * Phase 1 / Phase 4: Settings screen.
 *
 * Phase 1: placeholder for future settings.
 * Phase 4: Obsidian vault folder picker — user selects the vault root
 *          directory; the path is stored in SharedDataStore.
 *
 * TODO Phase 4: implement vault folder picker with Storage Access Framework
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

        findViewById<Button>(R.id.btn_select_vault)?.setOnClickListener {
            vaultPicker.launch(null)
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
