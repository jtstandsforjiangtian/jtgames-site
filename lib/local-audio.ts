import { tracks } from "./catalog-utils";
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open("jukebox-audio-v1", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("clips");
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error("浏览器无法保存音乐，请检查无痕模式或存储权限。"));
});
export async function readLocal(id: string): Promise<Blob | undefined> {
  const db = await database(); return new Promise((resolve, reject) => {
    const tx = db.transaction("clips", "readonly"); const req = tx.objectStore("clips").get(id);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); tx.oncomplete = () => db.close();
  });
}
export async function localIds(): Promise<string[]> {
  const db = await database(); return new Promise((resolve, reject) => { const tx = db.transaction("clips", "readonly"); const req = tx.objectStore("clips").getAllKeys(); req.onsuccess = () => resolve(req.result.map(String)); req.onerror = () => reject(req.error); tx.oncomplete = () => db.close(); });
}
export async function importAudio(files: File[]): Promise<{ imported: number; skipped: number }> {
  const valid: { id: string; file: File }[] = []; let skipped = 0;
  for (const file of files) {
    const track = tracks.find(t => t.expectedFilename.toLowerCase() === file.name.toLowerCase());
    if (!track) { skipped++; continue; }
    if (file.size > 12000000) throw new Error(`${file.name} 过大，请使用原来的样本片段。`);
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
    if (sha !== track.expectedSha256) throw new Error(`${file.name} 与原曲库片段不一致。请使用此前音乐包中同名文件，避免大家听到不同音乐。`);
    valid.push({ id: track.id, file });
  }
  const db = await database(); await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("clips", "readwrite"); for (const item of valid) tx.objectStore("clips").put(item.file, item.id);
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(new Error("存储失败，请检查浏览器剩余空间。")); };
  });
  return { imported: valid.length, skipped };
}
