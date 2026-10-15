#!/usr/bin/env bash
# 在腾讯云服务器上执行。用一份备份替换当前数据库。用法: bash deploy/restore.sh /srv/jukebox/backups/jukebox-时间.sqlite
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh
require_server_layout
backup="${1:-}"
name="$(basename "$backup")"
if [[ "$backup" != "$BACKUP_DIR/$name" || ! -f "$backup" || ! "$name" =~ ^[A-Za-z0-9._-]+\.sqlite$ ]]; then
  echo "请指定 $BACKUP_DIR 中的一个 .sqlite 备份文件。" >&2
  exit 1
fi
docker run --rm --network none \
  -v "$BACKUP_DIR:/backups:ro" \
  --entrypoint node \
  jukebox:current \
  -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/backups/${name}',{readOnly:true}); const row=db.prepare('SELECT COUNT(*) AS n FROM rooms').get(); if(row.n===undefined) process.exit(1); db.close();" 
cd "$APP_DIR"
if [[ -f "$DATA_DIR/jukebox.sqlite" ]]; then
  bash "$APP_DIR/deploy/backup.sh" || true
fi
"${COMPOSE[@]}" stop app
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
saved="$BACKUP_DIR/pre-restore-$stamp"
mkdir -p "$saved"
for suffix in "" "-wal" "-shm"; do
  if [[ -f "$DATA_DIR/jukebox.sqlite$suffix" ]]; then
    mv "$DATA_DIR/jukebox.sqlite$suffix" "$saved/"
  fi
done
cp "$backup" "$DATA_DIR/jukebox.sqlite"
chown 1001:1001 "$DATA_DIR/jukebox.sqlite" "$saved"
"${COMPOSE[@]}" up -d --no-build --no-deps app
if ! wait_app_healthy; then
  echo "恢复后的应用没有通过健康检查。替换前的数据库文件在 $saved" >&2
  exit 1
fi
echo "已用 $backup 恢复数据库。替换前的文件在 $saved"
