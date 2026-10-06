"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, Check, Copy, Eye, EyeOff, LayoutGrid, LockKeyhole, PanelsTopLeft, Plus, Settings2, ZoomIn } from "lucide-react";
import type { Action, Role, RoomView } from "@/lib/game";
import { cardImage, getGroup, labels, type ClipLabel } from "@/lib/catalog-utils";
import Dialog from "./Dialog";
import MusicPlayer from "./MusicPlayer";
import Scoreboard from "./Scoreboard";

const roleNames: Record<Role, string> = { author: "作者", spy: "间谍", listener: "普通玩家" };
const phaseNames = { listening: "一起聆听", selecting: "私下选牌", discussion: "解释与讨论", voting: "秘密投票", results: "揭晓与记分" };
type Props = { room: RoomView; clock: number; connected: boolean; act: (a: Action) => Promise<boolean>; openHost: () => void; openCredits: () => void; invite: () => void; copied: boolean };

export default function RoomScene({ room, clock, connected, act, openHost, openCredits, invite, copied }: Props) {
  const r = room.round; const me = room.self; const isHost = room.hostId === me.id; const b = r?.ballot;
  const [selectedCard, setSelectedCard] = useState<string | null>(me.card);
  const [selectedTarget, setSelectedTarget] = useState<ClipLabel | null>(me.target);
  const [vote, setVote] = useState<string | null>(b?.ownVote ?? null);
  const [privateOpen, setPrivateOpen] = useState(true);
  const [handOpen, setHandOpen] = useState(true);
  const [handView, setHandView] = useState<"large" | "compare">("large");
  const [zoom, setZoom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const pending = useRef(false);
  const scoreAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => { setSelectedCard(me.card); setSelectedTarget(me.target); setVote(b?.ownVote ?? null); }, [r?.id]);
  useEffect(() => { setVote(b?.ownVote ?? null); }, [b?.id]);
  useEffect(() => { setHandOpen(r?.phase === "listening" || r?.phase === "selecting"); }, [r?.id, r?.phase]);
  const perform = async (a: Action) => {
    if (pending.current) return false;
    pending.current = true; setBusy(true);
    try { return await act(a); } finally { pending.current = false; setBusy(false); }
  };
  const canSelect = !!r && r.phase === "selecting" && me.needsCard && (me.role !== "spy" || !!me.target);
  const targetLocked = r?.settings.mode === "identity" && me.role === "author" && !!me.target;
  const target = targetLocked ? me.target : selectedTarget || me.target;
  const canCommit = canSelect && !!selectedCard && (me.role !== "author" || !!target);
  const choiceSaved = selectedCard === me.card && (me.role !== "author" || target === me.target);
  const roleLabel = me.role === "listener" && r?.settings.mode === "guess" ? "猜题者" : me.role ? roleNames[me.role] : "";
  const roleHint = r?.settings.mode === "guess"
    ? me.role === "author" ? "选择一段音乐和一张插画，让其他人猜出你的音乐。" : "听三段音乐，再从作者的插画中找到对应的一段。"
    : me.role === "author" ? "让普通玩家认出你，并找出提前知道目标音乐的间谍。"
    : me.role === "spy" ? "让普通玩家把你认成作者，同时避开作者的指认。"
    : "找到作者，也可以通过解释让作者误以为你是间谍。";
  const voteText = (v: string | null) => v === "abstain" ? "弃权" : v ? b?.kind === "music" ? `片段 ${v}` : room.players.find(p => p.id === v)?.name || "已离席" : "未投";
  const handHint = r?.phase === "listening" ? "先听音乐，进入选牌阶段后再确认。"
    : me.role === "spy" && !me.target ? "等待目标音乐，收到后再选牌。"
    : r?.phase === "selecting" ? "点击插画选中，再确认出牌。" : "这是你本轮的手牌。";
  return <main className="room-page room-v2">
    <div className="room-heading"><div><span className="eyebrow">{r ? `ROUND ${String(r.number).padStart(2, "0")}` : "ROOM"} / {(r?.settings.mode ?? room.settings.mode) === "identity" ? "隐藏身份" : "猜音乐"}</span><h1>{r ? phaseNames[r.phase] : "等待玩家加入"}</h1></div><div className="room-tools"><button className="room-code" onClick={invite}><span>房间</span><strong>{room.code}</strong>{copied ? <Check size={15} /> : <Copy size={15} />}</button><button className="button compact" onClick={() => scoreAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>玩家积分</button>{isHost && <button className="button compact" onClick={openHost}><Settings2 size={15} />房主管理</button>}</div></div>
    {!connected && <p className="notice connection-warning">连接正在恢复，你的手牌与选择已保留。</p>}
    {room.players.some(p => p.canClaimHost) && !isHost && <div className="notice">房主已离线超过 90 秒。<button className="text-button" onClick={() => void perform({ type: "claimHost" })}>接管房主</button></div>}
    {r && <ol className="phase-rail">{Object.entries(phaseNames).map(([key, label], i) => <li key={key} className={r.phase === key ? "current" : ""}><span>{String(i + 1).padStart(2, "0")}</span>{label}</li>)}</ol>}
    <MusicPlayer room={room} clock={clock} act={act} />

    {!r && <section className="lobby-table"><div className="section-caption"><span>PLAYERS</span><span>{room.players.length} / 8 位玩家</span></div><div className="lobby-seats">{room.players.map((p, i) => <div className="lobby-seat" key={p.id}><span className="seat-initial">{p.name.slice(0, 1)}</span><strong>{p.name}</strong><small>{p.id === room.hostId ? "房主" : `座位 ${i + 1}`}{p.id === me.id ? " · 你" : ""}</small><span className={`presence ${p.online ? "online" : ""}`}>{p.online ? "在线" : "暂离"}</span></div>)}{room.players.length < 8 && <button className="invite-seat" onClick={invite}><Plus size={26} strokeWidth={1} /><span>{copied ? "邀请链接已复制" : "邀请朋友"}</span></button>}</div><p className="fine">先接通语音，每个人点击「开启声音」，再由房主开始游戏。</p></section>}

    {r && me.active && <section className="hand-stage" aria-label="我的身份与手牌">
      <div className="hand-stage-header"><div className="section-caption"><span><LockKeyhole size={13} /> 仅自己可见</span></div><button className="text-button muted" onClick={() => setPrivateOpen(!privateOpen)}>{privateOpen ? <EyeOff size={14} /> : <Eye size={14} />}{privateOpen ? "隐藏私密信息" : "显示私密信息"}</button></div>
      {privateOpen ? <>
        <div className="role-strip"><div className="role-name"><span>你的身份</span><h2>{roleLabel}</h2></div><p>{roleHint}</p>{me.target && !r.targetRevealed && <div className="secret-target"><LockKeyhole size={14} /><span>目标音乐</span><strong>{me.target}</strong></div>}</div>
        {me.needsCard && <>
          <div className="hand-tools"><div><h2>我的手牌 <span>{me.hand.length} 张</span></h2>{handOpen && <p>{handHint}</p>}</div><div className="hand-view-tools">{handOpen && <div className="view-switch" aria-label="手牌显示方式"><button className={handView === "large" ? "active" : ""} aria-pressed={handView === "large"} onClick={() => setHandView("large")}><PanelsTopLeft size={15} />大图</button><button className={handView === "compare" ? "active" : ""} aria-pressed={handView === "compare"} onClick={() => setHandView("compare")}><LayoutGrid size={15} />对照</button></div>}{r.cardsRevealed && <button className="text-button" onClick={() => setHandOpen(!handOpen)}>{handOpen ? "收起手牌" : "展开手牌"}</button>}</div></div>
          {handOpen && <>
            {canSelect && me.role === "author" && <div className="music-choice"><span>目标音乐{targetLocked ? " · 已锁定" : ""}</span><div className="letter-options">{labels.map(l => <button key={l} className={target === l ? "selected" : ""} aria-pressed={target === l} disabled={targetLocked} onClick={() => setSelectedTarget(l)}>{l}</button>)}</div>{targetLocked && <small>仍可更换插画</small>}</div>}
            <div className={`hand-gallery view-${handView}`} style={{ "--hand-count": Math.min(me.hand.length, 5) } as CSSProperties}>
              {me.hand.map(id => <article key={id} className={`large-hand-card ${selectedCard === id ? "selected" : ""}`}><button className="hand-art" onClick={() => { if (canSelect) setSelectedCard(id); }} disabled={!canSelect} aria-label={`选择插画 ${id}`} aria-pressed={selectedCard === id}><img src={cardImage(id)} alt={`手牌插画 ${id}`} loading="eager" decoding="async" />{selectedCard === id && <span className="selection-badge"><Check size={15} />已选</span>}</button><div className="hand-card-caption"><span>No. {id}</span><button onClick={() => setZoom(id)} aria-label={`查看插画 ${id} 细节`}><ZoomIn size={14} />细节</button></div></article>)}
            </div>
            <div className="hand-submit"><div>{selectedCard ? <><strong>已选插画 {selectedCard}</strong><span>{choiceSaved && me.card ? "已保存" : canSelect ? "确认后提交给房间" : ""}</span></> : <span>{handHint}</span>}</div>{canSelect && <button className="button primary" disabled={!canCommit || busy || choiceSaved} onClick={() => void perform({ type: "select", cardId: selectedCard, target })}>{choiceSaved && me.card ? "已保存选择" : me.card ? "更新选择" : "确认出牌"}<Check size={16} /></button>}</div>
          </>}
        </>}
      </> : <div className="private-hidden"><LockKeyhole size={19} /><p>身份、手牌和投票已隐藏。</p></div>}
    </section>}
    {r && !me.active && <p className="notice">本轮正在进行，你将从下一轮开始参与。</p>}

    {r && <section className={`table-section table-v2 ${!r.cardsRevealed ? "unrevealed" : ""}`} aria-label="桌面插画"><div className="table-heading"><div><span className="eyebrow">ON THE TABLE</span><h2>桌面插画</h2></div><span className="fine">{r.cardsRevealed ? "每张插画都属于它面前的玩家" : `${r.selectedCount} / ${r.selectionTotal} 张已选定`}</span></div>
      {r.targetRevealed && r.target && <div className="target-reveal"><span>目标音乐</span><strong>{r.target}</strong></div>}
      {!r.cardsRevealed ? <div className="waiting-cards"><span className="card-back-mini">J</span><p>{r.phase === "listening" ? "先听三段音乐，再开始选牌。" : "所有人选好后，由房主统一亮牌。"}</p></div> : <div className={`table-cards players-${r.roster.length}`}>{room.players.filter(p => r.roster.includes(p.id) && (r.settings.mode === "identity" || p.id === r.authorId)).map(p => <article className="table-place" key={p.id}>{p.card ? <button className="art-button" onClick={() => setZoom(p.card)}><img src={cardImage(p.card)} alt={`${p.name} 的插画`} /><ZoomIn size={16} className="zoom-icon" /></button> : <div className="card-back"><span>J</span><small>本轮未出牌</small></div>}<div className="table-caption"><span><b>{p.name}</b>{p.id === me.id ? " · 你" : ""}</span><span>{p.role ? roleNames[p.role] : ""}</span></div></article>)}</div>}
      {r.phase === "discussion" && <p className="discussion-note">{r.settings.mode === "identity" ? "请每个人轮流解释自己的插画与目标音乐有什么关联，再一起讨论。" : "请作者解释自己的插画与音乐有什么关联。"}</p>}
      {r.phase === "results" && <p className="results-note">本轮已揭晓，可以继续交流，再由房主记录得分。</p>}
    </section>}

    {b && !b.revealed && r?.phase === "voting" && privateOpen && <section className="vote-panel" aria-label="我的秘密投票"><div><span className="eyebrow"><LockKeyhole size={12} /> 秘密投票</span><h2>{b.prompt}</h2><p className="fine">{b.submitted} / {b.total} 人已提交</p></div>{b.eligible ? <div><div className="vote-options">{(b.kind === "music" ? labels.map(l => ({ id: l, name: `片段 ${l}` })) : room.players.filter(p => r.roster.includes(p.id) && (b.allowSelf || p.id !== me.id))).map(option => <button key={option.id} className={vote === option.id ? "selected" : ""} aria-pressed={vote === option.id} onClick={() => setVote(option.id)}>{option.name}{vote === option.id && <Check size={14} />}</button>)}{b.abstain && <button className={vote === "abstain" ? "selected" : ""} onClick={() => setVote("abstain")}>弃权</button>}</div><div className="vote-submit"><button className="button primary" disabled={!vote || busy || vote === b.ownVote} onClick={() => void perform({ type: "vote", value: vote })}>{b.ownVote ? "更新投票" : "秘密提交"}</button>{b.ownVote && <span className="saved-choice"><Check size={13} />已提交：{voteText(b.ownVote)}</span>}</div></div> : <p>本次投票无需你参与。</p>}</section>}
    {b?.revealed && <section className="ballot-results"><div className="section-caption"><span>VOTES</span><span>投票记录</span></div><h2>{b.kind === "music" ? "猜题结果" : "指认结果"}</h2>{b.kind === "music" && r?.targetRevealed && <p className="result-count">{Object.values(b.results || {}).filter(v => v === r.target).length}<span> / {b.total} 人猜中</span></p>}<div className="result-votes">{b.results ? room.players.filter(p => r?.roster.includes(p.id)).map(p => <div key={p.id}><span>{p.name}</span><strong>{b.results?.[p.id] === undefined ? "未投 / 未参与" : voteText(b.results[p.id])}</strong></div>) : Object.entries(b.tally).map(([v, count]) => <div key={v}><span>{voteText(v)}</span><strong>{count} 票</strong></div>)}</div>{!b.results && <p className="fine">身份揭晓前，只公布匿名计票。</p>}</section>}

    {isHost ? <section className="host-next"><div><span className="eyebrow">房主操作</span><p>{!r || r.phase === "results" ? `下一轮 · ${room.settings.mode === "guess" ? "猜音乐" : "隐藏身份"} · ${getGroup(room.settings.groupKey)!.label}` : r.phase === "listening" ? "大家听过三段音乐后，开始选牌。" : r.phase === "selecting" ? `已收到 ${r.selectedCount}/${r.selectionTotal} 张插画。` : r.phase === "discussion" ? "等每个人解释完并完成讨论，再开始投票。" : `已收到 ${b?.submitted ?? 0}/${b?.total ?? 0} 份投票。`}</p></div><button className="button primary" disabled={busy || (!r || r.phase === "results") && room.players.length < (room.settings.mode === "guess" ? 2 : 3)} onClick={() => void perform({ type: !r || r.phase === "results" ? "start" : "advance" })}>{busy ? "请稍候…" : !r ? "开始第一轮" : r.phase === "results" ? "开始下一轮" : r.phase === "listening" ? "开始选牌" : r.phase === "selecting" ? "亮出插画" : r.phase === "discussion" ? "开始投票" : "结束投票并揭晓"}<ArrowRight size={16} /></button></section> : <p className="waiting-host">由房主推进流程。</p>}
    <div ref={scoreAnchor} className="score-anchor"><Scoreboard room={room} act={act} /></div>
    <details className="room-journal"><summary>本场记录 <span>{room.log.length}</span></summary>{room.log.slice().reverse().map((event, i) => <p key={`${event.at}-${i}`}><time>{new Date(event.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>{event.text}</p>)}</details>
    <footer className="room-footer"><span>JUKEBOX</span><button onClick={openCredits}>录音与插画说明</button><span>建议佩戴耳机</span></footer>
    {zoom && <Dialog title={`插画 / ${zoom}`} onClose={() => setZoom(null)}><img className="zoom-art" src={cardImage(zoom)} alt={`插画 ${zoom}`} />{canSelect && me.hand.includes(zoom) && <button className="button primary full" onClick={() => { setSelectedCard(zoom); setZoom(null); }}>选择这张插画 <Check size={16} /></button>}</Dialog>}
  </main>;
}
