#!/usr/bin/env bash
# 在 Mac 上、项目根目录执行。
# 用法:
#   ./deploy/publish.sh ubuntu@服务器公网IP
#   ./deploy/publish.sh ubuntu@服务器公网IP update
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:?用法: ./deploy/publish.sh user@server [first|update]}"
MODE="${2:-first}"
if [[ "$MODE" != "first" && "$MODE" != "update" ]]; then
  echo "第二个参数只能是 first 或 update。" >&2
  exit 1
fi
cd "$ROOT"
SSH_CMD=(ssh -o StrictHostKeyChecking=accept-new)
if [[ -n "${JUKEBOX_SSH_KEY:-}" ]]; then
  SSH_CMD+=(-i "$JUKEBOX_SSH_KEY" -o IdentitiesOnly=yes)
fi
"${SSH_CMD[@]}" "$HOST" "mkdir -p /srv/jukebox/app /srv/jukebox/data /srv/jukebox/backups"
rsync -az --delete -e "${SSH_CMD[*]}" \
  --exclude .git \
  --exclude node_modules \
  --exclude .next \
  --exclude data \
  --exclude .env \
  --exclude .env.local \
  --exclude .env.production \
  --exclude .env.development \
  --exclude '*.sqlite' \
  --exclude '*.sqlite-wal' \
  --exclude '*.sqlite-shm' \
  --exclude .wrangler \
  --exclude .sites-runtime \
  ./ "$HOST:/srv/jukebox/app/"
skip_build=0
if command -v docker >/dev/null 2>&1; then
  docker buildx build --platform linux/amd64 -t jukebox:current --load "$ROOT"
  docker save jukebox:current | "${SSH_CMD[@]}" "$HOST" "docker load"
  skip_build=1
else
  echo "这台 Mac 没有 Docker。将改由服务器构建镜像。2 GB 内存可能不够，建议先安装 Docker Desktop，见 DEPLOY_CN.md。"
fi
if [[ "$MODE" == "first" ]]; then
  remote_script="deploy/first-deploy.sh"
else
  remote_script="deploy/update.sh"
fi
"${SSH_CMD[@]}" "$HOST" "cd /srv/jukebox/app && JUKEBOX_SKIP_BUILD=$skip_build bash $remote_script"
