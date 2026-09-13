#!/usr/bin/env bash
# 用 GPT-IMAGE-2 生成后室贴图原图（tools/textures/raw/<名字>.png），再交给 process.py 做成无缝 jpg。
#
# 用法：tools/textures/gen.sh [名字...]      不给名字 = prompts.json 里全部
#   FORCE=1          已有原图也重新生成（默认跳过，省钱）
#   ONLY_PROCESS=1   不调接口，只重跑后处理
#   VIBETOOL_KEY_FILE=路径   key 文件；默认依次找 仓库根/.vibetool_key、~/.vibetool_key
#
# 踩过的坑：
#   - 必须 curl：Python urllib 会被 Cloudflare 403 拦。
#   - 请求体写成临时文件用 -d @file，避免 shell 展开 JSON 花括号。
#   - key 通过 curl -K - 从 stdin 传，不出现在命令行参数（ps 看不到）也不落盘。
#   - 单个任务偶尔卡住但其实还在跑：超时就再提交一份，新旧 task_id 一起轮询，谁先出图用谁。
#   - bash 3.2（macOS 自带）没有关联数组，所以 prompt 放 prompts.json 由 python 取。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
RAW="$HERE/raw"
API="https://api.vibetool.ai/v1/images"
POLL_INTERVAL=6
RESUBMIT_AFTER=240     # 秒：没出图就补交一份
GIVE_UP_AFTER=1200     # 秒：彻底放弃
MAX_TASKS=3

mkdir -p "$RAW"

if [ "${ONLY_PROCESS:-0}" != "1" ]; then
  KEY_FILE="${VIBETOOL_KEY_FILE:-}"
  if [ -z "$KEY_FILE" ]; then
    for f in "$ROOT/.vibetool_key" "$HOME/.vibetool_key"; do
      if [ -f "$f" ]; then KEY_FILE="$f"; break; fi
    done
  fi
  if [ -z "$KEY_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo "找不到 key 文件，设置 VIBETOOL_KEY_FILE" >&2; exit 1
  fi
  KEY="$(tr -d ' \r\n' < "$KEY_FILE")"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$#" -gt 0 ]; then
  NAMES="$*"
else
  NAMES="$(python3 -c "import json,sys; print(' '.join(k for k in json.load(open(sys.argv[1])) if not k.startswith('_')))" "$HERE/prompts.json")"
fi

# $1 = 方法(GET/POST) $2 = URL $3 = 输出文件 [$4 = 请求体文件]；打印 HTTP 状态码
api() {
  local method="$1" url="$2" out="$3" body="${4:-}"
  if [ "$method" = "POST" ]; then
    printf 'header = "Authorization: Bearer %s"\n' "$KEY" | curl -sS --max-time 60 -K - \
      -H 'Content-Type: application/json' -d @"$body" -o "$out" -w '%{http_code}' "$url" || echo "000"
  else
    printf 'header = "Authorization: Bearer %s"\n' "$KEY" | curl -sS --max-time 60 -K - \
      -o "$out" -w '%{http_code}' "$url" || echo "000"
  fi
}

# 从状态 JSON 里取 "状态<TAB>图片URL"；接口字段以后可能变，所以递归找而不是写死路径
parse_status() {
  python3 - "$1" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("badjson\t"); sys.exit()
status, urls = "", []
def walk(o, k=None):
    global status
    if isinstance(o, dict):
        for kk, v in o.items(): walk(v, kk)
    elif isinstance(o, list):
        for v in o: walk(v, k)
    elif isinstance(o, str):
        if k in ("status", "state") and not status: status = o
        if o.startswith("http") and k in ("url", "image_url", "image", "output"): urls.append(o)
walk(d)
print(status + "\t" + (urls[0] if urls else ""))
PY
}

submit() {  # $1 名字 → 打印 task_id（失败打印空）
  local name="$1" out="$TMP/$1.submit.$RANDOM.json" code
  code="$(api POST "$API/generations" "$out" "$TMP/$name.body.json")"
  if [ "$code" != "200" ]; then
    echo "[$name] 提交失败 HTTP $code: $(head -c 300 "$out" 2>/dev/null)" >&2
    echo ""; return
  fi
  python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('task_id',''))" "$out" 2>/dev/null || echo ""
}

gen_one() {
  local name="$1"
  local dest="$RAW/$name.png"
  if [ -f "$dest" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "[$name] 已有原图，跳过"; return 0
  fi
  python3 - "$HERE/prompts.json" "$name" > "$TMP/$name.body.json" <<'PY'
import json, sys
p = json.load(open(sys.argv[1])); n = sys.argv[2]
if n not in p: sys.exit("prompts.json 里没有 " + n)
print(json.dumps({"model": "gpt-image-2", "prompt": p[n] + " " + p["_common"],
                  "async_mode": True, "size": "1024x1024", "quality": "high", "n": 1}))
PY
  local tasks tid start last now st url code line
  tid="$(submit "$name")"
  tasks="$tid"
  start=$(date +%s); last=$start
  echo "[$name] 已提交 ${tid:-（失败）}"
  while :; do
    sleep "$POLL_INTERVAL"
    now=$(date +%s)
    for tid in $tasks; do
      code="$(api GET "$API/status/$tid" "$TMP/$name.$tid.json")"
      [ "$code" = "200" ] || continue
      line="$(parse_status "$TMP/$name.$tid.json")"
      st="${line%%	*}"; url="${line#*	}"
      if [ -n "$url" ]; then
        # 图片地址是公开 CDN，下载时不带 key
        if curl -sS -L --max-time 180 -o "$TMP/$name.png" "$url" \
           && python3 -c "from PIL import Image; import sys; Image.open(sys.argv[1]).verify()" "$TMP/$name.png"; then
          mv "$TMP/$name.png" "$dest"
          echo "[$name] 完成（$tid，$((now - start)) 秒）"
          return 0
        fi
      fi
      case "$st" in
        failed|error|cancelled|canceled|timeout)
          echo "[$name] 任务 $tid 状态 $st，丢弃"
          tasks="$(echo "$tasks" | tr ' ' '\n' | grep -v "^$tid\$" | tr '\n' ' ')";;
      esac
    done
    local count; count=$(echo "$tasks" | wc -w | tr -d ' ')
    if [ $((now - start)) -gt "$GIVE_UP_AFTER" ]; then
      echo "[$name] 超过 ${GIVE_UP_AFTER}s 仍未出图，放弃" >&2; return 1
    fi
    if [ "$count" -eq 0 ] || { [ $((now - last)) -gt "$RESUBMIT_AFTER" ] && [ "$count" -lt "$MAX_TASKS" ]; }; then
      tid="$(submit "$name")"
      if [ -n "$tid" ]; then tasks="$tasks $tid"; echo "[$name] 补交 $tid，同时轮询 $tasks"; fi
      last=$now
    fi
  done
}

if [ "${ONLY_PROCESS:-0}" != "1" ]; then
  pids=""
  for n in $NAMES; do
    gen_one "$n" &
    pids="$pids $!"
  done
  fail=0
  for p in $pids; do wait "$p" || fail=1; done
  [ "$fail" = "0" ] || echo "有贴图没生成成功，后处理只处理已有原图" >&2
fi

python3 "$HERE/process.py"
