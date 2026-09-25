import { db, dbEnabled } from "@/db";
import { gameSaves } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getAdv } from "@/lib/sim/advanced";
import { applyAction } from "@/lib/sim/actions";
import { createGame } from "@/lib/sim/create";
import { computeNetWorth } from "@/lib/sim/finance";
import { fileDelete, fileGet, fileList, fileUpsert, storeDurable, storeKind, storeLocation } from "@/lib/filestore";
import type { GameState, NewGameInput, PlayerAction } from "@/lib/sim/types";
import { monthName, uid } from "@/lib/sim/util";

function summaryLine(state: GameState): string {
  const job = state.player.career.job?.title ?? (state.player.ownedCompanyIds.length ? "Founder" : "Private citizen");
  const city = state.world.cities.find((c) => c.id === state.player.cityId)?.name ?? "";
  return `${job} · ${city}`;
}

interface Meta {
  id: string;
  name: string;
  mode: string;
  playerName: string;
  year: number;
  month: number;
  netWorth: number;
  age: number;
  country: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

function rowFrom(state: GameState, id: string, name: string, createdAt?: Date) {
  return {
    id,
    name,
    mode: state.mode,
    playerName: state.player.name,
    year: state.time.year,
    month: state.time.month,
    netWorth: Math.round(computeNetWorth(state)),
    age: state.player.age,
    country: state.world.countries.find((c) => c.id === state.player.countryId)?.name ?? "",
    summary: summaryLine(state),
    state: state as unknown as Record<string, unknown>,
    createdAt: (createdAt ?? new Date()).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export type Backend = "postgres" | "files" | "memory";

export function backendName(): Backend {
  if (dbEnabled && db) return "postgres";
  return storeKind() === "files" ? "files" : "memory";
}

/** Can saves survive a restart? A serverless function with no writable disk
 *  answers false, and the client then keeps localStorage as the only truth
 *  instead of trusting a mirror that silently drops writes. */
export async function persistDurable(): Promise<boolean> {
  if (dbEnabled && db) {
    try {
      await db.select({ one: gameSaves.id }).from(gameSaves).limit(1);
      return true;
    } catch {
      return false;
    }
  }
  return storeDurable();
}

export function persistLocation(): string {
  return dbEnabled && db ? "postgres" : storeLocation();
}

/** Never let a storage failure escape as a 500: the client treats the server as
 *  an optional mirror, so a degraded answer beats an exception. */
async function safe<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[persist] ${label} failed:`, e instanceof Error ? e.message : e);
    return fallback;
  }
}

export async function listSaves(): Promise<Meta[]> {
  return safe(listSavesUnsafe, [], "listSaves");
}

async function listSavesUnsafe(): Promise<Meta[]> {
  if (dbEnabled && db) {
    const rows = await db.select().from(gameSaves).orderBy(desc(gameSaves.updatedAt));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      mode: r.mode,
      playerName: r.playerName,
      year: r.year,
      month: r.month,
      netWorth: r.netWorth,
      age: r.age,
      country: r.country,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
  const rows = await fileList();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    playerName: r.playerName,
    year: r.year,
    month: r.month,
    netWorth: r.netWorth,
    age: r.age,
    country: r.country,
    summary: r.summary,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function createSave(input: NewGameInput, slotName?: string) {
  const state = createGame(input);
  const id = uid("life");
  // The client keeps its own copy regardless; a storage failure must not lose
  // the freshly generated life, so this is best-effort.
  await safe(() => createSaveRow(id, slotName, state), undefined, "createSave");
  return { id, state };
}

async function createSaveRow(id: string, slotName: string | undefined, state: GameState) {
  const name = slotName || `${state.player.name} · ${state.mode}`;
  const row = rowFrom(state, id, name);
  if (dbEnabled && db) {
    await db.insert(gameSaves).values({
      id: row.id,
      name: row.name,
      mode: row.mode,
      playerName: row.playerName,
      year: row.year,
      month: row.month,
      netWorth: row.netWorth,
      age: row.age,
      country: row.country,
      summary: row.summary,
      state: row.state,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    });
  } else {
    await fileUpsert(row);
  }
}

export async function loadSave(id: string): Promise<GameState | null> {
  return safe(() => loadSaveUnsafe(id), null, "loadSave");
}

async function loadSaveUnsafe(id: string): Promise<GameState | null> {
  let state: GameState | null = null;
  if (dbEnabled && db) {
    const rows = await db.select().from(gameSaves).where(eq(gameSaves.id, id)).limit(1);
    state = (rows[0]?.state as unknown as GameState) ?? null;
  } else {
    const row = await fileGet(id);
    state = (row?.state as unknown as GameState) ?? null;
  }
  if (state) getAdv(state); // migrate in-place (adds adv if an old save lacks it)
  return state;
}

export async function persistState(id: string, state: GameState) {
  await safe(() => persistStateUnsafe(id, state), undefined, "persistState");
}

async function persistStateUnsafe(id: string, state: GameState) {
  state.lastSave = new Date().toISOString();
  const row = rowFrom(state, id, `${state.player.name} · ${state.mode}`);
  if (dbEnabled && db) {
    await db
      .update(gameSaves)
      .set({
        playerName: row.playerName,
        year: row.year,
        month: row.month,
        netWorth: row.netWorth,
        age: row.age,
        country: row.country,
        summary: row.summary,
        state: row.state,
        updatedAt: new Date(row.updatedAt),
      })
      .where(eq(gameSaves.id, id));
  } else {
    const existing = await fileGet(id);
    await fileUpsert({ ...row, createdAt: existing?.createdAt ?? row.createdAt });
  }
}

export async function upsertState(id: string, state: GameState, name?: string) {
  await safe(() => upsertStateUnsafe(id, state, name), undefined, "upsertState");
}

async function upsertStateUnsafe(id: string, state: GameState, name?: string) {
  const row = rowFrom(state, id, name ?? `${state.player.name} · ${state.mode}`);
  if (dbEnabled && db) {
    const rows = await db.select().from(gameSaves).where(eq(gameSaves.id, id)).limit(1);
    if (rows.length) {
      await persistState(id, state);
    } else {
      await db.insert(gameSaves).values({
        id: row.id,
        name: row.name,
        mode: row.mode,
        playerName: row.playerName,
        year: row.year,
        month: row.month,
        netWorth: row.netWorth,
        age: row.age,
        country: row.country,
        summary: row.summary,
        state: row.state,
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      });
    }
  } else {
    const existing = await fileGet(id);
    await fileUpsert({ ...row, createdAt: existing?.createdAt ?? row.createdAt });
  }
}

export async function actOnSave(id: string, action: PlayerAction) {
  const state = await loadSave(id);
  if (!state) return { error: "Save not found", status: 404 as const };
  const result = applyAction(state, action);
  if (!result.error) await persistState(id, result.state);
  return { state: result.state, log: result.log, error: result.error };
}

export async function deleteSave(id: string) {
  await safe(async () => {
    if (dbEnabled && db) {
      await db.delete(gameSaves).where(eq(gameSaves.id, id));
    } else {
      await fileDelete(id);
    }
  }, undefined, "deleteSave");
}

export async function duplicateSave(id: string) {
  return safe(() => duplicateSaveUnsafe(id), null, "duplicateSave");
}

async function duplicateSaveUnsafe(id: string) {
  const state = await loadSave(id);
  if (!state) return null;
  const nid = uid("life");
  const row = rowFrom(structuredClone(state), nid, `${state.player.name} (copy)`);
  if (dbEnabled && db) {
    await db.insert(gameSaves).values({
      id: row.id,
      name: row.name,
      mode: row.mode,
      playerName: row.playerName,
      year: row.year,
      month: row.month,
      netWorth: row.netWorth,
      age: row.age,
      country: row.country,
      summary: row.summary,
      state: row.state,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    });
  } else {
    await fileUpsert(row);
  }
  return nid;
}

export { monthName };
