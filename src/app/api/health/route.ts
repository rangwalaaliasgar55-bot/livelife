import { backendName, persistDurable, persistLocation } from "@/lib/persist";

export const dynamic = "force-dynamic";

// The client uses this to decide whether the server is a usable mirror.
// `ok` means "the API answered"; `persist` means "saves written here will still
// be there later". On a serverless host with no writable disk and no Postgres,
// persist is false and the client keeps localStorage as the only source of
// truth instead of trusting a mirror that drops writes.
export async function GET() {
  let ok = true;
  let persist = true;
  try {
    if (backendName() === "postgres") {
      const { db } = await import("@/db");
      if (db) {
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`select 1`);
      }
    }
    persist = await persistDurable();
  } catch {
    ok = false;
    persist = false;
  }
  return Response.json({ ok, persist, backend: backendName(), location: persistLocation() });
}
