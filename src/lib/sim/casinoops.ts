// Running a casino for real. You own the floor: how many tables of each game,
// how many slot machines and what they hold, table limits, every staff role,
// comps, a VIP programme, a hotel, marketing, the licence. Each month guests
// arrive (if you can seat them), wager, and the house wins or loses — with
// real variance, because one whale on a hot streak can wipe out a month.
// Cheating rings, AML audits and the gaming tax are part of the deal.
import type { CasinoBiz, GameState } from "./types";
import { bizFlow, getBiz, pushLog, type CasinoMonth, type CasinoOps, type TableGame } from "./biz";
import { credit, money, spend, spendUpTo } from "./finance";
import { history, news, note } from "./feed";
import { ledger } from "./advanced";
import { rng } from "./engine";
import { chance, clamp, formatDate, formatINR, normal, pick, round } from "./util";

const dt = (s: GameState) => formatDate(s.time.year, s.time.month);
const R = (s: GameState) => () => rng(s);

export const TABLE_DEFS: Record<TableGame, { name: string; edge: number; seats: number; price: number; blurb: string }> = {
  blackjack: {
    name: "Blackjack",
    edge: 0.012,
    seats: 7,
    price: 600000,
    blurb: "Low edge, loyal players. Card counters exist.",
  },
  roulette: {
    name: "Roulette",
    edge: 0.027,
    seats: 8,
    price: 900000,
    blurb: "Single-zero wheel, 2.7%.",
  },
  baccarat: {
    name: "Baccarat",
    edge: 0.012,
    seats: 14,
    price: 700000,
    blurb: "The whale game. Huge handle, thin edge, wild swings.",
  },
  poker: {
    name: "Poker room",
    edge: 0.05,
    seats: 9,
    price: 500000,
    blurb: "Players play each other; you take a 5% rake. No risk.",
  },
  craps: {
    name: "Craps",
    edge: 0.014,
    seats: 14,
    price: 1100000,
    blurb: "Loud, social, fast.",
  },
  bigsix: {
    name: "Big Six wheel",
    edge: 0.11,
    seats: 10,
    price: 400000,
    blurb: "Carnival wheel. Fat edge, small bets.",
  },
};
export const TABLE_IDS = Object.keys(TABLE_DEFS) as TableGame[];

export const STAFF_DEFS: Record<keyof CasinoOps["staff"], { name: string; pay: number; blurb: string }> = {
  dealers: {
    name: "Dealers",
    pay: 0.8,
    blurb: "≈4 per table to run 24/7. Short = tables closed.",
  },
  security: { name: "Security", pay: 0.7, blurb: "Deters cheats and trouble." },
  pit: {
    name: "Pit bosses",
    pay: 1.6,
    blurb: "One per ~6 tables. Spot advantage players.",
  },
  hosts: {
    name: "VIP hosts",
    pay: 1.4,
    blurb: "Bring and keep high rollers. VIP needs 2+.",
  },
  cashiers: {
    name: "Cage & cashiers",
    pay: 0.6,
    blurb: "AML compliance — auditors check.",
  },
  surveillance: {
    name: "Surveillance",
    pay: 1.0,
    blurb: "Eye in the sky. Catches cheating rings.",
  },
};
export const STAFF_IDS = Object.keys(STAFF_DEFS) as (keyof CasinoOps["staff"])[];

export function defaultOps(): CasinoOps {
  return {
    tables: {
      blackjack: 4,
      roulette: 2,
      baccarat: 2,
      poker: 1,
      craps: 0,
      bigsix: 1,
    },
    slots: 60,
    minBet: 500,
    maxBet: 50000,
    slotHold: 0.08,
    staff: {
      dealers: 40,
      security: 12,
      pit: 2,
      hosts: 1,
      cashiers: 4,
      surveillance: 3,
    },
    comps: 0.2,
    vip: false,
    hotelRooms: 0,
    marketing: 300000,
    licence: "standard",
    reputation: 50,
    last: null,
    history: [],
    whales: [],
    cheats: 0,
  };
}

export function getCasinoOps(state: GameState, c: CasinoBiz): CasinoOps {
  const biz = getBiz(state);
  let ops = biz.casinos[c.id];
  if (!ops) {
    ops = defaultOps();
    ops.assetValue = 5e7 * 0.7; // the building and fit-out, at book value
    biz.casinos[c.id] = ops;
  }
  return ops;
}

export function assetValue(ops: CasinoOps): number {
  return money(ops.assetValue);
}
function addAsset(ops: CasinoOps, v: number) {
  ops.assetValue = Math.max(0, money(ops.assetValue) + v);
}

const tableCount = (ops: CasinoOps) => TABLE_IDS.reduce((s, g) => s + ops.tables[g], 0);

export function casinoNeeds(ops: CasinoOps) {
  const t = tableCount(ops);
  return {
    dealers: t * 4,
    pit: Math.ceil(t / 6),
    security: Math.ceil(t * 0.8 + ops.slots / 25 + 4),
    surveillance: Math.ceil(t / 6 + ops.slots / 80),
    cashiers: Math.ceil(2 + (t + ops.slots / 10) / 8),
    hosts: ops.vip ? 2 : 0,
  };
}

function tickOneCasino(state: GameState, c: CasinoBiz) {
  const ops = getCasinoOps(state, c);
  const p = state.player;
  const city = state.world.cities.find((x) => x.id === c.cityId);
  const country = state.world.countries.find((x) => x.id === c.countryId);
  if (!city || !country) return;
  const r = R(state);
  const monthWage = city.avgWage / 12;
  const need = casinoNeeds(ops);
  // --- open tables (dealers limit), capacity and demand
  const dealerF = clamp(ops.staff.dealers / Math.max(1, need.dealers), 0, 1);
  const openTables = Object.fromEntries(TABLE_IDS.map((g) => [g, ops.tables[g] * dealerF])) as Record<TableGame, number>;
  const seats = TABLE_IDS.reduce((s, g) => s + openTables[g] * TABLE_DEFS[g].seats, 0) + ops.slots * 0.9;
  const capacity = seats * 150;
  const mkt = 0.6 + Math.min(1.4, (ops.marketing / 1e6) * 0.3);
  const rep = 0.55 + ops.reputation / 110;
  const minBetF = clamp(1.25 - ops.minBet / (monthWage * 0.06), 0.35, 1.25);
  const slotF = clamp(1.25 - ops.slotHold * 3, 0.5, 1.2);
  const econ = country.gdpGrowth > 0 ? 1.04 : 0.86;
  const compsF = 0.85 + ops.comps * 0.8;
  const demand =
    (city.population * 0.0035 + city.population * city.tourism * 0.00005) *
    mkt *
    rep *
    minBetF *
    econ *
    compsF *
    (ops.hotelRooms ? 1 + Math.min(0.4, ops.hotelRooms / 800) : 1);
  const visits = Math.round(Math.min(demand, capacity));
  const turnedAway = Math.max(0, demand - capacity);

  // --- handle by game: table guests bet more per visit than slot players
  const perVisit = monthWage * 0.2 * clamp(ops.maxBet / (monthWage * 2), 0.6, 1.6);
  const seatVisits = visits / Math.max(1, seats);
  const byGame: CasinoMonth["byGame"] = {};
  let ggr = 0;
  let theo = 0;
  let handleTotal = 0;
  const avgBet = clamp(ops.minBet * 3, ops.minBet, ops.maxBet);
  const mult: Record<TableGame, number> = {
    blackjack: 2.2,
    roulette: 2.2,
    baccarat: 3.5,
    poker: 2.2,
    craps: 2.4,
    bigsix: 0.8,
  };
  for (const g of TABLE_IDS) {
    if (openTables[g] <= 0) continue;
    const handle = openTables[g] * TABLE_DEFS[g].seats * seatVisits * perVisit * mult[g];
    handleTotal += handle;
    const edge = TABLE_DEFS[g].edge * (g === "blackjack" && ops.staff.pit < need.pit ? 0.4 : 1);
    const bets = Math.max(1, handle / avgBet);
    const sd = g === "poker" ? 0 : avgBet * Math.sqrt(bets) * (g === "baccarat" ? 1.0 : g === "bigsix" ? 2.2 : 1.1);
    const win = handle * edge + normal(r, 0, sd);
    byGame[g] = { handle: round(handle, 0), win: round(win, 0) };
    ggr += win;
    theo += handle * edge;
  }
  if (ops.slots > 0) {
    const handle = ops.slots * 0.9 * seatVisits * perVisit * 1.4 * slotF;
    handleTotal += handle;
    const spin = Math.max(10, ops.minBet / 10);
    const win = handle * ops.slotHold + normal(r, 0, spin * Math.sqrt(Math.max(1, handle / spin)) * 6);
    byGame.slots = { handle: round(handle, 0), win: round(win, 0) };
    ggr += win;
    theo += handle * ops.slotHold;
  }
  // --- whales: the variance that makes or breaks a month
  const whaleChance = ops.vip ? 0.45 + Math.min(0.3, ops.staff.hosts * 0.04) : 0.04;
  const whaleCount = chance(r, whaleChance) ? 1 + (chance(r, 0.35) ? 1 : 0) + (ops.vip && chance(r, 0.2) ? 1 : 0) : 0;
  for (let i = 0; i < whaleCount; i++) {
    const hands = 120 + Math.round(r() * 200);
    const bet = ops.maxBet * (0.4 + r() * 0.6);
    const handle = bet * hands;
    const result = handle * 0.012 + normal(r, 0, bet * Math.sqrt(hands) * 1.05);
    ggr += result;
    theo += handle * 0.012;
    const name = pick(r, [
      "Mr. Lau",
      "a shipping heir",
      "a crypto founder",
      "Sheikh Al-Rami",
      "a film producer",
      "the Tanaka syndicate",
      "an anonymous junket",
    ]);
    ops.whales.unshift({ t: dt(state), name, result: round(result, 0) });
    if (ops.whales.length > 12) ops.whales.length = 12;
    byGame.baccarat = {
      handle: round((byGame.baccarat?.handle ?? 0) + handle, 0),
      win: round((byGame.baccarat?.win ?? 0) + result, 0),
    };
    if (Math.abs(result) > 1e7)
      note(
        state,
        `${c.name}: ${name} ${result < 0 ? `won ${formatINR(-result)} from the house` : `lost ${formatINR(result)} at your baccarat tables`}.`,
        result < 0 ? "bad" : "good",
      );
  }

  // --- side businesses
  const occ = clamp(0.45 + city.tourism / 220 + ops.reputation / 400, 0.3, 0.95);
  const hotel = ops.hotelRooms * occ * 30 * monthWage * 0.07;
  const fnb = visits * monthWage * 0.006; // bars and restaurants: ~₹400 a head

  // --- costs
  const payroll = STAFF_IDS.reduce((s, k) => s + ops.staff[k] * monthWage * STAFF_DEFS[k].pay, 0);
  const compsCost = Math.max(0, theo) * ops.comps;
  const gamingTax = Math.max(0, ggr) * 0.25;
  const licence = ops.licence === "premium" ? 1_500_000 : 500_000;
  const upkeep = ops.slots * 3000 + tableCount(ops) * 20000 + 600000 + ops.hotelRooms * monthWage * 0.02;
  const sideCosts = hotel * 0.55 + fnb * 0.7;
  let incidents = 0;
  const notes: string[] = [];
  // cheating rings vs security & surveillance
  const guard = (ops.staff.security / Math.max(1, need.security)) * 0.5 + (ops.staff.surveillance / Math.max(1, need.surveillance)) * 0.5;
  if (chance(r, 0.07 * clamp(1.6 - guard, 0.2, 1.6))) {
    const loss = round(handleTotal * (0.004 + r() * 0.015), 0);
    const caught = chance(r, clamp(guard * 0.55, 0.05, 0.9));
    if (caught) {
      notes.push(`Surveillance caught a cheating ring (${formatINR(loss * 0.3)} lost before the arrest).`);
      incidents += loss * 0.3;
      ops.reputation = clamp(ops.reputation + 1, 0, 100);
    } else {
      notes.push(`A cheating ring took ${formatINR(loss)} and vanished.`);
      incidents += loss;
      ops.cheats += 1;
    }
  }
  // AML / regulator audit
  if (chance(r, 0.05 + (ops.slotHold > 0.12 ? 0.04 : 0))) {
    const weak = ops.staff.cashiers < need.cashiers || ops.staff.surveillance < need.surveillance;
    if (weak) {
      const fine = round(handleTotal * 0.01 + 500000, 0);
      incidents += fine;
      c.regulation = clamp(c.regulation - 10, 5, 95);
      notes.push(`Regulators audited the cage and fined you ${formatINR(fine)} for weak AML controls.`);
      history(state, "business", `Casino AML fine ${formatINR(fine)}`);
    } else {
      c.regulation = clamp(c.regulation + 5, 5, 95);
      notes.push("A regulator audit came back clean.");
    }
  }
  const costs = payroll + compsCost + gamingTax + licence + ops.marketing + upkeep + sideCosts + incidents;
  const revenue = ggr + hotel + fnb;
  const net = revenue - costs;

  // --- reputation drifts with service and comps
  const service =
    clamp(ops.staff.dealers / Math.max(1, need.dealers), 0, 1.2) * 0.5 +
    clamp(ops.staff.pit / Math.max(1, need.pit), 0, 1.2) * 0.2 +
    clamp(ops.staff.security / Math.max(1, need.security), 0, 1.2) * 0.3;
  ops.reputation = clamp(
    ops.reputation + (service - 0.9) * 2 + ops.comps * 2 - 0.3 - (turnedAway > demand * 0.2 ? 0.8 : 0) + (ops.slotHold > 0.12 ? -0.4 : 0),
    0,
    100,
  );

  // --- money: the owner eats the result either way
  const mf = state;
  if (net >= 0) {
    credit(p, net, `Casino net · ${c.name}`, "casino", dt(mf));
    bizFlow(state, "casino", net);
  } else {
    const paid = spendUpTo(p, -net, `Casino loss · ${c.name}`, "casino", dt(mf));
    bizFlow(state, "casino", -paid.paid);
    if (paid.short > 0) note(state, `${c.name} lost ${formatINR(-net)} this month and you could only cover ${formatINR(paid.paid)}.`, "bad");
  }
  if (Math.abs(net) > 5e7) ledger(state, `${c.name} month`, net);
  c.volume = round(handleTotal, 0);
  c.revenue = round(ggr, 0);
  c.costs = round(costs, 0);
  c.staff = STAFF_IDS.reduce((s, k) => s + ops.staff[k], 0);
  c.security = ops.staff.security;
  addAsset(ops, -assetValue(ops) * 0.004);
  ops.last = {
    t: dt(state),
    visits,
    handle: round(handleTotal, 0),
    theo: round(theo, 0),
    ggr: round(ggr, 0),
    byGame,
    hotel: round(hotel, 0),
    fnb: round(fnb, 0),
    payroll: round(payroll, 0),
    comps: round(compsCost, 0),
    gamingTax: round(gamingTax, 0),
    licence,
    marketing: ops.marketing,
    upkeep: round(upkeep + sideCosts, 0),
    incidents: round(incidents, 0),
    net: round(net, 0),
    note: [turnedAway > 1 ? `${Math.round(turnedAway).toLocaleString("en-IN")} guests turned away — add tables, slots or dealers.` : "", ...notes]
      .filter(Boolean)
      .join(" "),
  };
  ops.history.unshift({
    t: dt(state),
    handle: round(handleTotal, 0),
    ggr: round(ggr, 0),
    net: round(net, 0),
    visits,
  });
  if (ops.history.length > 36) ops.history.length = 36;
  for (const n of notes) note(state, `${c.name}: ${n}`, n.includes("clean") || n.includes("caught") ? "info" : "bad");
}

export function tickCasinoOps(state: GameState) {
  for (const c of state.world.casinos) tickOneCasino(state, c);
}

/* ------------------------------------------------------------ management */

export interface CasinoPatch {
  tables?: Partial<Record<TableGame, number>>;
  slots?: number;
  minBet?: number;
  maxBet?: number;
  slotHold?: number;
  staff?: Partial<CasinoOps["staff"]>;
  comps?: number;
  vip?: boolean;
  addRooms?: number;
  marketing?: number;
  licence?: "standard" | "premium";
}

export function casinoManage(state: GameState, casinoId: string, patch: CasinoPatch, log: string[]) {
  const c = state.world.casinos.find((x) => x.id === casinoId);
  if (!c) return;
  const ops = getCasinoOps(state, c);
  const p = state.player;
  const monthWage = (state.world.cities.find((x) => x.id === c.cityId)?.avgWage ?? 800000) / 12;
  const pay = (amt: number, what: string) => {
    if (amt <= 0) return true;
    if (!spend(p, amt, `${what} · ${c.name}`, "casino", dt(state))) {
      log.push(`${what} costs ${formatINR(amt)} — not enough cash.`);
      return false;
    }
    bizFlow(state, "casinoCapex", -amt);
    return true;
  };
  const out: string[] = [];
  if (patch.licence && patch.licence !== ops.licence) {
    if (patch.licence === "premium") {
      if (pay(10_000_000, "Premium gaming licence")) {
        ops.licence = "premium";
        out.push("Premium licence granted: table limits above ₹5L and a VIP programme are allowed (₹15L/month fee).");
      }
    } else {
      ops.licence = "standard";
      ops.maxBet = Math.min(ops.maxBet, 500000);
      ops.vip = false;
      out.push("Back to a standard licence.");
    }
  }
  if (patch.tables) {
    for (const g of TABLE_IDS) {
      const v = patch.tables[g];
      if (v == null) continue;
      const n = clamp(Math.round(v), 0, 400);
      const d = n - ops.tables[g];
      if (d > 0) {
        const cost = d * TABLE_DEFS[g].price;
        if (!pay(cost, `${d} ${TABLE_DEFS[g].name} table(s)`)) continue;
        addAsset(ops, cost * 0.7);
      } else if (d < 0) {
        const back = -d * TABLE_DEFS[g].price * 0.4;
        credit(p, back, `Sold ${-d} ${TABLE_DEFS[g].name} table(s)`, "casino", dt(state));
        bizFlow(state, "casinoCapex", back);
        addAsset(ops, -back);
      }
      ops.tables[g] = n;
      if (d) out.push(`${TABLE_DEFS[g].name}: ${n} tables`);
    }
  }
  if (patch.slots != null) {
    const n = clamp(Math.round(patch.slots), 0, 5000);
    const d = n - ops.slots;
    if (d > 0 && pay(d * 400000, `${d} slot machine(s)`)) {
      addAsset(ops, d * 400000 * 0.7);
      ops.slots = n;
      out.push(`${n} slots`);
    } else if (d < 0) {
      credit(p, -d * 160000, `Sold ${-d} slot machine(s)`, "casino", dt(state));
      bizFlow(state, "casinoCapex", -d * 160000);
      addAsset(ops, d * 160000);
      ops.slots = n;
      out.push(`${n} slots`);
    }
  }
  if (patch.minBet != null) ops.minBet = clamp(Math.round(patch.minBet), 100, 1e7);
  if (patch.maxBet != null) {
    const cap = ops.licence === "premium" ? 5e7 : 500000;
    ops.maxBet = clamp(Math.round(patch.maxBet), Math.max(ops.minBet * 5, 1000), cap);
    if (patch.maxBet > cap) out.push(`Max bet capped at ${formatINR(cap)} by your licence.`);
  }
  if (patch.slotHold != null) ops.slotHold = clamp(patch.slotHold, 0.02, 0.2);
  if (patch.staff) {
    for (const k of STAFF_IDS) {
      const v = patch.staff[k];
      if (v == null) continue;
      const n = clamp(Math.round(v), 0, 20000);
      const d = n - ops.staff[k];
      if (d > 0 && !pay(d * monthWage * STAFF_DEFS[k].pay * 0.5, `Hiring ${d} ${STAFF_DEFS[k].name.toLowerCase()}`)) continue;
      if (d < 0) pay(-d * monthWage * STAFF_DEFS[k].pay, `Severance for ${-d} ${STAFF_DEFS[k].name.toLowerCase()}`);
      ops.staff[k] = n;
    }
    out.push("Staffing updated");
  }
  if (patch.comps != null) ops.comps = clamp(patch.comps, 0, 0.6);
  if (patch.vip != null) {
    if (patch.vip && (ops.licence !== "premium" || ops.staff.hosts < 2)) out.push("A VIP programme needs a premium licence and at least 2 hosts.");
    else ops.vip = patch.vip;
  }
  if (patch.addRooms && patch.addRooms > 0) {
    const n = Math.round(patch.addRooms);
    const cost = n * monthWage * 12 * 3.2;
    if (pay(cost, `${n} hotel rooms`)) {
      ops.hotelRooms += n;
      addAsset(ops, cost * 0.8);
      out.push(`${ops.hotelRooms} hotel rooms`);
    }
  }
  if (patch.marketing != null) ops.marketing = clamp(Math.round(patch.marketing), 0, 1e10);
  pushLog((ops as CasinoOps & { log?: { t: string; text: string }[] }).log ?? [], dt(state), out.join(" · "));
  log.push(
    `${c.name}: ${out.length ? out.join(" · ") : "settings saved"}. Limits ${formatINR(ops.minBet)}–${formatINR(ops.maxBet)}, slot hold ${(ops.slotHold * 100).toFixed(1)}%, comps ${Math.round(ops.comps * 100)}%.`,
  );
}

export function casinoValue(state: GameState, c: CasinoBiz): number {
  const ops = getCasinoOps(state, c);
  const avgNet = ops.history.slice(0, 12).reduce((s, h) => s + h.net, 0) / Math.max(1, Math.min(12, ops.history.length));
  return round(Math.max(assetValue(ops), assetValue(ops) + avgNet * 12 * 5), 0);
}

export function sellCasino(state: GameState, casinoId: string, log: string[]) {
  const c = state.world.casinos.find((x) => x.id === casinoId);
  if (!c) return;
  const price = casinoValue(state, c);
  state.world.casinos = state.world.casinos.filter((x) => x.id !== casinoId);
  delete getBiz(state).casinos[casinoId];
  credit(state.player, price, `Sale of ${c.name}`, "casino", dt(state));
  bizFlow(state, "stakes", price);
  news(state, `${c.name} changes hands`, `The resort sold for ${formatINR(price)}.`, "business", c.countryId, "New owners, new rules.");
  log.push(`Sold ${c.name} for ${formatINR(price)}.`);
}
