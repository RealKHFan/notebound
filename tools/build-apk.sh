#!/usr/bin/env bash
# Builds a signed Notebound APK without Gradle, using only:
#   aapt2, javac (JDK 17+), dx or d8, zipalign, apksigner, node (for the UI)
# The normal way to build is Gradle (./gradlew assembleRelease); this script
# exists for machines without the Android Gradle Plugin.
#
# Environment:
#   ANDROID_JAR        android.jar used to compile the Java code (API 36)
#   ANDROID_RES_JAR    android.jar used by aapt2 to link resources (defaults to ANDROID_JAR)
#   BUILD_TOOLS        folder with aapt2, zipalign, apksigner, dx/d8 (optional if on PATH)
#   APP_ID             application id (default from app/build.gradle.kts)
#   KEYSTORE, KEYSTORE_PASS, KEY_ALIAS, KEY_PASS   release signing key
#   OUT                output apk path (default dist/notebound-<version>.apk)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_ID="${APP_ID:-$(sed -n 's/.*applicationId = "\(.*\)".*/\1/p' app/build.gradle.kts | head -1)}"
VERSION_NAME="$(sed -n 's/.*versionName = "\(.*\)".*/\1/p' app/build.gradle.kts | head -1)"
VERSION_CODE="$(sed -n 's/.*versionCode = \([0-9]*\).*/\1/p' app/build.gradle.kts | head -1)"
MIN_SDK="$(sed -n 's/.*minSdk = \([0-9]*\).*/\1/p' app/build.gradle.kts | head -1)"
TARGET_SDK="$(sed -n 's/.*targetSdk = \([0-9]*\).*/\1/p' app/build.gradle.kts | head -1)"
ANDROID_RES_JAR="${ANDROID_RES_JAR:-$ANDROID_JAR}"
OUT="${OUT:-dist/notebound-$VERSION_NAME.apk}"
tool() { if [ -n "${BUILD_TOOLS:-}" ] && [ -x "$BUILD_TOOLS/$1" ]; then echo "$BUILD_TOOLS/$1"; else command -v "$1"; fi; }
AAPT2="$(tool aapt2)"; ZIPALIGN="$(tool zipalign)"; APKSIGNER="$(tool apksigner)"
DEX="$(tool d8 || true)"; [ -z "$DEX" ] && DEX="$(tool dx)"

echo "Notebound $VERSION_NAME ($VERSION_CODE) -> $APP_ID, minSdk $MIN_SDK, targetSdk $TARGET_SDK"
B="$ROOT/build/apk"
rm -rf "$B"; mkdir -p "$B/res" "$B/gen" "$B/classes" "$B/dex"

echo "1/6 web UI"
(cd web && node build.mjs --out "$ROOT/app/src/main/assets/web" >/dev/null)

echo "2/6 resources"
sed -e "s/\${applicationId}/$APP_ID/g" \
    -e "s#<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">#<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\" package=\"io.github.realkhfan.notebound\">#" \
    app/src/main/AndroidManifest.xml > "$B/AndroidManifest.xml"
"$AAPT2" compile --dir app/src/main/res -o "$B/res/compiled.zip"
"$AAPT2" link -I "$ANDROID_RES_JAR" --manifest "$B/AndroidManifest.xml" -A app/src/main/assets \
  --min-sdk-version "$MIN_SDK" --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  --rename-manifest-package "$APP_ID" --custom-package io.github.realkhfan.notebound \
  --java "$B/gen" -o "$B/base.apk" "$B/res/compiled.zip" \
  --no-compress-regex '\.(png|jpg|woff2)$'

echo "3/6 java"
javac -nowarn -Xlint:-options -encoding UTF-8 -source 8 -target 8 -bootclasspath "$ANDROID_JAR" \
  -d "$B/classes" $(find app/src/main/java "$B/gen" -name '*.java')

echo "4/6 dex"
if [[ "$DEX" == *d8 ]]; then
  "$DEX" --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$B/dex" $(find "$B/classes" -name '*.class')
else
  "$DEX" --dex --min-sdk-version="$MIN_SDK" --output="$B/dex/classes.dex" "$B/classes"
fi

echo "5/6 package"
cp "$B/base.apk" "$B/unaligned.apk"
(cd "$B/dex" && zip -q -X "$B/unaligned.apk" classes*.dex)
"$ZIPALIGN" -f -p 4 "$B/unaligned.apk" "$B/aligned.apk"

echo "6/6 sign"
mkdir -p "$(dirname "$OUT")"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass "pass:$KEYSTORE_PASS" --ks-key-alias "$KEY_ALIAS" --key-pass "pass:$KEY_PASS" \
  --min-sdk-version "$MIN_SDK" --out "$OUT" "$B/aligned.apk"
"$APKSIGNER" verify --min-sdk-version "$MIN_SDK" "$OUT"
rm -f "$OUT.idsig"
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
