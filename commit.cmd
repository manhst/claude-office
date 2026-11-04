@echo off
rem Usage: commit.cmd "message" [--no-push] [--skip-checks] [--dry-run] [-y]
rem Runs tests/typecheck for the changed packages, asks, commits everything and pushes the current branch.
cd /d "%~dp0"
node scripts\commit.mjs %*
