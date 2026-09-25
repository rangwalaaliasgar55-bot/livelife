// UI smoke test (run: npm run ui-test).
// Renders every panel and the new game surfaces to static markup, so a runtime
// error in any view (undefined field, bad map, missing key) fails the build
// instead of showing up as a blank screen for a player.
import { renderToStaticMarkup } from "react-dom/server";
import { applyAction } from "../src/lib/sim/actions";
import { createGame } from "../src/lib/sim/create";
import { tickMonths } from "../src/lib/sim/engine";
import type { GameState, PlayerAction } from "../src/lib/sim/types";
import { MinesGame } from "../src/components/game/MinesGame";
import { minesLayout } from "../src/lib/sim/mines";
import { Panels } from "../src/components/game/panels";
import { CashFlow } from "../src/components/game/panels2";
import { SpeedControls, TreasuryModal } from "../src/components/game/overlays";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const input = {
  mode: "entrepreneur" as const,
  name: "UI Smoke",
  age: 25,
  countryId: "indara",
  background: "middle",
  educationLevel: 3,
  wealth: 400000,
  traits: { risk: 60, ambition: 70, discipline: 60, negotiation: 55, leadership: 50, creativity: 55, patience: 50, frugality: 50 },
  appearance: { skin: "#c68642", hair: "#1a120b", eyes: "#3d2914", style: "sharp" as const, portrait: "gold" as const },
  nationality: "Indaran",
  seed: "ui-smoke",
};

const state: GameState = createGame({ ...input });
const act = (a: PlayerAction) => {
  applyAction(state, a);
};

// Give the life a few months of real history so the money panels have data.
applyAction(state, { type: "dev", op: "toggle" });
applyAction(state, { type: "dev", op: "add_money", args: { amount: 3_000_000 } });
applyAction(state, { type: "hireAdvisor", advisorId: "accountant" });
for (let i = 0; i < 6; i++) {
  if (state.pending.length) state.pending.splice(0, state.pending.length);
  tickMonths(state, 1);
}
applyAction(state, { type: "minesStart", stake: 50_000, mines: 5 });
{
  const m = state.adv!.mines!;
  const bombs = minesLayout(m.seed, m.tiles, m.mines);
  const safe = Array.from({ length: m.tiles }, (_, i) => i).find((i) => !bombs.includes(i))!;
  applyAction(state, { type: "minesReveal", tile: safe });
}
// exercise the new surfaces so their views render real data
applyAction(state, { type: "dev", op: "add_money", args: { amount: 2_000_000_000 } });
applyAction(state, { type: "buyAircraft", modelId: "swift" });
applyAction(state, { type: "buyVehicle", modelId: "daycruiser" });
applyAction(state, { type: "bjStart", stake: 10_000 });
applyAction(state, { type: "hiloStart", stake: 10_000 });
applyAction(state, { type: "crashStart", stake: 10_000, auto: null });
applyAction(state, { type: "rouletteSpin", bets: [{ kind: "red", amount: 5000 }] });
applyAction(state, { type: "findLove", where: "app" });

const VIEWS = [
  "life", "career", "staff", "bank", "markets", "property", "business", "opps", "world",
  "politics", "concord", "media", "under", "analysis", "cashflow", "research", "stats",
  "calendar", "news", "legacy", "mylife", "casino", "lifestyle", "takeovers",
];

for (const view of VIEWS) {
  let html = "";
  let error = "";
  try {
    html = renderToStaticMarkup(<Panels view={view} state={state} act={act} busy={false} />);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  check(`view "${view}" renders`, error === "" && html.length > 100, error || `${html.length} bytes`);
}

const mines = renderToStaticMarkup(<MinesGame state={state} act={act} busy={false} />);
check("mines board has 25 tiles", (mines.match(/aspect-square/g) ?? []).length === 25);
check("mines shows the live multiplier and cash-out", /×/.test(mines) && /Cash out/.test(mines));
check("mines shows next-tile odds", /% safe/.test(mines));

const flow = renderToStaticMarkup(<CashFlow state={state} act={act} />);
check("cash flow shows runway and burn", /Runway/.test(flow) && /Fixed monthly burn/.test(flow));
check("cash flow shows the advisor line", /Advisors/.test(flow));
check("cash flow shows debt service", /Debt service/.test(flow));

const speeds = renderToStaticMarkup(<SpeedControls speed={0.25} setSpeed={() => {}} onStep={() => {}} />);
check("time controls offer slow speeds and manual steps", /¼×/.test(speeds) && /½×/.test(speeds) && /\+1mo/.test(speeds) && /\+1y/.test(speeds));

const locked = renderToStaticMarkup(<TreasuryModal state={state} act={act} onClose={() => {}} />);
check("treasury asks for the key when locked", /admin key/i.test(locked));
applyAction(state, { type: "admin", op: "unlock", key: process.env.NEXT_PUBLIC_ADMIN_KEY ?? "aurelion-admin" });
const unlocked = renderToStaticMarkup(<TreasuryModal state={state} act={act} onClose={() => {}} />);
check("treasury offers draws once unlocked", /Draw/.test(unlocked) && /Lock the treasury/.test(unlocked));
check("treasury offers the casino x-ray", /X-ray off/.test(unlocked));

// Mines x-ray: invisible to players, visible to the admin once switched on.
if (!state.adv!.mines || state.adv!.mines.status !== "live") applyAction(state, { type: "minesStart", stake: 10_000, mines: 5 });
const hidden = renderToStaticMarkup(<MinesGame state={state} act={act} busy={false} />);
check("mines hide positions without x-ray", !/bg-rose-500\/\[0\.06\]/.test(hidden));
applyAction(state, { type: "admin", op: "xray" });
const xr = renderToStaticMarkup(<MinesGame state={state} act={act} busy={false} />);
check("admin x-ray marks every mine", (xr.match(/bg-rose-500\/\[0\.06\]/g) ?? []).length === state.adv!.mines!.mines);
applyAction(state, { type: "admin", op: "lock" });
const relocked = renderToStaticMarkup(<MinesGame state={state} act={act} busy={false} />);
check("locking the treasury switches x-ray off", !/bg-rose-500\/\[0\.06\]/.test(relocked));

console.log(failures === 0 ? "\nUI SMOKE: ALL CHECKS PASSED" : `\nUI SMOKE: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
