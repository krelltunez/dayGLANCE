import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.ksp)
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val hasKeystore = keystorePropertiesFile.exists()
val keystoreProperties: Properties? = if (hasKeystore) {
    Properties().apply { load(keystorePropertiesFile.inputStream()) }
} else null

android {
    namespace = "com.dayglance.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.dayglance.app"
        minSdk = 26  // Android 8.0 — required for Health Connect
        targetSdk = 36
        // Overridable per-build from the command line (build-and-install.sh
        // passes -PversionCode=N for release builds); the literal is the
        // fallback for plain gradle/IDE builds and no longer needs a commit
        // per Play upload.
        versionCode = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 185
        versionName = "5.13.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // GLANCElauncher's permission (AndroidManifest.xml). Release builds must
        // keep exactly this name: the launcher requests it.
        manifestPlaceholders["launcherPermission"] = "com.dayglance.permission.LAUNCHER"
    }

    signingConfigs {
        if (hasKeystore && keystoreProperties != null) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // A debug build is its own package, so it declares its own launcher
            // permission (and, through applicationId, its own provider
            // authority): a test APK then installs beside the store app instead
            // of failing with INSTALL_FAILED_DUPLICATE_PERMISSION (#2272). The
            // launcher only pairs with com.dayglance.app, so nothing is lost.
            manifestPlaceholders["launcherPermission"] = "com.dayglance.permission.LAUNCHER_DEBUG"
        }
        release {
            if (hasKeystore) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    // Ship every language in the Play bundle instead of splitting them out.
    // Play installs only the language splits matching the device's system
    // languages, but the in-app picker can set the app language to any of them
    // (LocaleBridge); a Polish choice on an English-only phone would find no
    // values-pl installed and fall back to English. The sideload APK is a
    // universal build and already carries every language.
    bundle {
        language {
            enableSplit = false
        }
    }

    // Name the release APK dayglance.apk
    applicationVariants.all {
        outputs.all {
            this as com.android.build.gradle.internal.api.BaseVariantOutputImpl
            if (buildType.name == "release") {
                outputFileName = "dayglance.apk"
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    sourceSets {
        // The widget snapshot fixture the JS producers write (npm run
        // ios:vectors) and the iOS widget tests read. Served to the JVM unit
        // tests from its one home rather than copied, so the Kotlin and Swift
        // month grid tests see the same bytes and the JS drift test
        // (widgetSnapshotFixture.test.js) guards both.
        getByName("test") {
            resources.srcDir("../../dayglance-ios/TestFixtures")
        }
    }

    flavorDimensions += "distribution"
    productFlavors {
        // LAUNCHER_PROMO_URL: where Settings' GLANCElauncher card links
        // (bridge/LauncherPromo.kt, src/utils/launcherPromo.js). Empty means
        // the build shows no card and no Integrations entry at all.
        create("play") {
            dimension = "distribution"
            buildConfigField("boolean", "BILLING_ENABLED", "true")
            // Empty until GLANCElauncher is approved on Google Play. Once it is, set this to
            // "https://play.google.com/store/apps/details?id=app.glance.launcher".
            buildConfigField("String", "LAUNCHER_PROMO_URL", "\"\"")
        }
        create("github") {
            dimension = "distribution"
            buildConfigField("boolean", "BILLING_ENABLED", "false")
            buildConfigField("String", "LAUNCHER_PROMO_URL", "\"https://github.com/krelltunez/GLANCElauncher/releases/latest\"")
        }
    }
}

// Guard: a Release build without the bundled web assets (populated by
// `npm run build:android` / build-and-install.sh into src/main/assets/web/, which
// is gitignored) silently ships a blank-WebView app. Fail the release build early
// with a clear pointer if index.html is missing. Debug builds are never blocked:
// the verify task is wired only into release variants' merge-assets step, so it runs
// on `bundleRelease` / `assembleRelease` but not on any debug build.
androidComponents {
    onVariants(selector().withBuildType("release")) { variant ->
        val capName = variant.name.replaceFirstChar { it.uppercase() }
        val verifyWebAssets = tasks.register("verify${capName}WebAssets") {
            group = "verification"
            description = "Fails the $capName build when bundled web assets are missing."
            doLast {
                val indexHtml = layout.projectDirectory.file("src/main/assets/web/index.html").asFile
                if (!indexHtml.exists()) {
                    throw GradleException(
                        "Bundled web assets not found at ${indexHtml.path}. " +
                        "A Release build without them ships a blank-WebView app. " +
                        "Run `npm run build:android` from the repo root (or build-and-install.sh) " +
                        "to build and copy the web assets before building the release AAB/APK."
                    )
                }
            }
        }
        // The variant's tasks are NOT yet registered while onVariants runs (AGP
        // creates them after the variant API callbacks), so tasks.named() here
        // throws "Task with name 'mergeXxxAssets' not found" at configuration
        // time and breaks every build. configureEach is lazy: it also applies to
        // tasks created later, so the dependency attaches when AGP registers the
        // merge task.
        val mergeTaskName = "merge${capName}Assets"
        tasks.configureEach {
            if (name == mergeTaskName) dependsOn(verifyWebAssets)
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.constraintlayout)

    // Health Connect
    implementation(libs.health.connect)

    // WorkManager — widget periodic updates
    implementation(libs.androidx.work.runtime.ktx)

    // Room — shared data layer (widget <-> WebView)
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)

    // Lifecycle
    implementation(libs.androidx.lifecycle.viewmodel.ktx)

    // WebKit — WebViewAssetLoader serves assets via https://appassets.androidplatform.net
    // so ES module scripts load without CORS errors on file:// URLs
    implementation(libs.androidx.webkit)

    // Splash screen
    implementation(libs.androidx.core.splashscreen)

    // DocumentFile — Storage Access Framework wrapper for Obsidian vault file I/O
    implementation(libs.androidx.documentfile)

    // Google Play Billing (base Java artifact — see note in libs.versions.toml)
    implementation(libs.billing)

    // Chrome Custom Tabs — privacy policy link in PermissionsRationaleActivity
    implementation(libs.browser)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.json)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
