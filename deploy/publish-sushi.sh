#!/usr/bin/env bash
# 在 Mac 上、项目根目录执行。把寿司店 Demo 的某个 Git 提交发布到服务器的 /sushi/。
# 不重建应用镜像，不动 Jukebox、数据库和证书；Caddy 无需重载。
# 用法:
#   JUKEBOX_SSH_KEY=~/.ssh/jukebox_deploy.pem ./deploy/publish-sushi.sh ubuntu@服务器公网IP [REF]
#   REF 默认 main，可以是标签或提交号。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:?用法: ./deploy/publish-sushi.sh user@server [REF]}"
REF="${2:-main}"
REMOTE_APP=/srv/jukebox/app
REMOTE_SUSHI=/srv/jukebox/sushi
cd "$ROOT"

SSH_CMD=(ssh -o StrictHostKeyChecking=accept-new)
if [[ -n "${JUKEBOX_SSH_KEY:-}" ]]; then
  SSH_CMD+=(-i "$JUKEBOX_SSH_KEY" -o IdentitiesOnly=yes)
fi

# 1. 在 Mac 上从寿司仓库导出该提交（含 npm test），得到 releases/<短号>。
bash deploy/sync-sushi.sh --dest "$ROOT/.sushi-release" "$REF"
ID="$(basename "$(readlink "$ROOT/.sushi-release/current")")"
COMMIT="$(sed -n 's/.*"commit": *"\([0-9a-f]*\)".*/\1/p' "$ROOT/.sushi-release/releases/$ID/sushi-version.json" | head -1)"

# 2. 同步该版本和切换脚本到服务器。只传这一版，不覆盖服务器上的其他版本。
"${SSH_CMD[@]}" "$HOST" "mkdir -p '$REMOTE_SUSHI/releases/$ID' '$REMOTE_APP/deploy'"
rsync -az --delete -e "${SSH_CMD[*]}" "$ROOT/.sushi-release/releases/$ID/" "$HOST:$REMOTE_SUSHI/releases/$ID/"
rsync -az -e "${SSH_CMD[*]}" "$ROOT/deploy/sync-sushi.sh" "$HOST:$REMOTE_APP/deploy/sync-sushi.sh"

# 3. 服务器上原子切换 current，并在本机 Caddy 上确认。
"${SSH_CMD[@]}" "$HOST" "bash '$REMOTE_APP/deploy/sync-sushi.sh' --dest '$REMOTE_SUSHI' --activate '$ID' && \
  if command -v curl >/dev/null 2>&1; then \
    code=\$(curl -sk -o /dev/null -w '%{http_code}' --resolve jtmakegames.com:443:127.0.0.1 https://jtmakegames.com/sushi/sushi-version.json || true); \
    echo \"[publish-sushi] 服务器本机 https://jtmakegames.com/sushi/sushi-version.json -> HTTP \$code\"; \
    if [ \"\$code\" != 200 ]; then echo '[publish-sushi] 提示: 如果 Caddy 容器还没挂载 /srv/jukebox/sushi，先执行一次 ./deploy/publish.sh ... update 重建 Caddy。'; fi; \
  fi"

echo "[publish-sushi] 已发布寿司店 Demo：提交 ${COMMIT}（releases/${ID}）。"
echo "[publish-sushi] 浏览器检查 https://jtmakegames.com/sushi/ 与 https://jtmakegames.com/sushi/sushi-version.json"
echo "[publish-sushi] 回滚：ssh 到服务器后执行 bash $REMOTE_APP/deploy/sync-sushi.sh --dest $REMOTE_SUSHI --activate <旧短号>（见 $REMOTE_SUSHI/RELEASES.log）"
