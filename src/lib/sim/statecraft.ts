// The machinery of government, run for real.
//
// This is the country-leader layer: a national treasury separate from your
// own money, borrowing (markets, the central bank, the Concord — or from
// yourself), infrastructure you actually build and pay for month by month,
// welfare schemes with a running cost, a legislature that can pass or defeat
// your laws, per-company taxation and nationalisation, an army with a budget
// and a war that is fought month by month on a front line — and, if you push
// far enough, emergency powers and outright personal rule with a coup risk
// that never goes away.
//
// Everything is system-level fiction. No real states, leaders or advice.
import type { Country, GameState, ListedCompany } from "./types";
import {
  bizFlow,
  getBiz,
  pushLog,
  type CompanyLevy,
  type GovProject,
  type GovScheme,
  type GovState,
  type GovTribute,
  type InfraKind,
  type LawKind,
  type SchemeKind,
  type WarState,
} from "./biz";
import { credit, liquidCash, money, spend, spendUpTo } from "./finance";
import { history, news, note, timeline, unlock } from "./feed";
import { ledger } from "./advanced";
import { rng } from "./engine";
import { clamp, formatDate, formatINR, normal, round, uid } from "./util";

const dt = (s: GameState) => formatDate(s.time.year, s.time.month);
const R = (s: GameState) => () => rng(s);

/* ------------------------------------------------------------- access */

/** The country whose government you can direct. */
export function rulingCountry(state: GameState): Country | undefined {
  const id = state.player.politics.countryId || state.player.countryId;
  return state.world.countries.find((c) => c.id === id);
}

/** Head of government — or the sandbox/leader modes, or dev mode. */
export function canRule(state: GameState): boolean {
  if (!state.player.alive) return false;
  const role = state.player.politics.role;
  if (role === "head" || role === "minister") return true;
  if (state.mode === "leader" && role === "party_leader") return true;
  if (state.adv?.debug) return true; // dev tools open the cabinet to testers
  return false;
}

export function getGov(state: GameState): GovState {
  const b = getBiz(state);
  const c = rulingCountry(state) ?? state.world.countries[0]!;
  let g = b.gov;
  if (!g || g.countryId !== c.id) {
    g = blankGov(c);
    b.gov = g;
  }
  g.projects ??= [];
  g.schemes ??= [];
  g.laws ??= [];
  g.levies ??= {};
  g.debt ??= [];
  g.loans ??= [];
  g.wars ??= [];
  g.tribute ??= [];
  g.history ??= [];
  g.log ??= [];
  g.sanctions ??= 0;
  g.corruption ??= 0;
  g.growthBonus ??= 0;
  return g;
}

function blankGov(c: Country): GovState {
  const defence = round(c.revenue * 0.006, 0);
  return {
    countryId: c.id,
    treasury: round(c.revenue * 0.5, 0),
    projects: [],
    schemes: [],
    laws: [],
    levies: {},
    debt: [],
    loans: [],
    wars: [],
    tribute: [],
    defence: { budget: defence, readiness: 45, equipment: 40, personnel: 45 },
    regime: {
      type: "democracy",
      electionsSuspended: false,
      pressFreedom: 70,
      secretPolice: 0,
      legitimacy: 65,
      unrest: 20,
      coups: 0,
      since: 0,
    },
    sanctions: 0,
    corruption: 0,
    growthBonus: 0,
    stats: {
      injected: 0,
      borrowed: 0,
      repaid: 0,
      invested: 0,
      levied: 0,
      tributeIn: 0,
      tributeOut: 0,
      built: 0,
      warsWon: 0,
      warsLost: 0,
      annexed: [],
    },
    monthly: null,
    history: [],
    log: [],
  };
}

/* --------------------------------------------------------- definitions */

export interface InfraDef {
  name: string;
  /** Base cost at scale 1 (₹). */
  cost: number;
  months: number;
  blurb: string;
  effects: {
    infra?: number;
    growth?: number;
    jobs?: number;
    approval?: number;
    tech?: number;
    health?: number;
    education?: number;
    business?: number;
    transit?: number;
    tourism?: number;
    supply?: number;
  };
}

export const INFRA_DEFS: Record<InfraKind, InfraDef> = {
  highway: {
    name: "Expressway corridor",
    cost: 4.0e10,
    months: 30,
    blurb: "Grade-separated freight spine. Cuts logistics cost, lifts land value along the route.",
    effects: { infra: 4, growth: 0.25, approval: 2, transit: 8 },
  },
  rail: {
    name: "High-speed rail line",
    cost: 1.1e11,
    months: 42,
    blurb: "Electric inter-city rail. Permanent capacity, permanent jobs, slow payoff.",
    effects: { infra: 6, growth: 0.4, approval: 4, transit: 12, jobs: 0.15 },
  },
  port: {
    name: "Deep-water port",
    cost: 9.0e10,
    months: 36,
    blurb: "Container and bulk terminal. Trade balance improves the day it opens.",
    effects: { infra: 5, growth: 0.5, business: 4, approval: 2 },
  },
  airport: {
    name: "International airport",
    cost: 1.3e11,
    months: 40,
    blurb: "A new gateway: tourism, cargo and every airline that can now reach you.",
    effects: { infra: 5, growth: 0.45, tourism: 12, approval: 3 },
  },
  power: {
    name: "Generation capacity",
    cost: 8.0e10,
    months: 30,
    blurb: "Base-load and grid storage. Industry cannot run on promises.",
    effects: { infra: 4, growth: 0.35, business: 5 },
  },
  water: {
    name: "Water & sanitation grid",
    cost: 3.5e10,
    months: 24,
    blurb: "Pipes, treatment, sewage. Unspectacular, and it moves health more than hospitals.",
    effects: { infra: 3, health: 6, approval: 4 },
  },
  hospital: {
    name: "Hospital network",
    cost: 6.0e10,
    months: 28,
    blurb: "District hospitals with staff, not just buildings. Staffing is the expensive part.",
    effects: { health: 8, approval: 5, jobs: 0.05 },
  },
  school: {
    name: "Schools & colleges",
    cost: 4.5e10,
    months: 26,
    blurb: "Buildings, teachers and labs. Education index compounds into everything else.",
    effects: { education: 7, approval: 4, growth: 0.15 },
  },
  broadband: {
    name: "National broadband & 5G",
    cost: 7.0e10,
    months: 24,
    blurb: "Fibre to every district and spectrum released. Tech level and business freedom.",
    effects: { tech: 6, growth: 0.3, business: 3 },
  },
  industrial: {
    name: "Industrial park & SEZ",
    cost: 6.5e10,
    months: 26,
    blurb: "Serviced land, single-window clearance, power backup. Factories follow.",
    effects: { infra: 4, growth: 0.5, jobs: 0.3, business: 5 },
  },
  smartcity: {
    name: "Smart city programme",
    cost: 1.6e11,
    months: 48,
    blurb: "Rebuilt grid, transit, sensors and zoning at once. Enormous, slow, transformative.",
    effects: { infra: 9, tech: 8, growth: 0.7, approval: 5, jobs: 0.2, supply: 6 },
  },
  stadium: {
    name: "National stadium & tourism push",
    cost: 3.0e10,
    months: 22,
    blurb: "Cheap popularity, real tourism. Does nothing for productivity.",
    effects: { approval: 8, tourism: 10, growth: 0.1 },
  },
};

export const INFRA_IDS = Object.keys(INFRA_DEFS) as InfraKind[];

export interface SchemeDef {
  name: string;
  /** Cost multiplier against the baseline scheme budget. */
  cost: number;
  blurb: string;
  /** Applied every month, scaled by funding/100. */
  effects: {
    approval?: number;
    unemployment?: number;
    health?: number;
    education?: number;
    growth?: number;
    tech?: number;
    business?: number;
    housing?: number;
    inflation?: number;
    unrest?: number;
  };
}

export const SCHEME_DEFS: Record<SchemeKind, SchemeDef> = {
  housing: {
    name: "Housing for all",
    cost: 1,
    blurb: "Subsidised construction and rental vouchers. Housing index up, rents softer.",
    effects: { approval: 0.1, housing: 0.05, unemployment: -0.004, unrest: -0.05 },
  },
  jobs: {
    name: "Rural jobs guarantee",
    cost: 1.2,
    blurb: "A legal right to 100 days of work. Expensive, and it shows up in unemployment.",
    effects: { approval: 0.12, unemployment: -0.01, unrest: -0.06 },
  },
  food: {
    name: "Food security mission",
    cost: 0.8,
    blurb: "Grain procurement and a public distribution system.",
    effects: { approval: 0.1, health: 0.03, unrest: -0.05 },
  },
  pension: {
    name: "Universal pension",
    cost: 1.1,
    blurb: "A floor under old age. Voters remember; the budget never forgets.",
    effects: { approval: 0.11, unrest: -0.07 },
  },
  health: {
    name: "National health mission",
    cost: 1.3,
    blurb: "Clinics, drugs, insurance for the bottom half. Health index climbs steadily.",
    effects: { approval: 0.12, health: 0.05, unrest: -0.04 },
  },
  education: {
    name: "School digitalisation",
    cost: 0.9,
    blurb: "Devices, content and teacher training. Slow, and it compounds.",
    effects: { education: 0.05, growth: 0.004, approval: 0.05 },
  },
  farmer: {
    name: "Farm income support",
    cost: 1,
    blurb: "Price floors and direct transfers. Popular, inflationary.",
    effects: { approval: 0.13, inflation: 0.004, unrest: -0.05 },
  },
  digital: {
    name: "Digital governance stack",
    cost: 0.7,
    blurb: "One identity, one payment rail, every form online. Business gets faster.",
    effects: { tech: 0.05, business: 0.05, growth: 0.003, approval: 0.04 },
  },
  childcare: {
    name: "Childcare & maternity",
    cost: 0.8,
    blurb: "Subsidised childcare and paid leave. Labour participation rises.",
    effects: { approval: 0.09, unemployment: -0.006, education: 0.02 },
  },
  green: {
    name: "Renewable transition",
    cost: 1.4,
    blurb: "Solar, wind, storage and grid reform. Costs now, cheap power later.",
    effects: { growth: 0.006, tech: 0.05, approval: 0.06, business: 0.02 },
  },
};

export const SCHEME_IDS = Object.keys(SCHEME_DEFS) as SchemeKind[];

export interface LawDef {
  name: string;
  blurb: string;
  /** Support bonus/penalty in the chamber. */
  tilt: number;
  apply: (state: GameState, g: GovState, c: Country) => string;
}

export const LAW_DEFS: Record<LawKind, LawDef> = {
  corp_tax_cut: {
    name: "Corporate tax cut",
    blurb: "Corp tax −6 pts. Investment and business freedom up; voters call it capture.",
    tilt: 4,
    apply: (_s, _g, c) => {
      c.corpTax = clamp(c.corpTax - 6, 5, 60);
      c.businessFreedom = clamp(c.businessFreedom + 6, 15, 98);
      c.policy.business = clamp(c.policy.business + 6, 0, 100);
      c.approval = clamp(c.approval - 2, 5, 95);
      return "Corporate tax cut to " + c.corpTax.toFixed(1) + "%.";
    },
  },
  corp_tax_hike: {
    name: "Corporate tax surcharge",
    blurb: "Corp tax +6 pts. Revenue now, investment later (or never).",
    tilt: -3,
    apply: (_s, _g, c) => {
      c.corpTax = clamp(c.corpTax + 6, 5, 60);
      c.businessFreedom = clamp(c.businessFreedom - 4, 15, 98);
      c.approval = clamp(c.approval - 3, 5, 95);
      return "Corporate tax raised to " + c.corpTax.toFixed(1) + "%.";
    },
  },
  income_tax_cut: {
    name: "Income tax cut",
    blurb: "Income tax −5 pts. Popular, and the deficit notices immediately.",
    tilt: 6,
    apply: (_s, _g, c) => {
      c.incomeTax = clamp(c.incomeTax - 5, 0, 60);
      c.approval = clamp(c.approval + 4, 5, 95);
      return "Income tax cut to " + c.incomeTax.toFixed(1) + "%.";
    },
  },
  labour_reform: {
    name: "Labour market reform",
    blurb: "Hiring and firing liberalised. Business freedom +8, unions furious.",
    tilt: -4,
    apply: (_s, _g, c) => {
      c.businessFreedom = clamp(c.businessFreedom + 8, 15, 98);
      c.policy.business = clamp(c.policy.business + 8, 0, 100);
      c.unemployment = clamp(c.unemployment - 0.3, 2, 22);
      c.approval = clamp(c.approval - 3, 5, 95);
      return "Labour market liberalised.";
    },
  },
  land_reform: {
    name: "Land & tenancy reform",
    blurb: "Secure tenure and a release of public land. Housing index +6.",
    tilt: -2,
    apply: (_s, _g, c) => {
      c.housingIndex = clamp(c.housingIndex + 6, 10, 99);
      c.policy.housing = clamp(c.policy.housing + 10, 0, 100);
      c.businessFreedom = clamp(c.businessFreedom - 4, 15, 98);
      c.approval = clamp(c.approval + 4, 5, 95);
      return "Land and tenancy law rewritten.";
    },
  },
  press_law: {
    name: "Press regulation act",
    blurb: "Licensing and 'responsible reporting' rules. Fewer scandals, less legitimacy.",
    tilt: -6,
    apply: (_s, g, c) => {
      g.regime.pressFreedom = clamp(g.regime.pressFreedom - 25, 0, 100);
      g.regime.legitimacy = clamp(g.regime.legitimacy - 5, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest - 6, 0, 100);
      c.approval = clamp(c.approval - 2, 5, 95);
      return "The press is now licensed.";
    },
  },
  emergency: {
    name: "Emergency powers act",
    blurb: "Elections suspended while the emergency lasts. Legitimacy −12.",
    tilt: -8,
    apply: (_s, g, c) => {
      g.regime.type = g.regime.type === "dictatorship" ? "dictatorship" : "emergency";
      g.regime.electionsSuspended = true;
      g.regime.legitimacy = clamp(g.regime.legitimacy - 12, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest + 6, 0, 100);
      c.approval = clamp(c.approval - 4, 5, 95);
      return "Emergency proclaimed. Elections suspended.";
    },
  },
  conscription: {
    name: "Conscription act",
    blurb: "The ranks fill fast. Nobody thanks you for it.",
    tilt: -5,
    apply: (_s, g, c) => {
      g.defence.personnel = clamp(g.defence.personnel + 25, 0, 100);
      g.defence.readiness = clamp(g.defence.readiness + 8, 0, 100);
      c.unemployment = clamp(c.unemployment - 0.5, 2, 22);
      c.approval = clamp(c.approval - 8, 5, 95);
      g.regime.unrest = clamp(g.regime.unrest + 5, 0, 100);
      return "Conscription begins.";
    },
  },
  nationalisation: {
    name: "Nationalisation framework",
    blurb: "The state may take any strategic firm at book value. Capital takes note.",
    tilt: -10,
    apply: (_s, g, c) => {
      c.businessFreedom = clamp(c.businessFreedom - 10, 15, 98);
      c.policy.business = clamp(c.policy.business - 10, 0, 100);
      g.regime.legitimacy = clamp(g.regime.legitimacy - 4, 0, 100);
      c.approval = clamp(c.approval + 3, 5, 95);
      return "The state may now take strategic assets.";
    },
  },
  privatisation: {
    name: "Privatisation programme",
    blurb: "Sell state assets: one-off treasury receipt, business freedom +8.",
    tilt: 3,
    apply: (s, g, c) => {
      const proceeds = round(c.gdp * 0.0004, 0);
      g.treasury += proceeds;
      g.stats.levied += 0;
      c.businessFreedom = clamp(c.businessFreedom + 8, 15, 98);
      c.approval = clamp(c.approval - 3, 5, 95);
      return `State assets sold: ${formatINR(proceeds)} into the treasury.`;
    },
  },
  deregulation: {
    name: "Deregulation act",
    blurb: "Inspections, licences and filings cut. Business booms; so does fraud.",
    tilt: 5,
    apply: (_s, _g, c) => {
      c.businessFreedom = clamp(c.businessFreedom + 10, 15, 98);
      c.crimeIndex = clamp(c.crimeIndex + 4, 5, 90);
      c.policy.business = clamp(c.policy.business + 6, 0, 100);
      c.approval = clamp(c.approval - 2, 5, 95);
      return "Red tape cut.";
    },
  },
  antitrust: {
    name: "Antitrust & competition act",
    blurb: "Break up concentration: market share of the biggest firms falls.",
    tilt: 2,
    apply: (s, g, c) => {
      for (const co of s.world.companies) {
        if (co.countryId !== c.id) continue;
        if (co.marketShare > 12) co.marketShare = round(co.marketShare * 0.86, 2);
      }
      c.businessFreedom = clamp(c.businessFreedom - 3, 15, 98);
      c.approval = clamp(c.approval + 3, 5, 95);
      return "Dominant firms loosened their grip.";
    },
  },
  immigration_open: {
    name: "Open immigration act",
    blurb: "Population +0.4%, growth +0.3, wages softer, politics louder.",
    tilt: -3,
    apply: (_s, g, c) => {
      c.population *= 1.004;
      c.gdpGrowth = clamp(c.gdpGrowth + 0.3, -8, 12);
      c.unemployment = clamp(c.unemployment + 0.2, 2, 22);
      c.approval = clamp(c.approval - 3, 5, 95);
      g.regime.unrest = clamp(g.regime.unrest + 4, 0, 100);
      return "Borders opened.";
    },
  },
  central_bank: {
    name: "Central bank ordinance",
    blurb: "Rates forced down 1.5 pts. Growth now, inflation and credibility later.",
    tilt: -7,
    apply: (_s, g, c) => {
      c.interestRate = clamp(c.interestRate - 1.5, 0.25, 18);
      c.inflation = clamp(c.inflation + 1, -1, 18);
      c.gdpGrowth = clamp(c.gdpGrowth + 0.5, -8, 12);
      c.approval = clamp(c.approval - 4, 5, 95);
      g.regime.legitimacy = clamp(g.regime.legitimacy - 6, 0, 100);
      return "The bank was told what to do.";
    },
  },
  term_limits: {
    name: "Term limits abolished",
    blurb: "You may stand again, and again. Legitimacy −15, unrest +8.",
    tilt: -12,
    apply: (_s, g, c) => {
      g.regime.legitimacy = clamp(g.regime.legitimacy - 15, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest + 8, 0, 100);
      c.approval = clamp(c.approval - 5, 5, 95);
      return "Term limits removed.";
    },
  },
  digital_id: {
    name: "Digital identity act",
    blurb: "One ID for every resident. Tech +3, delivery improves, privacy shrinks.",
    tilt: 1,
    apply: (_s, g, c) => {
      c.techLevel = clamp(c.techLevel + 3, 0, 100);
      c.educationIndex = clamp(c.educationIndex + 2, 10, 99);
      g.regime.pressFreedom = clamp(g.regime.pressFreedom - 4, 0, 100);
      c.approval = clamp(c.approval - 2, 5, 95);
      return "Every resident now has a number.";
    },
  },
  health_service: {
    name: "Universal health service",
    blurb: "Healthcare index +8. It becomes a permanent line in the budget.",
    tilt: 6,
    apply: (_s, g, c) => {
      c.healthcareIndex = clamp(c.healthcareIndex + 8, 10, 99);
      c.policy.healthcare = clamp(c.policy.healthcare + 10, 0, 100);
      c.approval = clamp(c.approval + 6, 5, 95);
      g.schemes.push({ id: uid("sch"), kind: "health", countryId: c.id, funding: 40, monthlyCost: 0, months: 0, totalSpent: 0 });
      return "A health service exists now — and so does its bill.";
    },
  },
};

export const LAW_IDS = Object.keys(LAW_DEFS) as LawKind[];

export const WAR_OBJECTIVES: Record<WarState["objective"], { name: string; blurb: string }> = {
  reparations: { name: "Reparations", blurb: "Take their money for five years, then stop." },
  annex: { name: "Annexation", blurb: "Take the land. The world will not forgive it." },
  regime: { name: "Regime change", blurb: "Replace their government with one that answers to you." },
  resources: { name: "Resource rights", blurb: "Permanent concessions and cheap energy." },
};

/* -------------------------------------------------------------- quotes */

/** The share of current receipts the government can actually direct. */
export function discretionaryShare(c: Country): number {
  return round(c.revenue * 0.02, 0);
}

export function schemeBudget(c: Country): number {
  return round(c.revenue * 0.0015, 0);
}

export function infraQuote(state: GameState, kind: InfraKind, _cityId: string, scale: number) {
  const def = INFRA_DEFS[kind];
  const s = clamp(Math.round(scale) || 1, 1, 10);
  const budget = round(def.cost * s, 0);
  const months = Math.round(def.months * (1 + 0.12 * (s - 1)));
  return {
    budget,
    months,
    monthly: round(budget / Math.max(1, months), 0),
    scale: s,
    effects: def.effects,
    name: def.name,
  };
}

export function schemeQuote(state: GameState, kind: SchemeKind, funding: number) {
  const c = rulingCountry(state)!;
  const f = clamp(funding, 0, 100);
  return {
    monthlyCost: round(schemeBudget(c) * SCHEME_DEFS[kind].cost * (f / 100), 0),
    funding: f,
  };
}

/** What the chamber thinks before you force the vote. */
export function lawOdds(state: GameState, kind: LawKind) {
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const p = state.player.politics;
  const parties = state.world.parties.filter((x) => x.countryId === c.id);
  const totalSeats = Math.max(1, parties.reduce((s, x) => s + x.seats, 0));
  const mine = parties.find((x) => x.id === p.partyId);
  const seatPct = mine ? (mine.seats / totalSeats) * 100 : 18;
  const patrons = (p as unknown as { patrons?: number }).patrons ?? 0;
  const bonus =
    (g.regime.type === "dictatorship" ? 40 : g.regime.type === "emergency" ? 18 : 0) +
    ((p as unknown as { fullPower?: boolean }).fullPower ? 15 : 0) +
    (g.regime.secretPolice > 50 ? 6 : 0);
  const support = clamp(
    seatPct * 0.45 + p.popularity * 0.35 + patrons * 0.05 + bonus + LAW_DEFS[kind].tilt - g.corruption * 0.2,
    0,
    100,
  );
  return { support: round(support, 0), seatPct: round(seatPct, 0), auto: g.regime.type === "dictatorship" };
}

/* ------------------------------------------------------------- treasury */

export function injectTreasury(state: GameState, amountRaw: number, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const amt = Math.round(money(amountRaw));
  if (amt <= 0) return;
  if (!spend(state.player, amt, `Injection into ${c.name} treasury`, "gov", dt(state))) {
    log.push(`You don't have ${formatINR(amt)} to put into the treasury.`);
    return;
  }
  bizFlow(state, "govInject", -amt);
  g.treasury += amt;
  g.stats.injected += amt;
  const bump = clamp(Math.log10(Math.max(1, amt / 1e7)) * 2 + 0.5, 0.5, 10);
  c.approval = clamp(c.approval + bump, 5, 95);
  state.player.politics.popularity = clamp(state.player.politics.popularity + bump * 0.4, 0, 95);
  state.player.reputation.political = clamp(state.player.reputation.political + bump * 0.5, 0, 100);
  const party = state.world.parties.find((x) => x.id === state.player.politics.partyId);
  if (party) party.funds += amt * 0.5;
  ledger(state, `Injected ${formatINR(amt)} into the ${c.name} treasury`, -amt);
  pushLog(g.log, dt(state), `You put ${formatINR(amt)} of your own money into the treasury.`);
  log.push(`${formatINR(amt)} moved from your accounts into the state treasury. Approval +${bump.toFixed(1)}, the party got ${formatINR(amt * 0.5)} of machinery money.`);
  timeline(state, `Injected ${formatINR(amt)} into the ${c.name} treasury.`, "politics");
}

/** Borrow on the state's credit: markets, the central bank, or the Concord. */
export function govBorrow(state: GameState, source: "market" | "central" | "concord", amountRaw: number, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const amt = Math.round(money(amountRaw));
  if (amt <= 0) return;
  const debtRatio = c.debt / Math.max(1, c.gdp);
  const spread = clamp((debtRatio - 0.4) * 12 + g.sanctions * 0.04 + g.corruption * 0.02, 0, 14);
  const rate =
    source === "central"
      ? clamp(c.interestRate * 0.6, 0.5, 18)
      : source === "concord"
        ? clamp(c.interestRate * 0.55 + 0.3, 0.5, 12)
        : clamp(c.interestRate + 0.8 + spread, 1, 24);
  if (source === "concord" && !c.conMember) {
    log.push("Your country is not a Concord member — no cheap multilateral money.");
    return;
  }
  if (source === "concord" && g.sanctions > 25) {
    log.push("The Concord will not lend to a sanctioned government.");
    return;
  }
  const term = source === "central" ? 60 : source === "concord" ? 120 : 96;
  const monthly = round((amt * (rate / 100)) / 12 + amt / term, 0);
  g.debt.push({ id: uid("gd"), lender: source, principal: amt, remaining: amt, rate: round(rate, 2), monthly, term });
  g.treasury += amt;
  g.stats.borrowed += amt;
  c.debt += amt;
  c.approval = clamp(c.approval - (source === "central" ? 0.4 : 0.2), 5, 95);
  pushLog(g.log, dt(state), `Borrowed ${formatINR(amt)} from ${source === "central" ? "the central bank" : source === "concord" ? "the Concord" : "the market"} at ${rate.toFixed(2)}% (${formatINR(monthly)}/mo).`);
  log.push(`Raised ${formatINR(amt)} at ${rate.toFixed(2)}% for ${term} months — ${formatINR(monthly)}/month of debt service. Debt/GDP now ${((c.debt / Math.max(1, c.gdp)) * 100).toFixed(0)}%.`);
  if (debtRatio > 0.9) note(state, `${c.name}'s debt is above 90% of GDP. Borrowing costs are punishing and the rating agencies are circling.`, "warn");
}

export function govRepay(state: GameState, debtId: string, amountRaw: number, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const d = g.debt.find((x) => x.id === debtId);
  if (!d) return;
  const amt = Math.round(money(amountRaw));
  const pay = Math.min(d.remaining, amt > 0 ? amt : d.remaining);
  if (pay <= 0) return;
  if (g.treasury < pay) {
    log.push(`The treasury only holds ${formatINR(g.treasury)}.`);
    return;
  }
  g.treasury -= pay;
  d.remaining = round(d.remaining - pay, 0);
  g.stats.repaid += pay;
  const c = rulingCountry(state)!;
  c.debt = Math.max(0, c.debt - pay);
  log.push(`Repaid ${formatINR(pay)}. ${d.remaining > 1 ? `${formatINR(d.remaining)} left on this line.` : "That line is closed."}`);
  if (d.remaining <= 1) g.debt = g.debt.filter((x) => x.id !== d.id);
}

/** Borrow from the state, on your own signature, at a subsidised rate. */
export function stateLoan(state: GameState, amountRaw: number, term: number, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const amt = Math.round(money(amountRaw));
  const months = clamp(Math.round(term) || 60, 6, 240);
  if (amt <= 0) return;
  const maxLend = round(g.treasury * 0.25, 0);
  if (amt > maxLend) {
    log.push(`The treasury will only lend you ${formatINR(maxLend)} right now (a quarter of what it holds).`);
    return;
  }
  const rate = clamp(c.interestRate * 0.5, 0.5, 18);
  g.treasury -= amt;
  g.loans.push({ id: uid("gl"), principal: amt, remaining: amt, rate: round(rate, 2), monthly: round((amt * (1 + (rate / 100) * (months / 12))) / months, 0), term: months });
  credit(state.player, amt, `State loan · ${c.name}`, "gov", dt(state));
  bizFlow(state, "govLoan", amt);
  ledger(state, `Borrowed ${formatINR(amt)} from the ${c.name} treasury`, amt);
  g.corruption = clamp(g.corruption + clamp(amt / Math.max(1, c.revenue) * 40, 0.2, 12), 0, 100);
  c.approval = clamp(c.approval - clamp(amt / Math.max(1, c.revenue) * 30, 0.1, 6), 5, 95);
  pushLog(g.log, dt(state), `You borrowed ${formatINR(amt)} from the state at ${rate.toFixed(2)}% over ${months} months.`);
  log.push(`${formatINR(amt)} landed in your account at ${rate.toFixed(2)}% (market is ${c.interestRate.toFixed(2)}%). The treasury is lighter and the public accounts now show a related-party loan — corruption +.`);
  timeline(state, `Borrowed ${formatINR(amt)} from the state treasury.`, "politics");
}

export function repayStateLoan(state: GameState, loanId: string, amountRaw: number, log: string[]) {
  const g = getGov(state);
  const l = g.loans.find((x) => x.id === loanId);
  if (!l) return;
  const amt = Math.round(money(amountRaw));
  const want = amt > 0 ? Math.min(amt, l.remaining) : l.remaining;
  if (want <= 0) return;
  if (!spend(state.player, want, `Repaid state loan`, "gov", dt(state))) {
    log.push(`You can't cover ${formatINR(want)} right now.`);
    return;
  }
  bizFlow(state, "govRepay", -want);
  l.remaining = round(l.remaining - want, 0);
  g.treasury += want;
  g.stats.repaid += want;
  log.push(`Repaid ${formatINR(want)} of the state loan. ${l.remaining > 1 ? `${formatINR(l.remaining)} outstanding.` : "Cleared."}`);
  if (l.remaining <= 1) g.loans = g.loans.filter((x) => x.id !== l.id);
}

/** Quietly move state money into your pocket. This is what corruption is. */
export function skimTreasury(state: GameState, amountRaw: number, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const amt = Math.round(money(amountRaw));
  if (amt <= 0) return;
  const take = Math.min(amt, Math.max(0, g.treasury));
  if (take <= 0) {
    log.push("The treasury is empty — there is nothing left to move.");
    return;
  }
  g.treasury -= take;
  credit(state.player, take, `Diversion from ${c.name} treasury`, "gov", dt(state));
  bizFlow(state, "govSkim", take);
  ledger(state, `Diverted ${formatINR(take)} from the ${c.name} treasury`, take);
  const heat = clamp((take / Math.max(1, c.revenue)) * 300, 1, 45);
  g.corruption = clamp(g.corruption + heat, 0, 100);
  g.regime.unrest = clamp(g.regime.unrest + heat * 0.4, 0, 100);
  g.regime.legitimacy = clamp(g.regime.legitimacy - heat * 0.5, 0, 100);
  c.approval = clamp(c.approval - heat * 0.4, 5, 95);
  state.player.crime.heat = clamp(state.player.crime.heat + heat * 0.5, 0, 100);
  pushLog(g.log, dt(state), `${formatINR(take)} left the treasury without a vote.`);
  log.push(`${formatINR(take)} is in your account. Corruption +${heat.toFixed(0)}, unrest +, approval −, and investigators now have something to follow.`);
  news(state, "Audit questions treasury transfers", `The ${c.name} audit office flagged ${formatINR(take)} moved without a legislative vote.`, "politics", c.id, "Corruption raises unrest and lowers approval.");
}

function deny(log: string[]) {
  log.push("Only the head of government can move the machinery of state.");
}

/* ------------------------------------------------------- infrastructure */

export function startInfra(state: GameState, kind: InfraKind, cityId: string, scale: number, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const city = state.world.cities.find((x) => x.id === cityId) ?? state.world.cities.find((x) => x.countryId === c.id)!;
  const q = infraQuote(state, kind, city.id, scale);
  const deposit = round(q.budget * 0.08, 0);
  if (g.treasury < deposit) {
    log.push(`The treasury needs ${formatINR(deposit)} up front (8%). It holds ${formatINR(g.treasury)}. Inject money, borrow, or build smaller.`);
    return;
  }
  g.treasury -= deposit;
  g.stats.invested += deposit;
  const pj: GovProject = {
    id: uid("gp"),
    kind,
    name: `${INFRA_DEFS[kind].name}${q.scale > 1 ? ` ×${q.scale}` : ""}`,
    cityId: city.id,
    countryId: c.id,
    budget: q.budget,
    spent: deposit,
    progress: 0,
    months: q.months,
    scale: q.scale,
    quality: 60 + Math.round(rng(state) * 25),
    stage: "building",
    stalledMonths: 0,
    startYear: state.time.year,
    startMonth: state.time.month,
  };
  g.projects.push(pj);
  pushLog(g.log, dt(state), `Broke ground on ${pj.name}: ${formatINR(q.budget)} over ~${q.months} months (${formatINR(q.monthly)}/mo).`);
  log.push(`${pj.name} starts in ${city.name}. Budget ${formatINR(q.budget)}, about ${formatINR(q.monthly)} a month for ${q.months} months. Effects land when it opens.`);
  timeline(state, `Laid the foundation of the ${pj.name}.`, "politics");
}

export function cancelInfra(state: GameState, projectId: string, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const pj = g.projects.find((x) => x.id === projectId);
  if (!pj) return;
  const back = round(pj.spent * 0.25, 0);
  g.treasury += back;
  g.projects = g.projects.filter((x) => x.id !== projectId);
  const c = rulingCountry(state)!;
  c.approval = clamp(c.approval - 2, 5, 95);
  pushLog(g.log, dt(state), `${pj.name} cancelled after ${formatINR(pj.spent)} spent (${formatINR(back)} recovered).`);
  log.push(`${pj.name} abandoned. ${formatINR(back)} of ${formatINR(pj.spent)} came back. Approval −2.`);
}

function finishInfra(state: GameState, pj: GovProject) {
  const g = getGov(state);
  const c = state.world.countries.find((x) => x.id === pj.countryId)!;
  const city = state.world.cities.find((x) => x.id === pj.cityId);
  const e = INFRA_DEFS[pj.kind].effects;
  const k = Math.pow(pj.scale, 0.85);
  pj.stage = "done";
  pj.progress = 100;
  if (e.infra) c.infrastructure = clamp(c.infrastructure + e.infra * k, 10, 99);
  if (e.growth) g.growthBonus = round(g.growthBonus + e.growth * k, 3);
  if (e.tech) c.techLevel = clamp(c.techLevel + e.tech * k, 0, 100);
  if (e.health) c.healthcareIndex = clamp(c.healthcareIndex + e.health * k, 10, 99);
  if (e.education) c.educationIndex = clamp(c.educationIndex + e.education * k, 10, 99);
  if (e.business) c.businessFreedom = clamp(c.businessFreedom + e.business * k, 15, 98);
  if (e.approval) c.approval = clamp(c.approval + e.approval * k, 5, 95);
  if (e.jobs) c.unemployment = clamp(c.unemployment - e.jobs * k, 2, 22);
  if (city) {
    if (e.infra) city.infrastructure = clamp(city.infrastructure + e.infra * k * 1.4, 10, 100);
    if (e.transit) city.transit = clamp(city.transit + e.transit * k, 0, 100);
    if (e.tourism) city.tourism = clamp(city.tourism + e.tourism * k, 0, 100);
    if (e.supply) city.housingSupply = clamp(city.housingSupply + e.supply * k, 20, 140);
    city.businessActivity = clamp(city.businessActivity + 3 * k, 15, 100);
    city.demand = clamp(city.demand + 4 * k, 10, 160);
  }
  g.stats.built += 1;
  news(
    state,
    `${pj.name} opens in ${city?.name ?? c.name}`,
    `The ${formatINR(pj.budget)} project is finished — ${pj.months} months after the first draw. ${INFRA_DEFS[pj.kind].blurb}`,
    "infrastructure",
    c.id,
    "Infrastructure, growth, land values and jobs all move.",
  );
  note(state, `${pj.name} is complete.`, "good");
  timeline(state, `Opened the ${pj.name}.`, "politics");
  history(state, "gov", `Completed ${pj.name} (${formatINR(pj.budget)})`);
  unlock(state, "builder");
  pushLog(g.log, dt(state), `${pj.name} completed for ${formatINR(pj.spent)}.`);
}

/* -------------------------------------------------------------- schemes */

export function setScheme(state: GameState, kind: SchemeKind, funding: number, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const f = clamp(Math.round(funding), 0, 100);
  const existing = g.schemes.find((x) => x.kind === kind && x.countryId === c.id);
  if (f === 0) {
    if (existing) {
      g.schemes = g.schemes.filter((x) => x !== existing);
      pushLog(g.log, dt(state), `${SCHEME_DEFS[kind].name} wound down after ${existing.months} months (${formatINR(existing.totalSpent)} spent).`);
      log.push(`${SCHEME_DEFS[kind].name} closed.`);
    }
    return;
  }
  const cost = schemeQuote(state, kind, f).monthlyCost;
  if (existing) {
    existing.funding = f;
    existing.monthlyCost = cost;
    log.push(`${SCHEME_DEFS[kind].name} now funded at ${f}% — ${formatINR(cost)}/month.`);
    pushLog(g.log, dt(state), `${SCHEME_DEFS[kind].name} set to ${f}% (${formatINR(cost)}/mo).`);
  } else {
    g.schemes.push({ id: uid("sch"), kind, countryId: c.id, funding: f, monthlyCost: cost, months: 0, totalSpent: 0 });
    log.push(`${SCHEME_DEFS[kind].name} launched at ${f}% — ${formatINR(cost)}/month out of the treasury.`);
    pushLog(g.log, dt(state), `Launched ${SCHEME_DEFS[kind].name} at ${f}% (${formatINR(cost)}/mo).`);
    news(state, `${c.name} launches ${SCHEME_DEFS[kind].name}`, SCHEME_DEFS[kind].blurb, "politics", c.id, "Recurring spending with recurring political reward.");
  }
}

/* ----------------------------------------------------------------- laws */

export function passLaw(state: GameState, kind: LawKind, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const def = LAW_DEFS[kind];
  const odds = lawOdds(state, kind);
  const roll = odds.auto ? 100 : Math.round(odds.support + normal(R(state), 0, 8));
  if (roll < 50) {
    log.push(`${def.name} defeated in the chamber: ${Math.max(0, roll)}% in favour (you needed 50). Win seats, buy patrons, raise popularity — or stop asking.`);
    pushLog(g.log, dt(state), `${def.name} defeated (${Math.max(0, roll)}%).`);
    c.approval = clamp(c.approval - 1, 5, 95);
    return;
  }
  const effect = def.apply(state, g, c);
  g.laws.push({ id: uid("law"), kind, name: def.name, countryId: c.id, year: state.time.year, month: state.time.month, support: Math.max(50, roll) });
  state.player.politics.billsProposed += 1;
  pushLog(g.log, dt(state), `${def.name} became law (${Math.max(50, roll)}%). ${effect}`);
  log.push(`${def.name}: ${effect}`);
  news(state, `Law: ${def.name}`, `${def.blurb} Passed ${Math.max(50, roll)}–${100 - Math.max(50, roll)}.`, "politics", c.id, "Law changes what the economy does next month.");
  timeline(state, `Passed the ${def.name}.`, "politics");
  history(state, "gov", `Enacted ${def.name}`);
  unlock(state, "statecraft");
}

/* ------------------------------------------------------------ companies */

export function levyOf(state: GameState, co: ListedCompany): CompanyLevy | undefined {
  return getGov(state).levies[co.id];
}

export function setLevy(state: GameState, companyId: string, kind: CompanyLevy["kind"] | "none", rate: number, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const co = state.world.companies.find((x) => x.id === companyId);
  if (!co) return;
  const r = clamp(rate, 0, kind === "levy" || kind === "subsidy" ? 40 : 0);
  if (kind === "none") {
    delete g.levies[co.id];
    log.push(`${co.name} is back on the standard corporate tax.`);
    return;
  }
  g.levies[co.id] = { kind, rate: r, collected: g.levies[co.id]?.collected ?? 0 };
  co.sentiment = clamp(co.sentiment - (kind === "levy" ? 8 : kind === "subsidy" ? -10 : 0), 0, 100);
  c.businessFreedom = clamp(c.businessFreedom - (kind === "levy" || kind === "nationalised" ? 1.5 : -1), 15, 98);
  pushLog(g.log, dt(state), `${co.name}: ${kind} ${r ? `${r}% of turnover` : ""}.`);
  log.push(
    kind === "levy"
      ? `${co.name} now pays an extra ${r}% of turnover. ${formatINR((co.revenue / 12) * (r / 100))}/month into the treasury — and their board just repriced you.`
      : kind === "subsidy"
        ? `${co.name} receives ${r}% of turnover from the treasury (${formatINR((co.revenue / 12) * (r / 100))}/month).`
        : kind === "exempt"
          ? `${co.name} pays no corporate tax at all. Business freedom +, voters −.`
          : `${co.name} is run as a state enterprise: profits come to the treasury, efficiency suffers.`,
  );
}

export function nationalise(state: GameState, companyId: string, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const co = state.world.companies.find((x) => x.id === companyId);
  if (!co) return;
  if (!g.laws.some((l) => l.kind === "nationalisation")) {
    log.push("Pass the Nationalisation framework first — without it the seizure is illegal and the courts will reverse it.");
    return;
  }
  const price = round(Math.max(1, co.valuation) * 0.6, 0);
  if (g.treasury < price) {
    log.push(`Compensation of ${formatINR(price)} (60% of ${formatINR(co.valuation)}) is more than the treasury holds.`);
    return;
  }
  g.treasury -= price;
  const holder = co.shareholders.find((s) => s.type === "player");
  if (holder) {
    const mine = (holder.shares / Math.max(1, co.shares)) * price;
    credit(state.player, mine, `Compensation · ${co.name}`, "gov", dt(state));
    bizFlow(state, "govComp", mine);
  }
  g.levies[co.id] = { kind: "nationalised", rate: 0, collected: 0, bookValue: price };
  co.sentiment = clamp(co.sentiment - 25, 0, 100);
  co.quality = clamp(co.quality - 4, 0, 100);
  c.businessFreedom = clamp(c.businessFreedom - 6, 15, 98);
  c.approval = clamp(c.approval + 4, 5, 95);
  g.regime.legitimacy = clamp(g.regime.legitimacy - 3, 0, 100);
  pushLog(g.log, dt(state), `Nationalised ${co.name} for ${formatINR(price)}.`);
  log.push(`${co.name} is now a state enterprise. Compensation ${formatINR(price)}; every future profit is paid to the treasury, and every board in the country just repriced its risk.`);
  news(state, `${c.name} nationalises ${co.name}`, `Compensation set at ${formatINR(price)}, sixty per cent of the last valuation.`, "politics", c.id, "Investors demand more for everything now.");
  timeline(state, `Nationalised ${co.name}.`, "politics");
}

/** Confiscate a company's cash outright. Fast money, permanent damage. */
export function seizeAssets(state: GameState, companyId: string, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const co = state.world.companies.find((x) => x.id === companyId);
  if (!co) return;
  const take = round(Math.max(0, co.cash) * 0.7, 0);
  if (take <= 0) {
    log.push(`${co.name} has no cash worth taking.`);
    return;
  }
  co.cash = round(co.cash - take, 0);
  g.treasury += take;
  g.stats.levied += take;
  co.sentiment = clamp(co.sentiment - 40, 0, 100);
  co.stage = co.cash < 0 ? "distressed" : co.stage;
  c.businessFreedom = clamp(c.businessFreedom - 12, 15, 98);
  c.approval = clamp(c.approval - 6, 5, 95);
  g.sanctions = clamp(g.sanctions + 12, 0, 100);
  g.corruption = clamp(g.corruption + 10, 0, 100);
  state.player.crime.heat = clamp(state.player.crime.heat + 12, 0, 100);
  pushLog(g.log, dt(state), `Seized ${formatINR(take)} from ${co.name}.`);
  log.push(`${formatINR(take)} moved into the treasury. Business freedom −12, sanctions +12, and the file on your desk now has your name on it.`);
  news(state, `State seizes ${formatINR(take)} from ${co.name}`, "Regulators describe it as a 'special assessment'. Investors describe it differently.", "politics", c.id, "Capital flight: business freedom falls and sanctions rise.");
}

/* --------------------------------------------------------------- defence */

export function setDefence(state: GameState, patch: { budget?: number; equipment?: number; personnel?: number }, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  if (patch.budget != null) {
    g.defence.budget = clamp(Math.round(money(patch.budget)), 0, round(c.revenue * 0.6, 0));
  }
  if (patch.equipment != null) {
    const want = clamp(Math.round(money(patch.equipment)), 0, 100);
    const d = want - g.defence.equipment;
    if (d > 0) {
      const cost = round(d * c.gdp * 0.0000025, 0);
      if (g.treasury < cost) {
        log.push(`New equipment to ${want} costs ${formatINR(cost)}. The treasury holds ${formatINR(g.treasury)}.`);
      } else {
        g.treasury -= cost;
        g.defence.equipment = want;
        g.stats.invested += cost;
        log.push(`Equipment programme to ${want}: ${formatINR(cost)}.`);
      }
    } else g.defence.equipment = want;
  }
  if (patch.personnel != null) g.defence.personnel = clamp(Math.round(money(patch.personnel)), 0, 100);
  log.push(`Defence budget ${formatINR(g.defence.budget)}/month · equipment ${Math.round(g.defence.equipment)} · personnel ${Math.round(g.defence.personnel)} · readiness ${Math.round(g.defence.readiness)}.`);
}

/** A first read on how a war would go, before you commit. */
export function warPreview(state: GameState, enemyId: string, intensity: 1 | 2 | 3) {
  const c = rulingCountry(state)!;
  const g = getGov(state);
  const e = state.world.countries.find((x) => x.id === enemyId);
  if (!e || e.id === c.id) return null;
  const our = militaryPower(state, c, g, false);
  const theirs = militaryPower(state, e, g, true);
  const ratio = our / Math.max(1, our + theirs);
  return {
    our: round(our, 0),
    theirs: round(theirs, 0),
    ratio,
    odds: `${(ratio * 100).toFixed(0)}%`,
    monthly: round(warCost(state, c, intensity), 0),
    casualties: round(c.population * 0.00002 * intensity * 12, 0),
  };
}

function warCost(state: GameState, c: Country, intensity: number): number {
  const g = getGov(state);
  return round(g.defence.budget * (0.4 + 0.3 * intensity) + c.gdp * 0.00001 * intensity, 0);
}

export function militaryPower(state: GameState, c: Country, g: GovState, enemy: boolean): number {
  const gdpScore = Math.sqrt(Math.max(0, c.gdp) / 1e13) * 12;
  const popScore = Math.sqrt(Math.max(0, c.population) / 1e6) * 3;
  let p = gdpScore + popScore + c.techLevel * 0.8 + c.infrastructure * 0.3;
  if (enemy) {
    const atWar = state.world.countries.some((o) => o.id !== c.id && g.wars.some((w) => w.status === "active" && w.enemyId === o.id));
    p += atWar ? -6 : 0;
    p += (c.crimeIndex > 60 ? -4 : 0);
    return clamp(p, 10, 400);
  }
  const d = g.defence;
  p += Math.sqrt(Math.max(0, d.budget) / 1e9) * 6;
  p += d.equipment * 0.5 + d.readiness * 0.4 + d.personnel * 0.2;
  p += g.regime.type === "dictatorship" ? 8 : g.regime.type === "emergency" ? 4 : 0;
  p -= g.regime.unrest * 0.3;
  p -= g.wars.filter((w) => w.status === "active").length * 6;
  p -= g.sanctions * 0.15;
  const allies = state.world.countries.filter((o) => o.id !== c.id && c.relations[o.id] === "friendly").length;
  p += allies * 8;
  return clamp(p, 10, 400);
}

/* ------------------------------------------------------------------- war */

export function declareWar(state: GameState, enemyId: string, objective: WarState["objective"], intensity: 1 | 2 | 3, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const e = state.world.countries.find((x) => x.id === enemyId);
  if (!e || e.id === c.id) return;
  if (g.wars.some((w) => w.status === "active")) {
    log.push("You already have an open front. Settle it before opening another.");
    return;
  }
  const rel = c.relations[enemyId] ?? "neutral";
  const pretext = rel === "hostile" ? 1 : rel === "tense" ? 0.6 : 0.25;
  const w: WarState = {
    id: uid("war"),
    enemyId,
    countryId: c.id,
    objective,
    intensity,
    front: 0,
    occupation: 0,
    ourStrength: round(militaryPower(state, c, g, false), 0),
    enemyStrength: round(militaryPower(state, e, g, true), 0),
    ourCasualties: 0,
    theirCasualties: 0,
    exhaustion: 0,
    spend: 0,
    startYear: state.time.year,
    startMonth: state.time.month,
    status: "active",
    outcome: "",
    battles: [],
  };
  g.wars.push(w);
  const sanction = clamp(Math.round((1 - pretext) * 40 + intensity * 6), 0, 60);
  g.sanctions = clamp(g.sanctions + sanction, 0, 100);
  for (const o of state.world.countries) {
    if (o.id === c.id) continue;
    const order = ["hostile", "tense", "neutral", "cordial", "friendly"] as const;
    const cur = o.relations[c.id] ?? "neutral";
    const idx = order.indexOf(cur);
    const next = order[clamp(idx - (o.id === enemyId ? 3 : 1), 0, 4)]!;
    o.relations[c.id] = next;
    c.relations[o.id] = next;
  }
  c.relations[enemyId] = "hostile";
  e.relations[c.id] = "hostile";
  c.approval = clamp(c.approval + 6 * pretext, 5, 95);
  c.unemployment = clamp(c.unemployment - 0.2 * intensity, 2, 22);
  g.regime.unrest = clamp(g.regime.unrest + (1 - pretext) * 10, 0, 100);
  pushLog(g.log, dt(state), `War declared on ${e.name} — objective: ${WAR_OBJECTIVES[objective].name.toLowerCase()}, intensity ${intensity}.`);
  log.push(`War with ${e.name}. Your strength ${w.ourStrength} against ${w.enemyStrength}. It costs about ${formatINR(warCost(state, c, intensity))} a month and sanctions jumped ${sanction} points.`);
  news(
    state,
    `${c.name} declares war on ${e.name}`,
    `Objective: ${WAR_OBJECTIVES[objective].name.toLowerCase()}. Forces have crossed the line; ${WAR_OBJECTIVES[objective].blurb}`,
    "war",
    c.id,
    "War costs money every month, moves casualties and approval, and reshapes trade.",
  );
  timeline(state, `Declared war on ${e.name}.`, "politics");
  history(state, "war", `War declared on ${e.name}`);
}

export type WarMove = "escalate" | "hold" | "deescalate" | "peace" | "annex";

export function warMove(state: GameState, warId: string, move: WarMove, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  const w = g.wars.find((x) => x.id === warId);
  if (!w || w.status !== "active") return;
  const e = state.world.countries.find((x) => x.id === w.enemyId)!;
  if (move === "escalate") {
    w.intensity = clamp(w.intensity + 1, 1, 3) as 1 | 2 | 3;
    g.regime.unrest = clamp(g.regime.unrest + 5, 0, 100);
    c.approval = clamp(c.approval - 3, 5, 95);
    log.push(`Escalated to intensity ${w.intensity}. More force, more money, more coffins.`);
  } else if (move === "deescalate") {
    w.intensity = clamp(w.intensity - 1, 1, 3) as 1 | 2 | 3;
    log.push(`Dialled back to intensity ${w.intensity}. The front will drift against you.`);
  } else if (move === "peace") {
    settle(state, w, log);
    return;
  } else if (move === "annex") {
    if (w.front < 100) {
      log.push("You do not hold their capital. Take the front all the way first.");
      return;
    }
    annex(state, w, e, log);
    return;
  }
  pushLog(g.log, dt(state), `${e.name} front: intensity ${w.intensity}, front ${w.front > 0 ? "+" : ""}${Math.round(w.front)}.`);
}

function settle(state: GameState, w: WarState, log: string[]) {
  const g = getGov(state);
  const c = state.world.countries.find((x) => x.id === w.countryId)!;
  const e = state.world.countries.find((x) => x.id === w.enemyId)!;
  w.status = "settled";
  if (w.front >= 20) {
    const monthly = round(e.gdp * 0.0002 * w.intensity, 0);
    g.tribute.push({ fromId: e.id, monthly, months: 60, label: `Reparations from ${e.name}` });
    e.gdpGrowth = clamp(e.gdpGrowth - 0.4, -8, 12);
    w.outcome = `Favourable peace: ${formatINR(monthly)}/month for five years.`;
    c.approval = clamp(c.approval + 6, 5, 95);
    log.push(`Peace on your terms: ${e.name} pays ${formatINR(monthly)} a month for five years.`);
  } else if (w.front <= -20) {
    const monthly = -round(c.gdp * 0.0002 * (4 - w.intensity), 0);
    g.tribute.push({ fromId: c.id, monthly, months: 60, label: `Reparations to ${e.name}` });
    c.approval = clamp(c.approval - 15, 5, 95);
    g.regime.unrest = clamp(g.regime.unrest + 12, 0, 100);
    w.outcome = `Bought peace: ${formatINR(-monthly)}/month for five years.`;
    log.push(`You bought peace: ${formatINR(-monthly)} a month out of the treasury for five years. Approval −15.`);
  } else {
    w.outcome = "White peace: the line holds where it stopped.";
    log.push("White peace. Nothing gained, nothing paid, everyone counts their dead.");
  }
  g.regime.unrest = clamp(g.regime.unrest - 8, 0, 100);
  c.relations[e.id] = w.front >= 20 ? "tense" : "neutral";
  e.relations[c.id] = c.relations[e.id];
  pushLog(g.log, dt(state), `War with ${e.name} ended. ${w.outcome}`);
  news(state, `Peace with ${e.name}`, w.outcome, "war", c.id, "Exhaustion falls; the bills keep arriving.");
  timeline(state, `Made peace with ${e.name}.`, "politics");
}

function annex(state: GameState, w: WarState, e: Country, log: string[]) {
  const g = getGov(state);
  const c = state.world.countries.find((x) => x.id === w.countryId)!;
  const gdpShare = round(e.gdp * 0.22, 0);
  const popShare = Math.round(e.population * 0.25);
  e.gdp = round(e.gdp - gdpShare, 0);
  e.population = Math.max(1e6, e.population - popShare);
  e.gdpGrowth = clamp(e.gdpGrowth - 1.2, -8, 12);
  c.gdp = round(c.gdp + gdpShare, 0);
  c.population += popShare;
  c.infrastructure = clamp(c.infrastructure + 2, 10, 99);
  g.stats.annexed.push(e.id);
  g.stats.warsWon += 1;
  g.growthBonus = round(g.growthBonus + 0.3, 3);
  g.sanctions = clamp(g.sanctions + 35, 0, 100);
  g.regime.legitimacy = clamp(g.regime.legitimacy - 20, 0, 100);
  g.regime.unrest = clamp(g.regime.unrest + 15, 0, 100);
  c.approval = clamp(c.approval + 12, 5, 95);
  g.tribute.push({ fromId: e.id, monthly: round(e.gdp * 0.0003, 0), months: -1, label: `Tribute from the ${e.name} territories` });
  w.status = "won";
  w.outcome = `Annexed a quarter of ${e.name}: ${formatINR(gdpShare)} of GDP and ${popShare.toLocaleString("en-IN")} people.`;
  pushLog(g.log, dt(state), w.outcome);
  log.push(`${w.outcome} Sanctions +35, legitimacy −20, unrest +15 — and a permanent tribute line.`);
  news(
    state,
    `${c.name} annexes part of ${e.name}`,
    `The treaty transfers ${formatINR(gdpShare)} of output and ${popShare.toLocaleString("en-IN")} residents. The Concord has called an emergency session.`,
    "war",
    c.id,
    "Conquest adds GDP and population — and permanent sanctions and unrest.",
  );
  timeline(state, `Annexed territory from ${e.name}.`, "politics");
  unlock(state, "conqueror");
}

function resolveWar(state: GameState, w: WarState) {
  const g = getGov(state);
  const c = state.world.countries.find((x) => x.id === w.countryId)!;
  const e = state.world.countries.find((x) => x.id === w.enemyId)!;
  const won = w.front >= 100;
  if (won) {
    // annexation counts the win itself (see annex())
    if (w.objective === "annex") {
      annex(state, w, e, []);
      return;
    }
    g.stats.warsWon += 1;
    if (w.objective === "reparations") {
      const monthly = round(e.gdp * 0.0006 * w.intensity, 0);
      g.tribute.push({ fromId: e.id, monthly, months: 60, label: `Reparations from ${e.name}` });
      g.treasury += round(e.gdp * 0.002, 0);
      e.gdpGrowth = clamp(e.gdpGrowth - 0.8, -8, 12);
      w.outcome = `${e.name} sues for peace and pays ${formatINR(monthly)}/month for five years.`;
    } else if (w.objective === "regime") {
      const puppet = `Provisional Authority`;
      e.headOfGov = puppet;
      e.relations[c.id] = "cordial";
      c.relations[e.id] = "cordial";
      g.tribute.push({ fromId: e.id, monthly: round(e.gdp * 0.0004, 0), months: 48, label: `Concessions from ${e.name}` });
      w.outcome = `The government of ${e.name} has been replaced by an authority that answers to you.`;
    } else if (w.objective === "resources") {
      g.growthBonus = round(g.growthBonus + 0.5, 3);
      c.tradeBalance += round(e.gdp * 0.002, 0);
      g.tribute.push({ fromId: e.id, monthly: round(e.gdp * 0.00025, 0), months: -1, label: `Resource concessions in ${e.name}` });
      w.outcome = `Permanent resource and port concessions carved out of ${e.name}.`;
    }
    w.status = "won";
    c.approval = clamp(c.approval + 18, 5, 95);
    g.regime.legitimacy = clamp(g.regime.legitimacy + 8, 0, 100);
    g.regime.unrest = clamp(g.regime.unrest - 10, 0, 100);
    g.sanctions = clamp(g.sanctions - 5, 0, 100);
    news(state, `${c.name} wins the war`, w.outcome, "war", c.id, "Tribute arrives monthly; approval jumps.");
    note(state, `Victory. ${w.outcome}`, "good");
    unlock(state, "victory");
  } else {
    g.stats.warsLost += 1;
    w.status = "lost";
    const monthly = -round(c.gdp * 0.0005 * w.intensity, 0);
    g.tribute.push({ fromId: c.id, monthly, months: 60, label: `Reparations to ${e.name}` });
    c.approval = clamp(c.approval - 25, 5, 95);
    c.gdpGrowth = clamp(c.gdpGrowth - 1.5, -8, 12);
    g.regime.legitimacy = clamp(g.regime.legitimacy - 25, 0, 100);
    g.regime.unrest = clamp(g.regime.unrest + 25, 0, 100);
    w.outcome = `Defeat: ${e.name} dictates terms. ${formatINR(-monthly)}/month for five years.`;
    news(state, `${c.name} sues for peace`, w.outcome, "war", c.id, "Reparations drain the treasury; approval collapses.");
    note(state, `Defeat. ${w.outcome}`, "bad");
    pushDecision(state, "coup", `${e.name} has won`, w.outcome + " The cabinet is meeting without you. Your party wants a name to blame.", [
      { id: "resign", label: "Resign", hint: "Leave office, keep your money and your skin" },
      { id: "blame", label: "Blame the generals", hint: "Approval −8, you keep the chair" },
      { id: "dig", label: "Refuse to go", hint: "Legitimacy −15, unrest +15, and the streets decide" },
    ]);
  }
  pushLog(g.log, dt(state), `War with ${e.name}: ${w.outcome}`);
  timeline(state, `${won ? "Won" : "Lost"} the war with ${e.name}.`, "politics");
  history(state, "war", `${won ? "Victory" : "Defeat"} against ${e.name}`);
}

function pushDecision(state: GameState, kind: string, title: string, body: string, options: { id: string; label: string; hint?: string }[]) {
  state.pending.push({
    id: uid("dec"),
    kind,
    title,
    body,
    year: state.time.year,
    month: state.time.month,
    options,
    context: { kind },
  });
}

/* -------------------------------------------------------------- regime */

export type RegimeMove = "emergency" | "restore" | "censor" | "secret" | "dissolve" | "dictator" | "amnesty" | "purge" | "referendum";

export function regimeMove(state: GameState, move: RegimeMove, level = 20, log: string[]) {
  if (!canRule(state)) return deny(log);
  const g = getGov(state);
  const c = rulingCountry(state)!;
  switch (move) {
    case "emergency":
      g.regime.type = g.regime.type === "dictatorship" ? "dictatorship" : "emergency";
      g.regime.electionsSuspended = true;
      g.regime.legitimacy = clamp(g.regime.legitimacy - 12, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest + 6, 0, 100);
      c.approval = clamp(c.approval - 4, 5, 95);
      log.push("Emergency proclaimed. Elections are suspended and ordinances replace bills.");
      break;
    case "restore":
      g.regime.type = "democracy";
      g.regime.electionsSuspended = false;
      g.regime.secretPolice = clamp(g.regime.secretPolice - 40, 0, 100);
      g.regime.pressFreedom = clamp(g.regime.pressFreedom + 20, 0, 100);
      g.regime.legitimacy = clamp(g.regime.legitimacy + 14, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest - 10, 0, 100);
      c.approval = clamp(c.approval + 8, 5, 95);
      g.sanctions = clamp(g.sanctions - 10, 0, 100);
      log.push("Constitutional order restored. Elections are back on the calendar.");
      break;
    case "censor": {
      const d = clamp(Math.round(level), 5, 40);
      g.regime.pressFreedom = clamp(g.regime.pressFreedom - d, 0, 100);
      g.regime.legitimacy = clamp(g.regime.legitimacy - d * 0.2, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest - d * 0.3, 0, 100);
      log.push(`Press controls tightened by ${d}. Scandals are far less likely to reach the front page.`);
      break;
    }
    case "secret": {
      const d = clamp(Math.round(level), 5, 100);
      const cost = round(d * c.gdp * 0.000002, 0);
      if (g.treasury < cost) {
        log.push(`An internal security apparatus of that size costs ${formatINR(cost)} to stand up.`);
        break;
      }
      g.treasury -= cost;
      g.defence.budget = round(g.defence.budget + cost * 0.1, 0);
      g.regime.secretPolice = clamp(g.regime.secretPolice + d, 0, 100);
      g.regime.legitimacy = clamp(g.regime.legitimacy - d * 0.35, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest - d * 0.6, 0, 100);
      log.push(`Internal security raised to ${Math.round(g.regime.secretPolice)} for ${formatINR(cost)}. Unrest falls; legitimacy falls faster.`);
      break;
    }
    case "dissolve":
      g.regime.electionsSuspended = true;
      g.regime.legitimacy = clamp(g.regime.legitimacy - 18, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest + 10, 0, 100);
      for (const party of state.world.parties) if (party.countryId === c.id && party.id !== state.player.politics.partyId) party.seats = Math.round(party.seats * 0.6);
      c.approval = clamp(c.approval - 6, 5, 95);
      log.push("The chamber is dissolved. Opposition seats cut by forty per cent — nobody consented.");
      break;
    case "dictator": {
      const sec = g.regime.secretPolice;
      const pop = state.player.politics.popularity;
      const ready =
        (g.regime.type === "emergency" || g.regime.type === "dictatorship") &&
        sec >= 45 &&
        (pop >= 50 || (state.player.politics as unknown as { fullPower?: boolean }).fullPower);
      if (!ready) {
        log.push("Not yet: you need emergency powers, internal security at 45+, and either popularity 50+ or full power (security 80+ with popularity 62+).");
        return;
      }
      g.regime.type = "dictatorship";
      g.regime.electionsSuspended = true;
      g.regime.legitimacy = clamp(g.regime.legitimacy - 22, 0, 100);
      g.regime.unrest = clamp(g.regime.unrest + 12, 0, 100);
      g.sanctions = clamp(g.sanctions + 20, 0, 100);
      c.approval = clamp(c.approval + 6, 5, 95);
      c.government = "guided";
      pushLog(g.log, dt(state), "Constitutional order replaced by personal rule.");
      log.push("You rule by decree. Every law passes, every election is cancelled — and the coup clock starts now.");
      news(state, `${c.name} moves to personal rule`, "The constitution is suspended indefinitely. Decrees replace legislation.", "politics", c.id, "Sanctions, unrest and coup risk all rise; approval among your base jumps.");
      timeline(state, "Assumed personal rule.", "politics");
      history(state, "gov", "Personal rule proclaimed");
      unlock(state, "dictator");
      break;
    }
    case "amnesty": {
      const cost = round(c.gdp * 0.0001, 0);
      if (g.treasury < cost) {
        log.push(`A general amnesty and compensation package costs ${formatINR(cost)}.`);
        break;
      }
      g.treasury -= cost;
      g.regime.unrest = clamp(g.regime.unrest - 20, 0, 100);
      g.regime.legitimacy = clamp(g.regime.legitimacy + 12, 0, 100);
      c.approval = clamp(c.approval + 6, 5, 95);
      g.corruption = clamp(g.corruption - 8, 0, 100);
      log.push(`Amnesty and compensation: ${formatINR(cost)}. Unrest −20, legitimacy +12.`);
      break;
    }
    case "purge": {
      g.regime.unrest = clamp(g.regime.unrest - 14, 0, 100);
      g.regime.legitimacy = clamp(g.regime.legitimacy - 10, 0, 100);
      g.regime.secretPolice = clamp(g.regime.secretPolice + 8, 0, 100);
      c.approval = clamp(c.approval - 4, 5, 95);
      g.sanctions = clamp(g.sanctions + 6, 0, 100);
      for (const pol of state.world.politicians) if (pol.countryId === c.id && !pol.player) pol.scandal = clamp(pol.scandal + 10, 0, 100);
      log.push("Officers and officials replaced with loyalists. Unrest falls for now; the file on you grows.");
      break;
    }
    case "referendum": {
      const cost = round(c.gdp * 0.00005, 0);
      if (g.treasury < cost) {
        log.push(`A national referendum costs ${formatINR(cost)} to run.`);
        break;
      }
      g.treasury -= cost;
      const win = clamp(c.approval + 10 + normal(R(state), 0, 8), 0, 100) > 50;
      if (win) {
        g.regime.legitimacy = clamp(g.regime.legitimacy + 18, 0, 100);
        g.regime.unrest = clamp(g.regime.unrest - 12, 0, 100);
        c.approval = clamp(c.approval + 4, 5, 95);
        log.push(`The referendum carried: ${formatINR(cost)} bought you legitimacy +18 and a mandate.`);
      } else {
        g.regime.legitimacy = clamp(g.regime.legitimacy - 12, 0, 100);
        g.regime.unrest = clamp(g.regime.unrest + 10, 0, 100);
        log.push(`You called a referendum and lost it. Legitimacy −12, and everyone saw the numbers.`);
      }
      break;
    }
  }
  pushLog(g.log, dt(state), `Regime: ${move}.`);
}

/* ----------------------------------------------------------------- tick */

export function tickStatecraft(state: GameState) {
  const g = getGov(state);
  const c = state.world.countries.find((x) => x.id === g.countryId) ?? state.world.countries[0]!;
  const ruling = canRule(state);

  // --- permanent growth bonus bought with finished infrastructure
  if (g.growthBonus) c.gdpGrowth = clamp(c.gdpGrowth + g.growthBonus / 12, -8, 12);

  let revenue = round(discretionaryShare(c) * (ruling ? 1 : 0.35), 0);
  let spending = 0;

  // --- company levies, subsidies and state enterprises
  for (const co of state.world.companies) {
    const lv = g.levies[co.id];
    if (!lv || co.countryId !== c.id) continue;
    const turnover = Math.max(0, co.revenue) / 12;
    if (lv.kind === "levy") {
      const got = round(turnover * (lv.rate / 100), 0);
      g.treasury += got;
      revenue += got;
      lv.collected += got;
      g.stats.levied += got;
      co.cash = round(co.cash - got, 0);
    } else if (lv.kind === "subsidy") {
      const pay = round(turnover * (lv.rate / 100), 0);
      spending += pay;
      co.cash = round(co.cash + pay, 0);
      lv.collected -= pay;
    } else if (lv.kind === "nationalised") {
      const div = round(Math.max(0, co.profit) / 12 * 0.8, 0);
      if (div > 0) {
        g.treasury += div;
        revenue += div;
        lv.collected += div;
        co.cash = round(co.cash - div, 0);
      }
    }
  }

  // --- tribute in and out
  for (const t of [...g.tribute]) {
    g.treasury += t.monthly;
    if (t.monthly >= 0) {
      revenue += t.monthly;
      g.stats.tributeIn += t.monthly;
    } else {
      spending += -t.monthly;
      g.stats.tributeOut += -t.monthly;
    }
    if (t.months > 0) {
      t.months -= 1;
      if (t.months <= 0) {
        g.tribute = g.tribute.filter((x) => x !== t);
        pushLog(g.log, dt(state), `${t.label} has ended.`);
      }
    }
  }

  // --- schemes
  for (const s of g.schemes) {
    if (s.countryId !== c.id) continue;
    const cost = schemeQuote(state, s.kind, s.funding).monthlyCost;
    s.monthlyCost = cost;
    s.months += 1;
    s.totalSpent += cost;
    spending += cost;
    const e = SCHEME_DEFS[s.kind].effects;
    const f = s.funding / 100;
    if (e.approval) c.approval = clamp(c.approval + e.approval * f, 5, 95);
    if (e.unemployment) c.unemployment = clamp(c.unemployment + e.unemployment * f, 2, 22);
    if (e.health) c.healthcareIndex = clamp(c.healthcareIndex + e.health * f, 10, 99);
    if (e.education) c.educationIndex = clamp(c.educationIndex + e.education * f, 10, 99);
    if (e.tech) c.techLevel = clamp(c.techLevel + e.tech * f, 0, 100);
    if (e.business) c.businessFreedom = clamp(c.businessFreedom + e.business * f, 15, 98);
    if (e.housing) c.housingIndex = clamp(c.housingIndex + e.housing * f, 10, 99);
    if (e.inflation) c.inflation = clamp(c.inflation + e.inflation * f, -1, 18);
    if (e.growth) g.growthBonus = round(g.growthBonus + e.growth * f * 0.02, 3);
    if (e.unrest) g.regime.unrest = clamp(g.regime.unrest + e.unrest * f, 0, 100);
  }

  // --- infrastructure
  for (const pj of [...g.projects]) {
    const draw = round(pj.budget / Math.max(1, pj.months), 0);
    if (g.treasury >= draw) {
      g.treasury -= draw;
      pj.spent += draw;
      g.stats.invested += draw;
      spending += draw;
      pj.stalledMonths = 0;
      pj.stage = "building";
      const step = 100 / Math.max(1, pj.months);
      const slip = chance_(state, 0.08) ? 0.2 : 1;
      pj.progress = clamp(pj.progress + step * slip, 0, 100);
      if (pj.progress >= 100) finishInfra(state, pj);
    } else {
      pj.stalledMonths += 1;
      pj.stage = "stalled";
      if (pj.stalledMonths === 1 || pj.stalledMonths % 6 === 0) {
        note(state, `${pj.name} has stalled — the treasury could not pay the ${formatINR(draw)} monthly draw.`, "bad");
        c.approval = clamp(c.approval - 1.5, 5, 95);
      }
    }
  }

  // --- defence
  const defenceSpend = round(g.defence.budget, 0);
  spending += defenceSpend;
  const funded = clamp(g.defence.budget / Math.max(1, c.revenue * 0.03), 0, 3);
  g.defence.readiness = clamp(g.defence.readiness + (funded - 1) * 1.5 + 0.2, 0, 100);
  g.defence.equipment = clamp(g.defence.equipment - 0.08 + funded * 0.05, 0, 100);
  g.defence.personnel = clamp(g.defence.personnel + (g.regime.type === "dictatorship" ? 0.1 : 0) - 0.02, 0, 100);

  // --- wars
  for (const w of g.wars) {
    if (w.status !== "active") continue;
    const e = state.world.countries.find((x) => x.id === w.enemyId);
    if (!e) {
      w.status = "settled";
      continue;
    }
    const our = militaryPower(state, c, g, false) * (1 - w.exhaustion / 250);
    const theirs = militaryPower(state, e, g, true) * (1 + 0.08);
    w.ourStrength = round(our, 0);
    w.enemyStrength = round(theirs, 0);
    const ratio = our / Math.max(1, our + theirs);
    const swing =
      (ratio - 0.5) * 22 + normal(R(state), 0, 5) + (w.intensity - 2) * 2.5 - w.exhaustion * 0.12 + (g.regime.type === "dictatorship" ? 1.5 : 0);
    w.front = clamp(w.front + swing, -100, 100);
    w.occupation = clamp((w.front + 100) / 2, 0, 100);
    const ourLoss = Math.round(c.population * 0.00002 * w.intensity * (0.5 + theirs / Math.max(1, our + theirs)));
    const theirLoss = Math.round(e.population * 0.00002 * w.intensity * (0.5 + our / Math.max(1, our + theirs)));
    w.ourCasualties += ourLoss;
    w.theirCasualties += theirLoss;
    const cost = warCost(state, c, w.intensity);
    spending += cost;
    w.spend += cost;
    w.exhaustion = clamp(w.exhaustion + 1.2 + w.intensity * 0.5 - g.regime.secretPolice * 0.02, 0, 100);
    c.approval = clamp(c.approval - (0.4 * w.intensity + ourLoss / Math.max(1, c.population) * 4000), 5, 95);
    c.unemployment = clamp(c.unemployment - 0.05 * w.intensity, 2, 22);
    g.regime.unrest = clamp(g.regime.unrest + 0.6 * w.intensity + w.exhaustion * 0.02, 0, 100);
    if (swing > 6) {
      c.approval = clamp(c.approval + 2, 5, 95);
      w.battles.unshift({ t: dt(state), text: `Breakthrough — ${e.name}'s line gives way.`, swing: round(swing, 1), ourLoss, theirLoss });
    } else if (swing < -6) {
      w.battles.unshift({ t: dt(state), text: `${e.name} pushes the front back.`, swing: round(swing, 1), ourLoss, theirLoss });
    } else {
      w.battles.unshift({ t: dt(state), text: "Static front — artillery and patrols.", swing: round(swing, 1), ourLoss, theirLoss });
    }
    if (w.battles.length > 40) w.battles.length = 40;
    if (w.front >= 100) resolveWar(state, w);
    else if (w.front <= -100) resolveWar(state, w);
    else if (w.exhaustion >= 100 && chance_(state, 0.12)) {
      w.outcome = "Exhaustion forced a settlement.";
      settle(state, w, []);
    }
  }

  // --- debt service
  for (const d of [...g.debt]) {
    const interest = round((d.remaining * (d.rate / 100)) / 12, 0);
    const instalment = Math.max(interest, Math.min(d.remaining, d.monthly));
    spending += instalment;
    d.remaining = round(Math.max(0, d.remaining - (instalment - interest)), 0);
    if (d.remaining <= 1) {
      g.debt = g.debt.filter((x) => x.id !== d.id);
      pushLog(g.log, dt(state), `Repaid the ${d.lender} line of ${formatINR(d.principal)}.`);
    }
  }

  // --- your loans from the state
  for (const l of [...g.loans]) {
    const pay = Math.min(l.remaining, l.monthly);
    const got = spendUpTo(state.player, pay, "State loan instalment", "gov", dt(state));
    bizFlow(state, "govRepay", -got.paid);
    g.treasury += got.paid;
    g.stats.repaid += got.paid;
    l.remaining = round(l.remaining - got.paid, 0);
    if (got.short > 0) {
      l.remaining = round(l.remaining + got.short * 0.02, 0);
      note(state, `You missed part of a state loan instalment (${formatINR(got.short)} short). The auditor general has been informed.`, "warn");
      g.corruption = clamp(g.corruption + 2, 0, 100);
      c.approval = clamp(c.approval - 1, 5, 95);
    }
    if (l.remaining <= 1) g.loans = g.loans.filter((x) => x.id !== l.id);
  }

  // --- sanctions, corruption, regime drift
  if (g.sanctions > 0) {
    const hit = g.sanctions / 100;
    c.gdpGrowth = clamp(c.gdpGrowth - hit * 0.6, -8, 12);
    c.tradeBalance -= c.gdp * 0.00002 * hit;
    g.sanctions = clamp(g.sanctions - 0.6, 0, 100);
  }
  g.corruption = clamp(g.corruption - 0.15, 0, 100);
  if (g.corruption > 40) c.approval = clamp(c.approval - (g.corruption - 40) * 0.01, 5, 95);

  const pressHit = (100 - g.regime.pressFreedom) / 100;
  const target =
    clamp(
      18 +
        (55 - c.approval) * 1.1 +
        (60 - g.regime.legitimacy) * 0.6 +
        (g.regime.electionsSuspended ? 12 : 0) +
        g.sanctions * 0.18 +
        g.wars.filter((w) => w.status === "active").reduce((s, w) => s + 4 + w.exhaustion * 0.15, 0) -
        g.regime.secretPolice * 0.5 -
        pressHit * 6,
      0,
      100,
    );
  g.regime.unrest = clamp(g.regime.unrest * 0.88 + target * 0.12, 0, 100);
  if (g.regime.electionsSuspended) g.regime.legitimacy = clamp(g.regime.legitimacy - 0.4, 0, 100);
  else g.regime.legitimacy = clamp(g.regime.legitimacy + 0.25, 0, 100);
  g.regime.pressFreedom = clamp(g.regime.pressFreedom + (g.regime.electionsSuspended ? -0.2 : 0.4), 0, 100);
  g.regime.since += 1;

  // --- the coup clock
  const coupChance = clamp((g.regime.unrest - 62) * 0.004 + (45 - g.regime.legitimacy) * 0.003, 0, 0.12);
  if (ruling && coupChance > 0 && chance_(state, coupChance)) {
    g.regime.coups += 1;
    pushDecision(state, "coup", "The generals are moving", `Unrest ${Math.round(g.regime.unrest)}, legitimacy ${Math.round(g.regime.legitimacy)}. There are troops at the broadcast centre and your name is on a list.`, [
      { id: "crackdown", label: "Order a crackdown", hint: "Unrest −20, legitimacy −20, blood on the record" },
      { id: "concessions", label: "Offer concessions", hint: "Legitimacy +10, treasury −, you keep the chair for now" },
      { id: "flee", label: "Leave the country", hint: "You lose office and the state; wealth intact" },
    ]);
  }

  // --- books
  g.treasury = round(g.treasury + revenue - spending, 0);
  if (g.treasury < 0) {
    // forced borrowing at a punishing rate
    const short = -g.treasury;
    g.debt.push({
      id: uid("gd"),
      lender: "central",
      principal: short,
      remaining: short,
      rate: clamp(c.interestRate + 6, 2, 30),
      monthly: round((short * ((c.interestRate + 6) / 100)) / 12 + short / 24, 0),
      term: 24,
    });
    g.treasury = 0;
    c.approval = clamp(c.approval - 2, 5, 95);
    if (chance_(state, 0.25))
      note(state, `The treasury could not cover ${formatINR(short)} of obligations. The central bank covered it at a penalty rate.`, "bad");
  }
  g.monthly = { revenue: round(revenue, 0), spending: round(spending, 0), net: round(revenue - spending, 0) };
  g.history.push({ t: dt(state), treasury: round(g.treasury, 0), approval: round(c.approval, 1), growth: round(c.gdpGrowth, 2) });
  if (g.history.length > 240) g.history.splice(0, g.history.length - 240);
}

function chance_(state: GameState, p: number) {
  return rng(state) < p;
}

/** Resolving the coup / defeat decisions raised by this module. */
export function resolveStatecraft(state: GameState, kind: string, opt: string, log: string[]): boolean {
  const g = getGov(state);
  const c = state.world.countries.find((x) => x.id === g.countryId)!;
  if (kind !== "coup") return false;
  if (opt === "crackdown") {
    g.regime.unrest = clamp(g.regime.unrest - 20, 0, 100);
    g.regime.legitimacy = clamp(g.regime.legitimacy - 20, 0, 100);
    g.regime.secretPolice = clamp(g.regime.secretPolice + 15, 0, 100);
    c.approval = clamp(c.approval - 10, 5, 95);
    g.sanctions = clamp(g.sanctions + 15, 0, 100);
    state.player.crime.heat = clamp(state.player.crime.heat + 15, 0, 100);
    log.push("The crackdown holds — for now. Legitimacy −20, sanctions +15.");
  } else if (opt === "concessions") {
    const cost = round(Math.max(c.gdp * 0.0008, g.treasury * 0.3), 0);
    g.treasury = Math.max(0, g.treasury - cost);
    g.regime.legitimacy = clamp(g.regime.legitimacy + 10, 0, 100);
    g.regime.unrest = clamp(g.regime.unrest - 12, 0, 100);
    log.push(`Concessions worth ${formatINR(cost)} bought you time.`);
  } else if (opt === "flee") {
    state.player.politics.role = "none";
    state.player.politics.office = "In exile";
    state.player.politics.popularity = clamp(state.player.politics.popularity - 30, 0, 95);
    g.regime.type = "democracy";
    g.regime.electionsSuspended = false;
    for (const lv of Object.keys(g.levies)) delete g.levies[lv];
    g.wars = g.wars.map((w) => ({ ...w, status: w.status === "active" ? "settled" : w.status }));
    c.headOfGov = "Provisional Authority";
    c.approval = clamp(c.approval - 20, 5, 95);
    log.push("You left. The state you built carries on without you — and so does the file.");
    timeline(state, "Forced out of office and left the country.", "politics");
    news(state, `${c.name}: government falls`, `${state.player.name} has left the country. A provisional authority has taken over.`, "politics", c.id, "You keep your money, not your power.");
  }
  return true;
}

/** Everything the panel needs, computed from state. */
export function govSummary(state: GameState) {
  const g = getGov(state);
  const c = state.world.countries.find((x) => x.id === g.countryId) ?? state.world.countries[0]!;
  const active = g.wars.filter((w) => w.status === "active");
  const schemeCost = g.schemes.reduce((s, x) => s + x.monthlyCost, 0);
  const projectCost = g.projects.filter((p) => p.stage !== "done").reduce((s, p) => s + p.budget / Math.max(1, p.months), 0);
  const debtService = g.debt.reduce((s, d) => s + d.monthly, 0);
  return {
    country: c,
    gov: g,
    ruling: canRule(state),
    treasury: round(g.treasury, 0),
    revenue: round(discretionaryShare(c), 0),
    schemeCost: round(schemeCost, 0),
    projectCost: round(projectCost, 0),
    debtService: round(debtService, 0),
    debtRatio: c.debt / Math.max(1, c.gdp),
    warCost: round(active.reduce((s, w) => s + warCost(state, c, w.intensity), 0), 0),
    activeWars: active,
    power: round(militaryPower(state, c, g, false), 0),
    liquid: round(liquidCash(state.player), 0),
  };
}
