// Client-first persistence.
// The simulation runs entirely in the app (this browser tab / the phone's WebView):
//   - every save is written to localStorage (offline-first, APK-ready)
//   - when a server with a *working* store is reachable, saves are mirrored
//     there for multi-device sync (fire-and-forget, never blocks gameplay)
//
// Two rules protect the player's money and progress:
//   1. The mirror is only trusted when it can actually persist (see /api/health).
//   2. When both copies exist, the NEWER one wins — a stale local copy must never
//      overwrite fresher progress (that is how a balance used to "roll back").
import { applyAction } from "@/lib/sim/actions";
import { createGame } from "@/lib/sim/create";
import { computeNetWorth, repairFinances } from "@/lib/sim/finance";
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

export type SyncStatus = "unknown" | "local" | "synced" | "error";

let syncStatus: SyncStatus = "unknown";
let syncMessage = "";

/** What the last persistence attempt did — shown in the sidebar. */
export function persistenceStatus(): { status: SyncStatus; message: string } {
  return { status: syncStatus, message: syncMessage };
}

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function storageWorks(): boolean {
  if (!isBrowser()) return false;
  try {
    const k = "aurelion.probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
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
      syncStatus = "error";
      syncMessage = "Browser storage is full — export this life to keep it safe.";
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
    netWorth: Math.round(computeNetWorth(state)),
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
    if (syncStatus !== "synced") {
      syncStatus = "local";
      syncMessage = "Saved on this device.";
    }
  } catch {
    // storage full: trim heavy arrays and retry once
    try {
      state.news.length = Math.min(state.news.length, 30);
      state.timeline.length = Math.min(state.timeline.length, 80);
      state.history.length = Math.min(state.history.length, 100);
      window.localStorage.setItem(saveKey(id), JSON.stringify(state));
      writeIndex([metaOf(id, state), ...localIndex().filter((x) => x.id !== id)].slice(0, 20));
    } catch {
      // still full — gameplay continues in memory, but say so
      syncStatus = "error";
      syncMessage = "Browser storage is full — the last few months are in memory only.";
    }
  }
}

export function loadLocal(id: string): GameState | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(saveKey(id));
    if (!raw) return null;
    return migrate(JSON.parse(raw) as GameState);
  } catch {
    return null;
  }
}

/** Repair a loaded save: fill in fields older builds did not have and reset any
 *  balance that turned into NaN. Without this a single NaN silently zeroes
 *  everything downstream — the classic "my cash vanished" save. */
export function migrate(state: GameState): GameState {
  if (!state.player?.finances) return state;
  const f = state.player.finances;
  if (!Number.isFinite(f.arrears)) f.arrears = 0;
  if (!Array.isArray(f.accounts)) f.accounts = [];
  if (!Array.isArray(f.loans)) f.loans = [];
  repairFinances(state);
  return state;
}

export function deleteLocal(id: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(saveKey(id));
  writeIndex(localIndex().filter((x) => x.id !== id));
}

/* ------------------------------------------------------------------ server */

let serverOk: boolean | null = null;
let serverDurable = false;

interface Health {
  ok?: boolean;
  persist?: boolean;
  backend?: string;
}

export async function serverAvailable(): Promise<boolean> {
  if (serverOk !== null) return serverOk;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch("/api/health", { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    const data = (await res.json().catch(() => ({}))) as Health;
    serverOk = Boolean(res.ok && data.ok !== false);
    // A server that answers but cannot keep writes (read-only serverless disk,
    // no Postgres) is not a mirror we can trust with progress.
    serverDurable = Boolean(data.persist);
    if (serverOk && !serverDurable) serverOk = false;
  } catch {
    serverOk = false;
    serverDurable = false;
  }
  return serverOk;
}

/** True when a server copy is worth reading/writing. */
export function serverIsMirror(): boolean {
  return serverOk === true && serverDurable;
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncAttempts = 0;

function scheduleServerSync(id: string, state: GameState) {
  if (!serverIsMirror()) return;
  if (syncTimer) return;
  const delay = Math.min(20000, 2500 * 2 ** Math.min(3, syncAttempts));
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    try {
      const res = await fetch(`/api/game/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
        keepalive: true,
      });
      if (res.ok) {
        syncAttempts = 0;
        syncStatus = "synced";
        syncMessage = "Saved here and on the server.";
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch {
      syncAttempts += 1;
      syncStatus = "local";
      syncMessage = "Server sync failed — this device holds the save.";
    }
  }, delay);
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
        for (const s of data.saves ?? []) {
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

/** Which copy is newer? Falls back to the in-state save stamp. */
function stampOf(state: GameState | null): number {
  if (!state) return 0;
  const t = Date.parse(state.lastSave ?? "");
  return Number.isFinite(t) ? t : 0;
}

export async function loadLife(id: string): Promise<GameState | null> {
  const local = loadLocal(id);
  const hasServer = await serverAvailable();

  if (local && !hasServer) {
    syncStatus = "local";
    syncMessage = storageWorks() ? "Saved on this device." : "Browser storage is unavailable — progress is session-only.";
    return local;
  }

  let remote: GameState | null = null;
  if (hasServer) {
    try {
      const res = await fetch(`/api/game/${id}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { state?: GameState };
        if (data.state) remote = migrate(data.state);
      }
    } catch {
      // fall through to whatever we have
    }
  }

  if (local && remote) {
    // Newer wins. Pushing the older copy back up is what used to roll a life
    // back (and with it the wallet) after a reload on another device.
    const winner = stampOf(remote) > stampOf(local) ? remote : local;
    const loser = winner === remote ? local : remote;
    saveLocal(id, winner);
    if (winner === remote && stampOf(loser) > 0) scheduleServerSync(id, winner);
    syncStatus = "synced";
    syncMessage = winner === remote ? "Restored the newer server copy." : "This device had the newer copy.";
    return winner;
  }
  if (local) {
    scheduleServerSync(id, local);
    syncStatus = "local";
    syncMessage = "Saved on this device.";
    return local;
  }
  if (remote) {
    saveLocal(id, remote);
    syncStatus = "synced";
    syncMessage = "Downloaded from the server.";
    return remote;
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
  migrate(s);
  const id = uid("life");
  saveLocal(id, s);
  return { id, state: s };
}
