#!/usr/bin/env bash
# 在腾讯云服务器上执行。用 SQLite VACUUM INTO 做一致性备份，不复制正在写入的 WAL 文件。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh
require_server_layout
if [[ ! -f "$DATA_DIR/jukebox.sqlite" ]]; then
  echo "数据库还不存在，跳过备份。" >&2
  exit 1
fi
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
container_path="/backups/jukebox-$stamp.sqlite"
cd "$APP_DIR"
"${COMPOSE[@]}" exec -T app node /app/scripts/sqlite-backup.mjs "$container_path" >/dev/null
echo "$BACKUP_DIR/jukebox-$stamp.sqlite"
