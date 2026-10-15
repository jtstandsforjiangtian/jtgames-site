#!/usr/bin/env bash
# 在 Mac 上用真正的 Caddy 和同一份 Caddyfile 预览整站：
#   http://127.0.0.1:8080/          作品主页（代理到本机 Next 服务）
#   http://127.0.0.1:8080/jukebox/  Jukebox
#   http://127.0.0.1:8080/sushi/    寿司店 Demo（来自 .sushi-release/current）
#
# 先在另一个终端启动 Next：pnpm build && pnpm start   （监听 127.0.0.1:3000）
# 再执行本脚本。需要 brew install caddy。
# 可选环境变量：PREVIEW_PORT（默认 8080）、APP_UPSTREAM（默认 127.0.0.1:3000）、SUSHI_REF（默认 main）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PREVIEW_PORT:-8080}"
UPSTREAM="${APP_UPSTREAM:-127.0.0.1:3000}"
RELEASE_ROOT="$ROOT/.sushi-release"

command -v caddy >/dev/null 2>&1 || { echo "没有找到 caddy。请先 brew install caddy。" >&2; exit 1; }

if [[ ! -L "$RELEASE_ROOT/current" ]]; then
  echo "还没有寿司发布副本，先从寿司仓库导出 ${SUSHI_REF:-main} …"
  bash "$ROOT/deploy/sync-sushi.sh" --dest "$RELEASE_ROOT" "${SUSHI_REF:-main}"
fi

if ! curl -s -o /dev/null --max-time 3 "http://$UPSTREAM/api/health"; then
  echo "本机 Next 服务 $UPSTREAM 没有响应。请先在另一个终端执行：pnpm build && pnpm start" >&2
  exit 1
fi

echo "寿司版本: $(sed -n 's/.*"commit": *"\([0-9a-f]*\)".*/\1/p' "$RELEASE_ROOT/current/sushi-version.json")"
echo "预览地址: http://127.0.0.1:$PORT/   /jukebox/   /sushi/   （Ctrl+C 停止）"
export SITE_ADDRESS="http://127.0.0.1:$PORT"
export WWW_ADDRESS="http://127.0.0.1:$((PORT + 1))"
export APP_UPSTREAM="$UPSTREAM"
export SUSHI_ROOT="$RELEASE_ROOT/current"
exec caddy run --config "$ROOT/Caddyfile" --adapter caddyfile
