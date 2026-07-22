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
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dayglance.app"
        minSdk = 26  // Android 8.0 — required for Health Connect
        targetSdk = 35
        versionCode = 178
        versionName = "4.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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

    flavorDimensions += "distribution"
    productFlavors {
        create("play") {
            dimension = "distribution"
            buildConfigField("boolean", "BILLING_ENABLED", "true")
        }
        create("github") {
            dimension = "distribution"
            buildConfigField("boolean", "BILLING_ENABLED", "false")
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

    // Google Play Billing
    implementation(libs.billing.ktx)

    // Chrome Custom Tabs — privacy policy link in PermissionsRationaleActivity
    implementation(libs.browser)

    // Testing
    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
