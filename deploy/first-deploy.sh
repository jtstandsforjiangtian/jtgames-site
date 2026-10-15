#!/usr/bin/env bash
# 在腾讯云服务器上执行。首次部署：创建目录、确认机器、启动应用和 Caddy。
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source ./common.sh

if ! command -v docker >/dev/null 2>&1; then
  echo "服务器还没有 Docker。请先按 DEPLOY_CN.md 安装 Docker Engine 与 Compose 插件。" >&2
  exit 1
fi

require_server_layout
require_amd64
print_machine
mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if (( mem_kb < 1500000 )); then
  echo "可用内存报告低于 1.5 GiB，与 2 核 2 GB 选型不符。请先核对实例规格。" >&2
  exit 1
fi
if (( mem_kb > 3500000 )); then
  echo "提示：内存高于约 3.5 GiB，和原先的 2 GB 选型不同。确认这是要使用的实例后可以继续。"
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "已根据 .env.example 创建 $APP_DIR/.env"
fi

cd "$APP_DIR"
if docker image inspect jukebox:current >/dev/null 2>&1; then
  "${COMPOSE[@]}" up -d --no-build
else
  echo "本机没有 jukebox:current。将在服务器上构建。2 GB 内存构建可能失败；更稳妥的做法是在 Mac 上构建 linux/amd64 镜像再加载。"
  "${COMPOSE[@]}" up -d --build
fi
wait_app_healthy
bash "$APP_DIR/deploy/install-ops.sh"
echo "应用已启动。确认域名解析到这台服务器后，用浏览器打开 https://jtmakegames.com"
