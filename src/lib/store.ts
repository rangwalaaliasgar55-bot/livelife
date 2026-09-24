// Client-first persistence.
// The simulation runs entirely in the app (this browser tab / the phone's WebView):
//   - every save is written to localStorage (offline-first, APK-ready)
//   - when a server with /api is reachable, saves are mirrored there for
//     multi-device sync (fire-and-forget, never blocks gameplay)
import { applyAction } from "@/lib/sim/actions";
import { createGame } from "@/lib/sim/create";
import { computeNetWorth } from "@/lib/sim/finance";
import type { ActionResult, GameState, NewGameInput, PlayerAction } from "@/lib/sim/types";
import { monthName, uid } from "@/lib/sim/util";

const IDX = "aurelion.index.v1";
const saveKey = (id: string) => `aurelion.save.${id}`;

export interface SaveMeta {
  id: string;
  name: string;
  mode: string;
  playerName: string;
  year: number;
  month: number;
  monthName: string;
  netWorth: number;
  age: number;
  country: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  source: "local" | "server" | "both";
}

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function localIndex(): SaveMeta[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(IDX);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SaveMeta[];
    return arr.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

function writeIndex(list: SaveMeta[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(IDX, JSON.stringify(list.slice(0, 60)));
  } catch {
    // quota exceeded — drop oldest and retry once
    try {
      window.localStorage.setItem(IDX, JSON.stringify(list.slice(0, 10)));
    } catch {
      // give up quietly
    }
  }
}

function metaOf(id: string, state: GameState): SaveMeta {
  const country = state.world.countries.find((c) => c.id === state.player.countryId)?.name ?? "";
  const city = state.world.cities.find((c) => c.id === state.player.cityId)?.name ?? "";
  const job = state.player.career.job?.title ?? (state.player.ownedCompanyIds.length ? "Founder" : "Private citizen");
  return {
    id,
    name: `${state.player.name} · ${state.mode}`,
    mode: state.mode,
    playerName: state.player.name,
    year: state.time.year,
    month: state.time.month,
    monthName: monthName(state.time.month),
    netWorth: computeNetWorth(state),
    age: state.player.age,
    country,
    summary: `${job} · ${city}`,
    createdAt: (localIndex().find((x) => x.id === id)?.createdAt ?? new Date().toISOString()),
    updatedAt: new Date().toISOString(),
    source: "local",
  };
}

export function saveLocal(id: string, state: GameState) {
  if (!isBrowser()) return;
  try {
    state.lastSave = new Date().toISOString();
    window.localStorage.setItem(saveKey(id), JSON.stringify(state));
    const list = localIndex().filter((x) => x.id !== id);
    list.unshift(metaOf(id, state));
    writeIndex(list);
  } catch {
    // storage full: trim heavy arrays and retry once
    try {
      state.news.length = Math.min(state.news.length, 30);
      state.timeline.length = Math.min(state.timeline.length, 80);
      state.history.length = Math.min(state.history.length, 100);
      window.localStorage.setItem(saveKey(id), JSON.stringify(state));
      writeIndex([metaOf(id, state), ...localIndex().filter((x) => x.id !== id)].slice(0, 20));
    } catch {
      // still full — gameplay continues in memory
    }
  }
}

export function loadLocal(id: string): GameState | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(saveKey(id));
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

export function deleteLocal(id: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(saveKey(id));
  writeIndex(localIndex().filter((x) => x.id !== id));
}

/* ------------------------------------------------------------------ server */

let serverOk: boolean | null = null;

export async function serverAvailable(): Promise<boolean> {
  if (serverOk !== null) return serverOk;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch("/api/health", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    serverOk = res.ok;
  } catch {
    serverOk = false;
  }
  return serverOk;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleServerSync(id: string, state: GameState) {
  if (!serverOk) return; // unknown until probed; probe first
  if (syncTimer) return;
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    try {
      await fetch(`/api/game/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
        keepalive: true,
      });
    } catch {
      // offline / static build — local copy is authoritative
    }
  }, 2500);
}

export function persistNow(id: string, state: GameState) {
  saveLocal(id, state);
  if (serverOk === true) scheduleServerSync(id, state);
}

export async function listSavesMerged(): Promise<SaveMeta[]> {
  const local = localIndex();
  const seen = new Map(local.map((m) => [m.id, m] as const));
  if (await serverAvailable()) {
    try {
      const res = await fetch("/api/game", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { saves: SaveMeta[] };
        for (const s of data.saves) {
          const prev = seen.get(s.id);
          if (!prev) seen.set(s.id, { ...s, source: "server" });
          else if (s.updatedAt > prev.updatedAt) seen.set(s.id, { ...s, source: "both" });
          else seen.set(s.id, { ...prev, source: "both" });
        }
      }
    } catch {
      // ignore — local list still returned
    }
  }
  return [...seen.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function loadLife(id: string): Promise<GameState | null> {
  const local = loadLocal(id);
  if (local) {
    if (serverOk === true) scheduleServerSync(id, local);
    return local;
  }
  if (await serverAvailable()) {
    try {
      const res = await fetch(`/api/game/${id}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { state?: GameState };
        if (data.state) {
          saveLocal(id, data.state);
          return data.state;
        }
      }
    } catch {
      // fall through
    }
  }
  return null;
}

export async function createLife(input: NewGameInput, slotName?: string): Promise<{ id: string; state: GameState }> {
  const state = createGame(input);
  const id = uid("life");
  void slotName;
  saveLocal(id, state);
  if (await serverAvailable()) {
    scheduleServerSync(id, state);
  }
  return { id, state };
}

export function applyLocal(id: string, state: GameState, action: PlayerAction): ActionResult {
  const result = applyAction(state, action);
  if (!result.error) saveLocal(id, result.state);
  if (!result.error && serverOk === true) scheduleServerSync(id, result.state);
  return result;
}

export async function deleteLife(id: string) {
  deleteLocal(id);
  if (await serverAvailable()) {
    try {
      await fetch(`/api/game/${id}`, { method: "DELETE" });
    } catch {
      // ignore
    }
  }
}

// Import a save file (full GameState JSON). Returns the new id.
export function importLife(raw: unknown): { id: string; state: GameState } | null {
  const s = raw as GameState;
  if (!s || s.version !== 1 || !s.player || !s.world) return null;
  const id = uid("life");
  saveLocal(id, s);
  return { id, state: s };
}
