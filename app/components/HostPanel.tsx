"use client";
import { useState } from "react";
import Dialog from "./Dialog";
import Scoreboard from "./Scoreboard";
import { groups } from "@/lib/catalog-utils";
import type { Action, Role, RoomView, Settings } from "@/lib/game";
export function SettingsFields({ value, onChange }: { value: Settings; onChange: (s: Settings) => void }) {
  return <div className="settings-fields">
    <label>游戏模式<select value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as Settings["mode"] })}><option value="guess">猜音乐 · 2–8 人</option><option value="offline">猜音乐 · 线下 · 1 人即可</option><option value="identity">隐藏身份 · 3–8 人（建议 4+）</option></select></label>
    {value.mode === "offline" ? <p className="fine">开始后从十组曲目中随机抽取，不会立刻重复刚才听过的一组。出牌、解释和计分用实体卡牌完成。</p> : <><label>音乐曲组<select value={value.groupKey} onChange={e => onChange({ ...value, groupKey: e.target.value })}>{groups.filter(g => !g.quick || g.key === value.groupKey).map(g => <option value={g.key} key={g.key}>{g.label}</option>)}</select></label>
    <label>每人手牌<select value={value.handSize} onChange={e => onChange({ ...value, handSize: Number(e.target.value) })}>{[3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n} 张</option>)}</select></label>
    {value.mode === "guess" && <label className="check-field"><input type="checkbox" checked={value.explainFirst} onChange={e => onChange({ ...value, explainFirst: e.target.checked })} />作者先解释，再让大家猜</label>}</>}
  </div>;
}
export default function HostPanel({ room, act, onClose, error }: { room: RoomView; act: (a: Action) => Promise<boolean>; onClose: () => void; error: string }) {
  const [settings, setSettings] = useState(room.settings); const [notice, setNotice] = useState("");
  const [kind, setKind] = useState("player"); const [prompt, setPrompt] = useState(""); const [roles, setRoles] = useState<Role[]>(["author", "spy", "listener"]);
  const [selfVote, setSelfVote] = useState(false); const [abstain, setAbstain] = useState(true);
  const [confirm, setConfirm] = useState<{ text: string; action: Action } | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (action: Action, success = "操作已完成。") => { if (pending) return; setPending(true); const ok = await act(action); setPending(false); if (ok) { setNotice(success); setConfirm(null); } };
  const r = room.round;
  return <Dialog title="房主管理" onClose={onClose} wide><p className="fine">修改游戏设置、管理席位或记录积分。模式与手牌设置从下一轮生效。</p>
    <div className="host-grid"><section><h3>下一轮的设置</h3><SettingsFields value={settings} onChange={setSettings} /><button className="button primary" disabled={pending} onClick={() => void run({ type: "settings", settings }, "设置已保存，下一轮生效。")}>保存设置</button>
      <h3>流程控制</h3><div className="action-stack">
        <button className="button" disabled={!r || r.settings.mode === "offline" || r.cardsRevealed || pending} onClick={() => void run({ type: "reopen" })}>重新开放选牌</button>
        <button className="button" disabled={!r || r.settings.mode === "offline" || r.phase === "results" || pending} onClick={() => setConfirm({ text: "忽略尚未完成的选牌或投票，推进当前阶段？作者仍须先确定题目。", action: { type: "advance", force: true } })}>强制推进当前阶段</button>
        <button className="button" disabled={!r || r.settings.mode === "offline" || r.phase === "results" || pending} onClick={() => setConfirm({ text: "结束本轮，并公开已有目标音乐与所有身份？", action: { type: "end" } })}>结束并揭晓本轮</button>
        <button className="button" disabled={pending} onClick={() => setConfirm({ text: "用已保存的设置重新开始一轮？当前选择和投票将结束，已经获知的信息无法撤回。", action: { type: "start", force: true } })}>重新开始一轮</button>
        <button className="button" disabled={!!r && r.phase !== "results" || pending} onClick={() => setConfirm({ text: "收回全部手牌并重新洗牌？积分保留。", action: { type: "redeal" } })}>收回并重新发牌</button>
      </div>
    </section><section><h3>自由投票</h3><label>题目<input placeholder="例如：谁最像提前知道了音乐？" maxLength={80} value={prompt} onChange={e => setPrompt(e.target.value)} /></label><label>投票对象<select value={kind} onChange={e => setKind(e.target.value)}><option value="player">本轮玩家</option><option value="music">三段音乐</option></select></label><span className="field-label">参与身份</span><div className="check-row">{(["author", "spy", "listener"] as Role[]).map(role => <label key={role} className="check-field"><input type="checkbox" checked={roles.includes(role)} onChange={e => setRoles(e.target.checked ? [...roles, role] : roles.filter(x => x !== role))} />{{ author: "作者", spy: "间谍", listener: "普通玩家" }[role]}</label>)}</div><div className="check-row"><label className="check-field"><input type="checkbox" checked={selfVote} onChange={e => setSelfVote(e.target.checked)} />允许投自己</label><label className="check-field"><input type="checkbox" checked={abstain} onChange={e => setAbstain(e.target.checked)} />允许弃权</label></div>
      <div className="action-stack"><button className="button" disabled={!r?.cardsRevealed || !!r?.ballot && !r.ballot.revealed || pending} onClick={() => void run({ type: "ballot", kind, prompt, roles, allowSelf: selfVote, abstain }, "自由投票已开始。")}>发起投票</button><button className="button" disabled={!r?.ballot || r.ballot.revealed || pending} onClick={() => setConfirm({ text: "现在公开已有投票？尚未投票者会标为未投，身份与答案不会因此提前揭晓。", action: { type: "closeBallot" } })}>仅公开这次投票</button></div>

    </section></div>
    <Scoreboard room={room} act={act} compact />
    {confirm && <div className="confirm-box" role="alert"><p>{confirm.text}</p><button className="button primary" disabled={pending} onClick={() => void run(confirm.action)}>确认</button><button className="button" onClick={() => setConfirm(null)}>取消</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <h3>席位与房主</h3><div className="seat-management">{room.players.map(p => <div key={p.id}><span>{p.name}{p.id === room.hostId ? " · 房主" : ""}</span>{p.id !== room.hostId && <><button className="text-button" onClick={() => setConfirm({ text: `把房主权限交给 ${p.name}？`, action: { type: "transfer", playerId: p.id } })}>交接房主</button><button className="text-button muted" disabled={!!r && r.phase !== "results"} onClick={() => setConfirm({ text: `移除 ${p.name} 的座位？其浏览器凭证将失效。`, action: { type: "remove", playerId: p.id } })}>移除座位</button></>}</div>)}</div>
  </Dialog>;
}
