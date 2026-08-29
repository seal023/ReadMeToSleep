#!/bin/bash
set -e
echo "=== ci_post_clone.sh started ==="
echo "Current directory: $(pwd)"
echo "Listing files in ios directory:"
ls -la ios/ || echo "ios directory not found"

echo "Checking if pod is installed:"
which pod || echo "pod not found in PATH"

echo "Installing Pods..."
cd ios
pod install --verbose
echo "=== ci_post_clone.sh completed ==="l completed."