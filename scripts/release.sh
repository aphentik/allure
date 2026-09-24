#!/usr/bin/env bash
# Usage: scripts/release.sh 0.4.0 "Short release notes (markdown ok)"
# Writes js/version.js, commits, tags vX.Y.Z, pushes, creates the GitHub release.
set -euo pipefail
TAG="${1:?version, e.g. 0.4.0}"; NOTES="${2:-Release v$TAG}"
cd "$(dirname "$0")/.."
DATE=$(date +%F)
BUILD=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > js/version.js <<JS
// Updated by scripts/release.sh and the pre-commit hook — do not edit by hand.
export const VERSION = { tag: '$TAG', date: '$DATE', build: '$BUILD' };
export const REPO = 'aphentik/allure';
JS
git add js/version.js
git commit -q --allow-empty -m "Release v$TAG"
git tag -a "v$TAG" -m "v$TAG"
git push -q origin main
git push -q origin "v$TAG"
echo "tagged and pushed v$TAG → https://github.com/aphentik/allure/releases/tag/v$TAG"
gh release create "v$TAG" --title "v$TAG" --notes "$NOTES" >/dev/null 2>&1 && echo "GitHub release created" || echo "GitHub release not created (gh account lacks write access) — create it from the tag page if wanted"
