#!/bin/bash
# Build a locally installable macOS DMG with an Apple Development identity.
# This gives macOS a stable TCC identity during development, but is not a
# notarized release suitable for sharing with other people.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ "$(uname)" != "Darwin" ]]; then
    echo "This command must run on macOS."
    exit 1
fi

DEVELOPMENT_IDENTITY="$(
    security find-identity -v -p codesigning |
        sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' |
        head -n 1
)"

if [ -z "$DEVELOPMENT_IDENTITY" ]; then
    echo "No Apple Development signing identity is installed."
    echo "Open Xcode → Settings → Accounts → add your Apple ID → Manage Certificates → + → Apple Development."
    echo "Then confirm it with: security find-identity -v -p codesigning"
    exit 1
fi

echo "Using Apple Development identity: $DEVELOPMENT_IDENTITY"
npm run build:native:mac
npx tsc
npx rimraf dist-electron
npx vite build
node scripts/bundle-remotion.mjs

# mac.notarize is false in electron-builder.json5, so this signs the app for
# local development without submitting it to Apple's notarization service.
CSC_NAME="$DEVELOPMENT_IDENTITY" npx electron-builder --mac

VERSION="$(node -p "require('./package.json').version")"
APP_BUNDLES=(release/"$VERSION"/*/Guide\ Studio.app)

if [ "${#APP_BUNDLES[@]}" -eq 0 ] || [ ! -d "${APP_BUNDLES[0]}" ]; then
    echo "Could not find the packaged Guide Studio.app to verify its signature."
    exit 1
fi

for APP_BUNDLE in "${APP_BUNDLES[@]}"; do
    SIGNATURE_INFO="$(codesign -dvvv "$APP_BUNDLE" 2>&1)"
    if printf '%s\n' "$SIGNATURE_INFO" | grep -q '^Signature=adhoc$' || \
       ! printf '%s\n' "$SIGNATURE_INFO" | grep -q '^Authority=Apple Development:'; then
        echo "The packaged app was not signed with the Apple Development identity."
        exit 1
    fi
done

echo "Development DMG created. Install its Guide Studio.app in /Applications and grant Screen Recording once."
