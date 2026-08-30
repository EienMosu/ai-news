plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.eienmosu.theslowwire"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.eienmosu.theslowwire"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Signing credentials come from ~/.gradle/gradle.properties, which is
    // outside this repo and never committed. A machine without them still
    // builds every debug variant; only assembleRelease needs them.
    signingConfigs {
        create("release") {
            val storePath = providers.gradleProperty("THESLOWWIRE_STORE_FILE").orNull
            if (storePath != null) {
                storeFile = file(storePath)
                storePassword = providers.gradleProperty("THESLOWWIRE_STORE_PASSWORD").get()
                keyAlias = providers.gradleProperty("THESLOWWIRE_KEY_ALIAS").get()
                keyPassword = providers.gradleProperty("THESLOWWIRE_KEY_PASSWORD").get()
            }
        }
    }

    buildTypes {
        release {
            // R8 shrinks and renames what nothing reaches. The template shipped
            // with optimization disabled, which is fine for a placeholder app
            // and wrong for one that ships: this build drops roughly half the
            // APK. Compose and kotlinx-serialization bring their own keep rules
            // through consumer-rules, so the project file below stays short.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.coil.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    testImplementation(libs.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.androidx.junit)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
    debugImplementation(libs.androidx.compose.ui.tooling)
}