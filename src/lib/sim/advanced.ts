// Advanced simulation layers: goals, forecasts, research, advisors & delegation,
// auctions, credit ratings, lifetime stats, ledger, year-end reviews, challenges,
// economic calendar, decision analysis ("what should I do?"), and biographies.
//
// Everything here reads/writes the single authoritative GameState and is settled
// inside tickAdvanced(), called once per simulated month from the engine.
import { history, note, timeline, unlock } from "./feed";
import { companyRating, countryRating, type RatingInfo } from "./ratings";
import type { GameState } from "./types";
import { chance, clamp, formatDate, formatINR, pick, pushCap, round, uid } from "./util";
import { credit, liquidCash, money, monthlyLoanPayment, portfolioValue, propertyValue, runwayMonths, spend, totalDebt, computeNetWorth } from "./finance";
import { minesView, type MinesSession } from "./mines";
import { rng } from "./engine";
import { groupStakes, lifestyleAssets } from "./finance";

/* ------------------------------------------------------------------ types */

export interface Forecast {
  id: string;
  topic: "index" | "property" | "inflation" | "growth" | "fx" | "stock";
  targetId?: string;
  direction: "up" | "down";
  placedAt: string;
  base: number;
  dueTick: number;
  stake: number;
  status: "open" | "won" | "lost" | "push";
  resultPct?: number;
}

export interface ResearchEntry {
  id: string;
  topic: string;
  targetId?: string;
  title: string;
  cost: number;
  dueTick: number;
  done: boolean;
  findings: string[];
}

export interface AdvisorInst {
  id: string;
  defId: string;
  name: string;
  salary: number;
  skill: number;
  hiredAt: string;
}

export interface AuctionLot {
  id: string;
  kind: "property" | "company";
  refId: string;
  title: string;
  blurb: string;
  currentPrice: number;
  fairPrice: number;
  endsTick: number;
}

export interface LifetimeStats {
  earned: number;
  spent: number;
  taxes: number;
  businesses: number;
  propertiesMax: number;
  jobs: number;
  countries: string[];
  elections: number;
  offices: number;
  convictions: number;
  wagered: number;
  won: number;
  biggestWin: number;
  biggestLoss: number;
  peakNW: number;
  peakNWDate: string;
  yearEarned: number;
  yearSpent: number;
}

export interface ChallengeState {
  defId: string;
  title: string;
  startedTick: number;
  deadlineTick: number;
  status: "active" | "won" | "failed";
}

export interface YearReview {
  year: number;
  nwStart: number;
  nwEnd: number;
  earned: number;
  spent: number;
  built: string[];
  world: string[];
  markets: string[];
  outlook: string;
}

export interface LedgerEntry {
  id: string;
  t: string;
  text: string;
  amount: number;
}

export interface MonthFlow {
  t: string;
  income: number;
  expenses: number;
  flows: Record<string, number>;
}

/** Admin/"treasury" access. Off by default; unlocked only with the key. */
export interface AdminState {
  unlocked: boolean;
  draws: number;
  totalDrawn: number;
  lastDraw?: string;
  /** Owner-only casino x-ray: see mine positions, crash points, hole cards. */
  xray?: boolean;
}

export interface AdvState {
  version: 1;
  seedLabel: string;
  debug: boolean;
  goals: Record<string, { target: number; achievedAt?: string }>;
  forecasts: Forecast[];
  research: ResearchEntry[];
  advisors: AdvisorInst[];
  stats: LifetimeStats;
  challenge: ChallengeState | null;
  monthFlow: MonthFlow | null;
  /** Rolling month-by-month cash-flow breakdown (newest first). */
  flowHistory: MonthFlow[];
  /** Accumulated severity of months where an obligation could not be met. */
  shortfalls: number;
  ledger: LedgerEntry[];
  yearReview: YearReview | null;
  auctions: AuctionLot[];
  lastAuctionScan: number;
  ratings: Record<string, string>;
  /** The live (or just-finished) Mines round. */
  mines: MinesSession | null;
  admin: AdminState;
}

export interface CalendarItem {
  monthsAhead: number;
  label: string;
  detail: string;
  kind: "election" | "grant" | "loan" | "bond" | "contract" | "build" | "auction" | "forecast" | "challenge" | "tax";
}

export interface AnalysisOption {
  id: string;
  label: string;
  cost: string;
  risk: string;
  upside: string;
  opportunity: string;
}

/* --------------------------------------------------------------- advisors */

export const ADVISOR_DEFS: {
  id: string;
  role: string;
  title: string;
  salary: number;
  skill: [number, number];
  blurb: string;
  effect: string;
}[] = [
  { id: "accountant", role: "Accountant", title: "Numbers person", salary: 28000, skill: [55, 90], blurb: "Keeps your books clean and argues with the tax office.", effect: "Recovers ~8% of your monthly taxes as advisory savings." },
  { id: "lawyer", role: "Lawyer", title: "Counsel", salary: 34000, skill: [55, 95], blurb: "Reads the fine print and keeps heat off your file.", effect: "+25% success on legal defence; contract penalties −20%." },
  { id: "financial", role: "Financial advisor", title: "Portfolio manager", salary: 38000, skill: [50, 92], blurb: "Watches your concentration risk while you sleep.", effect: "−0.5% on new loan rates; flags exposure in Analysis." },
  { id: "economist", role: "Economist", title: "Macro desk", salary: 42000, skill: [55, 95], blurb: "Reads cycles, not tea leaves.", effect: "Monthly macro insight note on your home economy." },
  { id: "marketing", role: "Marketing strategist", title: "Brand builder", salary: 36000, skill: [50, 90], blurb: "Turns budgets into attention.", effect: "+4% revenue effect on your firms' marketing spend." },
  { id: "political", role: "Political strategist", title: "Campaign brain", salary: 40000, skill: [50, 95], blurb: "Knows which district to shake hands in.", effect: "+0.5 popularity/month while you hold office or campaign." },
  { id: "realestate", role: "Real-estate advisor", title: "Deal hunter", salary: 35000, skill: [50, 90], blurb: "Sniffs undervalued blocks.", effect: "Renovations 15% more effective; −10% on property transaction drag." },
  { id: "tech", role: "Technology advisor", title: "CTO-for-hire", salary: 46000, skill: [55, 95], blurb: "Keeps your AI firms' compute efficient.", effect: "R&D 8% more effective on your AI companies." },
];

export function hasAdvisor(state: GameState, role: string) {
  return getAdv(state).advisors.some((a) => a.defId === role);
}

/* ------------------------------------------------------------------ goals */

export const GOAL_DEFS: {
  id: string;
  label: string;
  needsTarget: boolean;
  hint: string;
  check: (state: GameState, target: number) => { cur: number; target: number; text: string };
}[] = [
  {
    id: "net_worth",
    label: "Reach net worth",
    needsTarget: true,
    hint: "₹ target",
    check: (s, t) => {
      const v = computeNetWorth(s);
      return { cur: v, target: t, text: `${formatINR(v)} of ${formatINR(t)}` };
    },
  },
  {
    id: "cash",
    label: "Hold cash",
    needsTarget: true,
    hint: "₹ in liquid cash",
    check: (s, t) => {
      const v = liquidCash(s.player);
      return { cur: v, target: t, text: `${formatINR(v)} liquid` };
    },
  },
  {
    id: "monthly_income",
    label: "Monthly income",
    needsTarget: true,
    hint: "₹ / month",
    check: (s, t) => {
      const v = s.player.finances.monthlyIncome;
      return { cur: v, target: t, text: `${formatINR(v)}/mo` };
    },
  },
  {
    id: "property_count",
    label: "Own properties",
    needsTarget: true,
    hint: "count",
    check: (s, t) => ({ cur: s.player.properties.length, target: t, text: `${s.player.properties.length} held` }),
  },
  {
    id: "company",
    label: "Found a company",
    needsTarget: false,
    hint: "any registered firm you own",
    check: (s) => ({ cur: s.player.ownedCompanyIds.length, target: 1, text: s.player.ownedCompanyIds.length ? "Founded" : "Not yet" }),
  },
  {
    id: "debt_free",
    label: "Become debt-free",
    needsTarget: false,
    hint: "no active loans",
    check: (s) => {
      const d = totalDebt(s.player);
      return { cur: d, target: 0, text: d > 0 ? `${formatINR(d)} owed` : "Debt-free" };
    },
  },
  {
    id: "followers",
    label: "Social reach",
    needsTarget: true,
    hint: "followers",
    check: (s, t) => ({ cur: s.player.social.followers, target: t, text: `${s.player.social.followers.toLocaleString()} followers` }),
  },
  {
    id: "portfolio",
    label: "Markets portfolio",
    needsTarget: true,
    hint: "₹ in stocks/bonds/funds",
    check: (s, t) => {
      const v = portfolioValue(s);
      return { cur: v, target: t, text: `${formatINR(v)}` };
    },
  },
];

/* ------------------------------------------------------------- challenges */

export const CHALLENGE_DEFS: {
  id: string;
  title: string;
  desc: string;
  years: number;
  check: (s: GameState) => { done: boolean; progress: number; text: string };
}[] = [
  {
    id: "profitable_10y",
    title: "Profitable in a decade",
    desc: "Build a company with positive monthly profit within 10 years.",
    years: 10,
    check: (s) => {
      const best = s.world.companies.filter((c) => s.player.ownedCompanyIds.includes(c.id));
      const ok = best.some((c) => c.profit > 0);
      const progress = Math.max(0, ...best.map((c) => c.profit / Math.max(1, c.revenue)), 0);
      return { done: ok, progress: clamp(progress * 5, 0, 1), text: ok ? "A firm of yours is profitable." : `Best margin ${Math.round(progress * 100)}%` };
    },
  },
  {
    id: "fi_40",
    title: "Free by 40",
    desc: "Passive monthly income covering 2× living costs, and ₹1 Cr net worth, before age 40.",
    years: 100,
    check: (s) => {
      const p = s.player;
      const passive = p.finances.monthlyIncome;
      const need = p.finances.livingCost * 2;
      const nw = computeNetWorth(s);
      const done = p.age < 40 && passive >= need && nw >= 1e7;
      const progress = clamp(passive / Math.max(1, need) * 0.5 + clamp(nw / 1e7, 0, 1) * 0.5, 0, 1);
      return { done, progress, text: `Income ${Math.round((passive / Math.max(1, need)) * 100)}% of need · NW ${formatINR(nw)}` };
    },
  },
  {
    id: "property_5",
    title: "Stone portfolio",
    desc: "Own five properties at once.",
    years: 15,
    check: (s) => ({
      done: s.player.properties.length >= 5,
      progress: clamp(s.player.properties.length / 5, 0, 1),
      text: `${s.player.properties.length}/5 held`,
    }),
  },
  {
    id: "ipo_12y",
    title: "Road to the exchange",
    desc: "Take a company you founded public within 12 years.",
    years: 12,
    check: (s) => {
      const pub = s.world.companies.some((c) => s.player.ownedCompanyIds.includes(c.id) && c.public);
      return { done: pub, progress: pub ? 1 : 0.1, text: pub ? "Listed." : "Still private." };
    },
  },
  {
    id: "election_poor",
    title: "Rags to parliament",
    desc: "Win a national election with campaign cash under ₹50 lakh at launch.",
    years: 25,
    check: (s) => ({
      done: s.player.politics.role === "head",
      progress: s.player.politics.role !== "none" ? 0.5 : 0.1,
      text: s.player.politics.role === "head" ? "Head of government." : "Not yet in power.",
    }),
  },
  {
    id: "rebuild",
    title: "From the floor",
    desc: "After any loan default, rebuild to ₹10 lakh net worth.",
    years: 20,
    check: (s) => {
      const defaulted = s.player.finances.defaults > 0;
      const nw = computeNetWorth(s);
      const done = defaulted && nw >= 1e7 / 10;
      return { done, progress: defaulted ? clamp(nw / 1e6, 0, 1) : 0.05, text: done ? "Rebuilt." : defaulted ? `${formatINR(nw)} after default` : "No default yet." };
    },
  },
];

/* --------------------------------------------------------------- research */

export const RESEARCH_TOPICS: {
  id: string;
  title: string;
  cost: number;
  months: number;
  desc: string;
  target: "none" | "company" | "country" | "industry";
}[] = [
  { id: "economy", title: "Home economy deep-dive", cost: 60000, months: 2, desc: "Growth, inflation, fiscal position and where the cycle is heading.", target: "none" },
  { id: "property_mkt", title: "Property market study", cost: 40000, months: 1, desc: "Demand vs supply, price direction and rent yields in your city.", target: "none" },
  { id: "company", title: "Company diligence", cost: 30000, months: 1, desc: "Margins, quality, competitive position and credit rating of one firm.", target: "company" },
  { id: "industry", title: "Industry scan", cost: 35000, months: 1, desc: "Where an industry earns money, who leads it, and AI exposure.", target: "industry" },
  { id: "politics", title: "Political landscape", cost: 30000, months: 1, desc: "Party standings, approval and the issues that move voters.", target: "none" },
  { id: "country", title: "Foreign country profile", cost: 50000, months: 2, desc: "Business environment, taxes, property and entry risks for one country.", target: "country" },
  { id: "tech", title: "Technology frontier", cost: 25000, months: 1, desc: "Where AI, robotics and automation stand — and what they displace.", target: "none" },
  { id: "cashflow", title: "Personal cash-flow audit", cost: 20000, months: 1, desc: "Your own money: 12-month flows, fixed burn, runway, leaks and what to cut first.", target: "none" },
  { id: "debt", title: "Debt & credit review", cost: 30000, months: 1, desc: "Every facility: true cost, amortisation, refinance and consolidation options.", target: "none" },
];

function researchFindings(state: GameState, topic: string, targetId?: string): string[] {
  const p = state.player;
  const c = state.world.countries.find((x) => x.id === p.countryId)!;
  if (topic === "economy") {
    const outlook = c.gdpGrowth > 2 ? "expanding" : c.gdpGrowth > -0.5 ? "stagnating" : "contracting";
    return [
      `${c.name} growth ${c.gdpGrowth.toFixed(1)}% · inflation ${c.inflation.toFixed(1)}% · policy rate ${c.interestRate.toFixed(2)}%.`,
      `The cycle looks ${outlook}; unemployment ${c.unemployment.toFixed(1)}%.`,
      `Fiscal: debt ${formatINR(c.debt)} vs monthly revenue ${formatINR(c.revenue * 12)}. Rating ${countryRating(c).grade}.`,
      c.interestRate > c.inflation ? "Real rates are positive — credit stays expensive, property cools." : "Real rates are negative — cheap credit is inflating asset prices.",
    ];
  }
  if (topic === "property_mkt") {
    const city = state.world.cities.find((x) => x.id === p.cityId);
    if (!city) return ["No city data."];
    return [
      `${city.name}: demand ${city.demand.toFixed(0)} vs housing supply ${city.housingSupply.toFixed(0)}.`,
      city.demand > city.housingSupply ? "Demand exceeds supply — values drift up, rents firm." : "Supply exceeds demand — expect soft prices unless rates fall.",
      `Rent yield ≈ ${(city.rentIndex / 100) * 0.55}%/yr on index basis. Mortgage rate ≈ ${(c.interestRate + 1.6).toFixed(1)}%.`,
      city.tech > 60 ? "Tech employment makes this market more resilient." : "A rate cut would matter more here than a wage hike.",
    ];
  }
  if (topic === "company") {
    const co = state.world.companies.find((x) => x.ticker === targetId || x.id === targetId);
    if (!co) return ["Target no longer trades."];
    const margin = co.revenue > 0 ? co.profit / co.revenue : 0;
    return [
      `${co.name} (${co.ticker}): revenue ${formatINR(co.revenue)}, margin ${Math.round(margin * 100)}%, P/E ${co.pe.toFixed(1)}.`,
      `Quality ${co.quality.toFixed(0)} · sentiment ${co.sentiment.toFixed(0)} · growth ${co.growth.toFixed(1)}%.`,
      `Credit rating ${companyRating(co, state).grade}. Debt ${formatINR(co.debt)} vs cash ${formatINR(co.cash)}.`,
      margin < 0 ? "Negative margin: price war or cost blow-up. Underwrite a turnaround, not a growth story." : "Profitable: the risk is competition and rate sensitivity.",
    ];
  }
  if (topic === "industry") {
    const ind = state.world.companies.filter((x) => x.industry === targetId && x.stage !== "bankrupt");
    const rev = ind.reduce((s, x) => s + x.revenue, 0);
    const top = [...ind].sort((a, b) => b.marketShare - a.marketShare)[0];
    return [
      `${String(targetId).toUpperCase()}: ${ind.length} tracked firms, combined revenue ${formatINR(rev)}.`,
      top ? `Leader: ${top.name} with ~${top.marketShare.toFixed(1)}% share.` : "Fragmented field.",
      ind.length ? `Average P/E ${round(ind.reduce((s, x) => s + x.pe, 0) / ind.length, 1)}.` : "No data.",
      "Entry is open, but incumbents respond to new share within 1–2 years.",
    ];
  }
  if (topic === "politics") {
    const parties = state.world.parties.filter((x) => x.countryId === c.id).sort((a, b) => b.popularity - a.popularity);
    const top = parties.slice(0, 3);
    return [
      `${c.name} approval ${c.approval.toFixed(0)}; next election ${c.electionYear}.`,
      top.map((x) => `${x.name} ${x.popularity.toFixed(0)}%`).join(" · "),
      c.policy.tax > 55 ? "Voters feel the tax burden; the anti-tax line is gaining." : "Fiscal hawks are comfortable; service delivery is the open flanks.",
      "Campaign visibility and scandal weather can swing 4–8 points inside a year.",
    ];
  }
  if (topic === "country") {
    const f = state.world.countries.find((x) => x.id === targetId) ?? c;
    return [
      `${f.name}: growth ${f.gdpGrowth.toFixed(1)}% · inflation ${f.inflation.toFixed(1)}% · rates ${f.interestRate.toFixed(2)}% · unemployment ${f.unemployment.toFixed(1)}%.`,
      `Taxes: income ${f.incomeTax}% · corporate ${f.corpTax}% · property ${f.propertyTax}% · VAT ${f.vat}%. Currency ${f.currency.code} (fx ${f.fx.toFixed(2)}).`,
      `Business freedom ${f.businessFreedom.toFixed(0)} · infrastructure ${f.infrastructure.toFixed(0)} · education ${f.educationIndex.toFixed(0)}.`,
      `Credit rating ${countryRating(f).grade}. ${f.businessFreedom > 65 ? "Easier for foreign firms than the regional average." : "Expect friction in licensing and land."}`,
    ];
  }
  if (topic === "tech") {
    const t = state.world.tech;
    return [
      `AI adoption ${t.ai.toFixed(0)} · robotics ${t.robotics.toFixed(0)} · automation ${t.automation.toFixed(0)} · renewables ${t.renewables.toFixed(0)}.`,
      t.ai > 55 ? "White-collar automation is cutting entry wages in exposed industries while AI vendors gain." : "Automation is still early; skilled labour has pricing power.",
      "New tech creates new firms; check Opportunities for emerging sectors.",
    ];
  }
  if (topic === "cashflow") return cashFlowFindings(state);
  if (topic === "debt") return debtFindings(state);
  return ["Study pending."];
}

/** Real numbers from the player's own flow history — no generic advice. */
function cashFlowFindings(state: GameState): string[] {
  const rep = cashFlowReport(state);
  const out = [
    `Last ${rep.monthsCovered} months: in ${formatINR(rep.income12)}, out ${formatINR(rep.expense12)}, net ${formatINR(rep.net12)}.`,
    `Fixed monthly burn ${formatINR(rep.fixedBurn)} (living ${formatINR(rep.living)}, loans ${formatINR(rep.loans)}, advisors ${formatINR(rep.advisors)}, upkeep ${formatINR(rep.upkeep)}, fees ${formatINR(rep.fees)}, insurance ${formatINR(rep.insurance)}, tuition ${formatINR(rep.tuition)}).`,
    `Runway on liquid cash: ${rep.runway === Infinity ? "not burning — income covers expenses" : `${rep.runway.toFixed(1)} months`}.`,
  ];
  if (rep.biggestLeak) out.push(`Largest single outflow: ${rep.biggestLeak.label} at ${formatINR(rep.biggestLeak.value)}/mo.`);
  if (rep.shortfallMonths > 0)
    out.push(`You were short in ${rep.shortfallMonths} of the last ${rep.monthsCovered} months — arrears now ${formatINR(rep.arrears)}.`);
  out.push(
    rep.net12 >= 0
      ? "Cash flow is positive. The lever now is where the surplus compounds: debt paydown vs investment vs capacity."
      : "Cash flow is negative. Cut the largest discretionary line first, then renegotiate fixed commitments — in that order.",
  );
  return out;
}

function debtFindings(state: GameState): string[] {
  const p = state.player;
  const loans = p.finances.loans.filter((l) => l.status !== "paid");
  if (!loans.length) return ["No open facilities. Your credit score is the asset to protect — utilisation is zero."];
  const totalInterest = loans.reduce((s, l) => s + (money(l.remaining) * money(l.rate)) / 100 / 12, 0);
  const worst = [...loans].sort((a, b) => money(b.rate) - money(a.rate))[0]!;
  const bank = state.world.banks.find((b) => b.countryId === p.countryId);
  const out = [
    `${loans.length} open facilities, ${formatINR(totalDebt(p))} outstanding, ${formatINR(totalInterest)}/month in interest.`,
    `Deepest rate: ${worst.kind} at ${money(worst.rate).toFixed(2)}% (${formatINR(worst.remaining)} left, ${formatINR(worst.monthly)}/mo).`,
    `Credit score ${Math.round(p.finances.creditScore)}, payment history ${Math.round(p.finances.paymentHistory)}, defaults ${p.finances.defaults}.`,
  ];
  if (bank) {
    const refi = bank.lendingRate + (p.finances.creditScore > 740 ? -1 : 1.5);
    out.push(
      refi < money(worst.rate) - 0.5
        ? `Refinancing the ${worst.kind} loan at ~${refi.toFixed(2)}% would save ~${formatINR(((money(worst.rate) - refi) / 100 / 12) * money(worst.remaining))}/month.`
        : `Current market rates (~${refi.toFixed(2)}%) do not beat your worst facility — refinance later, or pay principal down instead.`,
    );
  }
  out.push(
    `Next instalments: ${loans.map((l) => `${l.kind} ${formatINR(l.monthly)}`).join(", ")}. Total scheduled ${formatINR(loans.reduce((s, l) => s + money(l.monthly), 0))}/mo.`,
  );
  return out;
}

/* ------------------------------------------------------------- cash flow */

export interface FlowLine {
  key: string;
  label: string;
  value: number;
}

export interface CashFlowReport {
  t: string;
  monthsCovered: number;
  income: number;
  expenses: number;
  net: number;
  income12: number;
  expense12: number;
  net12: number;
  incomeLines: FlowLine[];
  expenseLines: FlowLine[];
  income12Lines: FlowLine[];
  expense12Lines: FlowLine[];
  fixedBurn: number;
  living: number;
  loans: number;
  advisors: number;
  upkeep: number;
  fees: number;
  insurance: number;
  tuition: number;
  arrears: number;
  runway: number;
  liquid: number;
  biggestLeak: { label: string; value: number } | null;
  shortfallMonths: number;
}

const FLOW_LABELS: Record<string, string> = {
  salary: "Salary",
  freelance: "Freelance",
  rent: "Rent received",
  dividends: "Dividends",
  coupons: "Bond coupons",
  interest: "Deposit interest",
  draws: "Business draws",
  grants: "Grants",
  media: "Media advertising",
  mediaCosts: "Newsroom costs",
  casino: "Casino floor",
  charter: "Charter & lease income",
  lifeIncome: "Gifts, windfalls & sales",
  stakes: "Stake purchases & sales",
  life: "Life & lifestyle spending",
  aviation: "Cars, yachts & aircraft",
  travel: "Travel & vacations",
  gambling: "Gambling",
  crime: "Underground",
  forecast: "Forecasts & insights",
  taxes: "Income tax",
  living: "Living costs",
  upkeep: "Property upkeep",
  construction: "Construction",
  insurance: "Insurance",
  tuition: "Tuition",
  loans: "Loan instalments",
  loanInterest: "  of which interest",
  advisors: "Advisors & staff",
  fees: "Bank & late fees",
  arrears: "Unpaid (arrears)",
};

const INCOME_KEYS = new Set([
  "salary", "freelance", "rent", "dividends", "coupons", "interest", "draws", "grants", "media", "casino", "gambling", "crime", "forecast",
  "charter", "lifeIncome",
]);

export const flowLabel = (key: string) => FLOW_LABELS[key] ?? key;
export const isIncomeKey = (key: string) => INCOME_KEYS.has(key);

export function cashFlowReport(state: GameState): CashFlowReport {
  const adv = getAdv(state);
  const p = state.player;
  const hist = adv.flowHistory.slice(0, 12); // newest first
  const current = adv.monthFlow;
  const months = current ? [current, ...hist.filter((h) => h.t !== current.t)] : hist;
  const take = months.slice(0, 12);

  // Classify by sign first, then by key: a "casino" or "media" month can be a
  // loss, and a loss belongs on the expense side of the report.
  const sumLines = (wantIncome: boolean) => {
    const acc: Record<string, number> = {};
    for (const m of take) {
      for (const [k, v] of Object.entries(m.flows ?? {})) {
        const val = money(v);
        if (val === 0) continue;
        if ((val > 0) !== wantIncome) continue;
        acc[k] = (acc[k] ?? 0) + val;
      }
    }
    return Object.entries(acc)
      .map(([key, value]) => ({ key, label: flowLabel(key), value: round(value, 0) }))
      .filter((l) => Math.abs(l.value) > 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  };

  const income12Lines = sumLines(true);
  const expense12Lines = sumLines(false);
  const income12 = income12Lines.reduce((s, l) => s + l.value, 0);
  const expense12 = expense12Lines.reduce((s, l) => s + Math.abs(l.value), 0);

  const cur = current?.flows ?? {};
  const g = (k: string) => money(cur[k]);
  const n = take.length || 1;
  const avg = (k: string) => round(take.reduce((s, m) => s + money(m.flows?.[k]), 0) / n, 0);

  const fixedBurn = Math.abs(avg("living")) + Math.abs(avg("loans")) + Math.abs(avg("advisors")) + Math.abs(avg("upkeep")) + Math.abs(avg("fees")) + Math.abs(avg("insurance")) + Math.abs(avg("tuition"));
  const leaks = expense12Lines.filter((l) => l.key !== "loanInterest");
  return {
    t: current?.t ?? formatDate(state.time.year, state.time.month),
    monthsCovered: take.length,
    income: round(money(current?.income), 0),
    expenses: round(money(current?.expenses), 0),
    net: round(money(current?.income) - money(current?.expenses), 0),
    income12: round(income12, 0),
    expense12: round(expense12, 0),
    net12: round(income12 - expense12, 0),
    incomeLines: Object.entries(cur).filter(([, v]) => money(v) > 0).map(([key, value]) => ({ key, label: flowLabel(key), value: round(value, 0) })).sort((a, b) => b.value - a.value),
    expenseLines: Object.entries(cur).filter(([, v]) => money(v) < 0).map(([key, value]) => ({ key, label: flowLabel(key), value: round(value, 0) })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    income12Lines,
    expense12Lines,
    fixedBurn: round(fixedBurn, 0),
    living: Math.abs(avg("living")),
    loans: Math.abs(avg("loans")),
    advisors: Math.abs(avg("advisors")),
    upkeep: Math.abs(avg("upkeep")),
    fees: Math.abs(avg("fees")),
    insurance: Math.abs(avg("insurance")),
    tuition: Math.abs(avg("tuition")),
    arrears: round(money(p.finances.arrears), 0),
    runway: runwayMonths(state),
    liquid: round(liquidCash(p), 0),
    biggestLeak: leaks.length ? { label: leaks[0]!.label, value: Math.round(Math.abs(leaks[0]!.value) / n) } : null,
    shortfallMonths: take.filter((m) => Math.abs(money(m.flows?.arrears)) > 0).length,
  };
}

/* ----------------------------------------------------------------- mines */

/** A live round is settled if it has been sitting open for a year of game time,
 *  so a stake can never be stranded in an unfinished round. */
function tickMines(state: GameState) {
  const adv = getAdv(state);
  const m = adv.mines;
  if (!m || m.status !== "live") return;
  if (state.ticks - m.startTick < 12) return;
  const v = minesView(m);
  m.status = "cashed";
  m.payout = round(v.cashoutNow, 2);
  credit(state.player, m.payout, `Mines auto cash-out (${v.safePicked} gems)`, "gamble", formatDate(state.time.year, state.time.month));
  state.player.gambling.lifetimeWon += m.payout;
  note(state, `Mines round auto-cashed after a year: ${formatINR(m.payout)} (${v.multiplier.toFixed(2)}×).`, "info");
  ledger(state, `Mines auto cash-out · ${v.safePicked} gems`, round(m.payout - m.stake, 0));
}

/* ------------------------------------------------------------------ ratings */

export { companyRating, countryRating, type RatingInfo };

/* ------------------------------------------------------------- init/migrate */

function blankStats(state: GameState): LifetimeStats {
  return {
    earned: 0,
    spent: 0,
    taxes: 0,
    businesses: state.player.ownedCompanyIds.length,
    propertiesMax: state.player.properties.length,
    jobs: state.player.career.history.length,
    countries: [state.player.countryId],
    elections: state.player.politics.elections.length,
    offices: state.player.politics.role !== "none" ? 1 : 0,
    convictions: state.player.crime.convictions,
    wagered: state.player.gambling.lifetimeWagered,
    won: state.player.gambling.lifetimeWon,
    biggestWin: 0,
    biggestLoss: 0,
    peakNW: computeNetWorth(state),
    peakNWDate: formatDate(state.time.year, state.time.month),
    yearEarned: 0,
    yearSpent: 0,
  };
}

export function initAdv(state: GameState, seedLabel: string): AdvState {
  return {
    version: 1,
    seedLabel,
    debug: false,
    goals: {},
    forecasts: [],
    research: [],
    advisors: [],
    stats: blankStats(state),
    challenge: null,
    monthFlow: null,
    flowHistory: [],
    shortfalls: 0,
    ledger: [],
    yearReview: null,
    auctions: [],
    lastAuctionScan: 0,
    ratings: {},
    mines: null,
    admin: { unlocked: false, draws: 0, totalDrawn: 0 },
  };
}

export function getAdv(state: GameState): AdvState {
  if (!state.adv) {
    state.adv = initAdv(state, state.seedLabel || String(state.seed));
    return state.adv;
  }
  const adv = state.adv;
  // Older saves predate these fields — fill them so nothing downstream reads
  // `undefined` and turns a balance into NaN.
  if (!Array.isArray(adv.flowHistory)) adv.flowHistory = [];
  if (!Number.isFinite(adv.shortfalls)) adv.shortfalls = 0;
  if (adv.mines === undefined) adv.mines = null;
  if (!adv.admin) adv.admin = { unlocked: false, draws: 0, totalDrawn: 0 };
  if (adv.monthFlow && !Number.isFinite(adv.monthFlow.income)) {
    adv.monthFlow = { t: adv.monthFlow.t, income: 0, expenses: 0, flows: adv.monthFlow.flows };
  }
  if (!Array.isArray(adv.ledger)) adv.ledger = [];
  if (!Array.isArray(adv.auctions)) adv.auctions = [];
  if (!adv.ratings) adv.ratings = {};
  return adv;
}

export function ledger(state: GameState, text: string, amount: number) {
  const adv = getAdv(state);
  pushCap(
    adv.ledger,
    { id: uid("led"), t: formatDate(state.time.year, state.time.month), text, amount: round(amount, 0) },
    250,
  );
}

/* ------------------------------------------------------------------- tick */

function forecastValue(state: GameState, f: Forecast): number {
  const p = state.player;
  switch (f.topic) {
    case "index": {
      const h = state.world.indexHistory;
      return h.length ? h[h.length - 1]!.v : 0;
    }
    case "property":
      return state.world.cities.find((c) => c.id === p.cityId)?.propertyIndex ?? 100;
    case "inflation":
      return state.world.countries.find((c) => c.id === p.countryId)?.inflation ?? 3;
    case "growth":
      return state.world.countries.find((c) => c.id === p.countryId)?.gdpGrowth ?? 2;
    case "fx":
      return state.world.countries.find((c) => c.id === p.countryId)?.fx ?? 1;
    case "stock": {
      const co = state.world.companies.find((c) => c.ticker === f.targetId);
      return co?.price ?? 0;
    }
  }
}

export function forecastLabel(state: GameState, f: Forecast): string {
  const p = state.player;
  const c = state.world.countries.find((x) => x.id === p.countryId);
  switch (f.topic) {
    case "index":
      return "Concord World Index";
    case "property":
      return `Property · ${state.world.cities.find((x) => x.id === p.cityId)?.name ?? "city"}`;
    case "inflation":
      return `Inflation · ${c?.name ?? ""}`;
    case "growth":
      return `GDP growth · ${c?.name ?? ""}`;
    case "fx":
      return `Currency · ${c?.currency.code ?? ""}`;
    case "stock":
      return `Stock · ${f.targetId}`;
  }
}

function settleForecasts(state: GameState) {
  const adv = getAdv(state);
  const date = formatDate(state.time.year, state.time.month);
  for (const f of adv.forecasts) {
    if (f.status !== "open" || state.ticks < f.dueTick) continue;
    const cur = forecastValue(state, f);
    const delta = f.base !== 0 ? ((cur - f.base) / Math.abs(f.base)) * 100 : 0;
    f.resultPct = round(delta, 2);
    if (Math.abs(delta) < 0.05) {
      f.status = "push";
      creditNote(state, f.stake, `Forecast push refund · ${forecastLabel(state, f)}`, date);
      note(state, `Forecast push: ${forecastLabel(state, f)} moved ${delta.toFixed(2)}%. Stake returned.`, "info");
    } else if ((f.direction === "up" && delta > 0) || (f.direction === "down" && delta < 0)) {
      f.status = "won";
      const payout = f.stake * 1.3;
      creditNote(state, payout, `Forecast win · ${forecastLabel(state, f)}`, date);
      state.player.reputation.professional = clamp(state.player.reputation.professional + 0.6, 0, 100);
      ledger(state, `Forecast won (${forecastLabel(state, f)} moved ${delta.toFixed(1)}%)`, payout - f.stake);
      note(state, `Forecast paid: ${forecastLabel(state, f)} ${f.direction} ${Math.abs(delta).toFixed(1)}%. +${formatINR(payout - f.stake)}`, "good");
    } else {
      f.status = "lost";
      ledger(state, `Forecast lost (${forecastLabel(state, f)} moved ${delta.toFixed(1)}%)`, -f.stake);
      note(state, `Forecast lost on ${forecastLabel(state, f)} (moved ${delta.toFixed(1)}%). Stake gone.`, "bad");
    }
  }
  adv.forecasts = adv.forecasts.filter((f) => f.status === "open" || state.ticks - f.dueTick < 24);
  if (adv.forecasts.length > 12) adv.forecasts.splice(0, adv.forecasts.length - 12);
}

function creditNote(state: GameState, amount: number, desc: string, date: string) {
  credit(state.player, amount, desc, "insight", date);
}

function tickAdvisors(state: GameState) {
  const adv = getAdv(state);
  const p = state.player;
  const date = formatDate(state.time.year, state.time.month);
  for (const a of [...adv.advisors]) {
    // One charge, taken from the liquid pool (wallet then accounts). The old
    // code debited the wallet AND the first account for the same salary — and,
    // when the wallet was short, emptied the account outright.
    const ok = spend(p, a.salary, `Advisor · ${a.name}`, "advisor", date);
    if (ok) {
      const mf = adv.monthFlow;
      if (mf) mf.flows.advisors = round(money(mf.flows.advisors) - a.salary, 2);
      p.finances.monthlyExpenses = round(money(p.finances.monthlyExpenses) + a.salary, 2);
      adv.stats.spent += a.salary;
    }
    if (!ok) {
      adv.advisors = adv.advisors.filter((x) => x.id !== a.id);
      note(state, `Could not pay ${a.name}. The engagement ended.`, "warn");
      ledger(state, `Advisor released: ${a.name} (unpaid)`, 0);
      continue;
    }
    if (a.defId === "accountant" && adv.monthFlow && Math.abs(money(adv.monthFlow.flows.taxes)) > 0) {
      const reb = Math.abs(money(adv.monthFlow.flows.taxes)) * 0.08 * (a.skill / 75);
      creditNote(state, reb, "Tax advisory saving", date);
    }
    if (a.defId === "political" && p.politics.role !== "none") {
      p.politics.popularity = clamp(p.politics.popularity + 0.5 * (a.skill / 75), 0, 95);
    }
    if (a.defId === "economist" && state.ticks % 2 === 0) {
      const c = state.world.countries.find((x) => x.id === p.countryId)!;
      const dir = c.gdpGrowth >= c.gdpGrowth * 0.9 ? "steady" : c.gdpGrowth > 0 ? "improving" : "deteriorating";
      note(
        state,
        `Economist: ${c.name} is ${dir} — growth ${c.gdpGrowth.toFixed(1)}%, CPI ${c.inflation.toFixed(1)}%, rates ${c.interestRate.toFixed(2)}%. ${
          c.interestRate > c.inflation ? "Borrowing stays dear; asset values need earnings to justify them." : "Cheap credit is flattering asset prices; don't confuse that with strength."
        }`,
        "info",
      );
    }
  }
}

function tickResearch(state: GameState) {
  const adv = getAdv(state);
  for (const r of adv.research) {
    if (r.done || state.ticks < r.dueTick) continue;
    r.done = true;
    r.findings = researchFindings(state, r.topic, r.targetId);
    note(state, `Research complete: ${r.title}. Findings are in the Research desk.`, "good");
    history(state, "research", `Completed study: ${r.title}`);
  }
  adv.research = adv.research.filter((r, i) => r.done || i < 6);
}

function tickChallenges(state: GameState) {
  const adv = getAdv(state);
  const ch = adv.challenge;
  if (!ch || ch.status !== "active") return;
  const def = CHALLENGE_DEFS.find((d) => d.id === ch.defId);
  if (!def) return;
  const res = def.check(state);
  if (res.done) {
    ch.status = "won";
    const reward = Math.max(200000, Math.round(computeNetWorth(state) * 0.02));
    ledger(state, `Challenge completed: ${ch.title}`, reward);
    note(state, `Challenge completed: ${ch.title}. Reputation reward ${formatINR(reward)} (public credibility, paid as a grant match).`, "good");
    creditNote(state, reward, `Challenge reward · ${ch.title}`, formatDate(state.time.year, state.time.month));
    timeline(state, `Completed challenge: ${ch.title}`, "challenge");
    unlock(state, "first_biz");
    return;
  }
  if (state.ticks >= ch.deadlineTick) {
    ch.status = "failed";
    note(state, `Challenge failed: ${ch.title}. The deadline passed.`, "warn");
    timeline(state, `Failed challenge: ${ch.title}`, "challenge");
  }
}

function scanAuctions(state: GameState) {
  const adv = getAdv(state);
  const r = () => rng(state);
  const active = adv.auctions;
  if (active.length >= 4) return;
  const distCompanies = state.world.companies.filter(
    (c) => (c.distressed || (c.stage === "bankrupt" && c.price > 0)) && !active.some((a) => a.kind === "company" && a.refId === c.id),
  );
  if (distCompanies.length && chance(r, 0.5)) {
    const co = pick(r, distCompanies);
    const fair = Math.max(100000, co.valuation * (co.stage === "bankrupt" ? 0.25 : 0.5));
    active.push({
      id: uid("lot"),
      kind: "company",
      refId: co.id,
      title: `${co.name} (${co.ticker})`,
      blurb: `${co.industry} · rev ${formatINR(co.revenue)} · debt ${formatINR(co.debt)} · ${co.stage}`,
      currentPrice: round(fair * (0.55 + r() * 0.15)),
      fairPrice: round(fair),
      endsTick: state.ticks + 3 + Math.floor(r() * 3),
    });
  }
  const distProps = state.world.properties.filter(
    (p) => p.distressed && !active.some((a) => a.kind === "property" && a.refId === p.id),
  );
  if (distProps.length && chance(r, 0.35)) {
    const pr = pick(r, distProps);
    const fair = pr.price * 0.85;
    active.push({
      id: uid("lot"),
      kind: "property",
      refId: pr.id,
      title: pr.name,
      blurb: `${pr.kind} · ${pr.district} · listed ${formatINR(pr.price)}`,
      currentPrice: round(fair * (0.6 + r() * 0.15)),
      fairPrice: round(fair),
      endsTick: state.ticks + 3 + Math.floor(r() * 3),
    });
  }
  for (const lot of active) {
    lot.currentPrice = round(lot.currentPrice * (1 + 0.008 + r() * 0.045));
  }
  for (const lot of active.filter((l) => state.ticks >= l.endsTick)) {
    note(state, `Auction closed without you: ${lot.title}.`, "info");
  }
  adv.auctions = active.filter((l) => state.ticks < l.endsTick);
  adv.lastAuctionScan = state.ticks;
}

function tickStats(state: GameState) {
  const adv = getAdv(state);
  const p = state.player;
  const s = adv.stats;
  s.earned += p.finances.monthlyIncome;
  s.spent += p.finances.monthlyExpenses;
  s.yearEarned += p.finances.monthlyIncome;
  s.yearSpent += p.finances.monthlyExpenses;
  // taxes accrue in tickPlayerMoney (single source of truth)
  s.jobs = p.career.history.length;
  s.elections = p.politics.elections.length;
  s.convictions = p.crime.convictions;
  s.propertiesMax = Math.max(s.propertiesMax, p.properties.length);
  s.wagered = p.gambling.lifetimeWagered;
  s.won = p.gambling.lifetimeWon;
  if (!s.countries.includes(p.countryId)) s.countries.push(p.countryId);
  const nw = computeNetWorth(state);
  if (nw > s.peakNW) {
    s.peakNW = nw;
    s.peakNWDate = formatDate(state.time.year, state.time.month);
  }
}

function ratingsTick(state: GameState) {
  const adv = getAdv(state);
  for (const co of state.world.companies) adv.ratings[co.id] = companyRating(co, state).grade;
  for (const c of state.world.countries) adv.ratings[c.id] = countryRating(c).grade;
}

function buildYearReview(state: GameState) {
  const adv = getAdv(state);
  const p = state.player;
  const hist = p.finances.netWorthHistory;
  const nwStart = hist.length > 12 ? hist[hist.length - 12]!.v : hist[0]?.v ?? 0;
  const nwEnd = computeNetWorth(state);
  const year = state.time.year;
  const built = state.timeline
    .filter((t) => t.year === year && ["business", "property", "politics", "education", "life", "finance", "challenge"].includes(t.kind))
    .slice(-8)
    .map((t) => t.text);
  const yearNews = state.news.filter((n) => n.year === year);
  const world = [
    ...yearNews.filter((n) => ["economy", "politics", "tech", "diplomacy"].includes(n.tag)).slice(0, 3).map((n) => n.headline),
    `World index ${state.world.indexHistory.length > 12 ? round(((state.world.indexHistory[state.world.indexHistory.length - 1]!.v / state.world.indexHistory[state.world.indexHistory.length - 12]!.v - 1) * 100), 1) : 0}% over the year.`,
  ];
  const c = state.world.countries.find((x) => x.id === p.countryId)!;
  const markets = [
    `${c.name}: growth ${c.gdpGrowth.toFixed(1)}%, CPI ${c.inflation.toFixed(1)}%, policy ${c.interestRate.toFixed(2)}%.`,
    `Property index ${round(state.world.cities.find((x) => x.id === p.cityId)?.propertyIndex ?? 100)} in your city.`,
    `Open auctions: ${adv.auctions.length} · forecasts open: ${adv.forecasts.filter((f) => f.status === "open").length}.`,
  ];
  const outlooks = [
    c.gdpGrowth > 2 ? "A favourable wind behind earnings — but crowded markets mean valuation discipline matters." : "A tougher tape: cash is a position, and cheap assets are appearing.",
  ];
  adv.yearReview = {
    year,
    nwStart,
    nwEnd,
    earned: adv.stats.yearEarned,
    spent: adv.stats.yearSpent,
    built,
    world,
    markets,
    outlook: pick(rng.bind(null, state), outlooks),
  };
  adv.stats.yearEarned = 0;
  adv.stats.yearSpent = 0;
  timeline(state, `${year} closed: net worth ${formatINR(nwEnd)}.`, "finance");
}

export function tickAdvanced(state: GameState) {
  settleForecasts(state);
  tickMines(state);
  tickAdvisors(state);
  tickResearch(state);
  tickChallenges(state);
  closeMonthFlow(getAdv(state));
  tickStats(state);
  ratingsTick(state);
  if (state.ticks - getAdv(state).lastAuctionScan >= 2) scanAuctions(state);
  if (state.time.month === 12) buildYearReview(state);
}

/** Memo keys are sub-lines, not separate movements: `loanInterest` is part of
 *  `loans`, `arrears` is the unpaid part of `living`. Summing them double counts. */
const FLOW_MEMO_KEYS = new Set(["loanInterest", "arrears"]);

/** Close the month. Flows are signed (income +, expense −) and several systems
 *  post to them during a tick, so totals are recomputed once everything is in. */
export function closeMonthFlow(adv: AdvState): void {
  const mf = adv.monthFlow;
  if (!mf) return;
  let income = 0;
  let expenses = 0;
  for (const [k, v] of Object.entries(mf.flows)) {
    if (FLOW_MEMO_KEYS.has(k)) continue;
    const n = money(v);
    if (n > 0) income += n;
    else expenses += -n;
  }
  mf.income = round(income, 0);
  mf.expenses = round(expenses, 0);
  pushCap(adv.flowHistory, { t: mf.t, income: mf.income, expenses: mf.expenses, flows: { ...mf.flows } }, 36);
}

/* ---------------------------------------------------------------- calendar */

export function buildCalendar(state: GameState): CalendarItem[] {
  const adv = getAdv(state);
  const p = state.player;
  const items: CalendarItem[] = [];
  const monthsFromNow = (y: number, m: number) => (y - state.time.year) * 12 + (m - state.time.month);
  for (const c of state.world.countries) {
    if (c.electionYear <= state.time.year) continue;
    items.push({
      monthsAhead: monthsFromNow(c.electionYear, 5),
      label: `Election · ${c.name}`,
      detail: `National vote expected May ${c.electionYear}. Approval ${c.approval.toFixed(0)}.`,
      kind: "election",
    });
  }
  for (const g of state.world.grants) {
    if (!g.open) continue;
    const ma = monthsFromNow(g.deadlineYear, g.deadlineMonth);
    if (ma < 0) continue;
    items.push({
      monthsAhead: ma,
      label: `Grant deadline · ${g.name}`,
      detail: `Up to ${formatINR(g.amount)} · ~${Math.round(g.prob * 100)}% odds · ${g.eligibility}`,
      kind: "grant",
    });
  }
  for (const l of p.finances.loans) {
    if (l.status === "paid") continue;
    items.push({
      monthsAhead: Math.max(0, Math.min(l.monthsLeft, 60)),
      label: `Loan · ${l.kind} · ${formatINR(l.remaining)}`,
      detail: `${l.monthsLeft} instalments left · ${l.rate.toFixed(2)}% · ${l.status}`,
      kind: "loan",
    });
  }
  for (const b of p.bonds) {
    const ma = monthsFromNow(b.maturityYear, 12);
    if (ma <= 0) continue;
    items.push({
      monthsAhead: ma,
      label: `Bond matures · ${b.name}`,
      detail: `${b.qty} units · ${b.coupon}% coupon · ${formatINR(b.qty * b.price)}`,
      kind: "bond",
    });
  }
  for (const ct of p.contracts) {
    if (ct.monthsLeft <= 0) continue;
    items.push({
      monthsAhead: ct.monthsLeft,
      label: `Contract ends · ${ct.counterparty}`,
      detail: `${ct.kind} · ${formatINR(ct.value)} · performance ${ct.performance.toFixed(0)}`,
      kind: "contract",
    });
  }
  for (const prop of p.properties) {
    if (prop.development && prop.development.stage === "building") {
      const months = Math.ceil((100 - prop.development.progress) / 10);
      items.push({
        monthsAhead: months,
        label: `Construction · ${prop.name}`,
        detail: `${prop.development.progress.toFixed(0)}% complete · ${formatINR(prop.development.budget - prop.development.spent)} budget left`,
        kind: "build",
      });
    }
  }
  for (const lot of adv.auctions) {
    items.push({
      monthsAhead: Math.max(0, lot.endsTick - state.ticks),
      label: `Auction closes · ${lot.title}`,
      detail: `Current bid ${formatINR(lot.currentPrice)} vs fair ~${formatINR(lot.fairPrice)}`,
      kind: "auction",
    });
  }
  for (const f of adv.forecasts) {
    if (f.status !== "open") continue;
    items.push({
      monthsAhead: Math.max(0, f.dueTick - state.ticks),
      label: `Forecast settles · ${forecastLabel(state, f)}`,
      detail: `Base ${round(f.base, 2)} · stake ${formatINR(f.stake)} · ${f.direction}`,
      kind: "forecast",
    });
  }
  if (adv.challenge && adv.challenge.status === "active") {
    const def = CHALLENGE_DEFS.find((d) => d.id === adv.challenge!.defId);
    if (def) {
      items.push({
        monthsAhead: Math.max(0, adv.challenge.deadlineTick - state.ticks),
        label: `Challenge · ${adv.challenge.title}`,
        detail: def.desc,
        kind: "challenge",
      });
    }
  }
  items.push({ monthsAhead: 0, label: "Monthly flows", detail: "Salary, rent, dividends, loans, taxes and upkeep post every month.", kind: "tax" });
  return items.sort((a, b) => a.monthsAhead - b.monthsAhead).slice(0, 18);
}

/* -------------------------------------------------------------- what-should-i-do */

export function buildAnalysis(state: GameState): { situation: string; options: AnalysisOption[] } {
  const p = state.player;
  const nw = computeNetWorth(state);
  const c = state.world.countries.find((x) => x.id === p.countryId)!;
  const liquid = liquidCash(p);
  const lines = [
    `You are ${p.age}, ${p.career.job?.title ?? (p.ownedCompanyIds.length ? "founder" : "between roles")} in ${c.name}. Net worth ${formatINR(nw)}, liquid ${formatINR(liquid)}, debt ${formatINR(totalDebt(p))}.`,
    c.gdpGrowth > 1
      ? `The economy is expanding (${c.gdpGrowth.toFixed(1)}%), inflation ${c.inflation.toFixed(1)}%, policy rate ${c.interestRate.toFixed(2)}%. Growth favours operating businesses; crowded assets favour caution.`
      : `The economy is weak (${c.gdpGrowth.toFixed(1)}%). Cheap assets are appearing; credit is tighter; patience is a position.`,
  ];
  const options: AnalysisOption[] = [];
  const grants = state.world.grants.filter((g) => g.open && (g.countryId === p.countryId || true)).slice(0, 2);
  for (const g of grants) {
    options.push({
      id: `grant_${g.id}`,
      label: `Apply for ${g.name}`,
      cost: "A few months of attention",
      risk: `~${Math.round(g.prob * 100)}% approval; missed deadline closes the window`,
      upside: `${formatINR(g.amount)} non-dilutive capital`,
      opportunity: "Time spent applying is time not spent building or researching",
    });
  }
  const opps = state.world.opportunities.filter((o) => ["investor", "contract", "foreign", "distressed"].includes(o.kind)).slice(0, 2);
  for (const o of opps) {
    options.push({
      id: `opp_${o.id}`,
      label: o.title,
      cost: o.kind === "investor" ? "Equity or standing" : `~${formatINR(o.value * 0.15)} working capital`,
      risk: `Risk score ${o.risk}/100`,
      upside: o.detail,
      opportunity: "Committing here delays other opportunities that expire",
    });
  }
  if (liquid > 2e6 && !p.properties.some((x) => x.kind === "house" || x.kind === "apartment")) {
    const cheap = state.world.properties.filter((x) => !x.distressed && x.price < liquid * 0.8).sort((a, b) => a.price - b.price)[0];
    if (cheap) {
      options.push({
        id: `prop_${cheap.id}`,
        label: `Buy ${cheap.name}`,
        cost: `${formatINR(cheap.price)} cash (or 80% mortgage)`,
        risk: "Property is illiquid; rates and demand can move values against you",
        upside: `${formatINR(cheap.rent)}/mo rent + long-run appreciation`,
        opportunity: "Ties up cash that could fund a business or portfolio",
      });
    }
  }
  if (p.ownedCompanyIds.length) {
    const co = state.world.companies.find((x) => x.id === p.ownedCompanyIds[0]);
    if (co && co.stage !== "public" && co.stage !== "bankrupt") {
      options.push({
        id: `raise_${co.id}`,
        label: `Raise a round for ${co.name}`,
        cost: `~${Math.round(10 + p.traits.negotiation / 6)}% equity at ${formatINR(co.valuation)}`,
        risk: "Dilution and board pressure; rejected rounds hurt momentum",
        upside: "Faster hiring, R&D and marketing — compounding share gains",
        opportunity: "Raising now vs later: valuations move with sentiment",
      });
    }
  }
  if (!p.career.employed && !p.ownedCompanyIds.length) {
    options.push({
      id: "job",
      label: "Take a full-time role",
      cost: "Time and energy; less freedom to build",
      risk: `Job security varies with industry demand (see Career)`,
      upside: `Salary + compounding skills + employer-sponsored standing`,
      opportunity: "Years in a role are not spent founding a firm",
    });
  }
  if (liquid > 5e5) {
    options.push({
      id: "forecast",
      label: "Place a market forecast",
      cost: "Stake of your choice (capped at liquid cash)",
      risk: "You can be right on the trend and still lose if it reverses before settlement",
      upside: "+30% on correct calls; builds research skill and record",
      opportunity: "A stake is capital not working in a business",
    });
  }
  options.push({
    id: "wait",
    label: "Do nothing this month",
    cost: "One month of time",
    risk: `Inflation ${c.inflation.toFixed(1)}% erodes idle cash; competitors keep moving`,
    upside: "Cash preserved; options stay open",
    opportunity: "The world ticks regardless — deals expire and cycles turn",
  });
  return { situation: lines.join(" "), options };
}

/* -------------------------------------------------------------------- why */

export function whyNetWorth(state: GameState): string[] {
  const adv = getAdv(state);
  const p = state.player;
  const parts = [
    `Cash + accounts: ${formatINR(liquidCash(p))}`,
    `Markets (stocks, bonds, funds): ${formatINR(portfolioValue(state))}`,
    `Property: ${formatINR(propertyValue(p))}`,
    `Business equity: ${formatINR(state.world.companies.reduce((s, c) => {
      const sh = c.shareholders.find((x) => x.type === "player");
      return sh && c.shares > 0 ? s + (sh.shares / c.shares) * Math.max(0, c.valuation) : s;
    }, 0))}`,
    `Stakes held by your companies: ${formatINR(groupStakes(state))}`,
    `Cars, yachts & aircraft: ${formatINR(lifestyleAssets(state))}`,
    `− Debt: ${formatINR(totalDebt(p))}`,
  ];
  const flow = adv.monthFlow;
  if (flow) {
    const entries = Object.entries(flow.flows).filter(([, v]) => Math.abs(v) > 500).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
    parts.push(`Last month's flow (${flow.t}):`);
    for (const [k, v] of entries) parts.push(`  ${k}: ${v >= 0 ? "+" : "−"}${formatINR(Math.abs(v))}`);
  }
  const c = state.world.countries.find((x) => x.id === p.countryId)!;
  parts.push(
    `Drivers right now: growth ${c.gdpGrowth.toFixed(1)}%, CPI ${c.inflation.toFixed(1)}%, policy rate ${c.interestRate.toFixed(2)}%. Rates up → mortgages dearer → property demand cools. Rates down → the reverse.`,
  );
  return parts;
}

export function whyMarket(state: GameState): string[] {
  const idx = state.world.indexHistory;
  if (idx.length < 2) return ["Not enough market history yet."];
  const last = idx[idx.length - 1]!.v;
  const prev = idx[idx.length - 2]!.v;
  const chg = ((last - prev) / prev) * 100;
  const listed = state.world.companies.filter((c) => c.listed && c.stage !== "bankrupt");
  const avgSent = listed.reduce((s, c) => s + c.sentiment, 0) / Math.max(1, listed.length);
  const avgGrowth = listed.reduce((s, c) => s + c.growth, 0) / Math.max(1, listed.length);
  const c = state.world.countries.find((x) => x.id === state.player.countryId)!;
  return [
    `Index ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% this month (${last.toFixed(0)}).`,
    `Earnings momentum across listed firms: ${avgGrowth >= 0 ? "+" : ""}${avgGrowth.toFixed(1)}%.`,
    `Investor sentiment ${avgSent.toFixed(0)}/100 — ${avgSent > 55 ? "optimism is lifting multiples" : avgSent < 45 ? "caution is compressing multiples" : "neutral"}.`,
    `Policy rate ${c.interestRate.toFixed(2)}%: ${c.interestRate > 6 ? "higher discount rates pressure valuations" : "easy credit supports equity prices"}.`,
    "Stocks do not fall 'because'. They fall when earnings, sentiment or rates change — see each ticker's drivers.",
  ];
}

export function whyStock(state: GameState, ticker: string): string[] {
  const co = state.world.companies.find((c) => c.ticker === ticker);
  if (!co) return ["This ticker no longer trades."];
  const hist = co.history.slice(-3);
  const chg = hist.length >= 2 ? ((co.price - hist[0]!.price) / hist[0]!.price) * 100 : 0;
  const margin = co.revenue > 0 ? co.profit / co.revenue : 0;
  const lines = [
    `${co.name} ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% (price ${co.price.toFixed(2)}, P/E ${co.pe.toFixed(1)}).`,
    `Earnings: margin ${Math.round(margin * 100)}%, growth ${co.growth.toFixed(1)}% — ${margin > 0.08 ? "fundamentals support the multiple" : margin < 0 ? "earnings are the problem, not the mood" : "thin margins leave little room"}.`,
    `Sentiment ${co.sentiment.toFixed(0)}: ${co.sentiment > 60 ? "optimistic buyers" : co.sentiment < 40 ? "cautious or fearful" : "mixed"}.`,
    `Market share ${co.marketShare.toFixed(1)}% · quality ${co.quality.toFixed(0)} · ${co.stage}.`,
    co.stage === "distressed" || co.stage === "bankrupt" ? "Distress risk dominates: watch cash, not just revenue." : "Competitors undercut and rate moves can still hit this stock.",
  ];
  return lines;
}

/* --------------------------------------------------------------- biography */

export function generateBio(state: GameState): string {
  const p = state.player;
  const s = getAdv(state).stats;
  const nw = computeNetWorth(state);
  const peaks = state.timeline.filter((t) => ["business", "politics", "education", "finance", "challenge", "life"].includes(t.kind)).slice(0, 40);
  const lines: string[] = [];
  lines.push(`${p.name} was ${p.alive ? "alive" : "dead"} at ${p.age}, with net worth ${formatINR(nw)} (peak ${formatINR(s.peakNW)} in ${s.peakNWDate}).`);
  lines.push("");
  lines.push("The record, as far as it goes:");
  if (!peaks.length) lines.push("A quiet life so far — the ledger is still short.");
  for (const t of peaks) lines.push(`  ${t.year} · ${t.text}`);
  lines.push("");
  lines.push(
    `Earned ${formatINR(s.earned)} lifetime · spent ${formatINR(s.spent)} · taxes ${formatINR(s.taxes)}. ${s.businesses} business${s.businesses === 1 ? "" : "es"}, ${s.propertiesMax} property holdings at best, ${s.jobs} jobs, ${s.elections} elections contested, lived in ${s.countries.length} country${s.countries.length === 1 ? "" : "ies"}.`,
  );
  const ach = state.achievements.length;
  lines.push(ach ? `${ach} achievements on the record.` : "No achievements yet.");
  return lines.join("\n");
}

/* ------------------------------------------------------------ misc helpers */

export function goalProgress(state: GameState, goalId: string, target: number) {
  const def = GOAL_DEFS.find((g) => g.id === goalId);
  if (!def) return null;
  const res = def.check(state, target);
  const done = def.needsTarget ? res.cur >= res.target : res.cur >= res.target;
  return { def, res, done, pct: clamp(res.target > 0 ? res.cur / res.target : done ? 1 : 0, 0, 1) };
}

export function advisorSalaryTotal(state: GameState) {
  return getAdv(state).advisors.reduce((s, a) => s + a.salary, 0);
}
