import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Jukebox — 你听到了什么？",
  description: "与朋友一起听音乐、选插画、猜身份。2–8 人的线上桌游。",
};

export default function JukeboxLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
