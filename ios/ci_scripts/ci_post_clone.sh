#!/bin/sh
set -e
set -x

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_DIR"

echo "PWD=$(pwd)"

brew install node || true
node -v
npm -v

npm install

npx expo prebuild -p ios --clean --no-install

cd ios
pod install --repo-update

echo "=== DONE ==="