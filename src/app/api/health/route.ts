import { backendName } from "@/lib/persist";

export const dynamic = "force-dynamic";

export async function GET() {
  let ok = true;
  if (backendName() === "postgres") {
    try {
      const { db } = await import("@/db");
      if (db) {
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`select 1`);
      }
    } catch {
      ok = false;
    }
  }
  return Response.json({ ok, backend: backendName() });
}
