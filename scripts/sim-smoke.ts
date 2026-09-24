// End-to-end simulation smoke test (run: npx tsx scripts/sim-smoke.ts)
import { applyAction } from "../src/lib/sim/actions";
import { createGame } from "../src/lib/sim/create";
import { computeNetWorth } from "../src/lib/sim/finance";
import { tickMonths } from "../src/lib/sim/engine";
import { generateBio, buildCalendar, buildAnalysis, getAdv, GOAL_DEFS } from "../src/lib/sim/advanced";
import { devOp } from "../src/lib/sim/debug";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const input = {
  mode: "entrepreneur" as const,
  name: "Test Founder",
  age: 25,
  countryId: "indara",
  background: "middle",
  educationLevel: 3,
  wealth: 400000,
  traits: { risk: 60, ambition: 70, discipline: 60, negotiation: 55, leadership: 50, creativity: 55, patience: 50, frugality: 50 },
  appearance: { skin: "#c68642", hair: "#1a120b", eyes: "#3d2914", style: "sharp", portrait: "gold" },
  nationality: "Indaran",
  seed: "smoke-test-1",
};

const s1 = createGame({ ...input });
const s2 = createGame({ ...input });
const sameWorld = JSON.stringify(s1.world.countries.map((c) => [c.gdpGrowth, c.inflation, c.interestRate])) === JSON.stringify(s2.world.countries.map((c) => [c.gdpGrowth, c.inflation, c.interestRate]));
check("deterministic seed", sameWorld);
check("adv initialized", Boolean(s1.adv && s1.adv.stats && s1.adv.seedLabel === "smoke-test-1"));

const state = s1;
// found a company
let r = applyAction(state, {
  type: "foundCompany",
  payload: {
    name: "Smoke Corp",
    industry: "software",
    countryId: state.player.countryId,
    cityId: state.player.cityId,
    capital: 100000,
    product: "Widgets",
    model: "SaaS",
    price: 100,
  },
});
check("found company", state.player.ownedCompanyIds.length === 1, r.log.join("; "));

// tick 24 months (auto-dismiss any decisions that pause time, like the UI would)
for (let i = 0; i < 24; i++) {
  if (state.pending.length) state.pending.splice(0, state.pending.length);
  tickMonths(state, 1);
}
check("time advanced", state.time.year >= 2028, `now ${state.time.year}-${state.time.month}`);
check("company still alive", state.world.companies.find((c) => c.name === "Smoke Corp") !== undefined);

// bank account + loan
r = applyAction(state, { type: "openAccount", bankId: state.world.banks[0]!.id, kind: "savings" });
check("opened account", state.player.finances.accounts.length >= 1, r.log.join("; "));
r = applyAction(state, { type: "applyLoan", kind: "business", amount: 500000, termMonths: 36 });
check("loan applied (may be declined)", r.log.length > 0, r.log.join("; "));

// fund the character (dev mode) so the money systems below have liquidity
r = applyAction(state, { type: "dev", op: "toggle" });
check("dev mode on", state.adv!.debug === true, r.log.join("; "));
r = applyAction(state, { type: "dev", op: "add_money", args: { amount: 5000000 } });
check("dev money added", state.player.finances.cash >= 5000000, `cash ${Math.round(state.player.finances.cash)}`);

// hire advisor
r = applyAction(state, { type: "hireAdvisor", advisorId: "accountant" });
check("hired advisor", getAdv(state).advisors.length === 1, r.log.join("; "));

// research
r = applyAction(state, { type: "startResearch", topic: "property_mkt" });
check("research started", getAdv(state).research.length === 1, r.log.join("; "));
for (let i = 0; i < 2; i++) {
  if (state.pending.length) state.pending.splice(0, state.pending.length);
  tickMonths(state, 1);
}
check("research done after 2mo", getAdv(state).research[0]?.done === true, getAdv(state).research[0]?.findings.join(" | ").slice(0, 120));

// forecast
r = applyAction(state, { type: "placeForecast", topic: "index", direction: "up", horizonMonths: 3, stake: 50000 });
check("forecast placed", getAdv(state).forecasts.length === 1, r.log.join("; "));
for (let i = 0; i < 3; i++) {
  if (state.pending.length) state.pending.splice(0, state.pending.length);
  tickMonths(state, 1);
}
check("forecast settled", getAdv(state).forecasts.every((f) => f.status !== "open"), JSON.stringify(getAdv(state).forecasts.map((f) => [f.status, f.resultPct])));

// goal
r = applyAction(state, { type: "setGoal", goalId: "net_worth", target: 1000000 });
check("goal set", Boolean(getAdv(state).goals.net_worth), r.log.join("; "));
const gp = GOAL_DEFS.find((g) => g.id === "net_worth")!.check(state, 1000000);
check("goal progress computable", typeof gp.cur === "number", `cur ${Math.round(gp.cur)}`);

// challenge
r = applyAction(state, { type: "startChallenge", challengeId: "profitable_10y" });
check("challenge started", getAdv(state).challenge?.status === "active", r.log.join("; "));

// buy a property if possible
const listing = state.world.properties.find((p) => p.price < 500000);
if (listing) {
  r = applyAction(state, { type: "buyProperty", listingId: listing.id, mortgage: false });
  check("bought property", state.player.properties.length >= 1 || r.log.join("").includes("Cannot"), r.log.join("; ").slice(0, 100));
}

// auction system (force a lot via debug)
r = applyAction(state, { type: "dev", op: "spawn_property" });
check("spawned distressed property", r.log.join("").includes("spawned"), r.log.join("; "));
for (let i = 0; i < 3; i++) {
  if (state.pending.length) state.pending.splice(0, state.pending.length);
  tickMonths(state, 1);
} // auctions get scanned every 2 ticks
check("auctions scanned", getAdv(state).lastAuctionScan > 0);
if (getAdv(state).auctions.length) {
  r = applyAction(state, { type: "bidAuction", lotId: getAdv(state).auctions[0]!.id });
  check("auction bid attempted", r.log.length > 0, r.log.join("; ").slice(0, 120));
}

// month flow + ledger + year review after a full year
for (let i = 0; i < 12; i++) {
  if (state.pending.length) state.pending.splice(0, state.pending.length);
  tickMonths(state, 1);
}
const advNow = getAdv(state);
check("month flow recorded", Boolean(advNow.monthFlow && Object.keys(advNow.monthFlow.flows).length >= 1), JSON.stringify(Object.keys(advNow.monthFlow?.flows ?? {})));
check("stats earned > 0", getAdv(state).stats.earned > 0, `earned ${Math.round(getAdv(state).stats.earned)}`);
check("ratings populated", Object.keys(getAdv(state).ratings).length > 50, `${Object.keys(getAdv(state).ratings).length} rated`);
check("calendar has items", buildCalendar(state).length > 2, buildCalendar(state).slice(0, 3).map((c) => c.label).join(" | "));
const analysis = buildAnalysis(state);
check("analysis options >= 2", analysis.options.length >= 2, analysis.options.map((o) => o.label).join(" | ").slice(0, 120));

// 12 more months → December should produce year review
for (let i = 0; i < 12; i++) {
  if (state.pending.length) state.pending.splice(0, state.pending.length);
  tickMonths(state, 1);
}
const yr = getAdv(state).yearReview;
check("year review exists", Boolean(yr), yr ? `year ${yr.year} nw ${Math.round(yr.nwEnd)}` : "missing");

// bio
const bio = generateBio(state);
check("biography generated", bio.length > 100, bio.split("\n")[0]?.slice(0, 80));

// long soak: 10 more years without crash
let alive = true;
try {
  for (let i = 0; i < 120; i++) {
    tickMonths(state, 1);
    if (state.pending.length) state.pending.splice(0, state.pending.length); // auto-dismiss decisions in soak
  }
} catch (e) {
  alive = false;
  console.error(e);
}
check("10-year soak stable", alive, `ended ${state.time.year}-${state.time.month} nw ${Math.round(computeNetWorth(state))}`);
check("no NaN in key numbers", [state.player.finances.cash, computeNetWorth(state), state.player.finances.monthlyIncome].every((x) => Number.isFinite(x)));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
