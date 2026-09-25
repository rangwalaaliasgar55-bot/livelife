import { actOnSave, deleteSave, loadSave, upsertState } from "@/lib/persist";
import type { GameState, PlayerAction } from "@/lib/sim/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const state = await loadSave(id);
    if (!state) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ state });
  } catch {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { action?: PlayerAction };
  try {
    body = (await req.json()) as { action?: PlayerAction };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.action?.type) {
    return Response.json({ error: "Action required" }, { status: 400 });
  }
  try {
    const result = await actOnSave(id, body.action);
    if ("status" in result && result.status === 404) {
      return Response.json({ error: result.error }, { status: 404 });
    }
    return Response.json(result);
  } catch {
    return Response.json({ error: "Action failed" }, { status: 500 });
  }
}

// Client-authoritative sync: the app (web or APK) runs the simulation locally
// and pushes the full state here for persistence / multi-device sync.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { state?: GameState; name?: string };
  try {
    body = (await req.json()) as { state?: GameState; name?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.state?.player) {
    return Response.json({ error: "State required" }, { status: 400 });
  }
  try {
    await upsertState(id, body.state, body.name);
  } catch {
    return Response.json({ error: "Persist failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteSave(id);
  } catch {
    // nothing to delete, or storage is read-only — either way it is gone locally
  }
  return Response.json({ ok: true });
}
