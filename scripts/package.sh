#!/usr/bin/env bash
# Chrome Web Store 配布用の zip を src/ から生成する。
# manifest.json がアーカイブのルートに来るよう、src/ の中身を zip 化する。
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
src_dir="$root_dir/src"

version="$(grep -o '"version": *"[^"]*"' "$src_dir/manifest.json" | head -1 | sed 's/.*"\([0-9][^"]*\)"/\1/')"
out="$root_dir/github-pr-live-folder-v${version}.zip"

rm -f "$out"
(cd "$src_dir" && zip -r -X "$out" . -x '*.DS_Store')

echo "wrote $out"
