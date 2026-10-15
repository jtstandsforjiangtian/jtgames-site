#!/usr/bin/env bash
# 在腾讯云服务器上执行。替换应用容器，保留数据库目录、备份目录和 Caddy 证书卷。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh
require_server_layout
require_amd64
cd "$APP_DIR"

if [[ -f "$DATA_DIR/jukebox.sqlite" ]]; then
  bash "$APP_DIR/deploy/backup.sh"
fi
if docker image inspect jukebox:current >/dev/null 2>&1; then
  docker tag jukebox:current jukebox:previous
fi
if [[ "${JUKEBOX_SKIP_BUILD:-}" == "1" ]]; then
  "${COMPOSE[@]}" up -d --no-build --force-recreate --no-deps app
else
  "${COMPOSE[@]}" build app
  "${COMPOSE[@]}" up -d --no-build --force-recreate --no-deps app
fi
if ! wait_app_healthy; then
  echo "新版本未通过健康检查。若存在上一版镜像，将回滚应用。" >&2
  if docker image inspect jukebox:previous >/dev/null 2>&1; then
    bash "$APP_DIR/deploy/rollback.sh"
  fi
  exit 1
fi
# rsync replaces Caddyfile with a new inode. Recreate the container so the bind mount sees it.
"${COMPOSE[@]}" up -d --no-build --force-recreate --no-deps caddy
if ! "${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then
  echo "Caddy 配置未能重新加载。应用已更新，请检查 Caddyfile。" >&2
  exit 1
fi
echo "应用已更新。数据库仍在 $DATA_DIR ，证书仍在 Docker 卷 caddy_data / caddy_config。"
