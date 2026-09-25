// Mines — a real, playable 5×5 round instead of a one-shot dice roll.
//
// The board is generated once, when the round starts, from a seed stored in the
// save. Mine positions are derived from that seed on demand (never stored as a
// list), so a round cannot be "read" out of the save file and every tile you
// open is a genuine decision: the odds of the next tile are shown before you
// click, and the multiplier is the fair multi with a visible house edge.
import { mulberry32 } from "./util";

export interface MinesSession {
  id: string;
  stake: number;
  tiles: number;
  mines: number;
  /** Layout seed. Mine positions are derived from this, not stored. */
  seed: number;
  /** Indices opened so far (all safe while status === "live"). */
  revealed: number[];
  status: "live" | "bust" | "cashed";
  startedAt: string;
  startTick: number;
  /** The tile that ended the round (only after a bust). */
  bustTile?: number;
  /** What the round paid, or 0. */
  payout?: number;
}

export const MINES_TILES = 25;
export const MINES_HOUSE_EDGE = 0.03;

export const MINES_PRESETS = [1, 3, 5, 10, 15] as const;

/** Deterministic mine positions for a round. */
export function minesLayout(seed: number, tiles = MINES_TILES, mines = 5): number[] {
  const n = Math.max(1, Math.min(tiles - 1, Math.round(mines)));
  const r = mulberry32(seed >>> 0);
  const pool = Array.from({ length: tiles }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(r() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
    out.push(pool[i]!);
  }
  return out.sort((a, b) => a - b);
}

export function isMine(session: MinesSession, tile: number): boolean {
  return minesLayout(session.seed, session.tiles, session.mines).includes(tile);
}

/** Fair multiplier for cashing out after `safePicked` gems, less house edge.
 *  P(survive k picks) = Π (safe-i)/(tiles-i), so 1/P is the fair price. */
export function minesMultiplier(safePicked: number, tiles = MINES_TILES, mines = 5, house = MINES_HOUSE_EDGE): number {
  if (safePicked <= 0) return 1;
  const safe = tiles - mines;
  if (safe <= 0) return 1;
  let p = 1;
  for (let i = 0; i < Math.min(safePicked, safe); i++) p *= (safe - i) / (tiles - i);
  return (1 - house) / Math.max(1e-9, p);
}

/** Chance the very next tile is a mine. */
export function minesNextHitProb(session: MinesSession): number {
  const left = session.tiles - session.revealed.length;
  if (left <= 0) return 0;
  return Math.min(1, session.mines / left);
}

export interface MinesView {
  safePicked: number;
  tilesLeft: number;
  multiplier: number;
  nextMultiplier: number;
  cashoutNow: number;
  cashoutNext: number;
  hitProb: number;
  safeProb: number;
  /** Expected value of opening one more tile, as a ratio of the stake. */
  evNext: number;
  maxed: boolean;
  layout: number[];
}

/** Everything the UI needs to show the round honestly. */
export function minesView(session: MinesSession): MinesView {
  const layout = minesLayout(session.seed, session.tiles, session.mines);
  const safePicked = session.revealed.length;
  const tilesLeft = session.tiles - safePicked;
  const multiplier = minesMultiplier(safePicked, session.tiles, session.mines);
  const nextMultiplier = minesMultiplier(safePicked + 1, session.tiles, session.mines);
  const hitProb = minesNextHitProb(session);
  const maxed = tilesLeft <= session.mines || safePicked >= session.tiles - session.mines;
  return {
    safePicked,
    tilesLeft,
    multiplier,
    nextMultiplier,
    cashoutNow: session.stake * multiplier,
    cashoutNext: session.stake * nextMultiplier,
    hitProb,
    safeProb: 1 - hitProb,
    // EV of one more pick, relative to banking what you already have.
    evNext: maxed ? multiplier : (1 - hitProb) * nextMultiplier,
    maxed,
    layout,
  };
}

/** A fresh round: seed comes from the caller (the save's RNG stream). */
export function newMinesSession(
  id: string,
  stake: number,
  mines: number,
  seed: number,
  startedAt: string,
  startTick: number,
): MinesSession {
  return {
    id,
    stake: Math.max(0, Math.round(stake)),
    tiles: MINES_TILES,
    mines: Math.max(1, Math.min(MINES_TILES - 1, Math.round(mines))),
    seed: seed >>> 0,
    revealed: [],
    status: "live",
    startedAt,
    startTick,
  };
}
