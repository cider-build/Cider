#!/usr/bin/env bash
# Build ciderctl in release mode and ad-hoc sign with the
# com.apple.security.virtualization entitlement.
set -euo pipefail

cd "$(dirname "$0")"

swift build -c release

BIN=".build/release/ciderctl"
codesign --force --sign - --entitlements ciderctl.entitlements "$BIN"

echo "built: $(pwd)/$BIN"
