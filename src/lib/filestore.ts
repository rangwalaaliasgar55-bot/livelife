// File-based save store used when DATABASE_URL is not configured.
// Keeps the whole product runnable (web server + previews) without Postgres.
import { promises as fs } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), ".saves");

interface Row {
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

async function ensure() {
  await fs.mkdir(DIR, { recursive: true });
}

function file(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(DIR, `${safe}.json`);
}

export async function fileList(): Promise<Row[]> {
  await ensure();
  const names = await fs.readdir(DIR);
  const rows: Row[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      rows.push(JSON.parse(await fs.readFile(path.join(DIR, n), "utf8")) as Row);
    } catch {
      // skip corrupt file
    }
  }
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function fileGet(id: string): Promise<Row | null> {
  try {
    return JSON.parse(await fs.readFile(file(id), "utf8")) as Row;
  } catch {
    return null;
  }
}

export async function fileUpsert(row: Row) {
  await ensure();
  await fs.writeFile(file(row.id), JSON.stringify(row), "utf8");
}

export async function fileDelete(id: string) {
  try {
    await fs.unlink(file(id));
  } catch {
    // already gone
  }
}
