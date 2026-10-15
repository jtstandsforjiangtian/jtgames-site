import type { Metadata } from "next";
import "./globals.css";
import "./room.css";

export const metadata: Metadata = {
  title: "JT Games",
  description: "JT 的小游戏作品：Jukebox 与寿司店 Demo。",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
