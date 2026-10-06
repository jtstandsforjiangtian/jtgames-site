# Jukebox：交给 Cursor 的项目包

整理日期：2026-10-06。项目源代码版本：063ecb6d1e9abf8e493ce95c591db8a6f9381fdb（原 Sites 线上第 2 版）。

## 这个包是什么

这是当前完整源代码与素材的快照，附带腾讯云迁移任务说明。它还不是已完成腾讯云适配的部署包。

包含 30 个 MP3 音乐片段、65 张完整插画牌、65 张缩略图、前后端代码、依赖锁文件、数据库表结构及现有测试。不包含 node_modules、构建产物、Git 历史、真实运行数据库、服务器密码或部署令牌。SOURCE_MANIFEST.json 记录源文件的 SHA-256。

原 README.md 是 Sites/Vinext 模板说明，部分命令和平台能力只适用于原环境。请先读本文件和 CURSOR_MIGRATION_BRIEF.md，不要把原来的 npm start / wrangler dev 当作腾讯云生产部署命令。

## 你接下来做什么

1. 腾讯云服务器：基于操作系统镜像，Ubuntu 26.04 LTS，中国香港，中国香港入门型 54 元/月（2 核、2 GB、50 GB SSD、30 Mbps 峰值带宽、1 TB 普通月流量），先买 1 个月。Ubuntu 26.04 与 24.04 均列在 Docker 官方支持清单中。
2. 自动生成密码可以用于初次登录，实例名称可填 jukebox。截图中的共享存储特惠包和一键域名解析无需现在购买/勾选；应用和素材可放这台服务器。
3. 开通同地域的 10 GB 优选流量包（官方标价 19.5 元，有效期 6 个月），然后在实例详情的“网络与域名”中手动开启优选流量加速。购买套餐自带的 1 TB 普通流量不是优选加速流量。设余量提醒，测试时保持加速额度有效。
4. 记下实例的公网 IPv4。在实例防火墙开放 TCP 80 和 443；如使用 SSH，TCP 22 仅放行你的管理网络。应用容器端口只留在服务器内部，不额外开放数据库端口。
5. 可在同一腾讯云账号注册普通 .com 域名：搜索名称、检查注册及续费价格、完成个人信息模板实名认证、支付 1 年。示例名称不代表可注册，不需要购买溢价域名。使用香港服务器直接托管网站，无需为此办理大陆 ICP 备案；账号/域名实名认证是另一件事。
6. 在腾讯云“云解析 DNS”中给域名加一条 A 记录：主机记录 @，记录类型 A，线路 默认，记录值为服务器公网 IPv4，TTL 600 秒或默认值。用子域名时将 @ 换为 jukebox。暂未配置 IPv6 时不要额外添加 AAAA。
7. 解压本包，在 Cursor 里用 Open Folder 打开包含 package.json 的 jukebox 文件夹。先建立本地 Git 基线，再让 Cursor 读取 CURSOR_MIGRATION_BRIEF.md 并执行迁移。没有云端 Git 仓库也能开始本地开发，之后可以推到你控制的私有仓库。
8. 让 Cursor 完成本地验证，产出 Dockerfile、compose.yaml、HTTPS 配置、更新/备份/恢复脚本，再通过你的 SSH 连接部署到这台服务器。部署凭据不写进代码包或 Git。HTTPS 建议使用 Caddy 或等价方案自动签发及续期证书。
9. 发布后由中国大陆（不开 VPN）和美国的实际玩家进入同一房间测试：首次加载、3 段音乐、出牌、投票、主持人改分、刷新重入、服务器重启恢复。至少覆盖一次大陆晚间网络。首页能开不等于多人游戏验证通过。

## 域名是不是必须

技术上不是。可以用公网 IP 提供网站，且 Let's Encrypt 已提供 IP 地址证书。但当前前端会调用 crypto.randomUUID()，普通公网 IP 的明文 HTTP 页面可能缺少所需的安全上下文；不能把这种测试失败当成服务器故障。

正式给朋友玩推荐域名 + HTTPS，方便分享、证书管理、以后换服务器。若暂不买域名，让 Cursor 使用受信任的 IP HTTPS 证书并配置自动续期；Let's Encrypt 的 IP 证书有效期为 160 小时。不要用忽略浏览器证书警告作为交付方案。

## 修改和数据保存

建议源代码在你的电脑和私有 Git 仓库；服务器只运行发布版本。建议目录由 Cursor 最终实现并写明：应用 /srv/jukebox/app，持久数据 /srv/jukebox/data，备份 /srv/jukebox/backups。更新应用时保留数据目录；SQLite 备份应使用其备份 API 或一致性备份流程，不能只随意复制一个正在写入的 WAL 数据库文件。

以后流程是：在 Cursor 修改 → 本地验证 → Git 提交 → 运行部署脚本 → 验证线上关键功能。修改数据库结构时单独执行兼容的迁移。旧平台的真实对局数据不在此包中；如需保留，必须先独立导出，再检查是否能迁移，不得声称已自动带走。

## 官方资料（2026-10-06 核对）

- 服务器产品：https://cloud.tencent.com/product/lighthouse
- 服务器价格：https://cloud.tencent.com/document/product/1207/73452
- 优选流量包原理：https://cloud.tencent.com/document/product/1207/104332
- 优选流量包价格：https://cloud.tencent.com/document/product/1207/104334
- 开启优选加速：https://cloud.tencent.com/document/product/1207/104336
- 域名注册：https://cloud.tencent.com/document/product/242/9595
- A 记录设置：https://cloud.tencent.com/document/product/302/3449
- 香港部署与备案：https://cloud.tencent.com/document/product/243/19630/
- Docker 支持的 Ubuntu 版本：https://docs.docker.com/engine/install/ubuntu/
- IP 地址证书：https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability

具体价格以账号购买页为准。跨境网络实际效果仍需由两地玩家验证。
