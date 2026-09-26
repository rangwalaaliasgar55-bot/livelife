// The "run it for real" layer: company HQs, your own bank, brokerage firms,
// casino operations, property management & development, taxes, benefits, the
// AI-shaped job market and gifts. Everything lives on `state.biz` so older
// saves simply grow the object on first touch.
import type { GameState } from "./types";
import { getAdv } from "./advanced";
import { money } from "./finance";
import { round } from "./util";

/* ------------------------------------------------------------ company HQ */

export type RoleId = "eng" | "sales" | "ops" | "mgmt";
export type PayLevel = "below" | "market" | "above";
export type Strategy = "steady" | "aggressive" | "lean" | "premium";

export interface CompanyHQ {
  roles: Record<RoleId, { count: number; target: number }>;
  /** AI agent seats doing the automatable part of each role. */
  agents: Record<Exclude<RoleId, "mgmt">, number>;
  pay: PayLevel;
  morale: number;
  strategy: Strategy;
  /** Share of each month's profit paid out to shareholders. */
  payout: number;
  /** Extra cities the company sells into. */
  markets: { cityId: string; since: number; ramp: number }[];
  /** Revenue a fully productive worker can carry, per year. */
  rpe: number;
  /** Months of merger integration left and its drag. */
  integration: { months: number; drag: number; name: string } | null;
  /** AI-lab controls (AI companies). */
  lab: { training: number; cluster: "cloud" | "owned"; gpus: number } | null;
  layoffScar: number;
  lastReport: HQReport | null;
  log: { t: string; text: string }[];
  corpDecisionTick: number;
  /** Last month a cash-crunch decision was raised. */
  crunchTick?: number;
  /** CEO auto-manage whole company (free CEO) — hires, pay, agents, expansions, suggestions */
  ceoAuto?: boolean;
  /** Auto-employ: CEO keeps headcount at optimal without manual targets */
  autoHire?: boolean;
  /** Auto-buy: CEO auto-acquires best affordable target each quarter when cash allows */
  autoBuy?: boolean;
  /** Months in a row payroll bounced. */
  bounced?: number;
  disruption?: { months: number; hit: number };
  boost?: { months: number; mult: number };
}

export interface HQReport {
  t: string;
  revenue: number;
  capacity: number;
  demand: number;
  payroll: number;
  hiring: number;
  aiBill: number;
  cogs: number;
  marketing: number;
  rd: number;
  strategy: number;
  expansion: number;
  interest: number;
  tax: number;
  profit: number;
  payout: number;
  headcount: number;
  attrition: number;
  hires: number;
  effective: number;
}

/* ------------------------------------------------------------ finance firms */

export interface BankOps {
  depositRate: number;
  lendingRate: number;
  /** 0 = only prime borrowers, 100 = lend to anyone. */
  risk: number;
  staff: number;
  marketing: number;
  dividendPct: number;
  trust: number;
  warnings: number;
  last: {
    t: string;
    nii: number;
    fees: number;
    opex: number;
    chargeoffs: number;
    tax: number;
    net: number;
    dividend: number;
    capitalRatio: number;
    depositFlow: number;
    loanFlow: number;
  } | null;
  history: {
    t: string;
    capital: number;
    deposits: number;
    loans: number;
    net: number;
  }[];
  /** Rates follow the market automatically until you set them by hand. */
  auto?: boolean;
  /** When true, bank marketing auto-scales with deposits/branches. */
  marketingAuto?: boolean;
  /** CEO auto-pilot for the bank (like Company HQ) — keeps trust & ratio healthy. */
  ceoAuto?: boolean;
}

export type BrokerTier = "junior" | "senior" | "star";

export interface Brokerage {
  id: string;
  name: string;
  cityId: string;
  countryId: string;
  brokers: Record<BrokerTier, number>;
  analysts: number;
  compliance: number;
  platform: number; // 0-100 tech quality
  commissionBps: number; // per trade
  mgmtFee: number; // % per year on managed AUM
  clients: number;
  aum: number;
  reputation: number;
  marketing: number;
  cash: number;
  last: {
    t: string;
    commissions: number;
    fees: number;
    payroll: number;
    bonus: number;
    tech: number;
    other: number;
    net: number;
  } | null;
  history: { t: string; aum: number; clients: number; net: number }[];
  founded: number;
}

export interface PersonalBroker {
  tier: BrokerTier;
  name: string;
  skill: number;
  fee: number; // % of AUM per year
  perfFee: number; // % of gains above a high-water mark
  value: number;
  contributed: number;
  withdrawn: number;
  highWater: number;
  risk: "careful" | "balanced" | "aggressive";
  history: { t: string; value: number; ret: number }[];
  since: number;
}

export interface FixedDeposit {
  id: string;
  bankId: string;
  bankName: string;
  principal: number;
  rate: number;
  months: number;
  start: number; // tick
  accrued: number;
}

/* ------------------------------------------------------------ casino ops */

export type TableGame = "blackjack" | "roulette" | "baccarat" | "poker" | "craps" | "bigsix";

export interface CasinoOps {
  tables: Record<TableGame, number>;
  slots: number;
  minBet: number;
  maxBet: number;
  /** Slot hold %. Tables follow their rules. */
  slotHold: number;
  staff: {
    dealers: number;
    security: number;
    pit: number;
    hosts: number;
    cashiers: number;
    surveillance: number;
  };
  comps: number; // % of theoretical win returned as comps
  vip: boolean;
  hotelRooms: number;
  marketing: number; // ₹ per month
  licence: "standard" | "premium";
  reputation: number;
  last: CasinoMonth | null;
  history: {
    t: string;
    handle: number;
    ggr: number;
    net: number;
    visits: number;
  }[];
  whales: { t: string; name: string; result: number }[];
  cheats: number;
  /** A tournament or festival: months left and the visit multiplier. */
  boost?: { months: number; mult: number; label: string };
  /** VIP junket programme (0–100): whale flow, and whale variance. */
  junket?: number;
  /** Dealer and floor training (0–100): service up, incidents down. */
  training?: number;
  /** Online licence — a permanent second floor that never closes. */
  online?: boolean;
  /** Luxury suites above the ordinary rooms. */
  suites?: number;
  /** Book value of the building, fit-out and machines. */
  assetValue?: number;
  log?: { t: string; text: string }[];
}

export interface CasinoMonth {
  t: string;
  visits: number;
  handle: number;
  theo: number;
  ggr: number;
  byGame: Record<string, { handle: number; win: number }>;
  hotel: number;
  fnb: number;
  /** Net of the online floor (revenue less its costs and tax). */
  online?: number;
  payroll: number;
  comps: number;
  gamingTax: number;
  licence: number;
  marketing: number;
  upkeep: number;
  incidents: number;
  net: number;
  note: string;
}

/* ------------------------------------------------------------ estates */

export type ManagerTier = "none" | "basic" | "premium";

export interface EstateOps {
  manager: ManagerTier;
  tenant: {
    name: string;
    quality: number;
    since: number;
    lease: number;
    arrears: number;
  } | null;
  vacancyMonths: number;
  listed: "rent" | "sale" | "off";
  askPrice: number;
  /** A development project run by a hired developer. */
  project: DevProject | null;
  units: {
    built: number;
    sold: number;
    leased: number;
    unitValue: number;
    unitRent: number;
  } | null;
  log: { t: string; text: string }[];
  lastMonth: { rent: number; fee: number; repairs: number; net: number } | null;
  /** When true, rent auto-tracks market and developer/title upkeep is fully handled. */
  autoRent?: boolean;
  fullAuto?: boolean;
}

export interface DevProject {
  kind: "apartments" | "offices" | "mall" | "villas" | "hotel";
  developer: "budget" | "reputable" | "premium";
  units: number;
  budget: number;
  spent: number;
  progress: number;
  months: number;
  quality: number;
  stage: "permits" | "construction" | "finishing" | "done";
  delays: number;
  overrun: number;
}

/* ------------------------------------------------- developer firm (portfolio) */

/** One developer for the whole portfolio: every site, maximum profit. */
export interface DevFirm {
  /** Which builder does the work across every property you own. */
  tier: DevProject["developer"];
  /** Auto-develop every site that stands still: pick the best scheme, file it,
   *  pay the deposit and the monthly draws, then dispose of the units. */
  auto: boolean;
  /** true = always build the scheme with the highest projected profit;
   *  false = stick to the chosen kind. */
  maximize: boolean;
  /** What the developer does with finished units. */
  exit: "sell" | "lease";
  /** Reinvest sale proceeds into the next site automatically. */
  reinvest: boolean;
  /** Keep developing even occupied plots (the developer buys out tenants). */
  redevelop: boolean;
  /** Counters for the panel. */
  built: number;
  invested: number;
  proceeds: number;
}

/* ------------------------------------------------------------ government */

export type InfraKind =
  | "highway"
  | "rail"
  | "port"
  | "airport"
  | "power"
  | "water"
  | "hospital"
  | "school"
  | "broadband"
  | "industrial"
  | "smartcity"
  | "stadium";

export type SchemeKind =
  | "housing"
  | "jobs"
  | "food"
  | "pension"
  | "health"
  | "education"
  | "farmer"
  | "digital"
  | "childcare"
  | "green";

export type LawKind =
  | "corp_tax_cut"
  | "corp_tax_hike"
  | "income_tax_cut"
  | "labour_reform"
  | "land_reform"
  | "press_law"
  | "emergency"
  | "conscription"
  | "nationalisation"
  | "privatisation"
  | "deregulation"
  | "antitrust"
  | "immigration_open"
  | "central_bank"
  | "term_limits"
  | "digital_id"
  | "health_service";

export type RegimeType = "democracy" | "dominant" | "emergency" | "dictatorship";

export interface GovProject {
  id: string;
  kind: InfraKind;
  name: string;
  cityId: string;
  countryId: string;
  budget: number;
  spent: number;
  progress: number;
  months: number;
  scale: number;
  quality: number;
  stage: "building" | "stalled" | "done";
  stalledMonths: number;
  startYear: number;
  startMonth: number;
}

export interface GovScheme {
  id: string;
  kind: SchemeKind;
  countryId: string;
  /** 0–100: how hard you fund it. Cost and effect both scale with this. */
  funding: number;
  monthlyCost: number;
  months: number;
  totalSpent: number;
}

export interface GovLaw {
  id: string;
  kind: LawKind;
  name: string;
  countryId: string;
  year: number;
  month: number;
  support: number;
}

export interface CompanyLevy {
  /** levy = extra tax on turnover, subsidy = paid from treasury,
   *  exempt = no corporate tax at all, nationalised = the state owns it. */
  kind: "levy" | "subsidy" | "exempt" | "nationalised";
  /** % of turnover for a levy/subsidy. */
  rate: number;
  collected: number;
  /** Price paid when the state took it over. */
  bookValue?: number;
}

export interface GovDebt {
  id: string;
  lender: "market" | "central" | "concord" | "player";
  principal: number;
  remaining: number;
  rate: number;
  monthly: number;
  term: number;
}

/** Money you borrowed from the state treasury, on your own signature. */
export interface GovPlayerLoan {
  id: string;
  principal: number;
  remaining: number;
  rate: number;
  monthly: number;
  term: number;
}

export interface WarBattle {
  t: string;
  text: string;
  swing: number;
  ourLoss: number;
  theirLoss: number;
}

export interface WarState {
  id: string;
  enemyId: string;
  countryId: string;
  objective: "reparations" | "annex" | "regime" | "resources";
  /** 1 = limited, 2 = full, 3 = total war. */
  intensity: 1 | 2 | 3;
  /** −100 = they are at our gates, +100 = we hold their capital. */
  front: number;
  occupation: number;
  ourStrength: number;
  enemyStrength: number;
  ourCasualties: number;
  theirCasualties: number;
  exhaustion: number;
  spend: number;
  startYear: number;
  startMonth: number;
  status: "active" | "won" | "lost" | "settled";
  outcome: string;
  battles: WarBattle[];
}

export interface GovTribute {
  fromId: string;
  /** Negative = we are the ones paying. */
  monthly: number;
  months: number;
  label: string;
}

export interface GovState {
  countryId: string;
  /** The state's own fund: taxes, your injections, borrowing, tribute. */
  treasury: number;
  projects: GovProject[];
  schemes: GovScheme[];
  laws: GovLaw[];
  levies: Record<string, CompanyLevy>;
  debt: GovDebt[];
  loans: GovPlayerLoan[];
  wars: WarState[];
  tribute: GovTribute[];
  defence: {
    /** ₹ per month voted to the military. */
    budget: number;
    readiness: number;
    equipment: number;
    personnel: number;
  };
  regime: {
    type: RegimeType;
    electionsSuspended: boolean;
    pressFreedom: number;
    secretPolice: number;
    legitimacy: number;
    unrest: number;
    coups: number;
    since: number;
  };
  /** 0–100: how hard the world is sanctioning you. */
  sanctions: number;
  /** Paper over the state's books; rises when you raid the treasury. */
  corruption: number;
  /** Permanent gdpGrowth bonus bought with completed infrastructure. */
  growthBonus: number;
  stats: {
    injected: number;
    borrowed: number;
    repaid: number;
    invested: number;
    levied: number;
    tributeIn: number;
    tributeOut: number;
    built: number;
    warsWon: number;
    warsLost: number;
    annexed: string[];
  };
  monthly: { revenue: number; spending: number; net: number } | null;
  history: { t: string; treasury: number; approval: number; growth: number }[];
  log: { t: string; text: string }[];
}

/* ------------------------------------------------------------ taxes */

export interface TaxBook {
  year: number;
  salary: number;
  withheld: number;
  freelance: number;
  rent: number;
  interest: number;
  dividends: number;
  business: number;
  gains: number;
  gambling: number;
  other: number;
  lastFlowT: string;
}

export interface TaxReturn {
  year: number;
  income: number;
  due: number;
  paid: number;
  choice: string;
  audited: boolean;
  penalty: number;
  status: "filed" | "late" | "audit" | "settled" | "evaded";
}

export interface BizQueueItem {
  due: number;
  kind: string;
  data: Record<string, string | number>;
}

export interface BizState {
  hq: Record<string, CompanyHQ>;
  banks: Record<string, BankOps>;
  brokerages: Brokerage[];
  broker: PersonalBroker | null;
  fds: FixedDeposit[];
  casinos: Record<string, CasinoOps>;
  estates: Record<string, EstateOps>;
  tax: TaxBook;
  returns: TaxReturn[];
  taxDebt: number;
  queue: BizQueueItem[];
  benefits: {
    unemployment: boolean;
    since: number;
    paid: number;
    pension: number;
  };
  certs: string[];
  aiJobsLost: number;
  jobsTick: number;
  gifts: { t: string; to: string; what: string; value: number }[];
  /** One developer for every property you own (portfolio-level automation). */
  devFirm?: DevFirm;
  /** The machinery of government, when you hold the country. */
  gov?: GovState;
}

export function blankTax(year: number): TaxBook {
  return {
    year,
    salary: 0,
    withheld: 0,
    freelance: 0,
    rent: 0,
    interest: 0,
    dividends: 0,
    business: 0,
    gains: 0,
    gambling: 0,
    other: 0,
    lastFlowT: "",
  };
}

export function getBiz(state: GameState): BizState {
  const s = state as GameState & { biz?: BizState };
  if (!s.biz) {
    s.biz = {
      hq: {},
      banks: {},
      brokerages: [],
      broker: null,
      fds: [],
      casinos: {},
      estates: {},
      tax: blankTax(state.time.year),
      returns: [],
      taxDebt: 0,
      queue: [],
      benefits: { unemployment: false, since: 0, paid: 0, pension: 0 },
      certs: [],
      aiJobsLost: 0,
      jobsTick: 0,
      gifts: [],
    };
  }
  const b = s.biz;
  b.hq ??= {};
  b.banks ??= {};
  b.brokerages ??= [];
  b.fds ??= [];
  b.casinos ??= {};
  b.estates ??= {};
  b.tax ??= blankTax(state.time.year);
  b.returns ??= [];
  b.queue ??= [];
  b.benefits ??= { unemployment: false, since: 0, paid: 0, pension: 0 };
  b.certs ??= [];
  b.gifts ??= [];
  b.devFirm ??= { tier: "reputable", auto: false, maximize: true, exit: "sell", reinvest: true, redevelop: false, built: 0, invested: 0, proceeds: 0 };
  return b;
}

/** Post a named line into this month's cash-flow report. */
export function bizFlow(state: GameState, key: string, amount: number) {
  const mf = getAdv(state).monthFlow;
  if (mf && amount) mf.flows[key] = round(money(mf.flows[key]) + amount, 2);
}

export function bizQueue(state: GameState, months: number, kind: string, data: Record<string, string | number> = {}) {
  getBiz(state).queue.push({
    due: state.ticks + Math.max(1, Math.round(months)),
    kind,
    data,
  });
}

export function pushLog(arr: { t: string; text: string }[], t: string, text: string, cap = 30) {
  arr.unshift({ t, text });
  if (arr.length > cap) arr.length = cap;
}
