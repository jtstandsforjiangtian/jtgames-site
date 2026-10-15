#!/usr/bin/env bash
# 在腾讯云服务器上执行。启用 Docker 开机启动，并安装每天一次的数据库备份定时器。
set -euo pipefail
cd "$(dirname "$0")"
sudo systemctl enable --now docker
sudo cp jukebox-backup.service jukebox-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jukebox-backup.timer
systemctl is-enabled docker
systemctl is-enabled jukebox-backup.timer
systemctl list-timers jukebox-backup.timer --no-pager
