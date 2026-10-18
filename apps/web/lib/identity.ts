// Who this browser is (a name and a cursor colour) and the boards it has
// opened. Per-viewer conveniences only, so browser storage is fine here.

export interface Identity {
  id: string;
  name: string;
  color: string;
}

const COLORS = ["#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5", "#0c8599", "#e8590c", "#5c940d", "#c2255c", "#3b5bdb"];
const ADJECTIVES = ["Swift", "Calm", "Bold", "Bright", "Keen", "Quiet", "Brave", "Clever", "Lucky", "Sunny"];
const ANIMALS = ["Otter", "Falcon", "Panda", "Lynx", "Heron", "Fox", "Koala", "Orca", "Wren", "Bison"];

const ID_KEY = "stacksketch.identity";
const BOARDS_KEY = "stacksketch.boards";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or storage blocked: keep going without it */
  }
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export function getIdentity(): Identity {
  const stored = read<Identity>(ID_KEY);
  if (stored?.id && stored.name && stored.color) return stored;
  const fresh: Identity = {
    id: crypto.randomUUID(),
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
  };
  write(ID_KEY, fresh);
  return fresh;
}

export function saveIdentity(identity: Identity): void {
  write(ID_KEY, identity);
}

export interface RecentBoard {
  id: string;
  name: string;
  openedAt: number;
}

export function recentBoards(): RecentBoard[] {
  return (read<RecentBoard[]>(BOARDS_KEY) ?? []).sort((a, b) => b.openedAt - a.openedAt);
}

export function rememberBoard(id: string, name: string): void {
  const rest = recentBoards().filter((b) => b.id !== id);
  write(BOARDS_KEY, [{ id, name, openedAt: Date.now() }, ...rest].slice(0, 30));
}

export function newBoardId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
