import { createSave, listSaves } from "@/lib/persist";
import type { NewGameInput } from "@/lib/sim/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const saves = await listSaves();
  return Response.json({ saves });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { input: NewGameInput; name?: string };
  if (!body?.input?.name) {
    return Response.json({ error: "Name required" }, { status: 400 });
  }
  const created = await createSave(body.input, body.name);
  return Response.json({ id: created.id, state: created.state });
}
