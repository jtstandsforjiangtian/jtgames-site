"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Minus, Plus, RotateCcw } from "lucide-react";
import type { Action, RoomView } from "@/lib/game";

type ScorePlayer = RoomView["players"][number];
function ScoreRow({ player, hostId, myId, editable, act }: { player: ScorePlayer; hostId: string; myId: string; editable: boolean; act: (a: Action) => Promise<boolean> }) {
  const [draft, setDraft] = useState(String(player.score));
  const [base, setBase] = useState(player.score);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  useEffect(() => { if (!dirty && !saving) { setDraft(String(player.score)); setBase(player.score); } }, [player.score, dirty, saving]);
  const number = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(number) && Math.abs(number) <= 9999;
  const conflict = dirty && base !== player.score;
  const edit = (value: string) => { if (!dirty) setBase(player.score); setDraft(value); setDirty(true); setMessage(""); };
  async function save() {
    if (inFlight.current || !valid || conflict) return;
    inFlight.current = true; setSaving(true); setMessage("");
    try {
      const ok = await act({ type: "scoreSet", playerId: player.id, score: number, expectedScore: base });
      if (ok) { setDirty(false); setBase(number); setMessage("已保存"); }
      else setMessage("未保存，请重试");
    } finally { inFlight.current = false; setSaving(false); }
  }
  return <div className="score-row">
    <div className="score-person"><i className={`status-dot ${player.online ? "online" : ""}`} /><span>{player.name}<small>{player.id === myId ? "你" : ""}{player.id === hostId ? `${player.id === myId ? " · " : ""}房主` : ""}</small></span></div>
    {editable ? <form className="score-editor" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="score-stepper"><button type="button" disabled={saving} onClick={() => edit(String((valid ? number : player.score) - 1))} aria-label={`${player.name} 减一分`}><Minus size={14} /></button><input aria-label={`${player.name} 的总分`} type="number" inputMode="numeric" min={-9999} max={9999} step={1} value={draft} disabled={saving} onChange={e => edit(e.target.value)} /><button type="button" disabled={saving} onClick={() => edit(String((valid ? number : player.score) + 1))} aria-label={`${player.name} 加一分`}><Plus size={14} /></button></div>
      <button className="button compact score-save" type="submit" disabled={saving || !dirty || !valid || conflict || number === player.score}>{saving ? "保存中" : "保存"}</button>
      {conflict ? <button type="button" className="score-message text-button" onClick={() => { setDraft(String(player.score)); setBase(player.score); setDirty(false); setMessage(""); }}><RotateCcw size={12} />分数已更新为 {player.score}，重新读取</button> : <span className={`score-message ${message === "已保存" ? "saved" : ""}`} role="status">{!valid && dirty ? "请输入整数" : message === "已保存" ? <><Check size={11} />已保存</> : message || (dirty && number !== player.score ? "尚未保存" : "")}</span>}
    </form> : <strong className="score-total">{player.score}<small>分</small></strong>}
  </div>;
}
export default function Scoreboard({ room, act, compact = false }: { room: RoomView; act: (a: Action) => Promise<boolean>; compact?: boolean }) {
  const editable = room.hostId === room.self.id;
  return <section className={`scores-panel ${compact ? "scores-compact" : ""}`} aria-label="玩家积分"><div className="score-heading"><div><span className="eyebrow">SCOREBOARD</span><h2>玩家积分</h2></div><p>{editable ? "修改每位玩家的总分后，点击保存。" : "积分由房主记录。"}</p></div><div className="score-rows">{room.players.map(player => <ScoreRow key={player.id} player={player} hostId={room.hostId} myId={room.self.id} editable={editable} act={act} />)}</div></section>;
}
