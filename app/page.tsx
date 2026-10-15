import { ArrowRight } from "lucide-react";
import styles from "./page.module.css";

// 作品主页。Jukebox 由本应用在 /jukebox/ 提供；寿司店 Demo 是独立静态站点，
// 由 Caddy 在 /sushi/ 直接提供发布副本（见 deploy/sync-sushi.sh）。
const games = [
  {
    index: "01",
    kicker: "Online party game",
    title: "Jukebox",
    description: "听三段音乐，从手中的插画里选一张，再听听朋友们各自的解释。支持猜音乐与隐藏身份两种玩法。",
    meta: ["2–8 人", "电脑与手机", "需要语音自备"],
    href: "/jukebox/",
    cta: "进入 Jukebox",
  },
  {
    index: "02",
    kicker: "3D management prototype",
    title: "寿司店 Demo",
    description: "经营一家小寿司店。从一次次亲手派工，到购置辅助设备，再到给机器人编写规则，三个章节压缩展示手工到自动化的变化。",
    meta: ["单人", "电脑浏览器", "试玩原型"],
    href: "/sushi/",
    cta: "进入寿司店",
  },
];

export default function Home() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>JT Games<i>.</i></h1>
        <span className={styles.tagline}>Small games by JT</span>
      </header>
      <p className={styles.intro}>两个正在打磨中的小游戏。直接在浏览器里打开，不需要安装。</p>
      <section className={styles.grid} aria-label="作品列表">
        {games.map(game => (
          <article className={styles.card} key={game.href}>
            <span className={styles.cardIndex}>{game.index}</span>
            <span className={styles.cardKicker}>{game.kicker}</span>
            <h2>{game.title}</h2>
            <p>{game.description}</p>
            <div className={styles.meta}>{game.meta.map(item => <span key={item}>{item}</span>)}</div>
            <a className={styles.enter} href={game.href}>{game.cta} <ArrowRight size={16} /></a>
          </article>
        ))}
      </section>
      <footer className={styles.footer}>
        <span>JT GAMES</span>
        <span>jtmakegames.com</span>
      </footer>
    </main>
  );
}
