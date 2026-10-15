#!/usr/bin/env bash
# 从寿司店仓库的某个 Git 提交生成 /sushi/ 的发布副本。寿司源码只在 sushi-auto-demo 仓库维护，
# 这里不保存第二份可编辑的源码：每个版本都从提交导出 dist/，并记录提交编号。
#
# 用法（Mac 或服务器均可）:
#   deploy/sync-sushi.sh [选项] [REF]
#     REF              分支、标签或提交，默认 main（先在远端 origin/REF 查找，再查本地）
#     --dest DIR       发布根目录，默认 <项目>/.sushi-release（服务器上请传 /srv/jukebox/sushi）
#     --repo URL|PATH  寿司仓库，默认 $SUSHI_REPO 或 GitHub 上的 sushi-auto-demo（SSH 地址）
#     --activate ID    不导出，只把已存在的 releases/ID 切换为 current（publish-sushi.sh 在服务器上使用）
#     --skip-tests     不在导出前运行寿司仓库的 npm test（默认：有 node 就运行）
#     --keep N         保留最近 N 个版本，默认 5；当前版本始终保留
#
# 目录结构:
#   DIR/.source/            寿司仓库的缓存 clone（不对外提供）
#   DIR/releases/<提交短号>/ dist/ 的内容 + sushi-version.json
#   DIR/current -> releases/<提交短号>   相对符号链接，mv 原子切换；Caddy 的 root 指向它
#   DIR/RELEASES.log        每次切换一行：时间 提交 来源
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.sushi-release"
# 仓库目前是私有的，默认走本机已配置的 GitHub SSH 密钥。导出只在 Mac 上进行，服务器不需要访问 GitHub。
REPO="${SUSHI_REPO:-git@github.com:jtstandsforjiangtian/sushi-auto-demo.git}"
REF="main"
ACTIVATE=""
RUN_TESTS=1
KEEP=5

while (($#)); do
  case "$1" in
    --dest) DEST="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --activate) ACTIVATE="$2"; shift 2 ;;
    --skip-tests) RUN_TESTS=0; shift ;;
    --keep) KEEP="$2"; shift 2 ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    --*) echo "未知选项: $1" >&2; exit 1 ;;
    *) REF="$1"; shift ;;
  esac
done

log() { printf '[sync-sushi] %s\n' "$*"; }
die() { printf '[sync-sushi] 错误: %s\n' "$*" >&2; exit 1; }

mkdir -p "$DEST/releases"
DEST="$(cd "$DEST" && pwd)"

activate() {
  local id="$1" target="$DEST/releases/$1"
  [[ -f "$target/index.html" && -f "$target/sushi-version.json" ]] || die "releases/$id 不完整，不能切换。"
  if [[ -e "$DEST/current" && ! -L "$DEST/current" ]]; then
    die "$DEST/current 不是符号链接。请先手动处理，避免把目录移进去。"
  fi
  # 新建临时链接再 rename 覆盖，切换瞬间完成，不会出现半套文件。
  rm -f "$DEST/.current.tmp"
  ln -s "releases/$id" "$DEST/.current.tmp"
  mv -f "$DEST/.current.tmp" "$DEST/current"
  local commit
  commit="$(sed -n 's/.*"commit": *"\([0-9a-f]*\)".*/\1/p' "$target/sushi-version.json" | head -1)"
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${commit:-$id}" "$(hostname)" >> "$DEST/RELEASES.log"
  log "current -> releases/${id}（提交 ${commit:-未知}）"
}

prune() {
  local keep_id; keep_id="$(basename "$(readlink "$DEST/current")")"
  # 按修改时间从新到旧，跳过前 KEEP 个和当前版本。
  ls -1t "$DEST/releases" 2>/dev/null | grep -v '^\.' | tail -n +"$((KEEP + 1))" | while read -r old; do
    [[ "$old" == "$keep_id" ]] && continue
    rm -rf "$DEST/releases/$old"
    log "清理旧版本 releases/$old"
  done
}

if [[ -n "$ACTIVATE" ]]; then
  activate "$ACTIVATE"
  prune
  exit 0
fi

command -v git >/dev/null 2>&1 || die "需要 git。"

SRC="$DEST/.source"
if [[ ! -d "$SRC/.git" ]]; then
  log "clone $REPO"
  git clone --quiet "$REPO" "$SRC"
else
  git -C "$SRC" remote set-url origin "$REPO"
fi
git -C "$SRC" fetch --quiet --tags --prune origin

if SHA="$(git -C "$SRC" rev-parse --verify --quiet "origin/$REF^{commit}")"; then
  SOURCE_REF="origin/$REF"
elif SHA="$(git -C "$SRC" rev-parse --verify --quiet "$REF^{commit}")"; then
  SOURCE_REF="$REF"
else
  die "在 $REPO 中找不到 ${REF}。"
fi
SHORT="${SHA:0:12}"
log "寿司版本 $SOURCE_REF = $SHA"

RELEASE="$DEST/releases/$SHORT"
if [[ -f "$RELEASE/sushi-version.json" ]]; then
  log "releases/$SHORT 已存在，直接切换。"
else
  git -C "$SRC" ls-tree -d "$SHA" -- dist >/dev/null 2>&1 \
    && [[ -n "$(git -C "$SRC" ls-tree "$SHA" -- dist/index.html)" ]] \
    || die "提交 $SHORT 没有 dist/index.html。"

  if (( RUN_TESTS )); then
    if command -v node >/dev/null 2>&1; then
      TESTDIR="$(mktemp -d "${TMPDIR:-/tmp}/sushi-test.XXXXXX")"
      trap 'rm -rf "$TESTDIR"' EXIT
      git -C "$SRC" archive "$SHA" | tar -x -C "$TESTDIR"
      log "运行寿司仓库的 npm test（提交 ${SHORT}）"
      (cd "$TESTDIR" && node --test tests/*.test.mjs >/dev/null) || die "寿司测试未通过，不生成发布副本。"
      log "测试通过"
    else
      log "本机没有 node，跳过寿司测试。请确认该提交已在别处通过 npm test。"
    fi
  fi

  TMP="$(mktemp -d "$DEST/releases/.tmp.XXXXXX")"
  git -C "$SRC" archive "$SHA" dist | tar -x -C "$TMP" --strip-components=1
  for f in index.html app.js sim.js world.js audio.js icons.js styles.css vendor/three.module.js vendor/THREE-LICENSE.txt; do
    [[ -f "$TMP/$f" ]] || { rm -rf "$TMP"; die "导出缺少 ${f}。"; }
  done
  cat > "$TMP/sushi-version.json" <<EOF
{
  "name": "sushi-demo",
  "commit": "$SHA",
  "ref": "$REF",
  "exportedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  chmod -R u+rwX,go+rX "$TMP"
  mv "$TMP" "$RELEASE"
  log "已导出 releases/${SHORT}（$(find "$RELEASE" -type f | wc -l | tr -d ' ') 个文件）"
fi

activate "$SHORT"
prune
log "完成。发布根目录: $DEST"
