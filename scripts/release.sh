#!/usr/bin/env bash
# Usage: scripts/release.sh 0.4.0 "Short release notes (markdown ok)"
# Writes js/version.js, commits, tags vX.Y.Z, pushes, creates the GitHub release.
set -euo pipefail
TAG="${1:?version, e.g. 0.4.0}"; NOTES="${2:-Release v$TAG}"
cd "$(dirname "$0")/.."
DATE=$(date +%F)
cat > js/version.js <<JS
// Updated by scripts/release.sh — do not edit by hand.
export const VERSION = { tag: '$TAG', date: '$DATE' };
export const REPO = 'aphentik/allure';
JS
git add js/version.js
git commit -q --allow-empty -m "Release v$TAG"
git tag -a "v$TAG" -m "v$TAG"
git push -q origin main "v$TAG"
gh release create "v$TAG" --title "v$TAG" --notes "$NOTES" >/dev/null && echo "released v$TAG → https://github.com/aphentik/allure/releases/tag/v$TAG"
