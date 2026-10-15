#!/usr/bin/env bash
# 在腾讯云服务器上执行。只把应用镜像退回上一版，不改数据库，也不删除证书卷。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh
require_server_layout
if ! docker image inspect jukebox:previous >/dev/null 2>&1; then
  echo "没有上一版镜像 jukebox:previous，不能回滚应用。" >&2
  exit 1
fi
docker tag jukebox:previous jukebox:current
cd "$APP_DIR"
"${COMPOSE[@]}" up -d --no-build --force-recreate --no-deps app
"${COMPOSE[@]}" up -d --no-build caddy
wait_app_healthy
echo "应用已回到上一版镜像。数据库没有被这条命令替换。"
