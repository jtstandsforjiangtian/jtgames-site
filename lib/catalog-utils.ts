import catalog from "./catalog.json";

export type ClipLabel = "A" | "B" | "C";
export const labels: ClipLabel[] = ["A", "B", "C"];
export type Track = (typeof catalog.groups)[number]["tracks"][number];
export type MusicGroup = { key: string; label: string; quick: boolean; tracks: Track[] };
const allTracks = catalog.groups.flatMap(g => g.tracks);
export const groups: MusicGroup[] = [
  ...catalog.quickTestGroups.map(g => ({ key: g.id, label: g.label.replace("在线试奏", "补充组"), quick: true,
    tracks: g.trackIds.map((id, i) => ({ ...allTracks.find(t => t.id === id)!, label: labels[i] })) })),
  ...catalog.groups.map(g => ({ key: g.key, label: g.label, quick: false, tracks: g.tracks })),
];
export const getGroup = (key: string) => groups.find(g => g.key === key);
export const cards = catalog.cards;
export const tracks = allTracks;
export const cardImage = (id: string, thumb = false) => `/cards/${thumb ? "thumb" : "card"}_${id}.jpg`;
