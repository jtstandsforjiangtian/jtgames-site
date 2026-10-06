"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, DoorOpen, Users, X } from "lucide-react";
import { cardImage } from "@/lib/catalog-utils";
import type { Action, RoomView, Settings } from "@/lib/game";
import Dialog from "./components/Dialog";
import RoomScene from "./components/RoomScene";
import HostPanel from "./components/HostPanel";
import { AudioLibrary, Credits, Gallery, Rules } from "./components/SupportPanels";

type Session = { code: string; token: string; name: string };
type Panel = "rules" | "audio" | "credits" | "gallery" | "host" | "invite" | null;
const defaultSettings: Settings = { mode: "guess", groupKey: "G01", handSize: 5, explainFirst: false };
async function request(path: string, data?: unknown, token?: string) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method: data ? "POST" : "GET", headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), signal: controller.signal, cache: "no-store" });
    let result: { room: RoomView; token?: string; error?: string }; try { result = await response.json() as typeof result; } catch { throw new Error("房间服务暂时没有响应，请稍后重试。"); }
    if (!response.ok) { const e = new Error(result.error || "请求失败。") as Error & { status: number }; e.status = response.status; throw e; }
    return result as { room: RoomView; token?: string };
  } finally { clearTimeout(timeout); }
}
function remember(s: Session) {
  try { localStorage.setItem(`jukebox-seat-${s.code}`, JSON.stringify(s)); localStorage.setItem("jukebox-last-seat", JSON.stringify(s)); localStorage.setItem("jukebox-name", s.name); sessionStorage.setItem("jukebox-active", JSON.stringify(s)); } catch { /* optional browser persistence */ }
}
function restore(key: string, storage: Storage): Session | null { try { const s = JSON.parse(storage.getItem(key) || "null"); return s?.code && s?.token ? s : null; } catch { return null; } }

export default function Jukebox() {
  const [session, setSession] = useState<Session | null>(null); const [lastSession, setLastSession] = useState<Session | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null); const [clock, setClock] = useState(0);
  const [name, setName] = useState(""); const [joinCode, setJoinCode] = useState(""); const [createMode, setCreateMode] = useState<Settings["mode"]>("guess");
  const [panel, setPanel] = useState<Panel>(null); const [entry, setEntry] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(true);
  const [copied, setCopied] = useState(false);
  const currentRevision = useRef(-1); const aliveSession = useRef<string | null>(null);
  const accept = useCallback((next: RoomView) => { if (next.revision >= currentRevision.current) { currentRevision.current = next.revision; setRoom(next); } }, []);
  useEffect(() => {
    try {
      setName(localStorage.getItem("jukebox-name") || ""); setLastSession(restore("jukebox-last-seat", localStorage));
      const code = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
      if (code) { setJoinCode(code); const saved = restore(`jukebox-seat-${code}`, localStorage); if (saved) setSession(saved); else setEntry("join"); }
      else { const active = restore("jukebox-active", sessionStorage); if (active) setSession(active); }
    } catch { /* manual join still works */ }
  }, []);
  useEffect(() => {
    if (!session) { aliveSession.current = null; return; }
    let cancelled = false; let timer: ReturnType<typeof setTimeout>; let heartbeatAt = 0; let failures = 0;
    aliveSession.current = session.code; history.replaceState(null, "", `?room=${session.code}`);
    async function poll() {
      const started = Date.now();
      try {
        const response = await request(`/api/room?code=${session!.code}`, undefined, session!.token);
        if (cancelled) return;
        setClock(response.room.serverNow - (started + Date.now()) / 2); accept(response.room); setConnected(true); failures = 0;
        if (Date.now() - heartbeatAt > 25000) { heartbeatAt = Date.now(); void request(`/api/room?code=${session!.code}`, { type: "heartbeat" }, session!.token).catch(() => {}); }
      } catch (e) {
        if (cancelled) return; failures++; if (failures >= 2) setConnected(false);
        const status = (e as Error & { status?: number }).status;
        if ([401, 404, 410].includes(status || 0)) { setError((e as Error).message); setRoom(null); setSession(null); currentRevision.current = -1; try { sessionStorage.removeItem("jukebox-active"); localStorage.removeItem(`jukebox-seat-${session!.code}`); } catch {} return; }
      }
      if (!cancelled) timer = setTimeout(poll, document.hidden ? 5000 : failures ? 2500 : 1200);
    }
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [session, accept]);
  const act = useCallback(async (action: Action) => {
    if (!session) return false;
    const quiet = action.type === "ready" || action.type === "heartbeat"; const payload = { ...action, requestId: crypto.randomUUID() };
    try {
      let response;
      try { response = await request(`/api/room?code=${session.code}`, payload, session.token); }
      catch (e) { if ((e as { status?: number }).status) throw e; response = await request(`/api/room?code=${session.code}`, payload, session.token); }
      if (aliveSession.current === session.code) accept(response.room); if (!quiet) setError(""); return true;
    } catch (e) { if (!quiet) setError((e as Error).name === "AbortError" ? "网络较慢，请稍后重试。" : (e as Error).message); return false; }
  }, [session, accept]);
  const join = async (create: boolean) => {
    if (!name.trim()) { setError("先给自己取一个昵称。"); return; } setBusy(true); setError("");
    try {
      const code = joinCode.trim().toUpperCase();
      const response = await request(create ? "/api/rooms" : `/api/room?code=${code}`, create ? { name, settings: { ...defaultSettings, mode: createMode } } : { type: "join", name });
      const s = { code: response.room.code, token: response.token!, name: name.trim() }; currentRevision.current = -1; aliveSession.current = s.code; remember(s); setLastSession(s); setSession(s); accept(response.room); setEntry(null);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const goHome = () => { if (session) remember(session); setSession(null); setRoom(null); currentRevision.current = -1; try { sessionStorage.removeItem("jukebox-active"); } catch {} history.replaceState(null, "", "/"); };
  const copyInvite = async () => { try { await navigator.clipboard.writeText(`${location.origin}/?room=${room!.code}`); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setPanel("invite"); } };
  const isHost = !!room && room.hostId === room.self.id;
  const inviteUrl = room && typeof window !== "undefined" ? `${location.origin}/?room=${room.code}` : "";
  return <>
    <header className={`site-header ${room ? "in-room" : ""}`}><button className="wordmark" onClick={goHome} aria-label="Jukebox 首页">Jukebox<span className="wordmark-dot">.</span></button><span className="header-description">音乐 · 插画 · 想象</span><nav><button onClick={() => setPanel("rules")}>玩法</button><button onClick={() => setPanel("audio")}>曲库</button>{!room && <button onClick={() => setPanel("gallery")}>画廊 <ArrowUpRight size={13} /></button>}{room && <button className="exit-button" onClick={goHome} title="回到首页，保留座位"><DoorOpen size={16} /><span>暂离</span></button>}</nav></header>
    {error && <div className="toast" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError("")} aria-label="关闭提示"><X size={16} /></button></div>}
    {!room && !session && <main className="home"><section className="home-hero"><div className="hero-copy"><div className="eyebrow"><span className="tiny-line" /> MUSIC, PICTURES & FRIENDS</div><h1>你听到了什么？</h1><p className="hero-intro">听音乐，选插画，<br />与朋友一起猜。</p><p className="hero-description">每轮三段音乐，每人五张插画。<br />选择你的联想，再听听其他人的解释。</p><div className="hero-actions"><button className="button primary large" onClick={() => setEntry("create")}>发起一场聚会 <ArrowRight size={17} /></button><button className="button large" onClick={() => setEntry("join")}>凭房间码入席</button></div><span className="hero-meta"><Users size={14} /> 2–8 人 <span>·</span> 电脑与手机 <span>·</span> 语音自备</span>{lastSession && <button className="resume-link" onClick={() => { currentRevision.current = -1; setSession(lastSession); remember(lastSession); }}>返回上次的房间 {lastSession.code} ↗</button>}</div><div className="hero-gallery"><div className="gallery-index">COLLECTION No. 01—65</div><figure className="hero-main"><img src={cardImage("001")} alt="窗边静坐的人物，远处是群山与深蓝色夜空" fetchPriority="high" /><figcaption><span>001 / 静夜</span><span>插画 / 001</span></figcaption></figure><figure className="hero-small"><img src={cardImage("065")} alt="人们穿过浅色石墙中的门，走向明亮的风景" /><figcaption>065 / 启程</figcaption></figure><div className="hero-seal">LISTEN<br /><i>&</i> IMAGINE</div></div></section>
      <section className="modes-section"><div className="section-caption"><span>TWO WAYS TO PLAY</span><span>从一张画开始</span></div><div className="mode-row"><article><span className="mode-number">01</span><div><h2>猜音乐</h2><p>作者选一段音乐和一张插画，<br />其他玩家猜它对应哪段音乐。</p><button className="text-button" onClick={() => { setCreateMode("guess"); setEntry("create"); }}>2–8 人 · 轮流出题 <ArrowRight size={15} /></button></div></article><article><span className="mode-number">02</span><div><h2>隐藏身份</h2><p>每个人都有自己的解释。<br />谁在即兴联想，谁提前知道了答案？</p><button className="text-button" onClick={() => { setCreateMode("identity"); setEntry("create"); }}>3–8 人 · 建议 4 人以上 <ArrowRight size={15} /></button></div></article><div className="collection-note"><span>65</span><p>张游戏插画</p></div></div></section><footer className="home-footer"><span>JUKEBOX</span><span>30 段音乐 · 65 张插画</span><button onClick={() => setPanel("credits")}>作品与录音说明 ↗</button></footer>
    </main>}
    {session && !room && <main className="loading-room"><span className="loading-mark">J.</span><h1>正在进入房间…</h1><p>房间 {session.code}</p><button className="button" onClick={goHome}>返回首页</button></main>}
    {room && <RoomScene key={room.code} room={room} clock={clock} connected={connected} act={act} openHost={() => setPanel("host")} openCredits={() => setPanel("credits")} invite={() => void copyInvite()} copied={copied} />}
    {entry && <Dialog title={entry === "create" ? "发起一场聚会" : "找到你的座位"} onClose={() => { setEntry(null); setError(""); }}><form className="entry-form" onSubmit={e => { e.preventDefault(); void join(entry === "create"); }}><label>你的昵称<input value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="让朋友们认出你" autoFocus required /></label>{entry === "create" ? <><label>今晚怎么玩？<select value={createMode} onChange={e => setCreateMode(e.target.value as Settings["mode"])}><option value="guess">猜音乐 · 2–8 人</option><option value="identity">隐藏身份 · 建议 4–8 人</option></select></label><p className="fine">每人 5 张手牌，默认使用第一组音乐。房主可以在房间中更换曲组和手牌数量。</p></> : <label>六位房间码<input className="code-input" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))} placeholder="例如 ABCD23" minLength={6} maxLength={6} required /></label>}{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" className="button primary full" disabled={busy}>{busy ? "正在入席…" : entry === "create" ? "创建房间" : "入席"}<ArrowRight size={16} /></button></form></Dialog>}
    {panel === "rules" && <Rules onClose={() => setPanel(null)} />}{panel === "audio" && <AudioLibrary onClose={() => setPanel(null)} />}{panel === "credits" && <Credits onClose={() => setPanel(null)} />}{panel === "gallery" && <Gallery onClose={() => setPanel(null)} />}{panel === "host" && room && isHost && <HostPanel room={room} act={act} error={error} onClose={() => setPanel(null)} />}
    {panel === "invite" && room && <Dialog title="邀请朋友入席" onClose={() => setPanel(null)}><p>复制下面链接发给朋友，或请他们输入房间码 <strong>{room.code}</strong>。</p><input readOnly value={inviteUrl} onFocus={e => e.target.select()} /><button className="button primary" onClick={copyInvite}>{copied ? "已复制" : "复制邀请链接"}</button></Dialog>}

  </>;
}
