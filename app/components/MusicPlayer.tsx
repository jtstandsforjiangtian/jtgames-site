"use client";
import { useEffect, useRef, useState } from "react";
import { Headphones, Play, Pause, Square, Volume2, Check, LoaderCircle } from "lucide-react";
import { getGroup, labels, type ClipLabel } from "@/lib/catalog-utils";
import type { Action, RoomView } from "@/lib/game";
type Props = { room: RoomView; clock: number; act: (action: Action) => Promise<boolean> };
export default function MusicPlayer({ room, clock, act }: Props) {
  const groupKey = room.round?.settings.groupKey ?? room.settings.groupKey;
  const group = getGroup(groupKey)!; const isHost = room.hostId === room.self.id;
  const audio = useRef<HTMLAudioElement>(null);
  const [reload, setReload] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]); const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false); const [volume, setVolume] = useState(0.7);
  const [position, setPosition] = useState({ label: "" as string, elapsed: 0, duration: 1, note: "等待房主播放" });
  const clockRef = useRef(clock); clockRef.current = clock;
  const readySent = useRef("");
  const playback = room.audio;
  const playbackKey = JSON.stringify(playback);
  useEffect(() => {
    let cancelled = false; const controller = new AbortController(); const created: string[] = [];
    setLoading(true); setUrls({}); setMissing([]); readySent.current = "";
    const load = async () => {
      const loaded: Record<string, string> = {}; const absent: string[] = [];
      await Promise.all(group.tracks.map(async track => {
        try {
          if (!track.path) { absent.push(track.label); return; }
          const res = await fetch(track.path, { signal: controller.signal });
          if (!res.ok) throw new Error("Audio unavailable");
          const blob = await res.blob();
          if (cancelled) return;
          const url = URL.createObjectURL(blob); created.push(url); loaded[track.label] = url;
        } catch { if (!cancelled) absent.push(track.label); }
      }));
      if (!cancelled) { setUrls(loaded); setMissing(absent); setLoading(false); }
    };
    const timeout = setTimeout(() => controller.abort(), 20000);
    void load().finally(() => clearTimeout(timeout)); return () => { cancelled = true; clearTimeout(timeout); controller.abort(); created.forEach(URL.revokeObjectURL); };
  // The key, rather than polled room object, determines the three assets.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, reload]);
  const ready = !loading && !missing.length && Object.keys(urls).length === 3;
  useEffect(() => { const key = `${groupKey}:${ready}`; if (readySent.current === key) return; readySent.current = key; void act({ type: "ready", ready, groupKey }).then(ok => { if (!ok) readySent.current = ""; }); }, [ready, groupKey, act, room.revision]);
  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);
  useEffect(() => {
    const el = audio.current; if (!el) return;
    let requested = false; let lastSource = "";
    const tick = () => {
      if (!playback || playback.groupKey !== groupKey) { el.pause(); setPosition({ label: "", elapsed: 0, duration: 1, note: "等待房主播放" }); return; }
      const elapsed = playback.paused ? playback.offset : Date.now() + clockRef.current - playback.startAt + playback.offset;
      if (!playback.paused && Date.now() + clockRef.current < playback.startAt) { el.pause(); setPosition({ label: "", elapsed: 0, duration: 1, note: `${Math.ceil((playback.startAt - Date.now() - clockRef.current) / 1000)} 秒后一起聆听` }); return; }
      let remain = elapsed / 1000;
      for (const label of playback.sequence) {
        const duration = group.tracks[labels.indexOf(label)].durationSeconds;
        if (remain < duration) {
          setPosition({ label, elapsed: Math.max(0, remain), duration, note: playback.paused ? "已暂停" : !unlocked ? "点击「开启声音」加入聆听" : `正在聆听 · 片段 ${label}` });
          const url = urls[label];
          if (!url || !unlocked) { el.pause(); return; }
          if (lastSource !== url) { el.src = url; lastSource = url; requested = false; }
          if (Number.isFinite(el.duration) && Math.abs(el.currentTime - Math.max(0, remain)) > 0.85) el.currentTime = Math.min(Math.max(0, remain), el.duration);
          if (playback.paused) el.pause();
          else if (el.paused && !requested) { requested = true; void el.play().catch(() => setUnlocked(false)).finally(() => { requested = false; }); }
          return;
        }
        remain -= duration;
        if (remain < 2) { el.pause(); setPosition({ label: "", elapsed: 0, duration: 1, note: "片段间歇" }); return; }
        remain -= 2;
      }
      el.pause(); setPosition({ label: "", elapsed: 0, duration: 1, note: "聆听结束 · 可以重播" });
    };
    tick(); const timer = setInterval(tick, 250); return () => { clearInterval(timer); el.pause(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackKey, urls, unlocked, groupKey]);
  const unlock = () => {
    const el = audio.current; if (!el) return;
    const current = position.label || "A"; const src = urls[current];
    if (!src) return;
    el.src = src; el.volume = 0; // prime the same media element during the user gesture
    void el.play().then(() => { el.pause(); el.volume = volume; setUnlocked(true); }).catch(() => { el.volume = volume; setUnlocked(false); });
  };
  const readyCount = room.players.filter(p => p.readyFor === groupKey).length;
  return <section className="music-panel" aria-label="音乐播放器">
    <audio ref={audio} preload="auto" hidden onError={() => setUnlocked(false)} />
    <div className="section-caption"><span>THE LISTENING ROOM</span><span>{group.label}</span></div>
    <div className="music-heading"><Headphones size={21} strokeWidth={1.4} /><h2>本轮音乐</h2><span className="audio-ready">{readyCount}/{room.players.length} 音频就绪</span></div>
    <div className="clips">{labels.map((label, i) => <button key={label} className={`clip ${position.label === label ? "playing" : ""}`} disabled={!isHost || !ready} onClick={() => void act({ type: "audio", clip: label })} aria-label={`${isHost ? "同步播放" : "音乐"}片段 ${label}`}>
      <span className="clip-letter">{label}</span><span className="clip-text">片段 {label}<small>{Math.round(group.tracks[i].durationSeconds)} 秒</small></span>
      <span className="wave" aria-hidden="true">{[9, 17, 12, 24, 15, 20, 10, 16, 8].map((height, j) => <i key={j} style={{ height }} />)}</span>
      {loading ? <LoaderCircle size={14} className="spin" /> : urls[label] ? <Check size={14} /> : <span className="missing-dot">未加载</span>}
      <span className="clip-progress" style={{ width: position.label === label ? `${position.elapsed / position.duration * 100}%` : "0%" }} />
    </button>)}</div>
    <div className="playback-row">
      {!unlocked ? <button className="button primary compact" onClick={unlock} disabled={loading || !Object.keys(urls).length}><Volume2 size={16} />开启声音</button> : <span className="sound-on"><Check size={14} />声音已开启</span>}
      {isHost && <div className="player-controls"><button className="button compact" disabled={!ready} onClick={() => void act({ type: "audio", clip: "all" })}><Play size={14} />依次播放</button><button className="icon-button" disabled={!playback} aria-label={playback?.paused ? "继续播放" : "暂停"} onClick={() => void act({ type: "audio", command: playback?.paused ? "resume" : "pause" })}>{playback?.paused ? <Play size={16} /> : <Pause size={16} />}</button><button className="icon-button" aria-label="停止播放" disabled={!playback} onClick={() => void act({ type: "audio", command: "stop" })}><Square size={14} /></button></div>}
      <label className="volume"><Volume2 size={15} /><input type="range" min="0" max="1" step="0.05" value={volume} onChange={e => setVolume(Number(e.target.value))} aria-label="我的音量" /></label>
    </div>
    <p className="playback-status" aria-live="polite">{loading ? "正在准备本轮音乐…" : missing.length ? `片段 ${missing.join("、")} 未加载。` : position.note}{missing.length > 0 && <button className="text-button" onClick={() => setReload(n => n + 1)}>重新加载</button>}</p>
  </section>;
}
