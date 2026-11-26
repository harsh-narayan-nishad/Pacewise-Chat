/**
 * The chat theme: the colour of my message bubbles and the conversation wallpaper. Kept on this device (like the
 * light / dark choice) and applied as data attributes on <html>, which globals.css reads.
 */
export const BUBBLES = [
  { id: "blue", name: "Blue", from: "#1A86FF", mid: "#0071E3", to: "#0062C9" },
  { id: "teal", name: "Teal", from: "#12968F", mid: "#0B7F79", to: "#086B66" },
  { id: "green", name: "Green", from: "#25974A", mid: "#1B7F39", to: "#146A2F" },
  { id: "purple", name: "Purple", from: "#8A5CF6", mid: "#7444E0", to: "#5F33C4" },
  { id: "rose", name: "Rose", from: "#F0457A", mid: "#D6336C", to: "#B8285B" },
  { id: "orange", name: "Orange", from: "#E06A1B", mid: "#C2570D", to: "#A5490B" },
  { id: "graphite", name: "Graphite", from: "#55585F", mid: "#45484F", to: "#36383E" },
] as const;
export const WALLPAPERS = [
  { id: "doodles", name: "Doodles" },
  { id: "grid", name: "Grid" },
  { id: "plain", name: "Plain" },
] as const;
export type Look = { bubble: (typeof BUBBLES)[number]["id"]; wallpaper: (typeof WALLPAPERS)[number]["id"] };

const KEY = "pacewise-chat-look";
export const DEFAULT_LOOK: Look = { bubble: "blue", wallpaper: "doodles" };

export function loadLook(): Look {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Look> | null;
    return {
      bubble: BUBBLES.some((b) => b.id === v?.bubble) ? v!.bubble! : DEFAULT_LOOK.bubble,
      wallpaper: WALLPAPERS.some((w) => w.id === v?.wallpaper) ? v!.wallpaper! : DEFAULT_LOOK.wallpaper,
    };
  } catch { return DEFAULT_LOOK; }
}
export function applyLook(l: Look) {
  const el = document.documentElement;
  el.dataset.bubble = l.bubble;
  el.dataset.wallpaper = l.wallpaper;
}
export function saveLook(l: Look) {
  applyLook(l);
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage blocked */ }
}
