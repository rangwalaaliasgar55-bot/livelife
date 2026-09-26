// Company HQ: run a company you control like a real one. You decide how many
// people it employs in each department and what it pays them, how much work AI
// agents take over (and what their compute bill is), the growth strategy,
// which cities it sells into, how profit is split between dividends,
// buybacks and reinvestment, whether it borrows or issues shares, and which
// rivals it swallows. Morale, attrition, hiring lead-times and capacity are
// simulated every month; the board brings you dilemmas with consequences.
import type { Decision, GameState, ListedCompany } from "./types";
import { bizFlow, bizQueue, getBiz, pushLog, type CompanyHQ, type HQReport, type PayLevel, type RoleId, type Strategy } from "./biz";
import { industryMeta } from "./catalog";
import { acceptance, checkControl, sharePrice } from "./corporate";
import { credit, money, spend, spendUpTo } from "./finance";
import { history, news, note, timeline, unlock } from "./feed";
import { ledger } from "./advanced";
import { rng } from "./engine";
import { queueHandlers, taxGain } from "./civic";
import { chance, clamp, formatDate, formatINR, pick, round, uid } from "./util";

const dt = (s: GameState) => formatDate(s.time.year, s.time.month);
const R = (s: GameState) => () => rng(s);

export const ROLE_DEFS: Record<RoleId, { name: string; pay: number; auto: number; blurb: string }> = {
  eng: {
    name: "Engineering & product",
    pay: 1.35,
    auto: 0.35,
    blurb: "Builds and improves what you sell.",
  },
  sales: {
    name: "Sales & marketing",
    pay: 1.0,
    auto: 0.5,
    blurb: "Wins customers and keeps them.",
  },
  ops: {
    name: "Operations & support",
    pay: 0.7,
    auto: 0.7,
    blurb: "Delivers, serves, fixes. Most automatable.",
  },
  mgmt: {
    name: "Management",
    pay: 2.2,
    auto: 0,
    blurb: "One manager keeps ~8 people productive.",
  },
};
export const ROLE_IDS: RoleId[] = ["eng", "sales", "ops", "mgmt"];
export const AGENT_ROLES: Exclude<RoleId, "mgmt">[] = ["eng", "sales", "ops"];

const PAY_MULT: Record<PayLevel, number> = {
  below: 0.85,
  market: 1,
  above: 1.2,
};

export const STRATEGIES: Record<Strategy, { name: string; blurb: string }> = {
  steady: {
    name: "Steady",
    blurb: "Grow with the market. No extra spend, calm staff.",
  },
  aggressive: {
    name: "Aggressive growth",
    blurb: "+8% of revenue on growth, market share climbs, staff strained.",
  },
  lean: {
    name: "Lean / cost-cutting",
    blurb: "COGS −6%, quality slowly erodes, morale takes a hit.",
  },
  premium: {
    name: "Premium brand",
    blurb: "+12% price realisation, +4% spend, quality rises, slightly smaller market.",
  },
};

/** Ideal department mix for an industry. */
export function roleMix(co: ListedCompany): Record<RoleId, number> {
  const i = co.industry;
  if (["technology", "software", "ai", "gaming", "telecom"].includes(i)) return { eng: 0.45, sales: 0.2, ops: 0.25, mgmt: 0.1 };
  if (["retail", "restaurants", "hotels", "entertainment", "ecommerce"].includes(i)) return { eng: 0.07, sales: 0.2, ops: 0.63, mgmt: 0.1 };
  if (["manufacturing", "construction", "energy", "logistics", "agriculture", "mining", "robotics"].includes(i))
    return { eng: 0.18, sales: 0.1, ops: 0.62, mgmt: 0.1 };
  if (["finance", "banking", "insurance", "realestate"].includes(i)) return { eng: 0.2, sales: 0.35, ops: 0.35, mgmt: 0.1 };
  return { eng: 0.25, sales: 0.25, ops: 0.4, mgmt: 0.1 };
}

function cityOf(state: GameState, co: ListedCompany) {
  return state.world.cities.find((c) => c.id === co.cityId);
}

export function roleSalary(state: GameState, co: ListedCompany, role: RoleId, pay: PayLevel = getHQ(state, co).pay): number {
  const wage = cityOf(state, co)?.avgWage ?? 800000;
  const meta = industryMeta(co.industry);
  return round(wage * ROLE_DEFS[role].pay * PAY_MULT[pay] * (0.6 + 0.4 * meta.wage), 0);
}

/** One AI agent seat per year. Gets cheaper as the world's AI improves. */
export function agentCost(state: GameState): number {
  return round(180000 * (1.6 - state.world.tech.ai / 100), 0);
}
/** Human-equivalents one agent delivers in a role. */
export function agentPower(state: GameState, role: Exclude<RoleId, "mgmt">): number {
  return round(ROLE_DEFS[role].auto * (0.4 + (1.2 * state.world.tech.ai) / 100), 3);
}

export function getHQ(state: GameState, co: ListedCompany): CompanyHQ {
  const b = getBiz(state);
  let hq = b.hq[co.id];
  if (!hq) {
    const mix = roleMix(co);
    const n = Math.max(0, co.employees - (co.playerRole === "founder" ? 0 : 0));
    const roles = Object.fromEntries(
      ROLE_IDS.map((r) => {
        const c = Math.round(n * mix[r]);
        return [r, { count: c, target: c }];
      }),
    ) as CompanyHQ["roles"];
    hq = {
      roles,
      agents: { eng: 0, sales: 0, ops: 0 },
      pay: "market",
      morale: 72,
      strategy: "steady",
      payout: 0.35,
      markets: [],
      rpe: 0,
      integration: null,
      lab: co.industry === "ai" || co.ai ? { training: 0, cluster: "cloud", gpus: 0 } : null,
      layoffScar: 0,
      lastReport: null,
      log: [],
      corpDecisionTick: state.ticks,
      ceoAuto: true,
    } as CompanyHQ;
    b.hq[co.id] = hq;
    const wage = cityOf(state, co)?.avgWage ?? 800000;
    // productivity calibrated so an existing business isn't wrecked by the takeover
    const eff = Math.max(1, effectiveWorkforce(state, co, hq).effective);
    hq.rpe = round(Math.max(wage * 2.2, (co.revenue / eff) * 1.15), 0);
  }
  hq.agents ??= { eng: 0, sales: 0, ops: 0 };
  hq.markets ??= [];
  hq.log ??= [];
  if ((hq as any).ceoAuto == null) (hq as any).ceoAuto = true;
  if (hq.morale < 58) hq.morale = clamp(hq.morale + 8, 0, 100);
  // undo previous erroneous duplicate ceoFreeDiscount var if any
  return hq;
}

export function headcount(hq: CompanyHQ): number {
  return ROLE_IDS.reduce((s, r) => s + hq.roles[r].count, 0);
}

/** How much work the company can actually do. */
export function effectiveWorkforce(state: GameState, co: ListedCompany, hq: CompanyHQ) {
  const mix = roleMix(co);
  const humans = headcount(hq);
  const agents = AGENT_ROLES.reduce((s, r) => s + hq.agents[r], 0);
  const founder = co.playerCeo ? 1 : 0;
  const managers = hq.roles.mgmt.count + founder;
  const needed = Math.max(1, (humans - hq.roles.mgmt.count + agents * 0.3) / 8);
  const mgmtF = clamp(0.7 + 0.3 * (managers / needed), 0.7, 1.05);
  const prod = (0.55 + hq.morale / 200) * mgmtF;
  const out: Record<string, number> = {};
  for (const r of AGENT_ROLES) {
    out[r] = hq.roles[r].count * prod + hq.agents[r] * agentPower(state, r) + (founder ? (r === "eng" ? 1 : 0.5) : 0);
  }
  const share = (r: Exclude<RoleId, "mgmt">) => out[r]! / (mix[r] / (1 - mix.mgmt));
  const weakest = Math.min(...AGENT_ROLES.map(share));
  const total = AGENT_ROLES.reduce((s, r) => s + out[r]!, 0);
  const effective = 0.6 * weakest + 0.4 * total;
  const bottleneck = AGENT_ROLES.reduce((a, r) => (share(r) < share(a) ? r : a), "eng" as Exclude<RoleId, "mgmt">);
  return {
    effective: round(effective, 2),
    humans,
    agents,
    prod: round(prod, 3),
    mgmtF: round(mgmtF, 3),
    bottleneck,
    out,
  };
}

export function capacityOf(state: GameState, co: ListedCompany, hq = getHQ(state, co)): number {
  const disrupt = (hq as CompanyHQ & { disruption?: { months: number; hit: number } }).disruption;
  const hit = disrupt && disrupt.months > 0 ? 1 - disrupt.hit : 1;
  return round(effectiveWorkforce(state, co, hq).effective * hq.rpe * hit * (hq.integration ? 1 - hq.integration.drag : 1), 0);
}

export function payrollOf(state: GameState, co: ListedCompany, hq = getHQ(state, co)): number {
  const base = ROLE_IDS.reduce((s, r) => s + hq.roles[r].count * roleSalary(state, co, r, hq.pay), 0);
  const free = (hq as CompanyHQ & { ceoAuto?: boolean }).ceoAuto ? roleSalary(state, co, "mgmt", hq.pay) : 0;
  return Math.max(0, base - free);
}

export function hqCeoToggle(state: GameState, coId: string, on: boolean, log: string[]) {
  const co = state.world.companies.find(c=>c.id===coId && state.player.ownedCompanyIds.includes(c.id));
  if (!co) { log.push("Not your company."); return; }
  const hq = getHQ(state, co);
  (hq as any).ceoAuto = on;
  log.push(on ? `${co.name}: CEO auto-pilot ON — free CEO now runs hiring, pay, agents and expansions for you (and whispers which companies to buy).` : `${co.name}: CEO auto-pilot OFF — you run it by hand.`);
}

export function hqCeoBuy(state: GameState, coId: string, log: string[]) {
  const co = state.world.companies.find(c=>c.id===coId && state.player.ownedCompanyIds.includes(c.id));
  if (!co) { log.push("Not your company."); return; }
  const suggestion = ceoSuggestion(state, coId);
  if (!suggestion) { log.push("CEO: nothing worth buying right now — hold cash and grow organically. Keep expanding cities and raising revenue."); return; }
  log.push(`CEO recommends buying ${suggestion.name} (${suggestion.industry}) for ${formatINR(suggestion.valuation)} — revenue ${formatINR(suggestion.revenue)} — cheap and strategic. One click to close.`);
  // CEO tries cash first, then debt, then stock — free CEO handles the board & regulators
  hqAcquire(state, coId, suggestion.id, 16, "cash", log);
  const last = log[log.length-1] || "";
  if (last.includes("needs") && last.includes("cash")) {
    hqAcquire(state, coId, suggestion.id, 16, "debt", log);
  } else if (last.includes("rejected") || last.includes("blocked")) {
    hqAcquire(state, coId, suggestion.id, 26, "debt", log);
    if (log[log.length-1]?.includes("rejected")) hqAcquire(state, coId, suggestion.id, 32, "stock", log);
  }
}

export function ceoSuggestion(state: GameState, coId: string): ListedCompany | null {
  const co = state.world.companies.find(c=>c.id===coId);
  if (!co) return null;
  // CEO only suggests targets you can actually afford (cash + 80% debt capacity + player top-up) — truly free CEO does the homework
  const affordCap = co.cash*1.9 + debtCapacity(co)*0.85 + 2_000_000;
  let pool = state.world.companies.filter(c=>c.id!==coId && c.stage!=="bankrupt" && c.valuation>0 && c.valuation < affordCap && !state.player.ownedCompanyIds.includes(c.id));
  if (!pool.length) pool = state.world.companies.filter(c=>c.id!==coId && c.stage!=="bankrupt" && c.valuation>0 && !state.player.ownedCompanyIds.includes(c.id) && c.valuation < affordCap*3);
  if (!pool.length) return null;
  let best: ListedCompany | null = null;
  let bestScore = -1e18;
  for (const cand of pool) {
    const cheap = cand.revenue / Math.max(1, cand.valuation);
    const same = cand.industry===co.industry ? 1.85 : 1.0;
    const affordable = cand.valuation < co.cash*1.2 + debtCapacity(co)*0.6 ? 1.35 : 1.0;
    const small = cand.valuation < co.valuation*0.6 ? 1.32 : 1.0;
    const sentimentPenalty = cand.sentiment > 75 ? 0.96 : 1.0;
    const score = cheap*1400*same*affordable*small*sentimentPenalty + (cand.valuation<1.2e9 ? 420:0) - Math.log10(Math.max(1,cand.valuation))*8;
    if (score>bestScore) { bestScore=score; best=cand; }
  }
  return best;
}

export function aiBillOf(state: GameState, co: ListedCompany, hq = getHQ(state, co)) {
  const agents = AGENT_ROLES.reduce((s, r) => s + hq.agents[r], 0) * agentCost(state);
  let inference = 0;
  let training = 0;
  let power = 0;
  if (hq.lab) {
    const owned = clamp((hq.lab.gpus * 1.2e7) / Math.max(1, co.revenue), 0, 1);
    inference = co.revenue * 0.22 * (1 - state.world.tech.ai / 250) * (1 - 0.45 * owned);
    training = hq.lab.training;
    power = hq.lab.gpus * 900000;
  }
  return {
    agents: round(agents, 0),
    inference: round(inference, 0),
    training: round(training, 0),
    power: round(power, 0),
    total: round(agents + inference + training + power, 0),
  };
}

function marketsMult(state: GameState, co: ListedCompany, hq: CompanyHQ) {
  const home = cityOf(state, co);
  let m = 1;
  for (const mk of hq.markets) {
    const c = state.world.cities.find((x) => x.id === mk.cityId);
    if (!c) continue;
    m += mk.ramp * 0.15 * Math.sqrt(c.population / 1e7) * Math.sqrt(c.avgWage / Math.max(1, home?.avgWage ?? c.avgWage));
  }
  return m;
}

export interface HQPre {
  payroll: number;
  cogs: number;
  extra: number;
  revMult: number;
  capacity: number;
  aiBill: number;
  strategyCost: number;
  expansion: number;
  /** New customers a month the sales team (and sales agents) bring in. */
  leads: number;
  newBiz: number;
}

/** Called by the engine before a controlled company's month is booked.
 *  Everything here is annualised, like the rest of the company model. */
export function hqPre(state: GameState, co: ListedCompany): HQPre {
  const hq = getHQ(state, co);
  const payroll = payrollOf(state, co, hq);
  const lean = hq.strategy === "lean" ? 0.94 : 1;
  const cogs = co.revenue * Math.max(0.08, 0.34 - co.quality / 500) * lean;
  const ai = aiBillOf(state, co, hq);
  const strategyCost = co.revenue * (hq.strategy === "aggressive" ? 0.08 : hq.strategy === "premium" ? 0.04 : 0);
  const expansion = hq.markets.reduce((s, m) => s + (state.world.cities.find((c) => c.id === m.cityId)?.avgWage ?? 0) * 8, 0);
  let revMult = marketsMult(state, co, hq);
  if (hq.strategy === "aggressive") co.marketShare = clamp(co.marketShare * 1.004, 0.05, 55);
  if (hq.strategy === "premium") revMult *= 1.12 * 0.965;
  if (hq.lab && co.ai) revMult *= 0.85 + co.ai.modelQuality / 330;
  const boost = (hq as CompanyHQ & { boost?: { months: number; mult: number } }).boost;
  if (boost && boost.months > 0) revMult *= boost.mult;
  // automation errors: agents doing more than they can shows up in quality
  const agents = AGENT_ROLES.reduce((s, r) => s + hq.agents[r], 0);
  const share = agents / Math.max(1, agents + headcount(hq));
  co.quality = clamp(
    co.quality - share * (1 - state.world.tech.ai / 100) * 0.35 + (hq.strategy === "premium" ? 0.08 : hq.strategy === "lean" ? -0.1 : 0),
    1,
    99,
  );
  const wf = effectiveWorkforce(state, co, hq);
  const qf = (0.7 + co.quality / 200) * (hq.strategy === "aggressive" ? 1.25 : 1);
  // consumer-scale customers for startups; new annual business for grown firms
  const leads = (wf.out.sales ?? 0) * 30 * qf;
  const newBiz = (wf.out.sales ?? 0) * hq.rpe * 0.02 * qf;
  return {
    payroll,
    cogs,
    extra: ai.total + strategyCost + expansion,
    revMult,
    capacity: capacityOf(state, co, hq),
    aiBill: ai.total,
    strategyCost,
    expansion,
    leads,
    newBiz,
  };
}

/** Called after revenue is known: caps it at capacity, runs HR, pays out. */
export function hqPost(
  state: GameState,
  co: ListedCompany,
  pre: HQPre,
  demand: number,
  parts: { marketing: number; rd: number; interest: number; tax: number },
) {
  const hq = getHQ(state, co);
  // --- FREE CEO AUTO-MANAGES whole company when enabled
  if ((hq as any).ceoAuto) {
    // Keep pay at market (stable), morale-friendly
    if (hq.pay === "below" && hq.morale < 62) hq.pay = "market" as any;
    // Auto-set headcount targets to ~ 92% of capacity vs demand — growing when demand>capacity
    const wf = effectiveWorkforce(state, co, hq);
    const cap = capacityOf(state, co, hq);
    const neededEff = Math.max(1, demand * 0.97);
    const ratio = cap > 1 ? neededEff / cap : 1;
    if (ratio > 1.08) {
      for (const r of (["eng","sales","ops"] as RoleId[])) hq.roles[r].target = clamp(Math.round(hq.roles[r].target * 1.14 + 2), 1, 50000);
      hq.roles.mgmt.target = clamp(Math.round((headcount(hq) / 8) + 1), 1, 8000);
    } else if (ratio < 0.72 && headcount(hq) > 12) {
      for (const r of (["eng","sales","ops"] as RoleId[])) hq.roles[r].target = clamp(Math.round(hq.roles[r].target * 0.94), 1, 50000);
    }
    // Bottleneck fix
    if (wf.bottleneck) {
      const bn = wf.bottleneck as RoleId;
      if (hq.roles[bn].target < hq.roles[bn].count + 4) hq.roles[bn].target = hq.roles[bn].count + 6;
    }
    // Auto deploy a few agents where it pays (up to 35% share)
    for (const r of (["ops","sales","eng"] as Exclude<RoleId,"mgmt">[])) {
      const curShare = hq.agents[r] / Math.max(1, hq.roles[r].count + hq.agents[r]);
      if (curShare < 0.28 && state.world.tech.ai > 38 && r==="ops") hq.agents[r] = Math.min(20000, hq.agents[r] + 1);
      if (curShare < 0.18 && state.world.tech.ai > 55 && r!=="ops") hq.agents[r] = Math.min(8000, hq.agents[r] + 1);
    }
    // Never let morale crater
    if (hq.morale < 60 && hq.pay !== "above") hq.pay = "market" as any;
    // Auto expand to biggest city if cash rich
    if (co.cash > co.revenue*0.55 && co.cash > 8_000_000 && hq.markets.length < 6 && state.world.cities.length) {
      const cities = state.world.cities.filter(c=>c.id!==co.cityId && !hq.markets.some(m=>m.cityId===c.id)).sort((a,b)=>b.population-a.population);
      const c2 = cities[0];
      if (c2 && co.cash > expansionCost(state, co, c2.id)*1.6) {
        const before = co.cash;
        hqExpand(state, co.id, c2.id, [], 0.9);
        if (co.cash !== before) { /* expanded */ }
      }
    }
  }
  const b = getBiz(state);
  const city = cityOf(state, co);
  const country = state.world.countries.find((c) => c.id === co.countryId);
  // --- HR: attrition, hiring toward targets, layoffs toward targets
  let attr = 0;
  let hires = 0;
  let hireCost = 0;
  let severance = 0;
  const drag = hq.integration?.drag ?? 0;
  const baseRate = clamp(0.008 + (60 - hq.morale) / 2500 + (hq.pay === "below" ? 0.006 : hq.pay === "above" ? -0.003 : 0) + drag * 0.05, 0.002, 0.07);
  const speed = 0.6 + (country?.unemployment ?? 6) / 10;
  // HR will not hire into a company that cannot make payroll for three months
  const burn = Math.max(0, -co.profit / 12);
  const frozen = burn > 0 && co.cash < burn * 3;
  let wanted = 0;
  for (const r of ROLE_IDS) {
    const role = hq.roles[r];
    const leave = Math.min(role.count, Math.round(role.count * baseRate + (rng(state) < (role.count * baseRate) % 1 ? 1 : 0)));
    role.count -= leave;
    attr += leave;
    const gap = role.target - role.count;
    if (gap > 0 && frozen) wanted += gap;
    else if (gap > 0) {
      const n = Math.min(gap, Math.ceil((2 + role.target * 0.15) * speed));
      role.count += n;
      hires += n;
      hireCost += n * roleSalary(state, co, r, hq.pay) * 0.15;
    } else if (gap < 0) {
      const n = -gap;
      role.count -= n;
      severance += n * (roleSalary(state, co, r, hq.pay) / 12) * 2;
      hq.layoffScar = clamp(hq.layoffScar + 3 + (n / Math.max(1, headcount(hq) + n)) * 40, 0, 40);
    }
  }
  co.employees = headcount(hq);
  const oneOff = hireCost + severance;
  co.cash -= oneOff;
  if (wanted > 0 && state.ticks % 3 === 0) {
    pushLog(hq.log, dt(state), `Hiring frozen: ${wanted} open roles, but only ${(co.cash / Math.max(1, burn)).toFixed(1)} months of cash at the current burn.`);
  }

  // --- the money runs out: payroll bounces, people walk, the board is called
  if (co.cash < 0) {
    hq.bounced = (hq.bounced ?? 0) + 1;
    let quit = 0;
    for (const r of ROLE_IDS) {
      const n = Math.ceil(hq.roles[r].count * (0.06 + hq.bounced * 0.04));
      hq.roles[r].count -= n;
      quit += n;
    }
    co.employees = headcount(hq);
    hq.morale = clamp(hq.morale - 15, 5, 98);
    co.quality = clamp(co.quality - 1.5, 1, 99);
    co.sentiment = clamp(co.sentiment - 6, 10, 90);
    pushLog(hq.log, dt(state), `Payroll bounced (company cash ${formatINR(co.cash)}). ${quit} people quit.`);
    if (!state.pending.some((d) => d.kind === "corp" && d.context.companyId === co.id) && state.ticks - (hq.crunchTick ?? -99) >= 2) {
      hq.crunchTick = state.ticks;
      const need = round(-co.cash + burn * 3, 0);
      const cap = debtCapacity(co);
      state.pending.push({
        id: uid("dec"),
        kind: "corp",
        title: `${co.name} can't make payroll`,
        body: `The company account is ${formatINR(co.cash)} and burning ${formatINR(burn)} a month on ${co.employees} staff against ${formatINR(co.revenue / 12)} of monthly revenue. Staff have not been paid and are leaving. The board needs a decision now.`,
        year: state.time.year,
        month: state.time.month,
        options: [
          {
            id: "inject",
            label: "Put in your own money",
            hint: `${formatINR(need)} clears it and buys 3 months`,
          },
          {
            id: "cut",
            label: "Emergency layoffs to break even",
            hint: "Cut staff to what revenue pays for",
          },
          {
            id: "bridge",
            label: "Emergency bridge loan",
            hint: cap > need ? `${formatINR(need)} at +6% over base` : "Lenders will likely refuse",
          },
          {
            id: "fold",
            label: "Let it go bankrupt",
            hint: "Your equity is wiped",
          },
        ],
        context: { companyId: co.id, dilemma: "crunch", need, burn },
      } as Decision);
    }
    if (hq.bounced >= 4 && co.cash < -Math.max(co.revenue, burn * 12) * 0.5) {
      co.stage = "bankrupt";
      co.price = Math.max(0.5, co.price * 0.1);
      news(
        state,
        `${co.name} collapses`,
        `${co.name} missed payroll for ${hq.bounced} months and has been wound up.`,
        "business",
        co.countryId,
        "Equity is wiped out.",
      );
      history(state, "business", `${co.name} went bankrupt`);
    }
  } else hq.bounced = 0;

  // --- morale
  const agents = AGENT_ROLES.reduce((s, r) => s + hq.agents[r], 0);
  const fear = (agents / Math.max(1, agents + co.employees)) * 15;
  const lead = co.playerCeo ? (state.player.skills.leadership ?? 30) / 8 : co.manager ? co.manager.skill / 12 : -5;
  const target =
    60 +
    (hq.pay === "below" ? -18 : hq.pay === "above" ? 12 : 0) +
    (hq.strategy === "aggressive" ? -6 : hq.strategy === "lean" ? -12 : hq.strategy === "premium" ? 4 : 2) -
    hq.layoffScar -
    fear +
    lead +
    (co.profit > 0 ? 3 : -5) -
    drag * 30;
  hq.morale = clamp(hq.morale + (target - hq.morale) * 0.15, 5, 98);
  hq.layoffScar *= 0.9;

  // --- markets ramp, integration, disruptions, boosts
  for (const m of hq.markets) m.ramp = clamp(m.ramp + 1 / 12, 0, 1);
  if (hq.integration) {
    hq.integration.months -= 1;
    hq.integration.drag *= 0.88;
    if (hq.integration.months <= 0) {
      pushLog(hq.log, dt(state), `Integration of ${hq.integration.name} complete.`);
      hq.integration = null;
    }
  }
  const x = hq as CompanyHQ & {
    disruption?: { months: number; hit: number };
    boost?: { months: number; mult: number };
  };
  if (x.disruption && --x.disruption.months <= 0) x.disruption = undefined;
  if (x.boost && --x.boost.months <= 0) x.boost = undefined;

  // --- AI lab: training raises model quality
  if (hq.lab && co.ai && hq.lab.training > 0) {
    co.ai.modelQuality = clamp(co.ai.modelQuality + (hq.lab.training / Math.max(2e7, co.revenue)) * 1.5, 1, 100);
  }

  // --- payout to shareholders
  let payout = 0;
  const monthly = co.profit / 12;
  const reserve = (co.costs / 12) * 2;
  if (monthly > 0 && hq.payout > 0 && co.cash - monthly * hq.payout > reserve) {
    payout = round(monthly * hq.payout, 0);
    co.cash -= payout;
    distribute(state, co, payout, "hqDividends", `Dividend · ${co.name}`);
  }

  const rep: HQReport = {
    t: dt(state),
    revenue: round(co.revenue / 12, 0),
    capacity: round(pre.capacity / 12, 0),
    demand: round(demand / 12, 0),
    payroll: round(pre.payroll / 12, 0),
    hiring: round(oneOff, 0),
    aiBill: round(pre.aiBill / 12, 0),
    cogs: round(pre.cogs / 12, 0),
    marketing: round(parts.marketing / 12, 0),
    rd: round(parts.rd / 12, 0),
    strategy: round(pre.strategyCost / 12, 0),
    expansion: round(pre.expansion / 12, 0),
    interest: round(parts.interest / 12, 0),
    tax: round(parts.tax / 12, 0),
    profit: round(co.profit / 12 - oneOff, 0),
    payout,
    headcount: co.employees,
    attrition: attr,
    hires,
    effective: effectiveWorkforce(state, co, hq).effective,
  };
  hq.lastReport = rep;
  void city;
  void b;
  maybeBoardDilemma(state, co, hq);
}

/** Pay cash out of a company pro rata: your share lands in your wallet, shares
 *  held by your other companies land in their treasury, the rest leaves. */
export function distribute(state: GameState, co: ListedCompany, amount: number, flowKey: string, desc: string) {
  const owned = new Set(state.player.ownedCompanyIds);
  for (const s of co.shareholders) {
    const part = (money(s.shares) / Math.max(1, co.shares)) * amount;
    if (part <= 0) continue;
    if (s.type === "player") {
      credit(state.player, part, desc, "biz", dt(state));
      bizFlow(state, flowKey, part);
    } else if (owned.has(s.id) && s.id !== co.id) {
      const holder = state.world.companies.find((c) => c.id === s.id);
      if (holder) holder.cash += part;
    }
  }
}

/* ============================================================ decisions */

export function hqSetRoles(state: GameState, companyId: string, targets: Partial<Record<RoleId, number>>, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const hq = getHQ(state, co);
  const changes: string[] = [];
  for (const r of ROLE_IDS) {
    const v = targets[r];
    if (v == null || !Number.isFinite(v)) continue;
    const n = clamp(Math.round(v), 0, 500000);
    if (n !== hq.roles[r].target) changes.push(`${ROLE_DEFS[r].name} ${hq.roles[r].target}→${n}`);
    hq.roles[r].target = n;
  }
  if (!changes.length) {
    log.push("No headcount change.");
    return;
  }
  const cuts = ROLE_IDS.filter((r) => hq.roles[r].target < hq.roles[r].count);
  pushLog(hq.log, dt(state), `Headcount plan: ${changes.join(", ")}.`);
  log.push(
    `Headcount plan set: ${changes.join(", ")}. HR hires over the coming months (≈15% of target a month, recruiting costs 15% of salary)${cuts.length ? "; layoffs happen next month with 2 months' severance and a morale hit" : ""}.`,
  );
  if (cuts.length) state.player.reputation.business = clamp(state.player.reputation.business - 1, 0, 100);
}

export function hqSetPay(state: GameState, companyId: string, pay: PayLevel, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const hq = getHQ(state, co);
  hq.pay = pay;
  pushLog(hq.log, dt(state), `Pay policy: ${pay}.`);
  log.push(
    `Pay set to ${pay === "below" ? "below market (cheaper, more quit)" : pay === "above" ? "above market (+20% cost, loyal and productive)" : "market rate"}.`,
  );
}

export function hqSetAgents(state: GameState, companyId: string, agents: Partial<Record<Exclude<RoleId, "mgmt">, number>>, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const hq = getHQ(state, co);
  let setup = 0;
  for (const r of AGENT_ROLES) {
    const v = agents[r];
    if (v == null || !Number.isFinite(v)) continue;
    const n = clamp(Math.round(v), 0, 200000);
    if (n > hq.agents[r]) setup += (n - hq.agents[r]) * agentCost(state) * 0.25;
    hq.agents[r] = n;
  }
  if (setup > co.cash) {
    log.push(`Deploying those agents needs ${formatINR(setup)} of integration work; ${co.name} has ${formatINR(co.cash)}.`);
    return;
  }
  co.cash -= setup;
  const total = AGENT_ROLES.reduce((s, r) => s + hq.agents[r], 0);
  pushLog(hq.log, dt(state), `AI agents deployed: ${total} seats.`);
  log.push(
    `${total} AI agent seats running (${formatINR(agentCost(state))}/seat/yr in compute & licences${setup ? `, integration ${formatINR(setup)}` : ""}). Staff notice — morale reacts.`,
  );
}

export function hqSetStrategy(state: GameState, companyId: string, strategy: Strategy, payout: number | undefined, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const hq = getHQ(state, co);
  if (STRATEGIES[strategy]) hq.strategy = strategy;
  if (payout != null && Number.isFinite(payout)) hq.payout = clamp(payout > 1 ? payout / 100 : payout, 0, 1);
  pushLog(hq.log, dt(state), `Strategy ${STRATEGIES[hq.strategy].name}, payout ${Math.round(hq.payout * 100)}%.`);
  log.push(`${co.name}: ${STRATEGIES[hq.strategy].name} strategy, ${Math.round(hq.payout * 100)}% of profit paid out.`);
}

export function expansionCost(state: GameState, co: ListedCompany, cityId: string): number {
  const c = state.world.cities.find((x) => x.id === cityId);
  if (!c) return 0;
  return round(c.avgWage * 30 * (1 + c.population / 2e7) * (0.6 + industryMeta(co.industry).wage * 0.3), 0);
}

export function hqExpand(state: GameState, companyId: string, cityId: string, log: string[], discount = 1) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const hq = getHQ(state, co);
  if (cityId === co.cityId || hq.markets.some((m) => m.cityId === cityId)) {
    log.push("Already operating there.");
    return;
  }
  const c = state.world.cities.find((x) => x.id === cityId);
  if (!c) return;
  const cost = round(expansionCost(state, co, cityId) * discount, 0);
  if (co.cash < cost) {
    log.push(`Opening in ${c.name} costs ${formatINR(cost)}; ${co.name} has ${formatINR(co.cash)}. Borrow, raise or wait.`);
    return;
  }
  co.cash -= cost;
  co.assets += cost * 0.6;
  hq.markets.push({ cityId, since: state.ticks, ramp: 0 });
  // new offices need people
  const mix = roleMix(co);
  const add = Math.max(3, Math.round(headcount(hq) * 0.12));
  for (const r of ROLE_IDS) hq.roles[r].target += Math.round(add * mix[r]);
  pushLog(hq.log, dt(state), `Opened in ${c.name} for ${formatINR(cost)}.`);
  timeline(state, `${co.name} expanded into ${c.name}.`, "business");
  log.push(
    `${co.name} opens in ${c.name} (${formatINR(cost)}). Demand ramps over 12 months; local office costs ${formatINR(c.avgWage * 8)}/yr and hiring targets rose by ${add}.`,
  );
}

export function hqCloseMarket(state: GameState, companyId: string, cityId: string, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const hq = getHQ(state, co);
  hq.markets = hq.markets.filter((m) => m.cityId !== cityId);
  log.push("Market closed. Office lease written off.");
}

export function hqLab(state: GameState, companyId: string, patch: { training?: number; buyGpus?: number; cluster?: "cloud" | "owned" }, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const hq = getHQ(state, co);
  if (!hq.lab) hq.lab = { training: 0, cluster: "cloud", gpus: 0 };
  if (!co.ai) co.ai = { compute: 20, modelQuality: 25, apiUsage: 0, infraCost: 0 };
  if (patch.training != null && Number.isFinite(patch.training)) hq.lab.training = clamp(Math.round(patch.training), 0, 1e12);
  if (patch.buyGpus && patch.buyGpus > 0) {
    const n = Math.round(patch.buyGpus);
    const cost = n * 2_500_000 * (1.3 - state.world.tech.ai / 200);
    if (co.cash < cost) {
      log.push(`${n} GPU nodes cost ${formatINR(cost)}; ${co.name} has ${formatINR(co.cash)}.`);
      return;
    }
    co.cash -= cost;
    co.assets += cost * 0.7;
    hq.lab.gpus += n;
    hq.lab.cluster = "owned";
    log.push(`Bought ${n} GPU nodes (${formatINR(cost)}). Owned compute cuts inference bills but costs ${formatINR(900000)}/node/yr in power and cooling.`);
  }
  if (patch.cluster) hq.lab.cluster = patch.cluster;
  log.push(`AI lab: training ${formatINR(hq.lab.training)}/yr, ${hq.lab.gpus} owned GPU nodes.`);
}

/* ------------------------------------------------------------ capital */

function outsideHolders(state: GameState, co: ListedCompany) {
  const ownedIds = new Set(state.player.ownedCompanyIds);
  return co.shareholders.filter((s) => s.type !== "player" && !ownedIds.has(s.id) && s.shares > 0);
}

export function hqBuyback(state: GameState, companyId: string, amountRaw: number, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const amount = Math.round(money(amountRaw));
  if (amount <= 0 || amount > co.cash) {
    log.push(`Buyback must be funded from company cash (${formatINR(co.cash)}).`);
    return;
  }
  const price = sharePrice(co) * 1.04;
  const pool = outsideHolders(state, co);
  const avail = pool.reduce((s, x) => s + x.shares, 0);
  if (avail <= 0) {
    log.push("There are no outside shareholders to buy back from.");
    return;
  }
  const n = Math.min(avail, Math.floor(amount / price));
  for (const h of pool) h.shares -= Math.round((h.shares / avail) * n);
  co.shareholders = co.shareholders.filter((s) => s.shares > 0 || s.type === "player");
  co.shares = Math.max(1, co.shares - n);
  co.cash -= n * price;
  co.sentiment = clamp(co.sentiment + 3, 10, 90);
  checkControl(state, co, log);
  const hq = getHQ(state, co);
  pushLog(hq.log, dt(state), `Bought back ${n.toLocaleString("en-IN")} shares for ${formatINR(n * price)}.`);
  log.push(
    `${co.name} bought back ${n.toLocaleString("en-IN")} shares at ${formatINR(price)} (${formatINR(n * price)}). Every remaining share — including yours — owns more of the company.`,
  );
}

export function hqIssue(state: GameState, companyId: string, pct: number, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const p = clamp(pct, 1, 40);
  const n = Math.round(co.shares * (p / 100));
  const price = sharePrice(co) * (co.listed ? 0.93 : 0.85);
  co.shares += n;
  const pub = co.shareholders.find((s) => s.type === "public");
  if (pub) pub.shares += n;
  else
    co.shareholders.push({
      id: uid("pub"),
      name: co.listed ? "Public float" : "New investors",
      type: "public",
      shares: n,
    });
  co.cash += n * price;
  co.sentiment = clamp(co.sentiment - 2, 10, 90);
  checkControl(state, co, log);
  pushLog(getHQ(state, co).log, dt(state), `Issued ${p}% new shares for ${formatINR(n * price)}.`);
  log.push(
    `Issued ${n.toLocaleString("en-IN")} new shares at ${formatINR(price)} — ${formatINR(n * price)} raised. Existing holders (you included) are diluted.`,
  );
}

export function debtCapacity(co: ListedCompany): number {
  const ebitda = Math.max(0, co.revenue - co.costs + co.debt * 0.08);
  return Math.max(0, Math.max(ebitda * 3, co.assets * 0.4) - co.debt);
}

export function hqBorrow(state: GameState, companyId: string, amountRaw: number, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const amount = Math.round(money(amountRaw));
  const cap = debtCapacity(co);
  if (amount <= 0) return;
  if (amount > cap) {
    log.push(`Lenders will extend at most ${formatINR(cap)} more (3× operating profit or 40% of assets).`);
    return;
  }
  co.debt += amount;
  co.cash += amount;
  pushLog(getHQ(state, co).log, dt(state), `Borrowed ${formatINR(amount)}.`);
  log.push(`${co.name} borrowed ${formatINR(amount)} at the policy rate. Interest is booked monthly.`);
}

export function hqRepay(state: GameState, companyId: string, amountRaw: number, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const amount = Math.min(co.debt, Math.round(money(amountRaw)), Math.max(0, co.cash));
  if (amount <= 0) {
    log.push("Nothing to repay (or no cash).");
    return;
  }
  co.debt -= amount;
  co.cash -= amount;
  log.push(`Repaid ${formatINR(amount)}. Debt now ${formatINR(co.debt)}.`);
}

export function hqInject(state: GameState, companyId: string, amountRaw: number, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const amount = Math.round(money(amountRaw));
  if (amount <= 0) return;
  if (!spend(state.player, amount, `Capital injection · ${co.name}`, "biz", dt(state))) {
    log.push("Not enough liquid cash.");
    return;
  }
  bizFlow(state, "stakes", -amount);
  const price = sharePrice(co);
  const n = Math.round(amount / price);
  co.shares += n;
  const me = co.shareholders.find((s) => s.type === "player");
  if (me) me.shares += n;
  else
    co.shareholders.push({
      id: state.player.id,
      name: state.player.name,
      type: "player",
      shares: n,
    });
  co.cash += amount;
  log.push(`Injected ${formatINR(amount)} for ${n.toLocaleString("en-IN")} new shares at ${formatINR(price)}.`);
}

export function hqSpecialDividend(state: GameState, companyId: string, amountRaw: number, log: string[]) {
  const co = owned(state, companyId, log);
  if (!co) return;
  const amount = Math.round(money(amountRaw));
  if (amount <= 0 || amount > co.cash) {
    log.push(`Special dividends come out of company cash (${formatINR(co.cash)}).`);
    return;
  }
  co.cash -= amount;
  distribute(state, co, amount, "hqDividends", `Special dividend · ${co.name}`);
  log.push(`${co.name} paid a ${formatINR(amount)} special dividend. Your share went to your wallet.`);
}

/* ------------------------------------------------------------ M&A */

export function mergerQuote(state: GameState, acquirerId: string, targetId: string, premium: number) {
  const a = state.world.companies.find((c) => c.id === acquirerId);
  const t = state.world.companies.find((c) => c.id === targetId);
  if (!a || !t) return null;
  const price = round(Math.max(1, t.valuation) * (1 + clamp(premium, 0, 150) / 100), 0);
  const sister = state.player.ownedCompanyIds.includes(t.id);
  const odds = sister ? 1 : acceptance(state, t, premium);
  const same = a.industry === t.industry;
  const combined = same ? a.marketShare + t.marketShare : 0;
  const antitrust = combined > 45 ? 0.5 : combined > 30 ? 0.15 : 0;
  return {
    price,
    odds: round(odds, 3),
    same,
    antitrust,
    fee: round(price * 0.01, 0),
    sister,
    debtRoom: debtCapacity(a),
  };
}

export function hqAcquire(state: GameState, acquirerId: string, targetId: string, premium: number, funding: "cash" | "debt" | "stock", log: string[]) {
  const a = owned(state, acquirerId, log);
  if (!a) return;
  const t = state.world.companies.find((c) => c.id === targetId);
  if (!t || t.id === a.id || t.stage === "bankrupt") {
    log.push("Pick a live target company.");
    return;
  }
  const q = mergerQuote(state, acquirerId, targetId, premium)!;
  const fee = q.fee;
  if (a.cash < fee) {
    log.push(`Advisers want ${formatINR(fee)} up front for the deal work; ${a.name} has ${formatINR(a.cash)}.`);
    return;
  }
  // funding check before anything moves
  const outsidePrice = q.sister ? 0 : q.price;
  if (funding === "cash" && a.cash - fee < outsidePrice) {
    log.push(`${a.name} needs ${formatINR(outsidePrice)} cash (has ${formatINR(a.cash - fee)}). Try debt or stock.`);
    return;
  }
  if (funding === "debt" && outsidePrice > q.debtRoom + Math.max(0, a.cash - fee)) {
    log.push(`Lenders cap new debt at ${formatINR(q.debtRoom)}. Combine with cash or use stock.`);
    return;
  }
  a.cash -= fee;
  if (!q.sister && !chance(R(state), q.odds)) {
    t.sentiment = clamp(t.sentiment + 4, 10, 90);
    log.push(`${t.name}'s board rejected the offer at a ${premium}% premium. Adviser fees of ${formatINR(fee)} are gone. A higher premium wins more holders.`);
    return;
  }
  if (q.antitrust && chance(R(state), q.antitrust)) {
    log.push(`Competition regulators blocked the deal: combined share would be ${round(a.marketShare + t.marketShare, 1)}%. Fees lost.`);
    news(
      state,
      `Regulator blocks ${a.name}–${t.name} merger`,
      "The competition authority ruled the combination would harm consumers.",
      "business",
      a.countryId,
      "Market stays fragmented.",
    );
    return;
  }
  const p = state.player;
  // pay every holder of the target at the deal price
  const perShare = q.price / Math.max(1, t.shares);
  const ownedIds = new Set(p.ownedCompanyIds);
  let playerProceeds = 0;
  for (const s of t.shareholders) {
    if (s.type === "player") playerProceeds += s.shares * perShare;
    else if (ownedIds.has(s.id) && s.id !== a.id) {
      const holder = state.world.companies.find((c) => c.id === s.id);
      if (holder) holder.cash += s.shares * perShare;
    }
  }
  const h = p.holdings.find((x) => x.ticker === t.ticker);
  if (h) {
    playerProceeds += h.shares * perShare;
    taxGain(state, h.shares * (perShare - h.avgCost));
    p.holdings = p.holdings.filter((x) => x.ticker !== t.ticker);
  }
  const outside = q.sister ? 0 : q.price;
  if (q.sister) {
    // sister merger: your shares in the target convert to acquirer shares
    const mine = t.shareholders.find((s) => s.type === "player")?.shares ?? 0;
    const newShares = Math.round(((mine / Math.max(1, t.shares)) * t.valuation) / sharePrice(a));
    a.shares += newShares;
    const me = a.shareholders.find((s) => s.type === "player");
    if (me) me.shares += newShares;
    else
      a.shareholders.push({
        id: p.id,
        name: p.name,
        type: "player",
        shares: newShares,
      });
    playerProceeds = 0;
  } else if (funding === "stock") {
    const n = Math.round(outside / sharePrice(a));
    a.shares += n;
    a.shareholders.push({
      id: uid("hold"),
      name: `Former ${t.name} holders`,
      type: "public",
      shares: n,
    });
  } else if (funding === "debt") {
    const fromCash = Math.min(Math.max(0, a.cash), outside * 0.3);
    a.cash -= fromCash;
    a.debt += outside - fromCash;
  } else a.cash -= outside;
  if (playerProceeds > 0 && !q.sister) {
    credit(p, playerProceeds, `Buyout proceeds · ${t.name}`, "biz", dt(state));
    bizFlow(state, "stakes", playerProceeds);
  }
  // combine the businesses
  const synergy = q.same ? 1.0 : 0.9;
  const hqA = getHQ(state, a);
  const hqT = state.player.ownedCompanyIds.includes(t.id) ? getHQ(state, t) : null;
  const mix = roleMix(t);
  for (const r of ROLE_IDS) {
    const add = hqT ? hqT.roles[r].count : Math.round(t.employees * mix[r]);
    hqA.roles[r].count += add;
    hqA.roles[r].target += add;
  }
  if (hqT) for (const r of AGENT_ROLES) hqA.agents[r] += hqT.agents[r];
  const effT = Math.max(1, t.employees * 0.8);
  const effA = Math.max(1, effectiveWorkforce(state, a, hqA).effective);
  hqA.rpe = round((hqA.rpe * (effA - effT) + Math.max(hqA.rpe, (t.revenue / effT) * 1.1) * effT) / effA, 0);
  a.revenue += t.revenue * synergy;
  a.customers += t.customers;
  a.cash += t.cash;
  a.debt += t.debt;
  a.assets += t.assets;
  a.employees = headcount(hqA);
  if (q.same) a.marketShare = clamp(a.marketShare + t.marketShare * 0.85, 0.05, 70);
  a.quality = clamp((a.quality * a.revenue + t.quality * t.revenue) / Math.max(1, a.revenue + t.revenue), 1, 99);
  if (t.ai && !a.ai) a.ai = { ...t.ai };
  hqA.integration = {
    months: q.same ? 8 : 12,
    drag: q.same ? 0.1 : 0.18,
    name: t.name,
  };
  // stakes the target held in other companies move to the acquirer
  for (const other of state.world.companies) {
    for (const s of other.shareholders)
      if (s.id === t.id) {
        s.id = a.id;
        s.name = a.name;
      }
  }
  state.world.companies = state.world.companies.filter((c) => c.id !== t.id);
  p.ownedCompanyIds = p.ownedCompanyIds.filter((x) => x !== t.id);
  delete getBiz(state).hq[t.id];
  pushLog(hqA.log, dt(state), `Acquired ${t.name} for ${formatINR(q.price)} (${funding}).`);
  ledger(state, `${a.name} acquired ${t.name}`, -outside);
  timeline(state, `${a.name} acquired ${t.name} for ${formatINR(q.price)}.`, "business");
  news(
    state,
    `${a.name} completes acquisition of ${t.name}`,
    `A ${formatINR(q.price)} deal${q.same ? " consolidates the sector" : " diversifies the group"}. Integration will take about a year.`,
    "business",
    a.countryId,
    "Competitors reassess.",
  );
  unlock(state, "takeover");
  log.push(
    `${a.name} now owns ${t.name}. ${t.employees.toLocaleString("en-IN")} staff join; revenue +${formatINR(t.revenue * synergy)}/yr.${playerProceeds > 0 ? ` Your own shares in ${t.name} were bought out for ${formatINR(playerProceeds)}.` : ""} Integration drag for ${hqA.integration.months} months.`,
  );
}

/* ------------------------------------------------------------ board dilemmas */

type Dilemma = {
  id: string;
  title: string;
  body: (co: ListedCompany) => string;
  options: { id: string; label: string; hint?: string }[];
  when?: (s: GameState, co: ListedCompany, hq: CompanyHQ) => boolean;
};

const DILEMMAS: Dilemma[] = [
  {
    id: "strike",
    title: "Union demands a 12% raise",
    body: (co) => `Staff at ${co.name} have unionised. They want 12% more pay and threaten to strike.`,
    options: [
      {
        id: "accept",
        label: "Agree to the raise",
        hint: "Pay goes above market, morale +",
      },
      {
        id: "negotiate",
        label: "Negotiate 6%",
        hint: "60% they accept, else a short strike",
      },
      { id: "refuse", label: "Refuse", hint: "Two-month strike likely" },
    ],
    when: (_s, co) => co.employees >= 30,
  },
  {
    id: "contract",
    title: "A giant client wants an exclusive deal",
    body: (co) => `A national buyer offers ${co.name} a contract worth about 25% more revenue for a year — at a thin margin, and you'll need the capacity.`,
    options: [
      { id: "accept", label: "Sign it", hint: "Demand +25% for 12 months" },
      {
        id: "haggle",
        label: "Push for better price",
        hint: "50% they walk, else +30% demand",
      },
      { id: "decline", label: "Decline" },
    ],
  },
  {
    id: "breach",
    title: "Data breach",
    body: (co) => `Attackers got into ${co.name}'s customer database. Legal wants a decision within the hour.`,
    options: [
      {
        id: "disclose",
        label: "Disclose publicly now",
        hint: "Fine 0.5% of revenue, sentiment −6",
      },
      {
        id: "quiet",
        label: "Fix quietly",
        hint: "30% it leaks later — much worse",
      },
      {
        id: "ransom",
        label: "Pay the ransom",
        hint: "Costs 1% of revenue; they may not delete it",
      },
    ],
    when: (_s, co) => co.customers > 50 || co.revenue > 5e6,
  },
  {
    id: "recall",
    title: "Product defect",
    body: (co) => `Engineers at ${co.name} found a defect that could hurt customers.`,
    options: [
      {
        id: "full",
        label: "Full recall",
        hint: "Costs 4% of revenue, quality +5, trust +",
      },
      {
        id: "partial",
        label: "Quiet partial fix",
        hint: "1.5% cost, 40% lawsuit later",
      },
      {
        id: "deny",
        label: "Deny and wait",
        hint: "55% scandal: 10% fine, sentiment −25",
      },
    ],
    when: (_s, co) => !["finance", "banking", "insurance", "software", "media"].includes(co.industry),
  },
  {
    id: "pricewar",
    title: "A rival starts a price war",
    body: (co) => `A competitor just cut prices 20% in ${co.name}'s core market.`,
    options: [
      {
        id: "match",
        label: "Match their prices",
        hint: "Price level −15, keep share",
      },
      {
        id: "differentiate",
        label: "Out-market them",
        hint: "3% of revenue on marketing",
      },
      { id: "ignore", label: "Hold price", hint: "Market share falls" },
    ],
  },
  {
    id: "aibacklash",
    title: "Backlash over AI layoffs",
    body: (co) => `A viral story says ${co.name} is replacing people with AI agents. Politicians are asking questions.`,
    options: [
      {
        id: "retrain",
        label: "Pledge to retrain affected staff",
        hint: "Costs 2 months ops payroll, morale +",
      },
      {
        id: "pr",
        label: "Run a PR campaign",
        hint: "1% of revenue, 60% it works",
      },
      { id: "ignore", label: "Ignore it", hint: "Sentiment −8, morale −" },
    ],
    when: (_s, _co, hq) => AGENT_ROLES.reduce((s, r) => s + hq.agents[r], 0) >= 5,
  },
  {
    id: "poach",
    title: "Rival poaching your best engineers",
    body: (co) => `A well-funded competitor is offering ${co.name}'s top engineers 40% more.`,
    options: [
      {
        id: "counter",
        label: "Counter-offer",
        hint: "Retention bonus = 2 months of engineering payroll",
      },
      { id: "let", label: "Let them go", hint: "Lose ~15% of engineers" },
    ],
    when: (_s, _co, hq) => hq.roles.eng.count >= 8,
  },
  {
    id: "regulator",
    title: "Regulator opens an investigation",
    body: (co) => `The regulator is examining ${co.name}'s pricing and compliance records.`,
    options: [
      {
        id: "cooperate",
        label: "Cooperate fully",
        hint: "Fine ~1% of revenue",
      },
      {
        id: "fight",
        label: "Lawyer up",
        hint: "Legal 0.5% of revenue, 60% cleared, else 3% fine",
      },
      {
        id: "lobby",
        label: "Lobby politicians",
        hint: "50% dropped · 20% becomes a scandal",
      },
    ],
  },
  {
    id: "activist",
    title: "Activist investor demands cash back",
    body: (co) => `A hedge fund with a stake in ${co.name} demands a big buyback or higher dividends.`,
    options: [
      { id: "comply", label: "Raise payout to 60%", hint: "Sentiment +" },
      { id: "resist", label: "Resist", hint: "Sentiment −10, public fight" },
    ],
    when: (s, co) => co.listed && outsideHolders(s, co).reduce((a, x) => a + x.shares, 0) / Math.max(1, co.shares) > 0.3,
  },
  {
    id: "subsidy",
    title: "State offers a subsidy to open a new site",
    body: (co) => `A regional government will cover 30% of the cost if ${co.name} opens in their city.`,
    options: [
      {
        id: "accept",
        label: "Take the deal",
        hint: "Expand at 70% of normal cost",
      },
      { id: "decline", label: "Not now" },
    ],
  },
  {
    id: "gpu",
    title: "GPU shortage",
    body: (co) => `Chip supply is tight. ${co.name}'s cloud provider is raising compute prices 30%.`,
    options: [
      { id: "buy", label: "Buy 4 GPU nodes now", hint: "Own your compute" },
      {
        id: "absorb",
        label: "Absorb the price rise",
        hint: "Lab costs +30% for 6 months",
      },
      {
        id: "pause",
        label: "Pause training runs",
        hint: "Model quality stalls",
      },
    ],
    when: (_s, _co, hq) => Boolean(hq.lab),
  },
];

function maybeBoardDilemma(state: GameState, co: ListedCompany, hq: CompanyHQ) {
  if (state.pending.some((d) => d.kind === "corp")) return;
  if (state.ticks - hq.corpDecisionTick < 6) return;
  if (!chance(R(state), 0.035)) return;
  const pool = DILEMMAS.filter((d) => !d.when || d.when(state, co, hq));
  const d = pick(R(state), pool);
  if (!d) return;
  hq.corpDecisionTick = state.ticks;
  state.pending.push({
    id: uid("dec"),
    kind: "corp",
    title: `${co.name}: ${d.title}`,
    body: d.body(co),
    year: state.time.year,
    month: state.time.month,
    options: d.options,
    context: { companyId: co.id, dilemma: d.id },
  } as Decision);
}

export function resolveCorp(state: GameState, d: Decision, opt: string, log: string[]) {
  const co = state.world.companies.find((c) => c.id === d.context.companyId);
  if (!co) return;
  const hq = getHQ(state, co);
  const x = hq as CompanyHQ & {
    disruption?: { months: number; hit: number };
    boost?: { months: number; mult: number };
  };
  const rev = co.revenue;
  const cost = (amt: number, what: string) => {
    co.cash -= amt;
    pushLog(hq.log, dt(state), `${what}: ${formatINR(amt)}.`);
  };
  const r = () => rng(state);
  const say = (s: string) => {
    log.push(s);
    pushLog(hq.log, dt(state), s);
  };
  switch (String(d.context.dilemma)) {
    case "crunch": {
      const need = Math.max(0, Number(d.context.need) || -co.cash);
      if (opt === "inject") {
        const paid = spendUpTo(state.player, need, `Rescue capital · ${co.name}`, "biz", dt(state));
        co.cash += paid.paid;
        bizFlow(state, "stakes", -paid.paid);
        say(
          paid.short > 0
            ? `You could only find ${formatINR(paid.paid)} of the ${formatINR(need)}.`
            : `You put ${formatINR(paid.paid)} into ${co.name}. Payroll clears.`,
        );
        hq.morale = clamp(hq.morale + 6, 5, 98);
      } else if (opt === "cut") {
        // keep only the people current revenue can carry
        const budget = Math.max(0, co.revenue * 0.55);
        const perHead = payrollOf(state, co, hq) / Math.max(1, headcount(hq));
        const keep = Math.max(1, Math.floor(budget / Math.max(1, perHead)));
        const now = headcount(hq);
        if (keep < now) {
          const f = keep / now;
          for (const r of ROLE_IDS) {
            hq.roles[r].count = Math.floor(hq.roles[r].count * f);
            hq.roles[r].target = hq.roles[r].count;
          }
          const cut = now - headcount(hq);
          hq.layoffScar = clamp(hq.layoffScar + 20, 0, 40);
          co.employees = headcount(hq);
          say(`Laid off ${cut} of ${now}. Severance is owed but deferred; morale is shattered.`);
        } else say("Revenue already covers payroll — the gap is other costs.");
        hq.agents = { eng: 0, sales: 0, ops: 0 };
        hq.strategy = "lean";
      } else if (opt === "bridge") {
        if (debtCapacity(co) > need * 0.5 || r() < 0.25) {
          co.debt += need;
          co.cash += need;
          say(`Bridge loan of ${formatINR(need)} signed at punishing rates.`);
        } else say("Every lender passed. The company is still out of cash.");
      } else {
        co.stage = "bankrupt";
        co.price = Math.max(0.5, co.price * 0.05);
        say(`${co.name} files for bankruptcy. Your stake is worthless.`);
        history(state, "business", `${co.name} bankrupt`);
      }
      return;
    }
    case "strike":
      if (opt === "accept") {
        hq.pay = "above";
        hq.morale = clamp(hq.morale + 15, 5, 98);
        say("Raise agreed. Pay is now above market; staff are loyal.");
      } else if (opt === "negotiate" && r() < 0.6) {
        hq.morale = clamp(hq.morale + 6, 5, 98);
        cost(((payrollOf(state, co, hq) * 0.06) / 12) * 6, "6% raise (first six months)");
        say("The union accepted 6%. Crisis averted.");
      } else {
        x.disruption = { months: opt === "refuse" ? 2 : 1, hit: 0.4 };
        hq.morale = clamp(hq.morale - 12, 5, 98);
        co.sentiment = clamp(co.sentiment - 5, 10, 90);
        say(`Strike! Capacity −40% for ${x.disruption.months} month(s).`);
      }
      break;
    case "contract":
      if (opt === "accept") {
        x.boost = { months: 12, mult: 1.25 };
        say("Contract signed. Demand +25% for a year — make sure you have the staff.");
      } else if (opt === "haggle") {
        if (r() < 0.5) say("They walked.");
        else {
          x.boost = { months: 12, mult: 1.3 };
          say("They caved: +30% demand for a year at a better price.");
        }
      } else say("Declined.");
      break;
    case "breach":
      if (opt === "disclose") {
        cost(rev * 0.005, "Breach fine");
        co.sentiment = clamp(co.sentiment - 6, 10, 90);
        say("Disclosed. A small fine; customers appreciated the honesty.");
      } else if (opt === "ransom") {
        cost(rev * 0.01, "Ransom");
        if (r() < 0.5) bizQueue(state, 4, "hq:leak", { companyId: co.id, size: 0.03 });
        say("Ransom paid. Whether they keep their word is another matter.");
      } else {
        if (r() < 0.3)
          bizQueue(state, 3 + r() * 8, "hq:leak", {
            companyId: co.id,
            size: 0.04,
          });
        say("Patched quietly. For now.");
      }
      break;
    case "recall":
      if (opt === "full") {
        cost(rev * 0.04, "Full recall");
        co.quality = clamp(co.quality + 5, 1, 99);
        co.sentiment = clamp(co.sentiment + 3, 10, 90);
        say("Recall done. Expensive, but trust went up.");
      } else if (opt === "partial") {
        cost(rev * 0.015, "Partial fix");
        if (r() < 0.4)
          bizQueue(state, 6 + r() * 6, "hq:lawsuit", {
            companyId: co.id,
            size: 0.05,
          });
        say("Quietly fixed the worst units.");
      } else {
        if (r() < 0.55)
          bizQueue(state, 4 + r() * 8, "hq:scandal", {
            companyId: co.id,
            size: 0.1,
          });
        say("You denied everything.");
      }
      break;
    case "pricewar":
      if (opt === "match") {
        co.priceLevel = clamp(co.priceLevel - 15, 20, 250);
        say("Prices matched. Margins thinner, share defended.");
      } else if (opt === "differentiate") {
        cost(rev * 0.03, "Counter-marketing");
        co.marketing = clamp(co.marketing + 2, 0, 40);
        say("Marketing blitz launched.");
      } else {
        co.marketShare = clamp(co.marketShare * 0.85, 0.05, 55);
        say("Held price. Lost about 15% of market share.");
      }
      break;
    case "aibacklash":
      if (opt === "retrain") {
        cost((hq.roles.ops.count * roleSalary(state, co, "ops", hq.pay)) / 6, "Retraining programme");
        hq.morale = clamp(hq.morale + 10, 5, 98);
        say("Retraining pledged. Staff and press calmed down.");
      } else if (opt === "pr") {
        cost(rev * 0.01, "PR campaign");
        if (r() < 0.6) say("The PR campaign worked.");
        else {
          co.sentiment = clamp(co.sentiment - 6, 10, 90);
          say("The PR campaign backfired.");
        }
      } else {
        co.sentiment = clamp(co.sentiment - 8, 10, 90);
        hq.morale = clamp(hq.morale - 8, 5, 98);
        say("Ignored. The story kept running.");
      }
      break;
    case "poach":
      if (opt === "counter") {
        cost((hq.roles.eng.count * roleSalary(state, co, "eng", hq.pay)) / 6, "Retention bonuses");
        say("Engineers stayed.");
      } else {
        const lost = Math.round(hq.roles.eng.count * 0.15);
        hq.roles.eng.count -= lost;
        say(`${lost} engineers left for the rival. HR will backfill toward target.`);
      }
      break;
    case "regulator":
      if (opt === "cooperate") {
        cost(rev * 0.01, "Regulatory settlement");
        say("Settled with a modest fine.");
      } else if (opt === "fight") {
        cost(rev * 0.005, "Legal fees");
        if (r() < 0.6) say("Cleared.");
        else {
          cost(rev * 0.03, "Regulatory fine");
          say("Lost. Heavy fine.");
        }
      } else if (r() < 0.5) say("The investigation was quietly dropped.");
      else if (r() < 0.4) {
        bizQueue(state, 2, "hq:scandal", { companyId: co.id, size: 0.05 });
        state.player.reputation.personal = clamp(state.player.reputation.personal - 5, 0, 100);
        say("The lobbying became a story.");
      } else {
        cost(rev * 0.02, "Regulatory fine");
        say("Lobbying failed. Fined.");
      }
      break;
    case "activist":
      if (opt === "comply") {
        hq.payout = Math.max(hq.payout, 0.6);
        co.sentiment = clamp(co.sentiment + 6, 10, 90);
        say("Payout raised to 60%. The fund backed off.");
      } else {
        co.sentiment = clamp(co.sentiment - 10, 10, 90);
        say("You resisted. The share price suffers during the fight.");
      }
      break;
    case "subsidy":
      if (opt === "accept") {
        const cand = state.world.cities.filter((c) => c.id !== co.cityId && !hq.markets.some((m) => m.cityId === c.id));
        const c = pick(R(state), cand);
        if (c) hqExpand(state, co.id, c.id, log, 0.7);
      } else say("Declined.");
      break;
    case "gpu":
      if (opt === "buy") hqLab(state, co.id, { buyGpus: 4 }, log);
      else if (opt === "absorb" && hq.lab) {
        cost((aiBillOf(state, co, hq).total * 0.3) / 2, "GPU price spike");
        say("Absorbed the compute price rise.");
      } else if (hq.lab) {
        hq.lab.training = 0;
        say("Training paused.");
      }
      break;
  }
}

queueHandlers.hq = (state, kind, data) => {
  const co = state.world.companies.find((c) => c.id === data.companyId);
  if (!co) return;
  const hq = getHQ(state, co);
  const size = Number(data.size) || 0.05;
  const hit = round(co.revenue * size, 0);
  co.cash -= hit;
  const what = kind === "hq:leak" ? "The hushed-up data breach leaked" : kind === "hq:lawsuit" ? "A class action over the defect" : "A scandal broke";
  co.sentiment = clamp(co.sentiment - (kind === "hq:scandal" ? 25 : 12), 10, 90);
  state.player.reputation.business = clamp(state.player.reputation.business - 6, 0, 100);
  pushLog(hq.log, dt(state), `${what}: ${formatINR(hit)}.`);
  note(state, `${co.name}: ${what}. Cost ${formatINR(hit)}, share price hit.`, "bad");
  news(
    state,
    `${co.name} hit by ${kind === "hq:leak" ? "data leak" : kind === "hq:lawsuit" ? "class action" : "scandal"}`,
    `${what}. Investors are reassessing.`,
    "business",
    co.countryId,
    "Sentiment falls.",
  );
};

function owned(state: GameState, companyId: string, log: string[]): ListedCompany | null {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co || !state.player.ownedCompanyIds.includes(co.id)) {
    log.push("You need control of that company first.");
    return null;
  }
  return co;
}

/** A comparison of cost structures — why AI firms and people-heavy firms
 *  make money so differently. */
export function costStructure(state: GameState, co: ListedCompany) {
  const hq = getHQ(state, co);
  const rev = Math.max(1, co.revenue);
  const ai = aiBillOf(state, co, hq);
  const payroll = payrollOf(state, co, hq);
  return {
    payrollPct: payroll / rev,
    aiPct: ai.total / rev,
    cogsPct: (co.revenue * Math.max(0.08, 0.34 - co.quality / 500)) / rev,
    revPerHead: co.revenue / Math.max(1, co.employees),
    ai,
  };
}
