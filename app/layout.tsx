import type { Metadata } from "next";
import "./globals.css";
import "./room.css";

export const metadata: Metadata = {
  title: "Jukebox — 你听到了什么？",
  description: "与朋友一起听音乐、选插画、猜身份。2–8 人的线上桌游。",
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
