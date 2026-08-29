#!/bin/sh
set -e
set -x

echo "PWD=$(pwd)"
echo "CI_WORKSPACE=$CI_WORKSPACE"

cd "$CI_WORKSPACE"

brew install node || true
node -v
npm -v

npm install

cd ios
pod install --repo-update

echo "=== DONE ==="