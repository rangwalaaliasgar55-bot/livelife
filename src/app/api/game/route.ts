import { createSave, listSaves } from "@/lib/persist";
import type { NewGameInput } from "@/lib/sim/types";

export const dynamic = "force-dynamic";

// The server is an optional mirror: the app runs client-first and keeps its own
// copy. A storage problem must therefore degrade quietly (empty list) instead
// of throwing a 500 that makes the whole save list look broken.
export async function GET() {
  try {
    const saves = await listSaves();
    return Response.json({ saves });
  } catch {
    return Response.json({ saves: [], degraded: true });
  }
}

export async function POST(req: Request) {
  let body: { input?: NewGameInput; name?: string };
  try {
    body = (await req.json()) as { input?: NewGameInput; name?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.input?.name) {
    return Response.json({ error: "Name required" }, { status: 400 });
  }
  try {
    const created = await createSave(body.input, body.name);
    return Response.json({ id: created.id, state: created.state });
  } catch {
    return Response.json({ error: "Could not create the save" }, { status: 500 });
  }
}
