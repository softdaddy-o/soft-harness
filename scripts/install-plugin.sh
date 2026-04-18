#!/usr/bin/env bash
set -euo pipefail

HOST="both"
TARGET="."
REPO="https://github.com/softdaddy-o/soft-harness.git"
REF="main"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --host=*)
            HOST="${1#*=}"
            shift
            ;;
        --target=*)
            TARGET="${1#*=}"
            shift
            ;;
        --repo=*)
            REPO="${1#*=}"
            shift
            ;;
        --ref=*)
            REF="${1#*=}"
            shift
            ;;
        *)
            echo "install failed: unsupported argument: $1" >&2
            exit 1
            ;;
    esac
done

if ! command -v git >/dev/null 2>&1; then
    echo "install failed: git is required" >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "install failed: node is required" >&2
    exit 1
fi

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t soft-harness-install)"
cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

git clone --depth 1 --branch "$REF" "$REPO" "$TMP_DIR" >/dev/null 2>&1
node "$TMP_DIR/scripts/install-plugin.js" "--target=$TARGET" "--host=$HOST" "--source-root=$TMP_DIR"
