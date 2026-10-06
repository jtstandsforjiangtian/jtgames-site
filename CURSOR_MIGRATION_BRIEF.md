# Cursor 任务：将 Jukebox 迁移到腾讯云香港服务器

用户已选择用 Cursor 继续维护。先完整检查代码，再实现迁移；目标是用户自己控制的普通 Linux 服务器，不是向原 Sites 项目重新发布。保留现有视觉、玩法和全部素材。本文件是交接任务说明，不代表迁移已经完成或服务器已经购买。

## 产品与范围

- Jukebox 是朋友私下试玩的音乐与插画桌游网页应用，支持电脑和手机。
- 两种现有模式：猜音乐支持 2–8 人；隐藏身份支持 3–8 人，典型 5 人为 1 作者、1 间谍、3 普通玩家。
- 语音通过微信/Discord；应用不承载语音。
- 保留大尺寸手牌区域、每人单独展示出牌、秘密选择/投票、主持人手动编辑各玩家积分、主持人推进流程、断线重入。规则仍会调整，不要在迁移时重设计玩法或强制自动计分。
- 保留首页“你听到了什么？”、古典/美术馆的视觉方向和面向玩家的简洁文案。
- 全部 30 段 MP3 与 65 张卡牌继续启用；本任务不更换或筛减音乐与插画。
- 网站应由大陆与美国玩家无需 ChatGPT 账号、无需 VPN 地访问；能否满足跨境网络表现必须实测，不应仅凭 HTTP 200 或构建成功宣称完成。

## 当前代码的事实

源版本为 063ecb6d1e9abf8e493ce95c591db8a6f9381fdb。

- React 19、TypeScript、Next App Router 形式的页面/路由；当前实际构建使用 Vinext + Vite + Cloudflare Workers 插件。
- package.json 同时已有 next 依赖、pnpm-lock.yaml；先读取 package.json/packageManager 和脚本。保留依赖与锁文件的一致性，不要凭空生成另一套未验证的锁文件。
- lib/game.ts：核心玩法、权限检查、个人视图和隐藏信息过滤。
- lib/store.ts：通过 cloudflare:workers 的 env.DB 调用 D1；不是普通 Node 数据库实现。
- db/schema.ts 与 drizzle/0000_marvelous_cyclops.sql：rooms(code,state,revision,updated_at)。状态目前整体序列化保存，修改使用 revision 条件更新并最多重试 7 次。
- app/api/rooms/route.ts：创建房间；app/api/room/route.ts：加入、读取、各种玩家操作。
- lib/http.ts：JSON、错误、请求体和 bearer token 处理。
- app/page.tsx：房间入口、状态轮询、浏览器座位凭证。非 heartbeat 请求使用 requestId 防止重复操作。
- app/components/RoomScene.tsx、Scoreboard.tsx、HostPanel.tsx、MusicPlayer.tsx、SupportPanels.tsx：牌桌、积分、主持、音频、规则与素材界面。
- app/globals.css、app/room.css：视觉样式；public/cards 和 public/audio：本地资源；lib/catalog.json：65 卡与 30 曲、10 个原始分组的目录。
- 原 app/chatgpt-auth.ts、build/、scripts/、vite.config.ts 含平台模板支持代码。游戏目前匿名进房，不依赖 ChatGPT 登录。
- 原 npm start 通过 Wrangler 启动本地 Workers 模拟器。不可直接当作生产 Node 服务使用。
- 浏览器凭证只保证同浏览器/同站点的座位恢复；新域名不会自动继承旧站点 localStorage。
- 旧房间 72 小时不活动后拒绝重入；并非长期统计系统，不代表数据库行已经自动清理。

## 迁移方案

1. 首先建立 Git 基线/迁移分支。这个包是源码快照，没有原 Git 仓库历史或生产数据。
2. 优先复用现有 Next App Router 代码，评估改为普通 Next.js Node 生产运行（可用 standalone 输出）。固定经验证的 Node LTS 版本。若选择其他 Node 路径，说明必要性并保留外部 API 约定，不重写整个界面。
3. 将 D1 存储换为普通 SQLite，数据库位置用环境变量配置，例如 JUKEBOX_DB_PATH=/data/jukebox.sqlite。启动时执行可重复的建表/版本迁移，启用合理 WAL/busy timeout；当前规模先单个应用进程。
4. 保留版本条件更新、去重 requestId、scoreSet 的 expectedScore 冲突检查、座位凭证哈希、主持权限、各身份的秘密视图。不要向所有客户端返回完整 room 再在前端隐藏。
5. 原有 tests/store.test.mjs 用内存 SQLite 适配 D1 模拟接口，只能证明旧接口逻辑；迁移后要改为覆盖真实的 SQLite 持久实现与重启恢复。保留 tests/game.test.mjs 和 tests/interface.test.mjs 的有效场景。
6. 所有音乐/卡牌从新站点同源提供，保留浏览器音频开启手势、预加载、失败重试和按服务器时间播放。检查在线播放不会回连旧 chatgpt.site 或依赖 Google 字体/CDN。
7. 公网交付必须配置 HTTPS。app/page.tsx 会用到 crypto.randomUUID()，不能假定公网明文 HTTP 与 localhost 等价；可在 HTTP 临时测试中明确提示，不要降低服务器端凭证生成安全性。
8. 给出 Dockerfile、compose.yaml、Caddyfile（或等价反向代理）及明确 .env.example。Caddy/代理监听 80/443，应用仅在容器内部，持久数据库和证书单独挂载。不要把 .env、数据库、私钥或服务器登录凭证打进镜像/源码仓库。
9. 提供部署、更新、备份、恢复和回滚脚本/命令；数据库备份不能与应用发布目录一起被覆盖。推荐 SQLite 备份 API/一致性快照，并验证恢复流程。生产日志不要记录 bearer token、完整秘密手牌或身份。
10. 2 GB 服务器优先运行预构建镜像；如在服务器本机构建，观察内存，必要时再合理配置交换空间。若在 Apple Silicon Mac 构建而服务器为 x86_64，产物需明确为 linux/amd64。

## 腾讯云目标配置

用户截图：Ubuntu 26.04 LTS，中国香港，中国香港入门型，2 核/2 GB、50 GB SSD、30 Mbps 峰值带宽、1 TB 普通月流量，54 元/月。正式资源以用户购买后的实例信息为准。

为改善大陆连接，用户计划给香港实例购买并开启优选流量包；普通 1 TB 套餐与该加速流量额度不同。优选流量包只针对香港/新加坡到大陆方向，国际方向使用原有网络。还需要在大陆和美国实测。

建议持久目录：

- /srv/jukebox/app：发布配置与应用。
- /srv/jukebox/data：真实 SQLite 数据库。
- /srv/jukebox/backups：一致性备份，并安排一份服务器之外的备份。
- HTTPS 证书状态单独持久化。

域名和公网 IP 由用户提供，不要猜测域名可注册性。购买与实名认证由用户在自己的账号完成。部署需已配置的 SSH 连接；缺少访问条件时先完成本地代码与可审阅的部署产物，再明确最后缺少的信息。

## 验收

完成必要的类型检查/生产构建及以下有实际风险的验证，不重复堆砌实现同义测试：

- 两模式完整流程；隐藏身份至少 5 人、猜音乐至少 2 人，并覆盖 8 人并发加入。
- 普通玩家不能读取别人的手牌/秘密身份，不能修改积分或执行房主操作。
- 并发选牌/投票/改分不会丢失写入；重复请求不会重复加分；过期 expectedScore 被拒绝。
- 重启应用后房间和分数仍可恢复，未持有座位凭证的客户端不能占用别人的座位。
- 所有 30 条音频 URL、65 张完整卡牌都能从新站点获取，移动端开启音频后实际可播放。
- 中国大陆无 VPN 与美国客户端在同一房间操作；测首次资源加载、音乐准备、断线重入。若没有两地实际测试条件，清楚列为尚待用户验证。

提交时分别报告：实际修改、验证结果、部署命令、数据目录、回滚方法、哪些步骤仍未完成。不要将本地通过视为生产已部署，不要重新使用原 Sites 平台作为最终入口。
