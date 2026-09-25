// Save store used when DATABASE_URL is not configured.
//
// Serverless filesystems (Vercel's /var/task, Lambda, a read-only container)
// cannot be written to, and the previous version threw ENOENT straight out of
// the API — every /api/game call 500'd, so the client saw a broken server and
// saves were never mirrored. This version picks a directory that is actually
// writable and otherwise keeps saves in process memory, so the API always
// answers and the client always knows whether the mirror can be trusted.
//
// Precedence: SAVE_DIR (explicit) → <project>/.saves → $TMPDIR/aurelion-saves
// → memory.
//
// NOTE: the directory constants below are deliberately module-scope literals.
// Building these paths from runtime variables makes Next's file tracer give up
// and bundle the whole project into every API function.
import { promises as fs } from "fs";
import path from "path";

export interface Row {
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
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type StoreKind = "files" | "memory";

const PROJECT_DIR = path.join(process.cwd(), ".saves");
const TMP_DIR = path.join(process.env.TMPDIR || "/tmp", "aurelion-saves");
const ENV_DIR = process.env.SAVE_DIR || PROJECT_DIR;

type Active = "env" | "tmp" | "memory";

let active: Active = "env";
let durable = true;
let resolved = false;
const memory = new Map<string, Row>();

/** The directory in use. Always one of two module-scope constants. */
function base(): string {
  return active === "tmp" ? TMP_DIR : ENV_DIR;
}

async function usable(dir: string): Promise<boolean> {
  try {
    await fs.mkdir(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function resolve(): Promise<void> {
  if (resolved) return;
  resolved = true;
  if (await usable(ENV_DIR)) {
    active = "env";
    durable = true;
    return;
  }
  if (ENV_DIR !== PROJECT_DIR && (await usable(PROJECT_DIR))) {
    active = "env";
    durable = true;
    return;
  }
  if (await usable(TMP_DIR)) {
    // Writable but ephemeral — a serverless host gives you /tmp for the life of
    // the instance only, so it must not be advertised as a durable mirror.
    active = "tmp";
    durable = false;
    return;
  }
  active = "memory";
  durable = false;
}

export function storeKind(): StoreKind {
  return active === "memory" ? "memory" : "files";
}

/** Where saves live right now — surfaced by /api/health for diagnostics. */
export function storeLocation(): string {
  return active === "memory" ? "in-process memory (no writable disk)" : base();
}

function file(id: string) {
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  return active === "tmp" ? path.join(TMP_DIR, `${safe}.json`) : path.join(ENV_DIR, `${safe}.json`);
}

export async function fileList(): Promise<Row[]> {
  await resolve();
  const rows: Row[] = [...memory.values()];
  if (active === "memory") return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  try {
    const names = active === "tmp" ? await fs.readdir(TMP_DIR) : await fs.readdir(ENV_DIR);
    for (const n of names) {
      if (!n.endsWith(".json")) continue;
      try {
        const row = JSON.parse(await fs.readFile(file(n.slice(0, -5)), "utf8")) as Row;
        if (!rows.some((r) => r.id === row.id)) rows.push(row);
      } catch {
        // skip corrupt file
      }
    }
  } catch {
    // directory vanished — memory rows are all we have
  }
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function fileGet(id: string): Promise<Row | null> {
  await resolve();
  if (active === "memory") return memory.get(id) ?? null;
  try {
    return JSON.parse(await fs.readFile(file(id), "utf8")) as Row;
  } catch {
    return memory.get(id) ?? null;
  }
}

export async function fileUpsert(row: Row): Promise<boolean> {
  await resolve();
  memory.set(row.id, row);
  if (active === "memory") return true;
  try {
    await fs.writeFile(file(row.id), JSON.stringify(row), "utf8");
    return true;
  } catch {
    // Disk went away mid-flight (or the volume turned read-only): the row is
    // still in memory for this process, and the client keeps its own copy.
    active = "memory";
    durable = false;
    return false;
  }
}

export async function fileDelete(id: string) {
  await resolve();
  memory.delete(id);
  if (active === "memory") return;
  try {
    await fs.unlink(file(id));
  } catch {
    // already gone
  }
}

/** Can this process actually persist across restarts? A read-only container or
 *  a serverless function with only /tmp answers false. */
export async function storeDurable(): Promise<boolean> {
  await resolve();
  return active !== "memory" && durable;
}
