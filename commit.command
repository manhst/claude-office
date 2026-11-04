#!/bin/bash
# Usage: ./commit.command "message" [--no-push] [--skip-checks] [--dry-run] [-y]
# Runs tests/typecheck for the changed packages, asks, commits everything and pushes the current branch.
cd "$(dirname "$0")" || exit 1
exec node scripts/commit.mjs "$@"
