package com.dayglance.app

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.view.WindowCompat
import com.dayglance.app.data.SharedDataStore
import com.dayglance.app.databinding.ActivityPermissionsRationaleBinding

class PermissionsRationaleActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPermissionsRationaleBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        // Follow the app's own dark/light setting rather than the system night mode.
        delegate.localNightMode = when (SharedDataStore(this).appDarkMode) {
            true  -> AppCompatDelegate.MODE_NIGHT_YES
            false -> AppCompatDelegate.MODE_NIGHT_NO
            null  -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
        }
        super.onCreate(savedInstanceState)
        // Opt out of edge-to-edge so the action bar and content sit below the status bar.
        // targetSdk 35 enforces edge-to-edge by default; without this the action bar renders
        // at y=0 (under the transparent status bar) and content overlaps the header.
        WindowCompat.setDecorFitsSystemWindows(window, true)
        binding = ActivityPermissionsRationaleBinding.inflate(layoutInflater)
        setContentView(binding.root)

        supportActionBar?.apply {
            title = "Health Connect Permissions"
            setDisplayHomeAsUpEnabled(true)
        }

        binding.btnPrivacyPolicy.setOnClickListener {
            CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(
                    CustomTabColorSchemeParams.Builder()
                        .setToolbarColor(Color.parseColor("#3b82f6"))
                        .build()
                )
                .build()
                .launchUrl(this, Uri.parse("https://docs.dayglance.app/en/privacy-policy"))
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        onBackPressedDispatcher.onBackPressed()
        return true
    }
}
