# Jukebox 腾讯云部署

正式网址：https://jtmakegames.com  
www.jtmakegames.com 永久跳转到主域名。

2026-10-06 已发布到香港轻量服务器。应用和 Caddy 在运行，Let's Encrypt 证书已签发。从这台 Mac 访问公网 443 会超时，需要先在腾讯云防火墙放行 TCP 443，浏览器才能打开 HTTPS。

## 当前服务器

| 项目 | 实际值 |
| --- | --- |
| 系统 | Ubuntu 26.04 LTS |
| 架构 | x86_64，镜像为 linux/amd64 |
| CPU | 2 |
| 内存 | 1.9 GiB，另有已启用的 2.0 GiB 交换空间 `/swap.img` |
| 磁盘 | 49 GB，发布时根分区约余 41 GB |
| 公网 IPv4 | 124.156.136.248 |
| SSH | 用户 `ubuntu`，本机私钥 `~/.ssh/jukebox_deploy.pem` |
| Docker Engine | 29.8.2 |
| Docker Compose | v5.6.0 |
| 应用镜像 | `jukebox:current`，本次在服务器上构建 |
| Caddy | `caddy:2.10` |
| 证书 | Let's Encrypt，颁给 `jtmakegames.com`，2026-10-06 至 2027-01-04；`www` 另有一张证书 |

域名的 A 记录已经指向 `124.156.136.248`。服务器本机防火墙没有拦截 80/443。腾讯云防火墙目前放行了 22 和 80；443 的连接到不了这台机器。

### 需要在腾讯云控制台放行 443

1. 打开 https://console.cloud.tencent.com/lighthouse ，地域选择中国香港。
2. 进入公网 IP 为 `124.156.136.248` 的实例。
3. 打开「防火墙」。
4. 添加规则：协议 TCP，端口 `443`，来源 `0.0.0.0/0`，策略允许。
5. 确认 TCP `80` 也是允许。不要添加 3000，也不要开放数据库端口。

放行后在 Mac 上执行：

```bash
curl -sI --max-time 20 https://jtmakegames.com/ | head
curl -sI --max-time 20 https://www.jtmakegames.com/ | head
```

第一条应返回首页的 HTTPS 响应，第二条应跳到 `https://jtmakegames.com/`。

## 目录和持久化

| 路径 | 内容 |
| --- | --- |
| `/srv/jukebox/app` | 发布文件、`compose.yaml`、`Caddyfile`、`.env` |
| `/srv/jukebox/data` | SQLite 数据库。容器内路径是 `/data/jukebox.sqlite` |
| `/srv/jukebox/backups` | 一致性备份 |

证书在 Docker 卷 `jukebox_caddy_data` 和 `jukebox_caddy_config`。不要执行 `docker compose down -v`。

应用容器只在 Docker 网络内监听 3000，没有映射到宿主机。数据目录属主是容器用户 1001（宿主机上显示为 `lighthouse`），组是 `ubuntu`。更新镜像不会清空 `/srv/jukebox/data`。

Docker 服务和每天 04:15（中国时间，最多再延迟 10 分钟）的备份定时器都已设为开机启用。备份保留 14 天。定时器名称是 `jukebox-backup.timer`。

## 在 Mac 上连接

私钥只放在本机，不上传到服务器。以后的发布命令都带上它：

```bash
cd /Users/jt/Projects/jukebox
export JUKEBOX_SSH_KEY="$HOME/.ssh/jukebox_deploy.pem"
ssh -i "$JUKEBOX_SSH_KEY" -o IdentitiesOnly=yes ubuntu@124.156.136.248
```

这台 Mac 没有 Docker。本次镜像是在服务器上构建的，架构与服务器一致。构建时交换空间从 0 增到约 105 MiB，构建成功。以后更新仍可以在服务器上构建。如果以后在 Mac 上安装 Docker，发布脚本会改为在 Mac 上构建 `linux/amd64` 再上传。

## 查看日志

在服务器上执行：

```bash
cd /srv/jukebox/app
docker compose ps
docker compose logs --tail 100 app
docker compose logs --tail 100 caddy
```

## 以后怎么更新

在 Mac 上改完并完成本地验证后：

```bash
cd /Users/jt/Projects/jukebox
JUKEBOX_SSH_KEY="$HOME/.ssh/jukebox_deploy.pem" ./deploy/publish.sh ubuntu@124.156.136.248 update
```

服务器会先备份数据库，把当前镜像标为 `jukebox:previous`，再重建应用容器。数据库目录、备份目录和证书卷都保留。新版本健康检查失败时，脚本会尝试切回上一版镜像。

只在服务器上重新构建、不从 Mac 同步文件时：

```bash
cd /srv/jukebox/app
bash deploy/update.sh
```

## 备份

自动备份由 `jukebox-backup.timer` 执行。手动备份在服务器上执行：

```bash
cd /srv/jukebox/app
bash deploy/backup.sh
systemctl list-timers jukebox-backup.timer --no-pager
```

备份使用 SQLite 的 `VACUUM INTO`。不要在应用写入时直接复制 `jukebox.sqlite`、`-wal` 和 `-shm`。

把备份拷到 Mac：

```bash
scp -i ~/.ssh/jukebox_deploy.pem ubuntu@124.156.136.248:/srv/jukebox/backups/jukebox-时间.sqlite ~/jukebox-backups/
```

首次手动备份已生成：`/srv/jukebox/backups/jukebox-20261006T104206Z.sqlite`。

## 用备份恢复数据库

在服务器上执行，文件名换成实际备份：

```bash
cd /srv/jukebox/app
bash deploy/restore.sh /srv/jukebox/backups/jukebox-时间.sqlite
```

脚本会检查备份、停掉应用容器、把当前数据库挪到 `backups/pre-restore-时间/`，再写入指定备份并启动。Caddy 和证书卷不动。

## 回滚应用

只退回上一版镜像，不替换数据库。在服务器上执行：

```bash
cd /srv/jukebox/app
bash deploy/rollback.sh
```

首次部署还没有 `jukebox:previous`。下一次更新成功后，这条命令才能退回上一版应用。要连同对局数据一起退回，再用上一节恢复当时的备份。

## 本次已经在服务器上验证

通过服务器本机的 HTTPS（证书、Caddy 和应用都在路径上）：

- 首页、健康检查，以及 Let's Encrypt 证书。
- `www.jtmakegames.com` 跳到 `https://jtmakegames.com/`。
- 65 张插画和 30 段音乐由本站返回。
- 隐藏身份 5 人：普通玩家看不到作者手牌和秘密目标，也不能改分。
- 猜音乐 2 人：手动加分只记一次，过期总分被拒绝。
- 8 人同时加入。
- 重启应用容器后，房间和手动分数仍在；错误座位凭证被拒绝。
- 数据库文件仍在 `/srv/jukebox/data`，备份可以单独打开并读到房间。

从 Mac 访问 `http://jtmakegames.com` 会收到跳转到 HTTPS 的响应。随后的 443 连接超时，所以浏览器验证还要等防火墙放行。

## 还需要真实玩家验证

防火墙放行 443 之后，由中国大陆（不开 VPN）和美国的玩家进入同一房间，实测首次加载、三段音乐、出牌、投票、主持人改分、刷新重入，以及服务器重启后的恢复。首页能打开不等于这一步完成。

旧 Sites 平台上的真实对局不在这个项目里，没有被迁移。
