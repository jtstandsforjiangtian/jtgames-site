"use client";
import { useEffect, useRef, useState } from "react";
import { Headphones, Play, Pause, Square, Volume2, Check, LoaderCircle } from "lucide-react";
import { getGroup, labels, type ClipLabel } from "@/lib/catalog-utils";
import type { Action, RoomView } from "@/lib/game";
type Props = { room: RoomView; clock: number; act: (action: Action) => Promise<boolean> };

function probeClip(path: string, signal: AbortSignal) {
  const attempt = new AbortController();
  const timer = setTimeout(() => attempt.abort(), 25000);
  const onAbort = () => attempt.abort();
  signal.addEventListener("abort", onAbort);
  const audio = new Audio();
  audio.preload = "auto";
  const ready = new Promise<void>((resolve, reject) => {
    const succeed = () => resolve();
    audio.addEventListener("canplay", succeed, { once: true });
    audio.addEventListener("loadeddata", succeed, { once: true });
    audio.addEventListener("error", () => reject(new Error("音频未就绪")), { once: true });
    attempt.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    audio.src = path;
  });
  const fetched = (async () => {
    const response = await fetch(path, { signal: attempt.signal });
    if (!response.ok) throw new Error("音频未就绪");
    const reader = response.body?.getReader();
    if (!reader) return;
    const first = await reader.read();
    if (first.done || !first.value?.byteLength) throw new Error("音频未就绪");
    await reader.cancel().catch(() => undefined);
  })();
  const settled = (task: Promise<void>) => task.then(() => true, () => false);
  return new Promise<void>((resolve, reject) => {
    let open = 2; let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      if (ok) { done = true; resolve(); return; }
      open -= 1;
      if (open === 0) { done = true; reject(new Error("音频未就绪")); }
    };
    void settled(ready).then(finish);
    void settled(fetched).then(finish);
  }).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    attempt.abort();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  });
}

export default function MusicPlayer({ room, clock, act }: Props) {
  const groupKey = room.round?.settings.groupKey ?? room.settings.groupKey;
  const group = getGroup(groupKey)!; const isHost = room.hostId === room.self.id;
  const audio = useRef<HTMLAudioElement>(null);
  const sources = useRef<Record<string, string>>({});
  const readyRef = useRef(new Set<string>());
  const loadedGroup = useRef("");
  const [reload, setReload] = useState(0);
  const [readyLabels, setReadyLabels] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]); const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false); const [volume, setVolume] = useState(0.7);
  const unlockedRef = useRef(false); const unlockingRef = useRef(false);
  const [position, setPosition] = useState({ label: "" as string, elapsed: 0, duration: 1, note: "等待房主播放" });
  const clockRef = useRef(clock); clockRef.current = clock;
  const readySent = useRef("");
  const playback = room.audio;
  const playbackKey = JSON.stringify(playback);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    if (loadedGroup.current !== groupKey) {
      loadedGroup.current = groupKey; readyRef.current = new Set(); sources.current = {};
      setReadyLabels([]); setMissing([]); readySent.current = "";
    }
    const pending = group.tracks.filter(track => !readyRef.current.has(track.label));
    if (!pending.length) { setLoading(false); return () => { active = false; controller.abort(); }; }
    setLoading(true);
    void Promise.all(pending.map(async track => {
      if (!track.path) { if (active) setMissing(current => current.includes(track.label) ? current : [...current, track.label]); return; }
      for (let attempt = 1; attempt <= 3 && active && !controller.signal.aborted; attempt++) {
        try {
          await probeClip(track.path, controller.signal);
          if (!active || controller.signal.aborted) return;
          readyRef.current.add(track.label); sources.current[track.label] = track.path;
          setReadyLabels([...readyRef.current]);
          setMissing(current => current.filter(label => label !== track.label));
          return;
        } catch {
          if (!active || controller.signal.aborted) return;
          if (attempt === 3) setMissing(current => current.includes(track.label) ? current : [...current, track.label]);
          else await new Promise(resolve => setTimeout(resolve, 700 * attempt));
        }
      }
    })).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  // The key, rather than the polled room object, determines the three assets.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, reload]);
  const ready = readyLabels.length === 3 && !missing.length;
  useEffect(() => { const key = `${groupKey}:${ready}`; if (readySent.current === key) return; readySent.current = key; void act({ type: "ready", ready, groupKey }).then(ok => { if (!ok) readySent.current = ""; }); }, [ready, groupKey, act, room.revision]);
  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);
  const lockSound = () => { unlockedRef.current = false; setUnlocked(false); };
  useEffect(() => {
    const el = audio.current; if (!el) return;
    let requested = false;
    const tick = () => {
      if (unlockingRef.current) return;
      if (!playback || playback.groupKey !== groupKey) { el.pause(); setPosition({ label: "", elapsed: 0, duration: 1, note: "等待房主播放" }); return; }
      const elapsed = playback.paused ? playback.offset : Date.now() + clockRef.current - playback.startAt + playback.offset;
      if (!playback.paused && Date.now() + clockRef.current < playback.startAt) { el.pause(); setPosition({ label: "", elapsed: 0, duration: 1, note: `${Math.ceil((playback.startAt - Date.now() - clockRef.current) / 1000)} 秒后一起聆听` }); return; }
      let remain = elapsed / 1000;
      for (const label of playback.sequence) {
        const duration = group.tracks[labels.indexOf(label)].durationSeconds;
        if (remain < duration) {
          setPosition({ label, elapsed: Math.max(0, remain), duration, note: playback.paused ? "已暂停" : !unlockedRef.current ? "点击「开启声音」加入聆听" : `正在聆听 · 片段 ${label}` });
          const url = sources.current[label];
          if (!url || !unlockedRef.current) { el.pause(); return; }
          const absolute = new URL(url, window.location.origin).href;
          if (el.src !== absolute) { el.src = absolute; requested = false; }
          if (Number.isFinite(el.duration) && Math.abs(el.currentTime - Math.max(0, remain)) > 0.85) el.currentTime = Math.min(Math.max(0, remain), el.duration);
          if (playback.paused) el.pause();
          else if (el.paused && !requested) { requested = true; void el.play().catch(() => lockSound()).finally(() => { requested = false; }); }
          return;
        }
        remain -= duration;
        if (remain < 2) { el.pause(); setPosition({ label: "", elapsed: 0, duration: 1, note: "片段间歇" }); return; }
        remain -= 2;
      }
      el.pause(); setPosition({ label: "", elapsed: 0, duration: 1, note: "聆听结束 · 可以重播" });
    };
    tick(); const timer = setInterval(tick, 250); return () => { clearInterval(timer); if (!unlockingRef.current) el.pause(); };
  // The unlock flag is read from a ref so this loop does not pause the gesture playback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackKey, groupKey]);
  const unlock = () => {
    const el = audio.current; if (!el || unlockingRef.current) return;
    const now = Date.now() + clockRef.current;
    const playing = playback && playback.groupKey === groupKey && !playback.paused && now >= playback.startAt;
    let spot: { label: ClipLabel; offset: number } | null = null;
    if (playing && playback) {
      let remain = (now - playback.startAt + playback.offset) / 1000;
      for (const label of playback.sequence) {
        const duration = group.tracks[labels.indexOf(label)].durationSeconds;
        if (remain < duration) { spot = { label, offset: Math.max(0, remain) }; break; }
        remain -= duration;
        if (remain < 2) break;
        remain -= 2;
      }
    }
    const src = sources.current[spot?.label || "A"] || sources.current.A;
    if (!src) return;
    unlockingRef.current = true;
    el.volume = volume;
    el.src = new URL(src, window.location.origin).href;
    void el.play().then(() => {
      if (spot && Number.isFinite(el.duration)) el.currentTime = Math.min(spot.offset, Math.max(0, el.duration - 0.05));
      if (!spot) el.pause();
      else if (el.paused) return el.play();
    }).then(() => { unlockedRef.current = true; setUnlocked(true); }).catch(() => lockSound()).finally(() => { unlockingRef.current = false; });
  };
  const readyCount = room.players.filter(p => p.readyFor === groupKey).length;
  const status = missing.length ? `片段 ${missing.join("、")} 未加载。` : loading ? (readyLabels.length ? "其余片段仍在缓冲，已就绪的可以先播放。" : "正在缓冲本轮音乐…") : position.note;
  return <section className="music-panel" aria-label="音乐播放器">
    <audio ref={audio} preload="auto" hidden />
    <div className="section-caption"><span>THE LISTENING ROOM</span><span>{group.label}</span></div>
    <div className="music-heading"><Headphones size={21} strokeWidth={1.4} /><h2>本轮音乐</h2><span className="audio-ready">{readyCount}/{room.players.length} 音频就绪</span></div>
    <div className="clips">{labels.map((label, i) => <button key={label} className={`clip ${position.label === label ? "playing" : ""}`} disabled={!isHost || !readyLabels.includes(label)} onClick={() => void act({ type: "audio", clip: label })} aria-label={`${isHost ? "同步播放" : "音乐"}片段 ${label}`}>
      <span className="clip-letter">{label}</span><span className="clip-text">片段 {label}<small>{Math.round(group.tracks[i].durationSeconds)} 秒</small></span>
      <span className="wave" aria-hidden="true">{[9, 17, 12, 24, 15, 20, 10, 16, 8].map((height, j) => <i key={j} style={{ height }} />)}</span>
      {missing.includes(label) ? <span className="missing-dot">未加载</span> : readyLabels.includes(label) ? <Check size={14} /> : <LoaderCircle size={14} className="spin" />}
      <span className="clip-progress" style={{ width: position.label === label ? `${position.elapsed / position.duration * 100}%` : "0%" }} />
    </button>)}</div>
    <div className="playback-row">
      {!unlocked ? <button className="button primary compact" onClick={unlock} disabled={!readyLabels.length}><Volume2 size={16} />开启声音</button> : <span className="sound-on"><Check size={14} />声音已开启</span>}
      {isHost && <div className="player-controls"><button className="button compact" disabled={!ready} onClick={() => void act({ type: "audio", clip: "all" })}><Play size={14} />依次播放</button><button className="icon-button" disabled={!playback} aria-label={playback?.paused ? "继续播放" : "暂停"} onClick={() => void act({ type: "audio", command: playback?.paused ? "resume" : "pause" })}>{playback?.paused ? <Play size={16} /> : <Pause size={16} />}</button><button className="icon-button" aria-label="停止播放" disabled={!playback} onClick={() => void act({ type: "audio", command: "stop" })}><Square size={14} /></button></div>}
      <label className="volume"><Volume2 size={15} /><input type="range" min="0" max="1" step="0.05" value={volume} onChange={e => setVolume(Number(e.target.value))} aria-label="我的音量" /></label>
    </div>
    <p className="playback-status" aria-live="polite">{status}{missing.length > 0 && <button className="text-button" onClick={() => setReload(n => n + 1)}>重新加载</button>}</p>
  </section>;
}
