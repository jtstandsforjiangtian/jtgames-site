# 由同目录脚本 source。这些路径只在腾讯云服务器上使用。
APP_DIR=/srv/jukebox/app
DATA_DIR=/srv/jukebox/data
BACKUP_DIR=/srv/jukebox/backups
# 寿司店 Demo 发布目录：releases/<版本>/ 加相对符号链接 current，只读挂进 Caddy 容器。
SUSHI_DIR=/srv/jukebox/sushi
COMPOSE=(docker compose --project-directory "$APP_DIR" -f "$APP_DIR/compose.yaml")

require_server_layout() {
  if [[ ! -f "$APP_DIR/compose.yaml" ]]; then
    echo "没有找到 $APP_DIR/compose.yaml。请先从 Mac 同步发布文件。" >&2
    exit 1
  fi
  sudo mkdir -p "$DATA_DIR" "$BACKUP_DIR"
  # 容器内应用用户是 1001，宿主机管理用户属于 ubuntu 组。目录可写，备份文件可被定时任务清理。
  sudo chown 1001:ubuntu "$DATA_DIR" "$BACKUP_DIR"
  sudo chmod 2775 "$DATA_DIR" "$BACKUP_DIR"
  # 寿司发布目录由管理用户写入（rsync + 切换符号链接），Caddy 只读。
  sudo mkdir -p "$SUSHI_DIR/releases"
  sudo chown -R "$(id -un):$(id -gn)" "$SUSHI_DIR"
}

print_machine() {
  echo "架构: $(uname -m)"
  echo "CPU: $(nproc)"
  echo "内存: $(awk '/MemTotal/ {printf "%.1f GiB\n", $2/1024/1024}' /proc/meminfo)"
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "系统: ${PRETTY_NAME:-unknown}"
  fi
}

require_amd64() {
  if [[ "$(uname -m)" != "x86_64" ]]; then
    echo "服务器架构是 $(uname -m)。当前镜像按 linux/amd64 构建，不能在这台机器上直接运行。" >&2
    exit 1
  fi
}

wait_app_healthy() {
  local i cid status
  for i in $(seq 1 40); do
    cid="$("${COMPOSE[@]}" ps -q app || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      if [[ "$status" == "healthy" ]]; then
        return 0
      fi
    fi
    sleep 2
  done
  echo "应用没有在预期时间内通过健康检查。" >&2
  "${COMPOSE[@]}" logs --tail 80 app >&2 || true
  return 1
}
