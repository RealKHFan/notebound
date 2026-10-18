import java.util.Properties

plugins {
    id("com.android.application")
}

// Release signing: put a keystore.properties next to settings.gradle.kts (never commit it):
// storeFile=/path/to/notebound-release.jks  storePassword=…  keyAlias=notebound  keyPassword=…
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.realkhfan.notebound"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.realkhfan.notebound"
        minSdk = 21
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        if (!keystoreProps.isEmpty) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (!keystoreProps.isEmpty) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    // No Google-specific dependency metadata blob in the APK (F-Droid friendly).
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

// The UI (web/) is bundled into assets/web before every build.
val buildWeb by tasks.registering(Exec::class) {
    description = "Builds the Notebound UI into app/src/main/assets/web"
    workingDir = rootProject.file("web")
    commandLine("sh", "-c", "npm ci --no-audit --no-fund && node build.mjs")
    inputs.dir(rootProject.file("web/src"))
    inputs.file(rootProject.file("web/build.mjs"))
    inputs.file(rootProject.file("web/package-lock.json"))
    outputs.dir(layout.projectDirectory.dir("src/main/assets/web"))
}
tasks.named("preBuild") { dependsOn(buildWeb) }
