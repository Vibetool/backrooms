#!/usr/bin/env bash
# 后室 · 打磨联系表 / 前后对照图入口（ENGINE_PLAN 第 4 节「实体画质打磨流程」）
#
#   tools/polish/sheet.sh <tag> [--out tests/output/gallery] [--per 8] [--thumb 220]
#       读 <out>/<tag>/gallery.json，每 8 个类型拼一张联系表 → <out>/<tag>/sheets/sheet-XX.png
#   tools/polish/sheet.sh --compare <before> <after> [--out tests/output/gallery] [--changed-only] [--jobs 8]
#       两个 tag 共有的每张图算像素差 AE → <out>/compare-<before>-<after>.json，每类型一张前后并排图 → <out>/compare-<before>-<after>/<type>.png
#
# 拼图、像素差全部交给 ImageMagick；解析 gallery.json、并发跑 compare 放在 sheet.mjs 里——
# 每格标注带空格和换行，在 bash 里拼 montage 参数太容易被拆词弄错
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "sheet.sh 需要 node" >&2
  exit 2
fi
if command -v magick >/dev/null 2>&1; then
  exec node "$here/sheet.mjs" "$@"
elif command -v montage >/dev/null 2>&1 && command -v compare >/dev/null 2>&1; then
  # ImageMagick 6 没有 magick 总入口，montage / compare / convert 是独立命令
  export SHEET_IM_LEGACY=1
  exec node "$here/sheet.mjs" "$@"
else
  echo "sheet.sh 需要 ImageMagick（macOS：brew install imagemagick）" >&2
  exit 2
fi
