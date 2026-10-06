"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import Dialog from "./Dialog";
import { cards, cardImage, groups, tracks } from "@/lib/catalog-utils";

export function IdentityScoring() {
  return <div className="scoring-rules"><div className="rules-table-wrap"><table className="rules-table"><thead><tr><th>身份</th><th>每轮如何得分</th></tr></thead><tbody>
    <tr><th>作者</th><td>每有一名普通玩家正确指认你，<strong>＋1 分</strong>。<br />你正确指认间谍，再得 <strong>＋2 分</strong>。</td></tr>
    <tr><th>间谍</th><td>每有一名普通玩家把你认成作者，<strong>＋1 分</strong>。<br />至少骗到一票，并且没有被作者认出，再得 <strong>＋1 分</strong>。</td></tr>
    <tr><th>普通玩家</th><td>正确找到作者，<strong>＋2 分</strong>。<br />被作者误认成间谍，再得 <strong>＋2 分</strong>。</td></tr>
  </tbody></table></div><p className="fine">同一身份的两项得分可以累加。“骗到一票”只计算普通玩家的票。每轮揭晓后，由房主将得分加到各人的总分中。</p></div>;
}
export function Rules({ onClose }: { onClose: () => void }) {
  return <Dialog title="游戏玩法" onClose={onClose} wide><div className="prose rules-prose">
    <p className="intro">听三段音乐，选一张插画，<br />讲讲你听到了什么。</p>
    <h3>猜音乐 · 2–8 人</h3>
    <ol><li>所有人依次听 A、B、C 三段音乐。</li><li>本轮作者秘密选择一段音乐，再从自己的手牌中选一张与它相配的插画。</li><li>作者亮出插画，其他玩家各自投票，猜它对应哪段音乐。</li><li>揭晓答案，作者解释自己的联想。下一轮按座位顺序更换作者。</li></ol>
    <p>房主可以选择让作者先解释再投票。每轮会显示猜中人数；如需记录个人积分，由房主填写。</p>
    <h3>隐藏身份 · 3–8 人，建议 4 人以上</h3>
    <p>每轮一名作者、一名间谍，其余都是普通玩家。身份只有自己知道。</p>
    <ol><li>所有人依次听相同的三段音乐。</li><li>作者秘密选定目标音乐与插画。间谍获知目标后选牌；普通玩家在不知道目标时选牌。</li><li>所有人亮出放在自己面前的插画，同时公布目标音乐。每个人轮流解释自己的画与音乐有什么关联。</li><li>讨论结束后秘密投票：普通玩家找作者，作者找间谍，间谍不投票。</li><li>公开身份与投票，按下表记分，然后开始下一轮。</li></ol>
    <h3>隐藏身份的计分</h3><IdentityScoring />
    <h3>播放与语音</h3><p>先在微信或 Discord 接通语音，建议佩戴耳机。每个人点击「开启声音」，由房主统一控制音乐。网页尽量保持在前台；切换应用后如果没有声音，重新开启即可。</p>
    <h3>继续游戏</h3><p>用同一浏览器重新打开房间，可以恢复自己的手牌与身份。房主离线超过 90 秒后，其他玩家可以接管。房间连续 72 小时无人操作后失效。</p>
  </div></Dialog>;
}
export function AudioLibrary({ onClose }: { onClose: () => void }) {
  return <Dialog title="曲库" onClose={onClose} wide><div className="prose"><p>30 段音乐，分为十组，每轮使用其中一组。全部可以直接播放。</p><p>游戏中只显示 A、B、C。以下是曲目与演奏版本，请在开局前或游戏结束后查看。</p></div>
    <div className="catalog-grid">{groups.filter(g => !g.quick).map(g => <div className="catalog-group" key={g.key}><h3>{g.label}</h3>{g.tracks.map(t => <div className="catalog-track" key={t.id}><span className="small-letter">{t.label}</span><div><strong>{t.title}</strong><small>{t.durationSeconds} 秒</small></div><Check size={14} /></div>)}</div>)}</div>
  </Dialog>;
}
export function Credits({ onClose }: { onClose: () => void }) {
  return <Dialog title="插画与音乐" onClose={onClose} wide><div className="prose"><p>65 张插画参考皮耶罗·德拉·弗朗切斯卡的空间、色彩与人物姿态，由 AI 辅助生成，并非画家原作。</p><p>音乐片段节选自以下演奏版本，并进行了剪辑与音量调整。</p></div>
    <div className="credits-list">{tracks.map(t => <article key={t.id}><span className="eyebrow">{t.id}</span><h3>{t.title}</h3><p>{t.performer}</p><p><a href={t.sourceUrl} target="_blank" rel="noreferrer">录音来源 ↗</a>{t.licenseUrl && <> · <a href={t.licenseUrl} target="_blank" rel="noreferrer">{t.licenseName} ↗</a></>}</p></article>)}</div>
    <a className="text-button" href="/audio/ATTRIBUTION.txt" target="_blank" rel="noreferrer">录音署名与处理说明 ↗</a>
  </Dialog>;
}
export function Gallery({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <Dialog title={selected ? `插画 / ${selected}` : "插画集"} onClose={onClose} wide>{selected ? <><button className="text-button" onClick={() => setSelected(null)}>← 返回画廊</button><img className="gallery-focus" src={cardImage(selected)} alt={`卡牌 ${selected}`} /></> : <div className="gallery-grid">{cards.map(c => <button key={c.id} onClick={() => setSelected(c.id)}><img src={c.thumbnail} loading="lazy" alt={`卡牌 ${c.id}`} /><span>{c.id}</span></button>)}</div>}</Dialog>;
}
