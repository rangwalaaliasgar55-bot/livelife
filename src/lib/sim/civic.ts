// Government and the labour market: the annual tax return (and what happens
// when you lie on it), property tax, unemployment benefit and the state
// pension, a job market that AI steadily hollows out, deeper education with
// professional certifications, and gifts to the people in your life.
import type { Decision, EducationRecord, EducationTrack, GameState, Industry, JobListing, SkillId } from "./types";
import { blankTax, bizFlow, bizQueue, getBiz, type TaxReturn } from "./biz";
import { getAdv, hasAdvisor, ledger } from "./advanced";
import { INDUSTRIES, INDUSTRY_JOB_LABEL, JOB_RANKS, TRACKS, industryMeta } from "./catalog";
import { credit, liquidCash, livingCostFor, money, spend, spendUpTo } from "./finance";
import { history, note, timeline, unlock } from "./feed";
import { rng } from "./engine";
import { getLife, inPrison, sentence } from "./life";
import { chance, clamp, formatDate, formatINR, pick, round, uid } from "./util";

const dt = (s: GameState) => formatDate(s.time.year, s.time.month);
const R = (s: GameState) => () => rng(s);

/* ================================================================ taxes */

export interface TaxQuote {
  year: number;
  lines: {
    key: string;
    label: string;
    income: number;
    rate: number;
    tax: number;
  }[];
  income: number;
  gross: number;
  surcharge: number;
  withheld: number;
  due: number;
  hideable: number;
}

function homeCountry(state: GameState) {
  return state.world.countries.find((c) => c.id === state.player.countryId)!;
}

/** What the book says you owe. Salary is taxed at source every month; the
 *  return settles everything else. */
export function quoteTax(state: GameState, book = getBiz(state).tax): TaxQuote {
  const c = homeCountry(state);
  const eff = (c.incomeTax / 100) * 0.55;
  const gainsRate = (c.incomeTax / 100) * 0.45;
  const corp = c.corpTax / 100;
  const exempt = 250000;
  let remaining = exempt;
  const shelter = (x: number) => {
    const used = Math.min(remaining, Math.max(0, x));
    remaining -= used;
    return Math.max(0, x - used);
  };
  const lines = [
    {
      key: "salary",
      label: "Salary & bonus (taxed at source)",
      income: book.salary,
      rate: eff,
      tax: book.salary * eff,
    },
    {
      key: "freelance",
      label: "Freelance & contracts",
      income: book.freelance,
      rate: eff,
      tax: 0,
    },
    {
      key: "rent",
      label: "Rental income (30% standard deduction)",
      income: book.rent,
      rate: eff * 0.7,
      tax: 0,
    },
    {
      key: "interest",
      label: "Interest & coupons",
      income: book.interest,
      rate: eff,
      tax: 0,
    },
    {
      key: "dividends",
      label: "Dividends & business draws",
      income: book.dividends,
      rate: eff,
      tax: 0,
    },
    {
      key: "business",
      label: "Owner-operated businesses",
      income: book.business,
      rate: corp,
      tax: 0,
    },
    {
      key: "gains",
      label: "Capital gains",
      income: book.gains,
      rate: gainsRate,
      tax: 0,
    },
    {
      key: "gambling",
      label: "Net gambling winnings (flat 30%)",
      income: book.gambling,
      rate: 0.3,
      tax: 0,
    },
    {
      key: "other",
      label: "Pension & other",
      income: book.other,
      rate: eff,
      tax: 0,
    },
  ];
  for (const l of lines) {
    if (l.key === "salary") continue;
    const taxable = l.key === "gambling" ? Math.max(0, l.income) : shelter(l.income);
    l.tax = Math.max(0, taxable * l.rate);
  }
  const income = lines.reduce((s, l) => s + Math.max(0, l.income), 0);
  const gross = lines.reduce((s, l) => s + l.tax, 0);
  const surcharge = income > 5e7 ? gross * 0.15 : income > 1e7 ? gross * 0.1 : 0;
  const withheld = book.withheld + book.freelance * (c.incomeTax / 100) * 0.4;
  const due = round(gross + surcharge - withheld, 0);
  const hideable = lines.filter((l) => !["salary"].includes(l.key)).reduce((s, l) => s + l.tax, 0) * (1 + (surcharge ? surcharge / Math.max(1, gross) : 0));
  return {
    year: book.year,
    lines,
    income: round(income, 0),
    gross: round(gross, 0),
    surcharge: round(surcharge, 0),
    withheld: round(withheld, 0),
    due,
    hideable: round(hideable, 0),
  };
}

/** Record a realised capital gain (or loss) for this year's return. */
export function taxGain(state: GameState, gain: number) {
  if (!Number.isFinite(gain)) return;
  getBiz(state).tax.gains += gain;
}

/** Called at the top of each month: fold last month's cash-flow lines into the
 *  tax book, so every rupee earned anywhere in the game is on the return. */
export function accrueTax(state: GameState) {
  const b = getBiz(state);
  const mf = getAdv(state).monthFlow;
  if (!mf || mf.t === b.tax.lastFlowT) return;
  const f = (k: string) => money(mf.flows[k]);
  const t = b.tax;
  t.lastFlowT = mf.t;
  t.salary += f("salary");
  t.withheld += -f("taxes") - f("freelanceTax");
  t.freelance += f("freelance");
  t.rent += f("rent") + f("estateFees") + f("estateRepairs");
  t.interest += f("interest") + f("coupons") + f("fdInterest");
  t.dividends += f("draws") + f("dividends") + f("bankDiv") + f("hqDividends");
  t.business += f("casino") + f("media") + f("mediaCosts") + f("charter") + f("brokerage");
  t.gambling += f("gambling");
  t.other += f("pension");
}

function taxDecision(state: GameState, q: TaxQuote): Decision {
  const hasCA = hasAdvisor(state, "accountant");
  const body =
    q.due <= 0
      ? `Your ${q.year} return shows a refund of ${formatINR(-q.due)}: more was withheld from salary than you owe. File to collect it.`
      : `Taxable income for ${q.year}: ${formatINR(q.income)}. Tax on it is ${formatINR(q.gross + q.surcharge)}. After ${formatINR(q.withheld)} withheld from salary you owe ${formatINR(q.due)}. The return must be filed by July. How do you file?`;
  return {
    id: uid("dec"),
    kind: "tax",
    title: `${q.year} income-tax return`,
    body,
    year: state.time.year,
    month: state.time.month,
    options:
      q.due <= 0
        ? [
            {
              id: "honest",
              label: "File and claim the refund",
              hint: formatINR(-q.due),
            },
          ]
        : [
            {
              id: "honest",
              label: "File honestly and pay",
              hint: formatINR(q.due),
            },
            {
              id: "ca",
              label: hasCA ? "Let your accountant file (legal deductions)" : "Hire a chartered accountant",
              hint: hasCA ? "Saves 10–18%, no fee" : `Fee ${formatINR(15000 + Math.min(500000, q.due * 0.01))}, saves 10–18%`,
            },
            {
              id: "aggressive",
              label: "Claim aggressive deductions",
              hint: "Pay ~35% less · audit risk ~25%",
            },
            {
              id: "conceal",
              label: "Declare only your salary",
              hint: `Hide ${formatINR(q.hideable)} of tax · evasion is a crime`,
            },
          ],
    context: {
      year: q.year,
      due: q.due,
      hideable: q.hideable,
      income: q.income,
    },
  };
}

/** Pay tax now; whatever cannot be paid becomes tax debt that accrues interest
 *  and is recovered from your accounts. */
function payTax(state: GameState, amount: number, what: string): number {
  const b = getBiz(state);
  const paid = spendUpTo(state.player, amount, what, "tax", dt(state));
  bizFlow(state, "taxReturn", -paid.paid);
  getAdv(state).stats.taxes += paid.paid;
  if (paid.short > 0) {
    b.taxDebt = round(b.taxDebt + paid.short, 0);
    note(
      state,
      `You could not pay ${formatINR(paid.short)} of tax. It is now tax debt at 1.25%/month and the department will recover it from your accounts.`,
      "bad",
    );
  }
  return paid.paid;
}

export function resolveTax(state: GameState, d: Decision, opt: string, log: string[]) {
  const b = getBiz(state);
  const year = Number(d.context.year);
  const due = Number(d.context.due);
  const hideable = Number(d.context.hideable);
  const income = Number(d.context.income);
  const ret: TaxReturn = {
    year,
    income,
    due,
    paid: 0,
    choice: opt,
    audited: false,
    penalty: 0,
    status: "filed",
  };
  if (opt === "honest" && b.returns.filter((r) => r.choice === "honest").length >= 4) unlock(state, "tax_honest");
  b.returns.unshift(ret);
  if (b.returns.length > 30) b.returns.length = 30;
  if (due <= 0) {
    credit(state.player, -due, `${year} tax refund`, "tax", dt(state));
    bizFlow(state, "taxReturn", -due);
    ret.paid = due;
    ret.status = "settled";
    log.push(`Return filed. Refund of ${formatINR(-due)} credited.`);
    return;
  }
  if (opt === "honest") {
    ret.paid = payTax(state, due, `${year} income tax`);
    ret.status = "settled";
    state.player.reputation.personal = clamp(state.player.reputation.personal + 1, 0, 100);
    log.push(`Filed honestly. Paid ${formatINR(ret.paid)}.`);
    if (chance(R(state), 0.02)) bizQueue(state, 8, "audit", { year, owed: 0, mode: "clean" });
    return;
  }
  if (opt === "ca") {
    const hasCA = hasAdvisor(state, "accountant");
    const fee = hasCA ? 0 : round(15000 + Math.min(500000, due * 0.01), 0);
    if (fee && !spend(state.player, fee, "Chartered accountant fee", "tax", dt(state))) {
      log.push("You cannot afford the accountant's fee — filed it yourself instead.");
      ret.choice = "honest";
      ret.paid = payTax(state, due, `${year} income tax`);
      ret.status = "settled";
      return;
    }
    if (fee) bizFlow(state, "fees", -fee);
    const saving = 0.1 + rng(state) * 0.08 + (state.player.skills.accounting ?? 0) / 2000;
    const owe = round(due * (1 - saving), 0);
    ret.paid = payTax(state, owe, `${year} income tax (via CA)`);
    ret.status = "settled";
    log.push(`Your CA found legitimate deductions worth ${formatINR(due - owe)}${fee ? ` (fee ${formatINR(fee)})` : ""}. Paid ${formatINR(ret.paid)}.`);
    if (chance(R(state), 0.03)) bizQueue(state, 9, "audit", { year, owed: 0, mode: "clean" });
    return;
  }
  if (opt === "aggressive") {
    const owe = round(due * 0.65, 0);
    ret.paid = payTax(state, owe, `${year} income tax`);
    const risk = clamp(
      0.22 + (income > 1e7 ? 0.1 : 0) + (b.returns.filter((r) => r.audited).length ? 0.1 : 0) - (hasAdvisor(state, "lawyer") ? 0.05 : 0),
      0.05,
      0.6,
    );
    ret.status = "filed";
    log.push(`Filed with aggressive deductions. Paid ${formatINR(ret.paid)} instead of ${formatINR(due)}. Audit risk about ${Math.round(risk * 100)}%.`);
    if (chance(R(state), risk))
      bizQueue(state, 6 + rng(state) * 10, "audit", {
        year,
        owed: due - owe,
        mode: "aggressive",
      });
    return;
  }
  // conceal
  const owe = Math.max(0, round(due - hideable, 0));
  if (owe > 0) ret.paid = payTax(state, owe, `${year} income tax (salary only)`);
  ret.status = "evaded";
  const hidden = due - owe;
  const risk = clamp(0.16 + (hidden > 5e6 ? 0.15 : hidden > 1e6 ? 0.08 : 0) + getLife(state).fame / 300, 0.08, 0.7);
  log.push(
    `You declared only your salary and kept ${formatINR(hidden)} of tax. Detection risk about ${Math.round(risk * 100)}% — the department matches bank, broker and land records.`,
  );
  if (chance(R(state), risk))
    bizQueue(state, 8 + rng(state) * 18, "audit", {
      year,
      owed: hidden,
      mode: "evasion",
    });
}

function runAudit(state: GameState, data: Record<string, string | number>) {
  const b = getBiz(state);
  const year = Number(data.year);
  const owed = Number(data.owed);
  const mode = String(data.mode);
  const ret = b.returns.find((r) => r.year === year);
  if (ret) ret.audited = true;
  if (mode === "clean" || owed <= 0) {
    note(state, `The tax department audited your ${year} return and found nothing. Honesty paid.`, "good");
    timeline(state, `Cleared a tax audit for ${year}.`, "finance");
    return;
  }
  const penaltyRate = mode === "evasion" ? 2 : 1;
  const interest = owed * 0.015 * Math.max(6, state.ticks % 24);
  const penalty = round(owed * penaltyRate, 0);
  const total = round(owed + penalty + interest, 0);
  if (ret) {
    ret.penalty = penalty;
    ret.status = "audit";
  }
  history(state, "finance", `Tax audit (${year}): ${formatINR(total)} demanded`);
  timeline(state, `Tax audit for ${year}: back tax ${formatINR(owed)}, penalty ${formatINR(penalty)}.`, "finance");
  note(
    state,
    `AUDIT: your ${year} return was examined. Back tax ${formatINR(owed)} + ${penaltyRate * 100}% penalty ${formatINR(penalty)} + interest ${formatINR(interest)}.`,
    "bad",
  );
  ledger(state, `Tax audit ${year}`, -total);
  payTax(state, total, `Tax audit ${year}`);
  state.player.finances.creditScore = clamp(state.player.finances.creditScore - 25, 300, 900);
  state.player.reputation.personal = clamp(state.player.reputation.personal - (mode === "evasion" ? 12 : 4), 0, 100);
  if (mode === "evasion" && owed > 2_500_000 && !inPrison(state)) {
    const months = clamp(Math.round(6 + (owed / 1e7) * 8), 6, 84);
    if (chance(R(state), hasAdvisor(state, "lawyer") ? 0.45 : 0.7)) {
      sentence(state, months, "tax evasion");
      getLife(state).record.push(`Tax evasion (${year})`);
    } else note(state, "Prosecutors considered charges for tax evasion but settled for the penalty. You were lucky.", "warn");
  }
}

function tickTaxes(state: GameState) {
  const b = getBiz(state);
  const p = state.player;
  // a new fiscal year: close the book and ask for a return
  if (b.tax.year < state.time.year) {
    const q = quoteTax(state, b.tax);
    b.tax = blankTax(state.time.year);
    if (q.income > 0 || q.due !== 0) {
      state.pending.push(taxDecision(state, q));
      bizQueue(state, 7, "taxDeadline", { year: q.year, due: q.due });
      note(state, `Your ${q.year} tax return is ready: ${q.due > 0 ? `${formatINR(q.due)} to pay` : `${formatINR(-q.due)} refund`}. File it by July.`, "info");
    }
  }
  // tax debt: interest and recovery from your accounts
  if (b.taxDebt > 0) {
    b.taxDebt = round(b.taxDebt * 1.0125, 0);
    const take = Math.min(b.taxDebt, Math.max(0, liquidCash(p) - livingCostFor(state)) * 0.4);
    if (take > 1) {
      const paid = spendUpTo(p, take, "Tax recovery (attachment)", "tax", dt(state));
      b.taxDebt = round(b.taxDebt - paid.paid, 0);
      bizFlow(state, "taxReturn", -paid.paid);
    }
    p.finances.creditScore = clamp(p.finances.creditScore - 1.5, 300, 900);
    if (b.taxDebt < 1) {
      b.taxDebt = 0;
      note(state, "Tax debt cleared.", "good");
    }
  }
}

/* ================================================================ benefits */

export function benefitQuote(state: GameState) {
  const p = state.player;
  const city = state.world.cities.find((c) => c.id === p.cityId);
  const wage = city?.avgWage ?? 700000;
  const b = getBiz(state);
  const monthsOn = b.benefits.unemployment ? state.ticks - b.benefits.since : 0;
  const eligible = !p.career.employed && p.age >= 18 && p.age < 65 && !inPrison(state) && liquidCash(p) < livingCostFor(state) * 6;
  return {
    eligible,
    amount: round((wage / 12) * 0.4, 0),
    monthsLeft: Math.max(0, 9 - monthsOn),
    pension: p.age >= 60 ? round(3000 + Math.min(40, p.career.experience) * (wage / 12) * 0.012, 0) : 0,
    reason: p.career.employed
      ? "You have a job."
      : p.age < 18
        ? "Too young."
        : p.age >= 65
          ? "You're on the state pension."
          : liquidCash(p) >= livingCostFor(state) * 6
            ? "Savings above 6 months of living costs."
            : "",
  };
}

export function claimBenefit(state: GameState, log: string[]) {
  const q = benefitQuote(state);
  const b = getBiz(state);
  if (b.benefits.unemployment) {
    log.push("You're already claiming.");
    return;
  }
  if (!q.eligible) {
    log.push(`Not eligible: ${q.reason}`);
    return;
  }
  b.benefits.unemployment = true;
  b.benefits.since = state.ticks;
  log.push(`Registered for unemployment benefit: ${formatINR(q.amount)}/month for up to 9 months while you look for work.`);
}

function tickBenefits(state: GameState) {
  const p = state.player;
  const b = getBiz(state);
  const q = benefitQuote(state);
  if (b.benefits.unemployment) {
    if (!q.eligible || q.monthsLeft <= 0) {
      b.benefits.unemployment = false;
      note(state, p.career.employed ? "Unemployment benefit stopped — you found work." : "Unemployment benefit ended.", "info");
    } else {
      credit(p, q.amount, "Unemployment benefit", "benefit", dt(state));
      bizFlow(state, "benefits", q.amount);
      b.benefits.paid += q.amount;
    }
  }
  if (q.pension > 0 && p.alive) {
    credit(p, q.pension, "State pension", "benefit", dt(state));
    bizFlow(state, "pension", q.pension);
    b.benefits.pension = q.pension;
  }
}

/* ================================================================ AI & jobs */

const AI_ROLES: {
  title: string;
  industry: Industry;
  skills: Partial<Record<SkillId, number>>;
  mult: number;
  edu: number;
  exp: number;
}[] = [
  {
    title: "AI Engineer",
    industry: "ai",
    skills: { ai: 45, ml: 40, programming: 45 },
    mult: 1.9,
    edu: 4,
    exp: 2,
  },
  {
    title: "ML Ops Engineer",
    industry: "ai",
    skills: { ml: 35, programming: 40, data: 30 },
    mult: 1.6,
    edu: 3,
    exp: 2,
  },
  {
    title: "AI Agent Designer",
    industry: "software",
    skills: { ai: 30, operations: 25, writing: 20 },
    mult: 1.3,
    edu: 3,
    exp: 1,
  },
  {
    title: "AI Safety & Compliance Auditor",
    industry: "technology",
    skills: { ai: 30, data: 30, writing: 25 },
    mult: 1.5,
    edu: 4,
    exp: 3,
  },
  {
    title: "Robotics Technician",
    industry: "manufacturing",
    skills: { robotics: 30, engineering: 25 },
    mult: 1.2,
    edu: 2,
    exp: 1,
  },
  {
    title: "AI Product Manager",
    industry: "technology",
    skills: { ai: 25, management: 40, marketing: 20 },
    mult: 2.2,
    edu: 4,
    exp: 5,
  },
  {
    title: "Data Centre Operations Lead",
    industry: "energy",
    skills: { engineering: 30, operations: 35 },
    mult: 1.4,
    edu: 3,
    exp: 3,
  },
  {
    title: "Human-in-the-loop Reviewer",
    industry: "ai",
    skills: { writing: 20, data: 15 },
    mult: 0.6,
    edu: 2,
    exp: 0,
  },
];

/** How much of each industry's hiring AI has absorbed in a country. */
export function aiJobPressure(state: GameState, countryId = state.player.countryId) {
  const c = state.world.countries.find((x) => x.id === countryId);
  const adopt = clamp(((c?.aiAdoption ?? 30) * 0.6 + state.world.tech.ai * 0.4) / 100, 0, 1);
  const rows = INDUSTRIES.map((i) => {
    const cut = i.aiExpose > 0 ? clamp(i.aiExpose * adopt * 1.1, 0, 0.92) : -clamp(-i.aiExpose * adopt * 2, 0, 1.5);
    return { id: i.id, name: i.name, expose: i.aiExpose, cut };
  }).sort((a, b) => b.cut - a.cut);
  const avg = rows.reduce((s, r) => s + Math.max(0, r.cut), 0) / rows.length;
  return { adopt, rows, avgCut: avg };
}

function newListing(state: GameState, cityId: string): JobListing | null {
  const city = state.world.cities.find((c) => c.id === cityId);
  if (!city) return null;
  const country = state.world.countries.find((c) => c.id === city.countryId)!;
  const pres = aiJobPressure(state, country.id);
  const r = R(state);
  // AI-era roles appear once the technology is real
  if (state.world.tech.ai > 30 && chance(r, 0.06 + pres.adopt * 0.18)) {
    const role = pick(r, AI_ROLES);
    const emp =
      pick(
        r,
        state.world.companies.filter((c) => c.countryId === country.id && c.stage !== "bankrupt"),
      ) ?? null;
    return {
      id: uid("job"),
      title: role.title,
      industry: role.industry,
      rank: role.mult > 1.8 ? 6 : role.mult > 1.3 ? 4 : 2,
      countryId: country.id,
      cityId: city.id,
      employer: emp?.name ?? "Frontier Labs",
      employerId: emp?.id,
      salary: Math.round(city.avgWage * role.mult * (0.9 + r() * 0.3)),
      hours: 44,
      educationMin: role.edu,
      experienceMin: role.exp,
      skills: role.skills,
      security: 70,
      bonusPct: 12,
      benefits: 14,
      demand: clamp(60 + pres.adopt * 40, 10, 100),
      type: "full",
    };
  }
  // ordinary roles, weighted away from what AI already does
  const weights = INDUSTRIES.map((i) => {
    const row = pres.rows.find((x) => x.id === i.id)!;
    return {
      i,
      w: Math.max(0.05, 1 - Math.max(0, row.cut)) * (1 + Math.max(0, -row.cut)),
    };
  });
  const tot = weights.reduce((s, x) => s + x.w, 0);
  let u = r() * tot;
  let ind = weights[0]!.i;
  for (const x of weights) {
    u -= x.w;
    if (u <= 0) {
      ind = x.i;
      break;
    }
  }
  // entry-level work goes first
  let rankIdx = 1 + Math.floor(r() * 8);
  const row = pres.rows.find((x) => x.id === ind.id)!;
  if (rankIdx <= 4 && row.cut > 0 && chance(r, row.cut * 0.6)) rankIdx += 3;
  const rank = JOB_RANKS[Math.min(9, rankIdx)]!;
  const emp = pick(
    r,
    state.world.companies.filter((c) => c.countryId === country.id && c.industry === ind.id && c.stage !== "bankrupt"),
  );
  const aiPay = row.cut > 0 ? 1 - row.cut * 0.15 : 1 + -row.cut * 0.1;
  return {
    id: uid("job"),
    title: rank.rank === 10 ? "Chief Executive Officer" : rank.title(INDUSTRY_JOB_LABEL[ind.id] ?? ind.name),
    industry: ind.id,
    rank: rank.rank,
    countryId: country.id,
    cityId: city.id,
    employer: emp?.name ?? `${city.name} ${ind.name} Group`,
    employerId: emp?.id,
    salary: Math.round(city.avgWage * ind.wage * rank.mult * aiPay * (0.9 + r() * 0.2)),
    hours: rank.rank >= 8 ? 55 : rank.rank <= 2 ? 35 : 42,
    educationMin: rank.edu,
    experienceMin: rank.exp,
    skills: Object.fromEntries(ind.skills.map((s, idx) => [s, 20 + rank.rank * 6 - idx * 4])),
    security: clamp(40 + (10 - rank.rank) * 4 - Math.max(0, row.cut) * 40, 5, 95),
    bonusPct: rank.rank >= 6 ? 15 : 5,
    benefits: 8 + rank.rank,
    demand: clamp(55 + city.businessActivity * 0.3 - country.unemployment * 2 - Math.max(0, row.cut) * 30, 5, 100),
    type: chance(r, 0.1) ? "contract" : chance(r, 0.08) ? "part" : "full",
  };
}

/** The job market turns over every month: listings get filled and expire,
 *  new ones open — fewer of them where AI does the work. */
function tickJobs(state: GameState) {
  const b = getBiz(state);
  const r = R(state);
  const cur = state.player.career.job?.id;
  const before = state.world.jobs.length;
  state.world.jobs = state.world.jobs.filter((j) => j.id === cur || !chance(r, 0.07));
  const filled = before - state.world.jobs.length;
  for (const city of state.world.cities) {
    const country = state.world.countries.find((c) => c.id === city.countryId)!;
    const pres = aiJobPressure(state, country.id);
    const target = Math.round(22 * clamp(1 + (country.gdpGrowth - 2) / 15 - country.unemployment / 60, 0.55, 1.35) * (1 - pres.avgCut * 0.55));
    const have = state.world.jobs.filter((j) => j.cityId === city.id).length;
    const add = Math.min(4, Math.max(0, target - have));
    for (let i = 0; i < add; i++) {
      const j = newListing(state, city.id);
      if (j) state.world.jobs.push(j);
    }
    // count what AI took: the gap between the pre-AI target and today's
    b.aiJobsLost = round(b.aiJobsLost * 0.9 + 22 * pres.avgCut * 0.55 * 0.1 * (city.population / 1e5), 0);
  }
  b.jobsTick = state.ticks;
  void filled;
}

/** Your own job's exposure to automation. */
export function jobAiRisk(state: GameState): number {
  const p = state.player;
  const job = p.career.job;
  if (!job) return 0;
  const pres = aiJobPressure(state, job.countryId);
  const row = pres.rows.find((x) => x.id === job.industry);
  if (!row || row.cut <= 0 || AI_ROLES.some((a) => a.title === job.title)) return 0;
  const rankF = job.rank <= 3 ? 1.3 : job.rank <= 6 ? 0.75 : 0.35;
  const shield = certShield(state, job.industry);
  const skill = 1 - Math.min(0.6, ((p.skills.ai ?? 0) + (p.skills.ml ?? 0)) / 250);
  return clamp(row.cut * row.cut * 0.035 * rankF * (1 - shield) * skill * (1.2 - p.career.performance / 150), 0, 0.08);
}

function tickAiLayoffs(state: GameState) {
  const p = state.player;
  if (!p.career.employed || !p.career.job) return;
  if (state.pending.some((d) => d.kind === "ailayoff")) return;
  const risk = jobAiRisk(state);
  if (!chance(R(state), risk)) return;
  const job = p.career.job;
  state.pending.push({
    id: uid("dec"),
    kind: "ailayoff",
    title: "Your role is being automated",
    body: `${job.employer} is rolling out AI agents across ${INDUSTRY_JOB_LABEL[job.industry] ?? job.industry}. Your position (${job.title}) is on the list. HR offers you a choice.`,
    year: state.time.year,
    month: state.time.month,
    options: [
      {
        id: "transition",
        label: "Volunteer for the AI transition team",
        hint: `Odds rise with AI/data skills (${Math.round(clamp(0.25 + (p.skills.ai ?? 0) / 120 + (p.skills.data ?? 0) / 250, 0.1, 0.9) * 100)}%)`,
      },
      {
        id: "paycut",
        label: "Accept a 20% pay cut to stay",
        hint: "Keeps the job — for now",
      },
      {
        id: "package",
        label: "Take the package",
        hint: `4 months' pay · ${formatINR((job.salary / 12) * 4)}`,
      },
      {
        id: "fight",
        label: "Organise colleagues and push back",
        hint: "35% keep your job, else 1 month's pay",
      },
    ],
    context: { jobId: job.id },
  });
}

export function resolveAiLayoff(state: GameState, opt: string, log: string[]) {
  const p = state.player;
  const job = p.career.job;
  if (!job) return;
  const leave = (months: number, why: string) => {
    const pay = round((job.salary / 12) * months, 0);
    if (pay > 0) {
      credit(p, pay, `Severance · ${job.employer}`, "salary", dt(state));
      bizFlow(state, "salary", pay);
    }
    p.career.history.push({
      title: job.title,
      employer: job.employer,
      start: "",
      end: dt(state),
      salary: job.salary,
    });
    p.career.job = null;
    p.career.employed = false;
    p.happiness = clamp(p.happiness - 8, 1, 100);
    p.stress = clamp(p.stress + 10, 0, 100);
    getBiz(state).aiJobsLost += 1;
    timeline(state, `Replaced by AI at ${job.employer} (${why}).`, "career");
    log.push(`You're out. ${pay ? `Severance ${formatINR(pay)}.` : ""} Unemployment benefit is available from Government.`);
  };
  if (opt === "transition") {
    const ok = chance(R(state), clamp(0.25 + (p.skills.ai ?? 0) / 120 + (p.skills.data ?? 0) / 250, 0.1, 0.9));
    if (ok) {
      job.salary = Math.round(job.salary * 1.1);
      job.title = `${job.title} (AI Transition)`;
      job.security = clamp(job.security + 20, 0, 100);
      p.skills.ai = clamp((p.skills.ai ?? 0) + 8, 0, 100);
      log.push("You made the transition team. You now run the agents that replaced your colleagues. +10% pay.");
      timeline(state, `Moved onto the AI transition team at ${job.employer}.`, "career");
    } else leave(2, "transition team full");
  } else if (opt === "paycut") {
    job.salary = Math.round(job.salary * 0.8);
    job.security = clamp(job.security - 10, 0, 100);
    p.happiness = clamp(p.happiness - 4, 1, 100);
    log.push(`You kept the job at ${formatINR(job.salary)}/yr. The agents are still learning your tasks.`);
  } else if (opt === "package") {
    leave(4, "took the package");
  } else {
    p.reputation.professional = clamp(p.reputation.professional + 3, 0, 100);
    if (chance(R(state), 0.35)) {
      log.push("The pushback worked: management kept a human team, including you.");
      job.security = clamp(job.security + 5, 0, 100);
    } else leave(1, "pushback failed");
  }
}

/* ================================================================ education */

export const EXTRA_TRACKS: {
  id: EducationTrack;
  name: string;
  skills: SkillId[];
}[] = [
  {
    id: "data_science",
    name: "Data Science",
    skills: ["data", "ml", "math", "programming"],
  },
  {
    id: "cybersecurity",
    name: "Cybersecurity",
    skills: ["cybersecurity", "programming", "data"],
  },
  {
    id: "nursing",
    name: "Nursing",
    skills: ["data", "leadership", "operations"],
  },
  {
    id: "aviation",
    name: "Aviation & Aerospace",
    skills: ["engineering", "math", "operations"],
  },
  {
    id: "hospitality",
    name: "Hospitality Management",
    skills: ["operations", "management", "sales"],
  },
  {
    id: "psychology",
    name: "Psychology",
    skills: ["speaking", "writing", "data"],
  },
  {
    id: "architecture",
    name: "Architecture",
    skills: ["engineering", "construction", "realestate"],
  },
  {
    id: "robotics",
    name: "Robotics & Automation",
    skills: ["robotics", "engineering", "ai", "programming"],
  },
];

export interface CertDef {
  id: string;
  name: string;
  cost: number;
  months: number;
  edu: number;
  track: EducationTrack;
  skills: Partial<Record<SkillId, number>>;
  industries: Industry[];
  /** How much of the AI layoff risk it removes in those industries. */
  shield: number;
  pay: number;
  blurb: string;
}

export const CERTS: CertDef[] = [
  {
    id: "cfa",
    name: "CFA Charter",
    cost: 350000,
    months: 18,
    edu: 4,
    track: "finance",
    skills: { finance: 18, accounting: 10, math: 8 },
    industries: ["finance", "banking", "insurance"],
    shield: 0.35,
    pay: 0.12,
    blurb: "Three brutal exams. The finance world's gold standard.",
  },
  {
    id: "ca",
    name: "Chartered Accountant",
    cost: 280000,
    months: 30,
    edu: 3,
    track: "finance",
    skills: { accounting: 25, finance: 10 },
    industries: ["finance", "banking", "insurance"],
    shield: 0.3,
    pay: 0.14,
    blurb: "Articleship plus exams. Every company needs one.",
  },
  {
    id: "pmp",
    name: "Project Management Professional",
    cost: 60000,
    months: 4,
    edu: 3,
    track: "business",
    skills: { management: 12, operations: 8 },
    industries: ["technology", "software", "construction", "manufacturing", "logistics", "energy"],
    shield: 0.2,
    pay: 0.07,
    blurb: "Deliver projects on time — and prove it.",
  },
  {
    id: "cloud",
    name: "Cloud Solutions Architect",
    cost: 45000,
    months: 3,
    edu: 2,
    track: "computer_science",
    skills: { programming: 10, cybersecurity: 6, data: 5 },
    industries: ["technology", "software", "ai", "ecommerce"],
    shield: 0.2,
    pay: 0.08,
    blurb: "Design the systems the AI runs on.",
  },
  {
    id: "aiml",
    name: "Applied AI/ML Engineer",
    cost: 150000,
    months: 6,
    edu: 3,
    track: "ai",
    skills: { ai: 18, ml: 18, programming: 8 },
    industries: INDUSTRIES.map((i) => i.id),
    shield: 0.5,
    pay: 0.1,
    blurb: "Build and fine-tune models. The most AI-proof skill is building AI.",
  },
  {
    id: "agentops",
    name: "AI Agent Operations",
    cost: 25000,
    months: 2,
    edu: 2,
    track: "ai",
    skills: { ai: 10, operations: 8 },
    industries: INDUSTRIES.map((i) => i.id),
    shield: 0.3,
    pay: 0.04,
    blurb: "Supervise AI agents instead of being replaced by them.",
  },
  {
    id: "cissp",
    name: "Certified Security Professional",
    cost: 90000,
    months: 5,
    edu: 3,
    track: "cybersecurity",
    skills: { cybersecurity: 20, programming: 5 },
    industries: ["technology", "software", "banking", "finance", "ai"],
    shield: 0.35,
    pay: 0.1,
    blurb: "Someone has to defend the systems.",
  },
  {
    id: "bar",
    name: "Bar Licence",
    cost: 120000,
    months: 6,
    edu: 4,
    track: "law",
    skills: { writing: 10, negotiation: 12, politics: 6 },
    industries: ["finance", "realestate", "media", "insurance"],
    shield: 0.25,
    pay: 0.15,
    blurb: "Needs a law degree. Lets you practise.",
  },
  {
    id: "realtor",
    name: "Real Estate Broker Licence",
    cost: 30000,
    months: 2,
    edu: 2,
    track: "real_estate",
    skills: { realestate: 14, negotiation: 8, sales: 6 },
    industries: ["realestate", "construction"],
    shield: 0.15,
    pay: 0.08,
    blurb: "List, show and close deals.",
  },
  {
    id: "sixsigma",
    name: "Six Sigma Black Belt",
    cost: 70000,
    months: 4,
    edu: 3,
    track: "engineering",
    skills: { manufacturing: 12, operations: 12, logistics: 6 },
    industries: ["manufacturing", "logistics", "energy", "retail"],
    shield: 0.2,
    pay: 0.08,
    blurb: "Waste out, quality in.",
  },
  {
    id: "medlicence",
    name: "Medical Licence",
    cost: 250000,
    months: 12,
    edu: 4,
    track: "medicine",
    skills: { data: 10, leadership: 8 },
    industries: ["healthcare"],
    shield: 0.55,
    pay: 0.25,
    blurb: "Needs a medicine degree. Residency included.",
  },
];

export const STUDY_LEVELS: {
  id: EducationRecord["level"];
  name: string;
  tuition: number;
  years: number;
  minEdu: number;
  grants: number;
  skill: number;
}[] = [
  {
    id: "course",
    name: "Short course",
    tuition: 18000,
    years: 0.33,
    minEdu: 0,
    grants: 0,
    skill: 5,
  },
  {
    id: "vocational",
    name: "Vocational diploma",
    tuition: 40000,
    years: 1.5,
    minEdu: 1,
    grants: 3,
    skill: 10,
  },
  {
    id: "college",
    name: "College diploma",
    tuition: 90000,
    years: 2,
    minEdu: 2,
    grants: 3,
    skill: 12,
  },
  {
    id: "university",
    name: "Bachelor's degree",
    tuition: 220000,
    years: 3.5,
    minEdu: 2,
    grants: 4,
    skill: 18,
  },
  {
    id: "masters",
    name: "Master's / MBA",
    tuition: 650000,
    years: 2,
    minEdu: 4,
    grants: 5,
    skill: 16,
  },
  {
    id: "phd",
    name: "Doctorate (PhD)",
    tuition: 150000,
    years: 4,
    minEdu: 5,
    grants: 6,
    skill: 22,
  },
];

export const allTracks = () => [...TRACKS, ...EXTRA_TRACKS];

export function studyYears(rec: EducationRecord): number {
  if (rec.level === "certification") {
    const c = CERTS.find((x) => x.id === (rec as EducationRecord & { certId?: string }).certId);
    return (c?.months ?? 6) / 12;
  }
  return STUDY_LEVELS.find((l) => l.id === rec.level)?.years ?? 2;
}

/** Graduation: level, real skills, and certification credentials. */
export function completeStudy(state: GameState, rec: EducationRecord) {
  const p = state.player;
  const lvl = STUDY_LEVELS.find((l) => l.id === rec.level);
  if (lvl?.grants) p.educationLevel = Math.max(p.educationLevel, lvl.grants);
  const gpaF = 0.7 + rec.gpa / 10;
  if (rec.level === "certification") {
    const c = CERTS.find((x) => x.id === (rec as EducationRecord & { certId?: string }).certId);
    if (c) {
      for (const [k, v] of Object.entries(c.skills)) p.skills[k] = clamp((p.skills[k] ?? 0) + (v ?? 0) * gpaF, 0, 100);
      const b = getBiz(state);
      if (!b.certs.includes(c.id)) b.certs.push(c.id);
      p.reputation.professional = clamp(p.reputation.professional + 4, 0, 100);
    }
  } else {
    const t = allTracks().find((x) => x.id === rec.track);
    for (const s of t?.skills ?? []) p.skills[s] = clamp((p.skills[s] ?? 0) + (lvl?.skill ?? 8) * gpaF * (1.1 - (p.skills[s] ?? 0) / 140), 0, 100);
    if (rec.level === "masters" || rec.level === "phd") p.reputation.professional = clamp(p.reputation.professional + 6, 0, 100);
    if (rec.level === "phd") unlock(state, "doctor");
  }
  getLife(state).smarts = clamp(getLife(state).smarts + (lvl?.grants ?? 1) * 0.8, 0, 100);
}

export function startCert(state: GameState, certId: string, log: string[]) {
  const p = state.player;
  const c = CERTS.find((x) => x.id === certId);
  if (!c) return;
  if (p.currentStudy) {
    log.push("Finish (or drop) your current studies first.");
    return;
  }
  if (getBiz(state).certs.includes(c.id)) {
    log.push("You already hold that certification.");
    return;
  }
  if (p.educationLevel < c.edu) {
    log.push(`${c.name} needs education level ${c.edu} (you have ${p.educationLevel}).`);
    return;
  }
  if (
    (c.id === "bar" && !p.education.some((e) => e.completed && e.track === "law" && ["university", "masters", "phd"].includes(e.level))) ||
    (c.id === "medlicence" && !p.education.some((e) => e.completed && e.track === "medicine" && ["university", "masters", "phd"].includes(e.level)))
  ) {
    log.push(`${c.name} requires a completed ${c.id === "bar" ? "law" : "medicine"} degree.`);
    return;
  }
  if (!spend(p, c.cost, `${c.name} fees`, "edu", dt(state))) {
    log.push(`${c.name} costs ${formatINR(c.cost)}.`);
    return;
  }
  bizFlow(state, "tuition", -c.cost);
  const rec: EducationRecord & { certId?: string } = {
    id: uid("edu"),
    level: "certification",
    name: c.name,
    track: c.track,
    institution: "Professional body",
    countryId: p.countryId,
    startYear: state.time.year,
    endYear: null,
    tuition: 0,
    scholarship: 0,
    loan: 0,
    gpa: 3,
    completed: false,
    inProgress: true,
    certId: c.id,
  };
  (rec as EducationRecord & { startTick?: number }).startTick = state.ticks;
  p.education.push(rec);
  p.currentStudy = rec;
  log.push(`Enrolled: ${c.name}. ${c.months} months, fees ${formatINR(c.cost)} paid up front.`);
}

export function certShield(state: GameState, ind: Industry): number {
  const held = getBiz(state).certs;
  return CERTS.filter((c) => held.includes(c.id) && c.industries.includes(ind)).reduce((m, c) => Math.max(m, c.shield), 0);
}

export function certPay(state: GameState, ind: Industry): number {
  const held = getBiz(state).certs;
  return CERTS.filter((c) => held.includes(c.id) && c.industries.includes(ind)).reduce((m, c) => Math.max(m, c.pay), 0);
}

/* ================================================================ gifts */

export function giftTo(state: GameState, personId: string, kind: "cash" | "vehicle" | "property" | "shares", ref: string, amountRaw: number, log: string[]) {
  const L = getLife(state);
  const p = state.player;
  const person = L.people.find((x) => x.id === personId && x.alive);
  if (!person) {
    log.push("They're not around to receive it.");
    return;
  }
  let value = 0;
  let what = "";
  if (kind === "cash") {
    const amt = Math.round(money(amountRaw));
    if (amt < 100) {
      log.push("Enter an amount of at least ₹100.");
      return;
    }
    if (!spend(p, amt, `Gift to ${person.name}`, "gift", dt(state))) {
      log.push("You don't have that much liquid cash.");
      return;
    }
    value = amt;
    what = `${formatINR(amt)} in cash`;
    bizFlow(state, "gifts", -amt);
  } else if (kind === "vehicle") {
    const v = L.vehicles.find((x) => x.id === ref);
    if (!v) {
      log.push("Pick one of your vehicles.");
      return;
    }
    L.vehicles = L.vehicles.filter((x) => x.id !== ref);
    value = v.value;
    what = `your ${v.name}`;
  } else if (kind === "property") {
    const pr = p.properties.find((x) => x.id === ref);
    if (!pr) {
      log.push("Pick one of your properties.");
      return;
    }
    if (pr.mortgaged) {
      log.push("Clear the mortgage before you can transfer the title.");
      return;
    }
    p.properties = p.properties.filter((x) => x.id !== ref);
    delete getBiz(state).estates[ref];
    value = pr.value;
    what = pr.name;
  } else {
    const h = p.holdings.find((x) => x.ticker === ref);
    const co = state.world.companies.find((c) => c.ticker === ref);
    if (!h || !co) {
      log.push("Pick a stock you hold.");
      return;
    }
    const n = Math.max(1, Math.min(h.shares, Math.round(money(amountRaw)) || h.shares));
    h.shares -= n;
    if (h.shares <= 0) p.holdings = p.holdings.filter((x) => x.ticker !== ref);
    value = n * co.price;
    what = `${n} shares of ${co.ticker}`;
  }
  // gift tax: gifts to non-relatives above ₹50,000 are taxable income for them —
  // modelled as a 10% stamp/gift duty you pay on big non-family transfers
  const family = ["parent", "sibling", "child", "spouse", "partner", "grandparent"].includes(person.rel);
  if (!family && value > 50000) {
    const duty = round(value * 0.1, 0);
    const paid = spendUpTo(p, duty, `Gift duty · ${person.name}`, "tax", dt(state));
    bizFlow(state, "taxReturn", -paid.paid);
    log.push(`Gift duty ${formatINR(paid.paid)} (transfers above ₹50,000 to non-relatives).`);
  }
  const rel = value / Math.max(20000, person.wealth * 0.15 + 20000);
  const gain = clamp(Math.round(4 + Math.log10(1 + rel * 9) * 18), 2, 40);
  person.bond = clamp(person.bond + gain, 0, 100);
  person.wealth += value;
  p.happiness = clamp(p.happiness + Math.min(6, gain / 5), 1, 100);
  getLife(state).karma = clamp(getLife(state).karma + Math.min(6, gain / 6), 0, 100);
  const b = getBiz(state);
  b.gifts.unshift({
    t: dt(state),
    to: person.name,
    what,
    value: round(value, 0),
  });
  if (b.gifts.length > 40) b.gifts.length = 40;
  if (value >= 1e6) timeline(state, `Gave ${person.name} ${what}.`, "life");
  log.push(`You gave ${person.name} ${what}. Relationship +${gain}.${value > person.wealth * 0.5 && value > 500000 ? " It changes their life." : ""}`);
}

/* ================================================================ queue & tick */

function runQueue(state: GameState) {
  const b = getBiz(state);
  const due = b.queue.filter((q) => q.due <= state.ticks);
  if (!due.length) return;
  b.queue = b.queue.filter((q) => q.due > state.ticks);
  for (const q of due) {
    if (q.kind === "audit") runAudit(state, q.data);
    else if (q.kind === "taxDeadline") {
      const year = Number(q.data.year);
      const pending = state.pending.find((d) => d.kind === "tax" && Number(d.context.year) === year);
      const filed = b.returns.some((r) => r.year === year);
      if (!filed) {
        if (pending) state.pending = state.pending.filter((d) => d !== pending);
        const due = Number(q.data.due);
        if (due > 0) {
          const late = round(due * 1.12 + 10000, 0);
          b.returns.unshift({
            year,
            income: 0,
            due,
            paid: 0,
            choice: "late",
            audited: false,
            penalty: late - due,
            status: "late",
          });
          note(state, `You missed the July deadline for your ${year} return. Assessed at ${formatINR(late)} including interest and a late fee.`, "bad");
          payTax(state, late, `${year} tax (late assessment)`);
        } else if (due < 0) {
          b.returns.unshift({
            year,
            income: 0,
            due,
            paid: due,
            choice: "late",
            audited: false,
            penalty: 0,
            status: "settled",
          });
          credit(state.player, -due, `${year} tax refund (late)`, "tax", dt(state));
          bizFlow(state, "taxReturn", -due);
        }
      }
    } else if (q.kind.startsWith("hq:") || q.kind.startsWith("est:") || q.kind.startsWith("cas:")) {
      queueHandlers[q.kind.split(":")[0]!]?.(state, q.kind, q.data);
    }
  }
}

/** Other modules register delayed-consequence handlers here. */
export const queueHandlers: Record<string, (state: GameState, kind: string, data: Record<string, string | number>) => void> = {};

/** Monthly civic tick: taxes, benefits, jobs, AI. Runs after the money tick. */
export function tickCivic(state: GameState) {
  runQueue(state);
  tickTaxes(state);
  tickBenefits(state);
  tickJobs(state);
  tickAiLayoffs(state);
}

/** Study progress by elapsed months (the old year-arithmetic graduated a
 *  four-month course in January). */
export function studyDone(state: GameState, rec: EducationRecord): boolean {
  const r = rec as EducationRecord & { startTick?: number };
  if (r.startTick == null) r.startTick = state.ticks - Math.max(0, (state.time.year - rec.startYear) * 12);
  return (state.ticks - r.startTick) / 12 >= studyYears(rec);
}
