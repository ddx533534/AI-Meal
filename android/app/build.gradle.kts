plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "dev.a2ui.mealpicker"
    compileSdk { version = release(37) { minorApiLevel = 1 } }
    defaultConfig {
        applicationId = "dev.a2ui.mealpicker"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "dev.a2ui.mealpicker.ConnectionSetupInstrumentation"
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies {
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.a2ui.compose:compose-runtime:1.0.0-alpha01")
    implementation("androidx.a2ui.compose:compose-ui:1.0.0-alpha01")
    implementation("androidx.compose.material3:material3-a2ui:1.0.0-alpha01")
    implementation("androidx.compose.material3:material3:1.5.0-alpha28")
    implementation("androidx.compose.foundation:foundation:1.13.0-alpha03")
    implementation("androidx.a2ui:a2ui-engine:1.0.0-alpha01")
}
