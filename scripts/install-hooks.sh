#!/usr/bin/env bash
# Installs the pre-commit hook (build stamp). Run once after cloning.
cd "$(dirname "$0")/.." && ln -sf ../../scripts/pre-commit .git/hooks/pre-commit && echo "pre-commit hook installed"
