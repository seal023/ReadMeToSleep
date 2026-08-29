#!/bin/bash
set -e
echo "Installing Pods after clone..."
cd ios
pod install
echo "Pod install completed."