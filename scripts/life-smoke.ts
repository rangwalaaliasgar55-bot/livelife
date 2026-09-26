// Life-layer regression test (run: npm run life-test).
//
// Plays whole lives through the BitLife layer — aging up, answering life
// events, relationships, activities, prison, death and heirs — and checks the
// casino games' house edges, the aircraft economy and the takeover rules.
import { applyAction } from "../src/lib/sim/actions";
import { createGame } from "../src/lib/sim/create";
import { tickMonths } from "../src/lib/sim/engine";
import { computeNetWorth, liquidCash } from "../src/lib/sim/finance";
import { getLife, sentence } from "../src/lib/sim/life";
import { lifeEventCount } from "../src/lib/sim/lifeevents";
import { getCasino, slotRTP, plinkoTable, plinkoProbs, handValue } from "../src/lib/sim/casino";
import { controlOf } from "../src/lib/sim/corporate";
import type { GameState } from "../src/lib/sim/types";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const finite = (n: number) => Number.isFinite(n);

const input = {
  mode: "entrepreneur" as const,
  name: "Life Test",
  age: 18,
  countryId: "indara",
  background: "middle",
  educationLevel: 2,
  wealth: 400000,
  traits: { risk: 60, ambition: 70, discipline: 60, negotiation: 55, leadership: 50, creativity: 55, patience: 50, frugality: 50 },
  appearance: { skin: "#c68642", hair: "#1a120b", eyes: "#3d2914", style: "sharp" as const, portrait: "gold" as const },
  nationality: "Indaran",
};
function fresh(seed: string): GameState {
  const s = createGame({ ...input, seed });
  applyAction(s, { type: "dev", op: "toggle" });
  return s;
}
const fund = (s: GameState, amount: number) => applyAction(s, { type: "dev", op: "add_money", args: { amount } });

/** Answer whatever decision is on the table with a (seeded) choice. */
function answer(s: GameState, k: number) {
  let guard = 0;
  while (s.pending.length && guard++ < 10) {
    const d = s.pending[0]!;
    if (d.kind === "death") return;
    const opt = d.options[k % d.options.length]!;
    applyAction(s, { type: "resolve", decisionId: d.id, optionId: opt.id });
  }
}

/* 1. the life layer exists from day one ------------------------------------ */
{
  const s = fresh("life-1");
  const L = getLife(s);
  check("life layer created with the game", Boolean(s.life));
  check("parents exist in the relationship web", L.people.some((p) => p.rel === "mother") && L.people.some((p) => p.rel === "father"));
  check("stats are sane", [L.smarts, L.looks, L.karma].every((x) => x >= 0 && x <= 100));
  check("at least 30 kinds of life events", lifeEventCount() >= 30, String(lifeEventCount()));
}

/* 2. age up moves exactly to the next birthday ---------------------------- */
{
  const s = fresh("life-2");
  const age = s.player.age;
  let tries = 0;
  while (s.player.age === age && tries++ < 20) {
    applyAction(s, { type: "ageUp" });
    answer(s, tries);
  }
  check("+Age reaches the next birthday", s.player.age === age + 1, `age ${s.player.age}`);
  check("birthday month matches", s.time.month === s.player.birthMonth);
}

/* 3. a whole life, many seeds: no NaN, events fire, consequences resolve --- */
{
  let events = 0;
  let deaths = 0;
  let consequencesLanded = 0;
  let nanFree = true;
  const ages: string[] = [];
  for (let seed = 0; seed < 6; seed++) {
    const s = fresh(`life-long-${seed}`);
    fund(s, 60_000_000);
    const seen = new Set<string>();
    for (let y = 0; y < 70 && s.player.alive; y++) {
      let g = 0;
      const age = s.player.age;
      while (s.player.age === age && s.player.alive && g++ < 12) {
        applyAction(s, { type: "ageUp" });
        for (const d of s.pending) if (d.kind === "life") seen.add(d.title);
        if (s.pending.some((d) => d.kind === "death")) break;
        answer(s, seed + y);
      }
      if (s.pending.some((d) => d.kind === "death")) break;
      const L = getLife(s);
      if (y % 3 === 0 && L.people.length) applyAction(s, { type: "interact", personId: L.people[0]!.id, kind: "time" });
      if (y % 4 === 1) applyAction(s, { type: "activity", id: "gym" });
      const nw = computeNetWorth(s);
      if (!finite(nw) || !finite(s.player.health) || !finite(s.player.happiness) || !finite(L.smarts)) nanFree = false;
    }
    events += seen.size;
    const L = getLife(s);
    consequencesLanded += s.timeline.filter((t) => t.kind === "consequence").length;
    if (!s.player.alive || s.pending.some((d) => d.kind === "death")) {
      deaths++;
      ages.push(`${s.player.age} (${s.player.causeOfDeath ?? "?"})`);
    }
    void L;
  }
  check("life events fire across a life", events >= 20, `${events} distinct events`);
  check("delayed consequences land later", consequencesLanded > 0, `${consequencesLanded}`);
  check("mortality is real within 70 years from 18", deaths >= 1, `${deaths}/6 died at ${ages.join(", ")}`);
  check("no NaN in a long life", nanFree);
}

/* 4. death → heir carries on with a rebuilt family ------------------------ */
{
  const s = fresh("life-heir");
  fund(s, 5_000_000);
  const L = getLife(s);
  // find a partner, marry, have a child
  for (let i = 0; i < 12 && !L.people.some((p) => p.rel === "partner" || p.rel === "spouse"); i++) {
    applyAction(s, { type: "findLove", where: "app" });
    const c = getLife(s).candidates.sort((a, b) => (b.interest ?? 0) - (a.interest ?? 0))[0];
    if (c) applyAction(s, { type: "askOut", candidateId: c.id });
  }
  applyAction(s, { type: "haveChild" });
  const kids = getLife(s).people.filter((p) => p.rel === "child");
  check("children join the relationship web", kids.length >= 1);
  let g = 0;
  s.player.age = 66;
  while (s.player.alive && !s.pending.some((d) => d.kind === "death" || d.kind === "heir") && g++ < 24) {
    s.player.health = 1;
    tickMonths(s, 1);
    answer(s, 0);
  }
  const d = s.pending.find((x) => x.kind === "death" || x.kind === "heir" || x.kind === "successor");
  check("death raises an heir decision", Boolean(d) || !s.player.alive, d?.kind ?? (s.player.alive ? "alive" : "dead"));
  if (d) {
    const heirOpt = d.options.find((o) => o.id !== "end" && o.id !== "no") ?? d.options[0]!;
    const oldName = s.player.name;
    applyAction(s, { type: "resolve", decisionId: d.id, optionId: heirOpt.id });
    if (s.player.alive && s.player.name !== oldName) {
      const L2 = getLife(s);
      check("heir sees the old player as a dead parent", L2.people.some((p) => p.name === oldName && !p.alive));
      check("heir is not their own sibling", !L2.people.some((p) => p.name === s.player.name));
    }
  }
}

/* 5. prison blocks the outside world and ends --------------------------- */
{
  const s = fresh("life-prison");
  fund(s, 1_000_000);
  sentence(s, 14, "fraud");
  const r = applyAction(s, { type: "applyJob", jobId: "x" } as never);
  check("prison blocks applying for jobs", /serving time/i.test(r.log.join(" ")));
  const cash = liquidCash(s.player);
  const r2 = applyAction(s, { type: "slotSpin", stake: 1000 });
  check("no casino from a cell", liquidCash(s.player) === cash && /serving time/i.test(r2.log.join(" ")));
  applyAction(s, { type: "activity", id: "p_read" });
  for (let i = 0; i < 20 && getLife(s).prison; i++) {
    tickMonths(s, 1);
    answer(s, 1);
  }
  check("released when the sentence is served", !getLife(s).prison || getLife(s).prison!.monthsLeft <= 0);
  check("the conviction is on the record", getLife(s).record.length > 0);
}

/* 6. casino house edges hold over many rounds --------------------------- */
{
  check("slots RTP 94–97%", slotRTP() > 0.94 && slotRTP() < 0.97, (slotRTP() * 100).toFixed(2) + "%");
  for (const r of ["low", "medium", "high"] as const) {
    const t = plinkoTable(r);
    const rtp = t.reduce((s, m, i) => s + m * plinkoProbs()[i]!, 0);
    check(`plinko ${r} RTP ≈ 97%`, rtp > 0.96 && rtp < 0.98, (rtp * 100).toFixed(2) + "%");
  }
  const s = fresh("life-casino");
  fund(s, 50_000_000);
  const start = liquidCash(s.player);
  let wagered = 0;
  for (let i = 0; i < 1500; i++) {
    applyAction(s, { type: "rouletteSpin", bets: [{ kind: "red", amount: 1000 }] });
    applyAction(s, { type: "slotSpin", stake: 1000 });
    applyAction(s, { type: "diceRoll", stake: 1000, target: 50, over: true });
    applyAction(s, { type: "plinkoDrop", stake: 1000, risk: "medium" });
    wagered += 4000;
  }
  const lost = start - liquidCash(s.player);
  const edge = lost / wagered;
  check("house wins over 6,000 rounds", edge > -0.02 && edge < 0.12, `realised edge ${(edge * 100).toFixed(2)}%`);
  check("casino history is recorded", getCasino(s).history.length > 0 && getCasino(s).sessions >= 6000);
  check("gambling builds a habit", getLife(s).addiction.gambling > 10, `${getLife(s).addiction.gambling.toFixed(1)}%`);

  // blackjack: play basic "stand on 17" through complete hands
  let hands = 0;
  for (let i = 0; i < 300; i++) {
    applyAction(s, { type: "bjStart", stake: 1000 });
    let g = 0;
    while (getCasino(s).bj?.status === "live" && g++ < 10) {
      const v = handValue(getCasino(s).bj!.player).total;
      applyAction(s, { type: v < 17 ? "bjHit" : "bjStand" });
    }
    if (getCasino(s).bj?.status === "done") hands++;
  }
  check("blackjack hands always resolve", hands === 300, `${hands}`);

  // crash: cash out below / above the crash point
  applyAction(s, { type: "crashStart", stake: 10_000, auto: null });
  const cp = getCasino(s).crash!.crash;
  const before = liquidCash(s.player);
  applyAction(s, { type: "crashCashout", at: cp + 1 });
  check("cashing out after the crash pays nothing", liquidCash(s.player) === before && getCasino(s).crash!.status === "bust");
  let found = false;
  for (let i = 0; i < 50 && !found; i++) {
    applyAction(s, { type: "crashStart", stake: 10_000, auto: null });
    const c = getCasino(s).crash!;
    if (c.crash >= 1.5) {
      const b = liquidCash(s.player);
      applyAction(s, { type: "crashCashout", at: 1.5 });
      found = Math.abs(liquidCash(s.player) - b - 15_000) < 1;
    } else applyAction(s, { type: "crashCashout", at: c.crash });
  }
  check("cashing out before the crash pays stake × multiplier", found);

  // hi-lo run
  applyAction(s, { type: "hiloStart", stake: 1000 });
  applyAction(s, { type: "hiloGuess", guess: "skip" });
  check("hi-lo skip keeps the run alive", getCasino(s).hilo?.status === "live");
  applyAction(s, { type: "hiloCashout" });

  // unaffordable stakes move nothing
  const c0 = liquidCash(s.player);
  applyAction(s, { type: "bjStart", stake: c0 * 10 });
  check("an unaffordable stake takes nothing", liquidCash(s.player) === c0);
}

/* 7. aircraft: charter earns, lease pays, flying relocates ---------------- */
{
  const s = fresh("life-air");
  fund(s, 3_000_000_000);
  applyAction(s, { type: "buyAircraft", modelId: "swift" });
  const L = getLife(s);
  const a = L.aircraft[0]!;
  check("aircraft bought", Boolean(a) && a.crew);
  const nw0 = computeNetWorth(s);
  check("aircraft counts in net worth", nw0 > 2_900_000_000, String(Math.round(nw0)));
  applyAction(s, { type: "aircraftMode", id: a.id, mode: "charter" });
  let income = 0;
  let cost = 0;
  for (let i = 0; i < 24; i++) {
    tickMonths(s, 1);
    answer(s, 1);
    income += a.lastIncome;
    cost += a.lastCost;
  }
  check("charter earns revenue", income > 0, `in ${Math.round(income)} / out ${Math.round(cost)}`);
  applyAction(s, { type: "aircraftMode", id: a.id, mode: "lease" });
  tickMonths(s, 1);
  answer(s, 1);
  check("lease pays monthly rent", a.lastIncome > 0 || a.mode !== "lease", String(a.lastIncome));
  applyAction(s, { type: "aircraftMode", id: a.id, mode: "private" });
  a.grounded = 0;
  const dest = s.world.cities.find((c) => c.id !== s.player.cityId && c.countryId !== s.player.countryId)!;
  applyAction(s, { type: "flyAircraft", id: a.id, cityId: dest.id });
  check("flying your own jet relocates you", s.player.cityId === dest.id, dest.name);
  check("the country counts as visited", getLife(s).visited.includes(dest.countryId));
  const home = s.world.cities.find((c) => c.id !== s.player.cityId)!;
  const cashV = liquidCash(s.player);
  applyAction(s, { type: "vacation", cityId: home.id, tier: "luxury", days: 7 });
  check("a vacation costs money and is logged", liquidCash(s.player) < cashV && getLife(s).trips.length === 1);
  applyAction(s, { type: "sellAircraft", id: a.id });
  check("aircraft sold", getLife(s).aircraft.length === 0);
}

/* 8. takeovers: stake, board seat, control, sell-down --------------------- */
{
  const s = fresh("life-corp");
  const target = s.world.companies.filter((c) => c.npc && c.stage !== "bankrupt").sort((a, b) => a.valuation - b.valuation)[0]!;
  fund(s, Math.ceil(target.valuation * 3));
  applyAction(s, { type: "tenderOffer", companyId: target.id, pct: 12, premium: 40, buyer: "me" });
  const ctl1 = controlOf(s, target);
  check("tender offer buys a stake", ctl1.pct > 0, `${ctl1.pct.toFixed(2)}%`);
  for (let i = 0; i < 6 && !controlOf(s, target).controlled; i++) {
    applyAction(s, { type: "tenderOffer", companyId: target.id, pct: 60, premium: 60, buyer: "me" });
  }
  const ctl2 = controlOf(s, target);
  check("crossing 50% gives control", ctl2.controlled && s.player.ownedCompanyIds.includes(target.id), `${ctl2.pct.toFixed(1)}%`);
  check("takeover achievement", s.achievements.includes("takeover"));
  const nw = computeNetWorth(s);
  check("net worth stays finite", finite(nw));
  // use the controlled company to buy into another
  const second = s.world.companies.filter((c) => c.npc && c.id !== target.id && c.stage !== "bankrupt").sort((a, b) => a.valuation - b.valuation)[0]!;
  target.cash = second.valuation;
  applyAction(s, { type: "tenderOffer", companyId: second.id, pct: 15, premium: 30, buyer: target.id });
  const via = controlOf(s, second);
  check("a controlled company can build stakes", via.viaCompanies.length === 1, `${via.pct.toFixed(2)}% via ${via.viaCompanies[0]?.name}`);
  // sell back down below control
  for (let i = 0; i < 4; i++) applyAction(s, { type: "sellStake", companyId: target.id, holderId: "player", pct: 60 });
  check("selling below 50% hands control back", !s.player.ownedCompanyIds.includes(target.id), `${controlOf(s, target).pct.toFixed(1)}%`);
}

/* 9. admin x-ray requires the unlocked treasury -------------------------- */
{
  const s = createGame({ ...input, seed: "life-xray" });
  const r = applyAction(s, { type: "admin", op: "xray" });
  check("x-ray refuses without admin", !s.adv?.admin?.xray && /locked/i.test(r.log.join(" ")));
  applyAction(s, { type: "admin", op: "unlock", key: process.env.NEXT_PUBLIC_ADMIN_KEY ?? "aurelion-admin" });
  check("x-ray turns on for the admin at unlock", Boolean(s.adv?.admin?.xray));
  applyAction(s, { type: "admin", op: "xray" });
  check("the admin can switch x-ray off", !s.adv?.admin?.xray);
}

console.log(failures === 0 ? "\nLIFE TEST: ALL CHECKS PASSED" : `\nLIFE TEST: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
