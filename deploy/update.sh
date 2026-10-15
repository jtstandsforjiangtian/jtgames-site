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
# The recreated container already loads the new Caddyfile; the reload is a belt-and-braces
# check. Its admin API needs a moment to come up, so retry instead of failing on the first try.
caddy_reloaded=0
for _ in $(seq 1 10); do
  if "${COMPOSE[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    caddy_reloaded=1
    break
  fi
  sleep 2
done
if [[ "$caddy_reloaded" != 1 ]]; then
  echo "Caddy 配置未能重新加载。应用已更新，请检查 Caddyfile：" >&2
  "${COMPOSE[@]}" logs --tail 20 caddy >&2 || true
  exit 1
fi
echo "应用已更新。数据库仍在 $DATA_DIR ，证书仍在 Docker 卷 caddy_data / caddy_config。"
