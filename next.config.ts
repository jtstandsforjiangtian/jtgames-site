import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // 站点入口统一带斜杠：/ 作品主页、/jukebox/ Jukebox、/sushi/ 寿司店（由 Caddy 直接提供）。
  // 不让 Next 自己做斜杠跳转：那会连 /api/* 一起 308，使每次轮询都多一跳。
  // /jukebox 与 /jukebox/ 都直接渲染；对外的规范化跳转由 Caddyfile 负责。
  trailingSlash: true,
  skipTrailingSlashRedirect: true,
  async redirects() {
    return [
      // 迁移前的邀请链接是 https://jtmakegames.com/?room=CODE，继续带到 Jukebox。查询参数自动保留。
      { source: "/", has: [{ type: "query", key: "room" }], destination: "/jukebox/", permanent: false },
    ];
  },
};

export default nextConfig;
