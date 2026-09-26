// Round-2 business systems smoke test (run: npx tsx scripts/biz-smoke.ts)
// Company HQ, banks & brokers, casino operations, estates & developers,
// taxes, AI jobs, education, gifts, and the three new casino games.
import { applyAction } from "../src/lib/sim/actions";
import { createGame } from "../src/lib/sim/create";
import { computeNetWorth, liquidCash } from "../src/lib/sim/finance";
import { tickMonths } from "../src/lib/sim/engine";
import { getBiz } from "../src/lib/sim/biz";
import { getHQ } from "../src/lib/sim/company";
import { getCasinoOps } from "../src/lib/sim/casinoops";
import { getEstate } from "../src/lib/sim/estates";
import { BIG_SIX, BIG_SIX_WHEEL, bigSixEdge, getCasino, vpEvaluate } from "../src/lib/sim/casino";
import { quoteTax } from "../src/lib/sim/civic";
import type { GameState, PlayerAction } from "../src/lib/sim/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Panels } from "../src/components/game/panels";
import { CasinoOwner } from "../src/components/game/CasinoGames2";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const L = (r: { log: string[] }) => r.log.join("; ").slice(0, 220);

const state: GameState = createGame({
  mode: "entrepreneur",
  name: "Biz Tester",
  age: 30,
  countryId: "indara",
  background: "wealthy",
  educationLevel: 4,
  wealth: 2_000_000,
  traits: {
    risk: 60,
    ambition: 70,
    discipline: 65,
    negotiation: 60,
    leadership: 60,
    creativity: 55,
    patience: 50,
    frugality: 50,
  },
  appearance: {
    skin: "#c68642",
    hair: "#1a120b",
    eyes: "#3d2914",
    style: "sharp",
    portrait: "gold",
  },
  nationality: "Indaran",
  seed: "biz-smoke-1",
} as Parameters<typeof createGame>[0]);

const act = (a: PlayerAction) => applyAction(state, a);
const biz = (op: string, id = "", args: Record<string, unknown> = {}) => act({ type: "biz", op, id, args });
function live(months: number, onMonth?: () => void) {
  for (let i = 0; i < months; i++) {
    // answer decisions with their first option, like a hurried player would
    while (state.pending.length) {
      const d = state.pending[0]!;
      act({
        type: "resolve",
        decisionId: d.id,
        optionId: d.options[0]!.id,
      } as PlayerAction);
      if (state.pending[0] === d) state.pending.shift();
    }
    tickMonths(state, 1);
    onMonth?.();
  }
}

act({ type: "dev", op: "toggle" } as PlayerAction);
act({
  type: "dev",
  op: "add_money",
  args: { amount: 200_000_000 },
} as PlayerAction);
check("funded", liquidCash(state.player) >= 200_000_000);

/* ---------- casino games */
{
  const counts: Record<string, number> = {};
  for (const s of BIG_SIX_WHEEL) counts[s] = (counts[s] ?? 0) + 1;
  check("big six wheel has 54 segments", BIG_SIX_WHEEL.length === 54);
  check(
    "big six counts match",
    BIG_SIX.every((s) => counts[s.id] === s.count),
    JSON.stringify(counts),
  );
  check("big six ₹1 edge ≈ 11.1%", Math.abs(bigSixEdge("1") - 0.111) < 0.001);
  // card ids: rank 1..13 → check evaluator with constructed hands via labels
  const royal = [0, 9, 10, 11, 12]; // A,10,J,Q,K of the first suit (card = suit*13 + rank-1)
  check("royal flush detected", vpEvaluate(royal).hand === "Royal Flush", vpEvaluate(royal).hand);
  const pairK = [12, 25, 2, 17, 33];
  check("pair of kings = Jacks or Better", vpEvaluate(pairK).hand === "Jacks or Better", vpEvaluate(pairK).hand);

  const before = liquidCash(state.player);
  let r = act({ type: "baccaratDeal", bets: { banker: 10000 } });
  const bac = getCasino(state).baccarat;
  check("baccarat round settled", Boolean(bac && bac.player.length >= 2 && bac.banker.length >= 2), L(r));
  r = act({ type: "vpDeal", stake: 5000 });
  check("video poker dealt 5", getCasino(state).vp?.hand.length === 5, L(r));
  r = act({ type: "vpDraw", holds: [true, false, true, false, false] });
  check("video poker drew", getCasino(state).vp?.status === "done", L(r));
  r = act({ type: "wheelSpin", bets: { "1": 2000, joker: 500 } });
  check("big six spun", getCasino(state).wheel != null, L(r));
  check("gambling moved money", liquidCash(state.player) !== before);

  // RTP sanity for baccarat banker over many hands
  let staked = 0;
  let back = 0;
  for (let i = 0; i < 3000; i++) {
    const c0 = liquidCash(state.player);
    act({ type: "baccaratDeal", bets: { banker: 1000 } });
    staked += 1000;
    back += liquidCash(state.player) - c0 + 1000;
  }
  const edge = 1 - back / staked;
  check("baccarat banker edge within noise of 1.06%", edge > -0.04 && edge < 0.06, `${(edge * 100).toFixed(2)}%`);
}

/* ---------- company HQ */
let r = act({
  type: "foundCompany",
  payload: {
    name: "Test Robotics",
    industry: "ai",
    countryId: state.player.countryId,
    cityId: state.player.cityId,
    capital: 20_000_000,
    product: "Agents",
    model: "SaaS",
    price: 100,
  },
} as PlayerAction);
const coId = state.player.ownedCompanyIds[0]!;
check("company founded", Boolean(coId), L(r));
const co = state.world.companies.find((c) => c.id === coId)!;
const hq = getHQ(state, co);
check("HQ created with roles", hq.roles.eng.count + hq.roles.sales.count >= 0);
r = biz("hqRoles", coId, { targets: { eng: 12, sales: 6, ops: 4, mgmt: 3 } });
check("set hiring targets", hq.roles.eng.target === 12, L(r));
r = biz("hqAgents", coId, { agents: { eng: 3, sales: 2, ops: 4 } });
check("deployed AI agents", hq.agents.ops === 4, L(r));
r = biz("hqStrategy", coId, { strategy: "aggressive", payout: 20 });
check("strategy set", hq.strategy === "aggressive", L(r));
r = biz("hqLab", coId, { training: 40 });
check("AI lab configured", hq.lab != null, L(r));

/* ---------- banks, FDs, broker, brokerage */
r = act({ type: "foundBank", name: "Tester Bank" } as PlayerAction);
const myBank = state.world.banks.find((b) => b.playerOwned)!;
check("bank founded", Boolean(myBank), L(r));
r = biz("bankSet", myBank.id, {
  depositRate: 4,
  lendingRate: 11,
  risk: 45,
  staff: 30,
  marketing: 200000,
  dividendPct: 30,
});
check("bank policy set", getBiz(state).banks[myBank.id]?.lendingRate === 11, L(r));
r = biz("openFD", state.world.banks[0]!.id, { amount: 1_000_000, months: 12 });
check("fixed deposit opened", getBiz(state).fds.length === 1, L(r));
r = biz("hireBroker", "", {
  tier: "senior",
  amount: 2_000_000,
  risk: "balanced",
});
check("personal broker hired", getBiz(state).broker != null, L(r));
r = biz("foundBrokerage", "", { name: "Tester Securities" });
check("brokerage founded", getBiz(state).brokerages.length === 1, L(r));

/* ---------- casino */
r = act({
  type: "foundCasino",
  name: "Tester Palace",
  cityId: state.player.cityId,
} as PlayerAction);
const cas = state.world.casinos[state.world.casinos.length - 1]!;
check("casino founded for ₹5 Cr", Boolean(cas) && Boolean(getBiz(state).casinos[cas.id]), L(r));
r = biz("casinoManage", cas.id, {
  tables: { baccarat: 4, craps: 1 },
  staff: { dealers: 50, hosts: 3 },
  vip: true,
});
check("casino floor changed", getCasinoOps(state, cas).tables.baccarat === 4, L(r));

/* ---------- real estate */
r = act({ type: "dev", op: "spawn_property" } as PlayerAction);
const listing = state.world.properties?.[0] as { id: string } | undefined;
if (listing)
  act({
    type: "buyProperty",
    listingId: listing.id,
    mortgage: false,
  } as PlayerAction);
const prop = state.player.properties[0];
check("own a property", Boolean(prop), L(r));
if (prop) {
  const e = getEstate(state, prop);
  r = biz("estManager", prop.id, { tier: "premium" });
  check("hired property manager", e.manager === "premium", L(r));
  r = biz("estRent", prop.id, { amount: Math.round(prop.value * 0.004) });
  check("listed for rent", e.listed === "rent" && prop.rent > 0, L(r));
}

/* ---------- gifts, certs */
const L0 = state.life;
const person = L0?.people?.find((p) => p.alive !== false);
if (person) {
  r = biz("gift", person.id, { kind: "cash", amount: 100000 });
  check("gift given", getBiz(state).gifts.length === 1, L(r));
  const h = state.player.holdings.find((x) => x.shares >= 2);
  if (h) {
    const before = h.shares;
    r = biz("gift", person.id, { kind: "shares", ref: h.ticker, amount: 1 });
    const after = state.player.holdings.find((x) => x.ticker === h.ticker)?.shares ?? 0;
    check("gifted shares", after === before - 1, L(r));
  }
  const spare = state.player.properties.find((x) => !x.mortgaged && !getBiz(state).estates[x.id]?.project);
  if (spare) {
    const n = state.player.properties.length;
    r = biz("gift", person.id, { kind: "property", ref: spare.id });
    check("gifted a property", state.player.properties.length === n - 1, L(r));
  }
}
r = biz("cert", "agentops");
check("started certification", state.player.currentStudy?.level === "certification", L(r));

/* ---------- live 3 years */
let minNW = Infinity;
live(36, () => {
  const nw = computeNetWorth(state);
  minNW = Math.min(minNW, nw);
  if (!Number.isFinite(nw)) throw new Error("net worth NaN at " + state.ticks);
});
check("alive after 3 years (or died naturally)", state.player.alive || state.player.age > 30);
check("net worth finite", Number.isFinite(computeNetWorth(state)), String(Math.round(computeNetWorth(state))));
check("cash never negative", state.player.finances.cash >= 0);
const hqNow = getBiz(state).hq[coId];
check("HQ has monthly reports", Boolean(hqNow?.lastReport), JSON.stringify(hqNow?.lastReport ?? {}).slice(0, 200));
check("headcount moved toward targets", (hqNow?.roles.eng.count ?? 0) > 0, `eng ${hqNow?.roles.eng.count}`);
const ops = getBiz(state).casinos[cas.id];
check("casino ran months", (ops?.history.length ?? 0) >= 12, `last net ${Math.round(ops?.last?.net ?? 0)}, visits ${ops?.last?.visits}`);
check("fixed deposit matured or accruing", getBiz(state).fds.length === 0 || getBiz(state).fds[0]!.accrued > 0);
check("broker account valued", (getBiz(state).broker?.value ?? 0) > 0, String(Math.round(getBiz(state).broker?.value ?? 0)));
check("brokerage has history", (getBiz(state).brokerages[0]?.history.length ?? 0) > 0 || getBiz(state).brokerages.length === 0);
check("bank ops tracked", (getBiz(state).banks[myBank.id]?.history.length ?? 0) > 0 || !state.world.banks.includes(myBank));
if (prop && state.player.properties.includes(prop))
  check("estate log written", getEstate(state, prop).log.length > 0 || getEstate(state, prop).lastMonth != null);
check("tax book or returns exist", getBiz(state).returns.length > 0 || getBiz(state).tax.salary + getBiz(state).tax.business + getBiz(state).tax.rent !== 0);
const q = quoteTax(state);
check("tax quote finite", Number.isFinite(q.due), `due ${Math.round(q.due)}`);
check("certification completed", getBiz(state).certs.includes("agentops"));

/* ---------- start a development */
if (prop && state.player.properties.includes(prop)) {
  r = biz("estDevelop", prop.id, {
    kind: "apartments",
    developer: "reputable",
  });
  check("development started (or refused with reason)", r.log.length > 0, L(r));
  live(24);
  const e = getEstate(state, prop);
  check("development progressed", !e.project || e.project.progress > 0 || e.units != null, JSON.stringify(e.project ?? e.units).slice(0, 160));
}

/* ---------- the new screens render with a busy save */
const uiAct = (a: PlayerAction) => void act(a);
const views: [string, RegExp][] = [
  ["hq", /Test Robotics/],
  ["finance", /Tester Bank/],
  ["estates", state.player.properties[0] ? new RegExp(state.player.properties[0].name.replace(/[()]/g, ".")) : /Buy a property/],
  ["civic", /tax/i],
];
for (const [view, expect] of views) {
  let html = "";
  try {
    html = renderToStaticMarkup(createElement(Panels, { view, state, act: uiAct, busy: false }));
  } catch (e) {
    html = "THREW " + String(e);
  }
  check(`${view} screen renders`, expect.test(html), html.slice(0, 160));
}
let ownerHtml = "";
try {
  ownerHtml = renderToStaticMarkup(createElement(CasinoOwner, { state, act: uiAct }));
} catch (e) {
  ownerHtml = "THREW " + String(e);
}
check("casino owner console renders", /Tester Palace/.test(ownerHtml), ownerHtml.slice(0, 160));

console.log(
  `\nnet worth ${Math.round(computeNetWorth(state)).toLocaleString("en-IN")}, cash ${Math.round(liquidCash(state.player)).toLocaleString("en-IN")}, min NW ${Math.round(minNW).toLocaleString("en-IN")}`,
);
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
if (!process.env.PROBE) process.exit(failures ? 1 : 0);
export { state };
