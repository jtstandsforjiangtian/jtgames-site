import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import catalog from "../lib/catalog.json" with { type: "json" };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const audio = readdirSync(join(root, "public/audio")).filter(name => name.endsWith(".mp3"));
const cards = readdirSync(join(root, "public/cards")).filter(name => name.startsWith("card_"));
const thumbs = readdirSync(join(root, "public/cards")).filter(name => name.startsWith("thumb_"));
assert.equal(audio.length, 30);
assert.equal(cards.length, 65);
assert.equal(thumbs.length, 65);
assert.equal(catalog.cards.length, 65);
const tracks = catalog.groups.flatMap(group => group.tracks);
assert.equal(tracks.length, 30);
for (const card of catalog.cards) {
  for (const path of [card.image, card.thumbnail]) {
    const file = join(root, "public", path.slice(1));
    assert.equal(existsSync(file), true, path);
    assert.ok(statSync(file).size > 1000, path);
  }
}
for (const track of tracks) {
  assert.equal(track.path.startsWith("/audio/"), true, track.id);
  const file = join(root, "public", track.path.slice(1));
  assert.equal(existsSync(file), true, track.path);
  assert.ok(statSync(file).size > 1000, track.path);
}
const runtimeFiles = [
  "app/page.tsx",
  "app/layout.tsx",
  "app/globals.css",
  "app/room.css",
  "app/components/MusicPlayer.tsx",
  "app/components/RoomScene.tsx",
  "app/components/SupportPanels.tsx",
  "lib/catalog-utils.ts",
  "lib/local-audio.ts",
];
const forbidden = ["chatgpt.site", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "unpkg.com", "jsdelivr.net"];
for (const path of runtimeFiles) {
  const text = readFileSync(join(root, path), "utf8");
  for (const host of forbidden) assert.equal(text.includes(host), false, `${path} references ${host}`);
}
console.log("PASS 30 audio files and 65 cards are local, with no playback dependency on the old host or a font CDN");
