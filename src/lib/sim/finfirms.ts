// Finance firms you run and finance people you hire:
//  • your own bank — set deposit and lending rates, risk appetite, staff,
//    branches and dividend policy; NPLs, capital ratio, regulators and runs;
//    buy an existing bank, sell yours.
//  • brokerage firms — hire junior/senior/star brokers who bring clients and
//    assets; earn commissions (which rise with volatility) and fees; compliance
//    keeps rogue brokers in check.
//  • a personal stockbroker who manages money for you.
//  • fixed deposits with an early-break penalty.
import type { BankInst, Decision, GameState } from "./types";
import { bizFlow, getBiz, type BankOps, type Brokerage, type BrokerTier, type FixedDeposit, type PersonalBroker } from "./biz";
import { credit, money, spend, spendUpTo } from "./finance";
import { history, news, note, timeline, unlock } from "./feed";
import { ledger } from "./advanced";
import { rng } from "./engine";
import { taxGain } from "./civic";
import { chance, clamp, formatDate, formatINR, normal, pick, round, uid } from "./util";

const dt = (s: GameState) => formatDate(s.time.year, s.time.month);
const R = (s: GameState) => () => rng(s);
const countryOf = (s: GameState, id: string) => s.world.countries.find((c) => c.id === id)!;

/* ================================================================ bank */

export function getBankOps(state: GameState, b: BankInst): BankOps {
  const biz = getBiz(state);
  let ops = biz.banks[b.id];
  if (!ops) {
    // start priced at the market, not at whatever the charter said
    const mkt = bankMarket(state, b);
    ops = {
      depositRate: mkt.deposit,
      lendingRate: mkt.lending,
      risk: 35,
      auto: true,
      staff: Math.max(3, Math.round((b.deposits + b.loans) / 1.5e8 + b.branches * 3)),
      marketing: 0,
      dividendPct: 0.4,
      trust: 55,
      warnings: 0,
      last: null,
      history: [],
    };
    biz.banks[b.id] = ops;
  }
  return ops;
}

export function bankMarket(state: GameState, b: BankInst) {
  const c = countryOf(state, b.countryId);
  return {
    deposit: round(c.interestRate * 0.55, 2),
    lending: round(c.interestRate + 3.5, 2),
    policy: c.interestRate,
  };
}

export function staffNeed(b: BankInst) {
  return Math.max(2, Math.round((b.deposits + b.loans) / 1.5e8 + b.branches * 3));
}

export function capitalRatio(b: BankInst, ops: BankOps) {
  return b.capital / Math.max(1, b.loans * (0.6 + ops.risk / 200));
}

function tickOneBank(state: GameState, b: BankInst) {
  const ops = getBankOps(state, b);
  const c = countryOf(state, b.countryId);
  const city = state.world.cities.find((x) => x.countryId === b.countryId);
  const wage = city?.avgWage ?? 800000;
  const mkt = bankMarket(state, b);
  if (ops.auto !== false) {
    // treasury desk reprices to the market each month
    ops.depositRate = mkt.deposit;
    ops.lendingRate = mkt.lending;
  }
  const service = clamp(ops.staff / staffNeed(b), 0.3, 1.3);
  const mktEff = Math.min(0.03, (ops.marketing / Math.max(1e6, b.deposits)) * 0.6);
  const gD = clamp(
    0.006 + (ops.depositRate - mkt.deposit) * 0.012 + b.branches * 0.0008 + (ops.trust - 50) / 5000 + mktEff + (service - 1) * 0.012,
    -0.1,
    0.09,
  );
  const depositFlow = b.deposits * gD;
  b.deposits = Math.max(0, b.deposits + depositFlow);
  const rw = 0.6 + ops.risk / 200;
  // idle deposits cost money: loan officers push to lend them out
  const idle = (b.deposits * 0.8 - b.loans) / Math.max(1, b.deposits);
  const gL = clamp(0.006 + idle * 0.03 + (mkt.lending - ops.lendingRate) * 0.009 + ops.risk / 7000 + c.gdpGrowth / 1200 + (service - 1) * 0.006, -0.06, 0.09);
  const maxLoans = Math.min(b.deposits * 0.92 + b.capital, b.capital / (0.09 * rw));
  const before = b.loans;
  b.loans = clamp(b.loans * (1 + gL), 0, Math.max(0, maxLoans));
  const loanFlow = b.loans - before;
  const nplTarget =
    1.2 +
    ops.risk * 0.06 +
    Math.max(0, -c.gdpGrowth) * 1.3 +
    Math.max(0, ops.lendingRate - mkt.lending) * 0.35 +
    (c.unemployment - 6) * 0.2 +
    (service < 0.8 ? 1.5 : 0);
  b.npl = clamp(b.npl + (nplTarget - b.npl) * 0.08, 0.3, 40);
  const nii = b.loans * (ops.lendingRate / 100 / 12) * (1 - b.npl / 100) - b.deposits * (ops.depositRate / 100 / 12);
  // account, card and processing fees
  const fees = b.deposits * (0.008 / 12) + b.loans * (0.01 / 12);
  const opex = ops.staff * ((wage * 1.1) / 12) + b.branches * 150000 + ops.marketing;
  const chargeoffs = b.loans * (b.npl / 100) * 0.035;
  b.loans = Math.max(0, b.loans - chargeoffs);
  const pretax = nii + fees - opex - chargeoffs;
  const tax = Math.max(0, pretax) * (c.corpTax / 100);
  const net = pretax - tax;
  let dividend = 0;
  if (net > 0 && capitalRatio(b, ops) > 0.12) dividend = round(net * ops.dividendPct, 0);
  b.capital += net - dividend;
  b.profit = net;
  b.savingsRate = ops.depositRate;
  b.lendingRate = ops.lendingRate;
  if (dividend > 0) {
    credit(state.player, dividend, `Dividend · ${b.name}`, "biz", dt(state));
    bizFlow(state, "bankDiv", dividend);
  }
  const cr = capitalRatio(b, ops);
  ops.trust = clamp(ops.trust + (cr > 0.14 ? 0.3 : -0.8) + (b.npl < 3 ? 0.2 : -0.5) + (service > 0.9 ? 0.1 : -0.3), 0, 100);
  ops.last = {
    t: dt(state),
    nii: round(nii, 0),
    fees: round(fees, 0),
    opex: round(opex, 0),
    chargeoffs: round(chargeoffs, 0),
    tax: round(tax, 0),
    net: round(net, 0),
    dividend,
    capitalRatio: round(cr, 4),
    depositFlow: round(depositFlow, 0),
    loanFlow: round(loanFlow, 0),
  };
  ops.history.unshift({
    t: dt(state),
    capital: round(b.capital, 0),
    deposits: round(b.deposits, 0),
    loans: round(b.loans, 0),
    net: round(net, 0),
  });
  if (ops.history.length > 36) ops.history.length = 36;

  // regulators and depositors
  if (cr < 0.105 && cr >= 0.08 && chance(R(state), 0.3)) {
    ops.warnings += 1;
    note(state, `${b.name}: the regulator warns your capital ratio (${(cr * 100).toFixed(1)}%) is below the 10.5% buffer. Dividends are blocked.`, "warn");
  }
  if (cr < 0.08 && !state.pending.some((d) => d.kind === "bankcap" && d.context.bankId === b.id)) {
    const need = round(Math.max(0, b.loans * rw * 0.11 - b.capital), 0);
    state.pending.push({
      id: uid("dec"),
      kind: "bankcap",
      title: `${b.name} is under-capitalised`,
      body: `Capital ratio ${(cr * 100).toFixed(1)}% is below the 8% legal minimum. The regulator demands action within the month. Restoring 11% needs about ${formatINR(need)}.`,
      year: state.time.year,
      month: state.time.month,
      options: [
        {
          id: "inject",
          label: `Inject ${formatINR(need)}`,
          hint: "From your cash",
        },
        {
          id: "shrink",
          label: "Shrink the loan book 25%",
          hint: "Sell loans at a 6% loss",
        },
        {
          id: "ignore",
          label: "Ignore the regulator",
          hint: "Depositors may run",
        },
      ],
      context: { bankId: b.id, need },
    } as Decision);
  }
  if ((cr < 0.06 || ops.trust < 22) && chance(R(state), 0.25)) bankRun(state, b, ops);
  if (b.capital <= 0) failBank(state, b);
}

function bankRun(state: GameState, b: BankInst, ops: BankOps) {
  const out = b.deposits * (0.2 + rng(state) * 0.2);
  b.deposits -= out;
  ops.trust = clamp(ops.trust - 15, 0, 100);
  // meet withdrawals: if loans exceed what deposits and capital can fund, sell loans at a loss
  const gap = b.loans - (b.deposits * 0.92 + b.capital);
  if (gap > 0) {
    b.loans -= gap;
    b.capital -= gap * 0.15;
  }
  history(state, "finance", `Bank run at ${b.name}`);
  news(
    state,
    `Queues outside ${b.name}`,
    `Depositors pulled ${formatINR(out)} in days after doubts about its capital.`,
    "economy",
    b.countryId,
    "Bank stocks fall; regulator watching.",
  );
  note(state, `BANK RUN: depositors withdrew ${formatINR(out)} from ${b.name}.${gap > 0 ? ` Loans sold at a loss to pay them.` : ""}`, "bad");
}

function failBank(state: GameState, b: BankInst) {
  b.playerOwned = false;
  b.capital = Math.max(0, b.deposits * 0.08);
  b.name = `${b.name} (resolved)`;
  delete getBiz(state).banks[b.id];
  timeline(state, `Your bank ${b.name} failed and was seized by the regulator.`, "business");
  news(
    state,
    `${b.name} fails; regulator takes over`,
    "Shareholders are wiped out. Insured deposits are protected.",
    "economy",
    b.countryId,
    "A bank failure rattles confidence.",
  );
  note(state, `${b.name} failed. The regulator seized it and your equity is gone.`, "bad");
  state.player.reputation.business = clamp(state.player.reputation.business - 15, 0, 100);
}

export function resolveBankCap(state: GameState, d: Decision, opt: string, log: string[]) {
  const b = state.world.banks.find((x) => x.id === d.context.bankId);
  if (!b || !b.playerOwned) return;
  const ops = getBankOps(state, b);
  if (opt === "inject") {
    const need = Number(d.context.need);
    const paid = spendUpTo(state.player, need, `Recapitalise ${b.name}`, "biz", dt(state));
    bizFlow(state, "stakes", -paid.paid);
    b.capital += paid.paid;
    ops.trust = clamp(ops.trust + 8, 0, 100);
    log.push(`Injected ${formatINR(paid.paid)}. Capital ratio ${(capitalRatio(b, ops) * 100).toFixed(1)}%.`);
  } else if (opt === "shrink") {
    const cut = b.loans * 0.25;
    b.loans -= cut;
    b.capital -= cut * 0.06;
    log.push(`Sold ${formatINR(cut)} of loans at a 6% loss. Ratio ${(capitalRatio(b, ops) * 100).toFixed(1)}%.`);
  } else {
    ops.trust = clamp(ops.trust - 12, 0, 100);
    log.push("You ignored the regulator. Word is getting out.");
  }
}

export function bankSet(
  state: GameState,
  bankId: string,
  patch: Partial<Pick<BankOps, "depositRate" | "lendingRate" | "risk" | "staff" | "marketing" | "dividendPct">> & { auto?: boolean },
  log: string[],
) {
  const b = state.world.banks.find((x) => x.id === bankId && x.playerOwned);
  if (!b) {
    log.push("You don't own that bank.");
    return;
  }
  const ops = getBankOps(state, b);
  if (patch.auto === true) ops.auto = true;
  if (patch.depositRate != null || patch.lendingRate != null) ops.auto = false;
  if (patch.depositRate != null) ops.depositRate = clamp(round(patch.depositRate, 2), 0, 20);
  if (patch.lendingRate != null) ops.lendingRate = clamp(round(patch.lendingRate, 2), 1, 40);
  if (patch.risk != null) ops.risk = clamp(Math.round(patch.risk), 0, 100);
  if (patch.staff != null) {
    const n = clamp(Math.round(patch.staff), 1, 100000);
    if (n < ops.staff) {
      const wage = state.world.cities.find((x) => x.countryId === b.countryId)?.avgWage ?? 800000;
      b.capital -= (ops.staff - n) * (wage / 12) * 2;
    }
    ops.staff = n;
  }
  if (patch.marketing != null) ops.marketing = clamp(Math.round(patch.marketing), 0, 1e10);
  if (patch.dividendPct != null) ops.dividendPct = clamp(patch.dividendPct > 1 ? patch.dividendPct / 100 : patch.dividendPct, 0, 1);
  const mkt = bankMarket(state, b);
  log.push(
    `${b.name}: deposits ${ops.depositRate}% (market ${mkt.deposit}%), loans ${ops.lendingRate}% (market ${mkt.lending}%), risk ${ops.risk}, ${ops.staff} staff (need ≈${staffNeed(b)}), dividends ${Math.round(ops.dividendPct * 100)}%${ops.auto !== false ? ", rates auto-track the market" : ""}.`,
  );
}

export function bankBranch(state: GameState, bankId: string, delta: number, log: string[]) {
  const b = state.world.banks.find((x) => x.id === bankId && x.playerOwned);
  if (!b) return;
  if (delta > 0) {
    const cost = 5_000_000;
    if (b.capital < cost * 2) {
      log.push("The bank's capital is too thin to fund a new branch.");
      return;
    }
    b.capital -= cost;
    b.branches += 1;
    log.push(`Opened branch #${b.branches} (${formatINR(cost)} fit-out). Branches pull in deposits; each costs ₹1.5L/month and wants ~3 staff.`);
  } else if (b.branches > 1) {
    b.branches -= 1;
    getBankOps(state, b).trust -= 2;
    log.push("Closed a branch.");
  }
}

export function bankCapital(state: GameState, bankId: string, amountRaw: number, log: string[]) {
  const b = state.world.banks.find((x) => x.id === bankId && x.playerOwned);
  if (!b) return;
  const ops = getBankOps(state, b);
  const amt = Math.round(money(amountRaw));
  if (amt > 0) {
    if (!spend(state.player, amt, `Capital into ${b.name}`, "biz", dt(state))) {
      log.push("Not enough cash.");
      return;
    }
    bizFlow(state, "stakes", -amt);
    b.capital += amt;
    log.push(`Injected ${formatINR(amt)}. Capital ratio ${(capitalRatio(b, ops) * 100).toFixed(1)}%.`);
  } else if (amt < 0) {
    const take = -amt;
    const after = (b.capital - take) / Math.max(1, b.loans * (0.6 + ops.risk / 200));
    if (after < 0.12 || take > b.capital) {
      log.push("The regulator won't let capital fall below a 12% ratio.");
      return;
    }
    b.capital -= take;
    credit(state.player, take, `Capital returned · ${b.name}`, "biz", dt(state));
    bizFlow(state, "stakes", take);
    log.push(`Withdrew ${formatINR(take)} of surplus capital.`);
  }
}

export function bankValue(state: GameState, b: BankInst): number {
  const roe = (b.profit * 12) / Math.max(1, b.capital);
  const pb = clamp(0.8 + roe * 6, 0.4, 2.5);
  return round(Math.max(0, b.capital) * pb, 0);
}

export function buyBank(state: GameState, bankId: string, log: string[]) {
  const b = state.world.banks.find((x) => x.id === bankId);
  if (!b || b.playerOwned) return;
  const price = round(bankValue(state, b) * 1.25, 0);
  if (!spend(state.player, price, `Acquire ${b.name}`, "biz", dt(state))) {
    log.push(`Buying ${b.name} costs ${formatINR(price)} (1.25× its market value).`);
    return;
  }
  bizFlow(state, "stakes", -price);
  b.playerOwned = true;
  const ops = getBankOps(state, b);
  ops.depositRate = b.savingsRate;
  ops.lendingRate = b.lendingRate;
  ops.staff = staffNeed(b);
  unlock(state, "banker");
  ledger(state, `Acquired ${b.name}`, -price);
  timeline(state, `Acquired ${b.name} for ${formatINR(price)}.`, "business");
  news(
    state,
    `${state.player.name} buys ${b.name}`,
    `A ${formatINR(price)} deal puts a private owner in charge of a national lender.`,
    "business",
    b.countryId,
    "Rates may move.",
  );
  log.push(`You own ${b.name}. Set its rates and risk from Banking → Your bank.`);
}

export function sellBank(state: GameState, bankId: string, log: string[]) {
  const b = state.world.banks.find((x) => x.id === bankId && x.playerOwned);
  if (!b) return;
  const price = bankValue(state, b);
  b.playerOwned = false;
  delete getBiz(state).banks[b.id];
  credit(state.player, price, `Sale of ${b.name}`, "biz", dt(state));
  bizFlow(state, "stakes", price);
  taxGain(state, price * 0.5);
  ledger(state, `Sold ${b.name}`, price);
  log.push(`Sold ${b.name} for ${formatINR(price)}.`);
}

/* ================================================================ FDs */

export function fdRate(state: GameState, bankId: string, months: number): number {
  const b = state.world.banks.find((x) => x.id === bankId);
  if (!b) return 0;
  return round(b.savingsRate + (months >= 60 ? 2.0 : months >= 36 ? 1.6 : months >= 12 ? 1.0 : 0.5), 2);
}

export function openFD(state: GameState, bankId: string, amountRaw: number, months: number, log: string[]) {
  const b = state.world.banks.find((x) => x.id === bankId);
  const amt = Math.round(money(amountRaw));
  const m = [6, 12, 36, 60].includes(months) ? months : 12;
  if (!b || amt < 10000) {
    log.push("Minimum fixed deposit is ₹10,000.");
    return;
  }
  if (!spend(state.player, amt, `Fixed deposit · ${b.name}`, "fd", dt(state))) {
    log.push("Not enough liquid cash.");
    return;
  }
  bizFlow(state, "fdMoves", -amt);
  const fd: FixedDeposit = {
    id: uid("fd"),
    bankId: b.id,
    bankName: b.name,
    principal: amt,
    rate: fdRate(state, b.id, m),
    months: m,
    start: state.ticks,
    accrued: 0,
  };
  getBiz(state).fds.push(fd);
  if (b.playerOwned) b.deposits += amt;
  log.push(`Locked ${formatINR(amt)} for ${m} months at ${fd.rate}% with ${b.name}. Break early and you lose half the interest plus 1%.`);
}

export function breakFD(state: GameState, fdId: string, log: string[]) {
  const biz = getBiz(state);
  const fd = biz.fds.find((x) => x.id === fdId);
  if (!fd) return;
  const penalty = fd.accrued * 0.5 + fd.principal * 0.01;
  const payout = Math.max(0, fd.principal + fd.accrued - penalty);
  biz.fds = biz.fds.filter((x) => x.id !== fdId);
  credit(state.player, payout, `FD broken early · ${fd.bankName}`, "fd", dt(state));
  bizFlow(state, "fdMoves", fd.principal);
  bizFlow(state, "fdInterest", payout - fd.principal);
  log.push(`Broke the FD: got ${formatINR(payout)} (penalty ${formatINR(penalty)}).`);
}

function tickFDs(state: GameState) {
  const biz = getBiz(state);
  for (const fd of [...biz.fds]) {
    fd.accrued += (fd.principal + fd.accrued) * (fd.rate / 100 / 12);
    if (state.ticks - fd.start >= fd.months) {
      const pay = fd.principal + fd.accrued;
      credit(state.player, pay, `FD matured · ${fd.bankName}`, "fd", dt(state));
      bizFlow(state, "fdMoves", fd.principal);
      bizFlow(state, "fdInterest", fd.accrued);
      biz.fds = biz.fds.filter((x) => x.id !== fd.id);
      note(state, `Fixed deposit matured: ${formatINR(pay)} (${formatINR(fd.accrued)} interest).`, "good");
    }
  }
}

/* ================================================================ personal broker */

export const BROKER_TIERS: Record<
  BrokerTier,
  {
    name: string;
    fee: number;
    perf: number;
    min: number;
    skill: [number, number];
    blurb: string;
  }
> = {
  junior: {
    name: "Junior broker",
    fee: 1.0,
    perf: 0,
    min: 50000,
    skill: [25, 55],
    blurb: "Cheap and keen. Sometimes churns your account for commissions.",
  },
  senior: {
    name: "Senior wealth manager",
    fee: 1.5,
    perf: 10,
    min: 1000000,
    skill: [45, 75],
    blurb: "Steady hands, 10% of gains above the high-water mark.",
  },
  star: {
    name: "Star fund manager",
    fee: 2.0,
    perf: 20,
    min: 10000000,
    skill: [60, 95],
    blurb: "2 and 20. Beats the market more often than not — not always.",
  },
};

const BROKER_NAMES = [
  "Vikram Anand",
  "Sofia Marr",
  "Kenji Arai",
  "Leila Haddad",
  "Rohan Mehta",
  "Ines Duarte",
  "Anton Weiss",
  "Priya Nair",
  "Omar Farouk",
  "Maren Solberg",
];

export function hireBroker(state: GameState, tier: BrokerTier, amountRaw: number, risk: PersonalBroker["risk"], log: string[]) {
  const biz = getBiz(state);
  const t = BROKER_TIERS[tier];
  if (!t) return;
  const amt = Math.round(money(amountRaw));
  if (biz.broker) {
    log.push("You already have a broker. Add funds or fire them first.");
    return;
  }
  if (amt < t.min) {
    log.push(`${t.name}s take accounts from ${formatINR(t.min)}.`);
    return;
  }
  if (!spend(state.player, amt, `Managed account · ${t.name}`, "inv", dt(state))) {
    log.push("Not enough liquid cash.");
    return;
  }
  bizFlow(state, "brokerMoves", -amt);
  const [lo, hi] = t.skill;
  biz.broker = {
    tier,
    name: pick(R(state), BROKER_NAMES),
    skill: Math.round(lo + rng(state) * (hi - lo)),
    fee: t.fee,
    perfFee: t.perf,
    value: amt,
    contributed: amt,
    withdrawn: 0,
    highWater: amt,
    risk,
    history: [],
    since: state.ticks,
  };
  log.push(
    `${biz.broker.name} (${t.name}) now manages ${formatINR(amt)} (${risk}). Fee ${t.fee}%/yr${t.perf ? ` + ${t.perf}% of new highs` : ""}. Skill is hidden — judge them by results.`,
  );
}

export function brokerFund(state: GameState, amountRaw: number, log: string[]) {
  const biz = getBiz(state);
  const br = biz.broker;
  if (!br) return;
  const amt = Math.round(money(amountRaw));
  if (amt > 0) {
    if (!spend(state.player, amt, `Add to managed account`, "inv", dt(state))) {
      log.push("Not enough liquid cash.");
      return;
    }
    bizFlow(state, "brokerMoves", -amt);
    br.value += amt;
    br.contributed += amt;
    br.highWater += amt;
    log.push(`Added ${formatINR(amt)}. Account ${formatINR(br.value)}.`);
  } else if (amt < 0) {
    const take = Math.min(br.value, -amt);
    const basis = (br.contributed - br.withdrawn) * (take / Math.max(1, br.value));
    br.value -= take;
    br.withdrawn += take;
    br.highWater = Math.max(0, br.highWater - take);
    credit(state.player, take, "Withdrawal from managed account", "inv", dt(state));
    bizFlow(state, "brokerMoves", take);
    taxGain(state, take - basis);
    log.push(`Withdrew ${formatINR(take)}. Account ${formatINR(br.value)}.`);
  }
}

export function fireBroker(state: GameState, log: string[]) {
  const biz = getBiz(state);
  const br = biz.broker;
  if (!br) return;
  const basis = br.contributed - br.withdrawn;
  credit(state.player, br.value, `Closed account with ${br.name}`, "inv", dt(state));
  bizFlow(state, "brokerMoves", br.value);
  taxGain(state, br.value - basis);
  log.push(
    `Closed the account: ${formatINR(br.value)} returned (${br.value >= basis ? "+" : "−"}${formatINR(Math.abs(br.value - basis))} vs what you put in).`,
  );
  biz.broker = null;
}

/** Monthly market return of the world index, as a fraction. */
export function indexReturn(state: GameState): number {
  const h = state.world.indexHistory;
  if (h.length < 2) return 0;
  const a = h[h.length - 2]!.v;
  const b = h[h.length - 1]!.v;
  return a > 0 ? b / a - 1 : 0;
}

export function marketVol(state: GameState): number {
  const h = state.world.indexHistory.slice(-13);
  if (h.length < 3) return 0.04;
  const rets = h.slice(1).map((x, i) => x.v / Math.max(1, h[i]!.v) - 1);
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  return Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / rets.length);
}

function tickBroker(state: GameState) {
  const biz = getBiz(state);
  const br = biz.broker;
  if (!br || br.value <= 0) return;
  const beta = br.risk === "careful" ? 0.5 : br.risk === "aggressive" ? 1.5 : 1;
  const idx = clamp(indexReturn(state), -0.3, 0.3);
  const alpha = ((br.skill - 50) / 50) * 0.004 * beta;
  const noise = normal(R(state), 0, 0.012 * beta);
  let ret = (br.risk === "careful" ? 0.003 : 0) + idx * beta + alpha + noise;
  // junior churning: commissions eaten from the account
  if (br.tier === "junior" && chance(R(state), 0.05)) ret -= 0.01;
  const before = br.value;
  br.value = Math.max(0, br.value * (1 + ret));
  const fee = br.value * (br.fee / 100 / 12);
  br.value -= fee;
  let perf = 0;
  if (br.perfFee > 0 && br.value > br.highWater) {
    perf = (br.value - br.highWater) * (br.perfFee / 100);
    br.value -= perf;
    br.highWater = br.value;
  }
  br.history.unshift({
    t: dt(state),
    value: round(br.value, 0),
    ret: round(br.value / Math.max(1, before) - 1, 4),
  });
  if (br.history.length > 60) br.history.length = 60;
  if (br.tier === "junior" && chance(R(state), 0.004)) {
    const lost = br.value * 0.3;
    br.value -= lost;
    note(state, `${br.name} made unauthorised trades and lost ${formatINR(lost)} of your account. You can fire them from Brokers.`, "bad");
  }
}

/* ================================================================ brokerage firm */

export const BROKER_HIRE: Record<
  BrokerTier,
  {
    salary: number;
    clients: number;
    aumPer: number;
    bonus: number;
    rogue: number;
    label: string;
  }
> = {
  junior: {
    salary: 600000,
    clients: 40,
    aumPer: 1500000,
    bonus: 0.2,
    rogue: 0.004,
    label: "Junior brokers",
  },
  senior: {
    salary: 1800000,
    clients: 60,
    aumPer: 4000000,
    bonus: 0.3,
    rogue: 0.0025,
    label: "Senior brokers",
  },
  star: {
    salary: 6000000,
    clients: 80,
    aumPer: 15000000,
    bonus: 0.4,
    rogue: 0.0015,
    label: "Star brokers",
  },
};

export function foundBrokerage(state: GameState, name: string, log: string[]) {
  const p = state.player;
  const cost = 5_000_000;
  const clean =
    String(name || "")
      .trim()
      .slice(0, 40) || `${p.name.split(" ")[0]} Securities`;
  if (!spend(p, cost, `Brokerage licence & capital · ${clean}`, "biz", dt(state))) {
    log.push(`A brokerage licence plus minimum net capital costs ${formatINR(cost)}.`);
    return;
  }
  bizFlow(state, "stakes", -cost);
  const f: Brokerage = {
    id: uid("brk"),
    name: clean,
    cityId: p.cityId,
    countryId: p.countryId,
    brokers: { junior: 2, senior: 0, star: 0 },
    analysts: 0,
    compliance: 1,
    platform: 30,
    commissionBps: 30,
    mgmtFee: 1,
    clients: 80,
    aum: 80 * 1500000,
    reputation: 40,
    marketing: 0,
    cash: cost * 0.8,
    last: null,
    history: [],
    founded: state.ticks,
  };
  getBiz(state).brokerages.push(f);
  unlock(state, "broker_firm");
  timeline(state, `Founded the brokerage ${clean}.`, "business");
  log.push(`${clean} is licensed with ${formatINR(f.cash)} net capital, 2 junior brokers and the 80 clients they brought. Hire brokers to bring more.`);
}

export function brokerageSet(
  state: GameState,
  id: string,
  patch: Partial<{
    junior: number;
    senior: number;
    star: number;
    analysts: number;
    compliance: number;
    commissionBps: number;
    mgmtFee: number;
    marketing: number;
    platformSpend: number;
  }>,
  log: string[],
) {
  const f = getBiz(state).brokerages.find((x) => x.id === id);
  if (!f) return;
  for (const t of ["junior", "senior", "star"] as BrokerTier[]) {
    const v = patch[t];
    if (v == null) continue;
    const n = clamp(Math.round(v), 0, 5000);
    const hires = n - f.brokers[t];
    if (hires > 0) {
      const signOn = hires * BROKER_HIRE[t].salary * 0.25;
      if (f.cash < signOn) {
        log.push(`Signing ${hires} ${t} broker(s) costs ${formatINR(signOn)} up front; the firm has ${formatINR(f.cash)}.`);
        continue;
      }
      f.cash -= signOn;
      // brokers bring their book with them
      f.clients += hires * BROKER_HIRE[t].clients;
      f.aum += hires * BROKER_HIRE[t].clients * BROKER_HIRE[t].aumPer;
    } else if (hires < 0) {
      // departing brokers take some clients
      const gone = -hires * BROKER_HIRE[t].clients * 0.6;
      const share = gone / Math.max(1, f.clients);
      f.clients = Math.max(0, Math.round(f.clients - gone));
      f.aum *= 1 - share;
    }
    f.brokers[t] = n;
  }
  if (patch.analysts != null) f.analysts = clamp(Math.round(patch.analysts), 0, 2000);
  if (patch.compliance != null) f.compliance = clamp(Math.round(patch.compliance), 0, 2000);
  if (patch.commissionBps != null) f.commissionBps = clamp(Math.round(patch.commissionBps), 1, 200);
  if (patch.mgmtFee != null) f.mgmtFee = clamp(round(patch.mgmtFee, 2), 0, 3);
  if (patch.marketing != null) f.marketing = clamp(Math.round(patch.marketing), 0, 1e10);
  if (patch.platformSpend != null && patch.platformSpend > 0) {
    const amt = Math.round(patch.platformSpend);
    if (f.cash < amt) log.push("Not enough firm cash for the platform upgrade.");
    else {
      f.cash -= amt;
      f.platform = clamp(f.platform + (amt / 1e6) * (1 - f.platform / 110) * 4, 0, 100);
    }
  }
  log.push(
    `${f.name}: ${f.brokers.junior}/${f.brokers.senior}/${f.brokers.star} brokers (junior/senior/star), ${f.analysts} analysts, ${f.compliance} compliance, ${f.commissionBps} bps commission, ${f.mgmtFee}% advisory fee, platform ${Math.round(f.platform)}.`,
  );
}

export function brokerageCash(state: GameState, id: string, amountRaw: number, log: string[]) {
  const f = getBiz(state).brokerages.find((x) => x.id === id);
  if (!f) return;
  const amt = Math.round(money(amountRaw));
  if (amt > 0) {
    if (!spend(state.player, amt, `Capital into ${f.name}`, "biz", dt(state))) {
      log.push("Not enough cash.");
      return;
    }
    bizFlow(state, "stakes", -amt);
    f.cash += amt;
    log.push(`Injected ${formatINR(amt)} into ${f.name}.`);
  } else if (amt < 0) {
    const minCap = 2_000_000;
    const take = Math.min(-amt, Math.max(0, f.cash - minCap));
    if (take <= 0) {
      log.push(`Regulators require ${formatINR(minCap)} of net capital to stay in the firm.`);
      return;
    }
    f.cash -= take;
    credit(state.player, take, `Draw from ${f.name}`, "biz", dt(state));
    bizFlow(state, "brokerage", take);
    log.push(`Took ${formatINR(take)} out of ${f.name}.`);
  }
}

export function sellBrokerage(state: GameState, id: string, log: string[]) {
  const biz = getBiz(state);
  const f = biz.brokerages.find((x) => x.id === id);
  if (!f) return;
  const price = brokerageValue(f);
  biz.brokerages = biz.brokerages.filter((x) => x.id !== id);
  credit(state.player, price, `Sale of ${f.name}`, "biz", dt(state));
  bizFlow(state, "stakes", price);
  taxGain(state, price * 0.5);
  log.push(`Sold ${f.name} for ${formatINR(price)} (cash + ${(((price - Math.max(0, f.cash)) / Math.max(1, f.aum)) * 100).toFixed(1)}% of client assets).`);
}

export function brokerageValue(f: Brokerage): number {
  const annual = (f.last?.net ?? 0) * 12;
  return round(Math.max(0, f.cash) + Math.max(f.aum * 0.01, annual * 8), 0);
}

function tickBrokerages(state: GameState) {
  const biz = getBiz(state);
  const vol = marketVol(state);
  const idx = indexReturn(state);
  for (const f of biz.brokerages) {
    const city = state.world.cities.find((c) => c.id === f.cityId);
    const wage = city?.avgWage ?? 800000;
    const heads = f.brokers.junior + f.brokers.senior + f.brokers.star;
    // client flows: brokers + reputation + marketing + platform − fees
    const pull = f.brokers.junior * 1.0 + f.brokers.senior * 1.2 + f.brokers.star * 1.5 + f.marketing / 100000 + f.platform / 25;
    const repel = (f.commissionBps / 30 - 1) * 0.6 + (f.mgmtFee - 1) * 1.2;
    const newClients = Math.max(0, Math.round(pull * (0.6 + f.reputation / 100) * (1 - clamp(repel, -0.5, 0.8)) + (rng(state) - 0.5) * 2));
    const churn = clamp(0.012 + repel * 0.01 + (50 - f.reputation) / 4000, 0.004, 0.08);
    const lost = Math.round(f.clients * churn);
    const avgAum = f.aum / Math.max(1, f.clients);
    f.clients = Math.max(0, f.clients + newClients - lost);
    f.aum = Math.max(0, f.aum + newClients * (heads ? avgAum * 0.8 + 600000 : 0) - lost * avgAum);
    f.aum *= 1 + clamp(idx, -0.3, 0.3) * 0.7; // client portfolios move with markets
    // revenue: turnover rises with volatility; analysts improve advice and retention
    const turnover = 0.3 + vol * 5 + f.analysts * 0.003;
    const commissions = f.aum * turnover * (f.commissionBps / 10000);
    const fees = f.aum * 0.35 * (f.mgmtFee / 100 / 12);
    const revenue = commissions + fees;
    const base = (f.brokers.junior * BROKER_HIRE.junior.salary + f.brokers.senior * BROKER_HIRE.senior.salary + f.brokers.star * BROKER_HIRE.star.salary) / 12;
    const support = ((f.analysts * 1.4 + f.compliance * 1.2) * wage) / 12;
    const payroll = base + support;
    const bonus = Math.max(0, commissions) * (f.brokers.star ? 0.35 : f.brokers.senior ? 0.3 : 0.2);
    const tech = 60000 + f.clients * 150 + f.platform * 1500;
    const other = 100000 + f.marketing;
    let net = revenue - payroll - bonus - tech - other;
    f.reputation = clamp(f.reputation + (f.analysts > heads / 6 ? 0.15 : -0.05) + (idx > 0 ? 0.1 : -0.1) + (f.platform - 50) / 1000, 0, 100);
    // rogue brokers and regulators
    const coverage = f.compliance / Math.max(1, heads / 10);
    const rogueP =
      (f.brokers.junior * BROKER_HIRE.junior.rogue + f.brokers.senior * BROKER_HIRE.senior.rogue + f.brokers.star * BROKER_HIRE.star.rogue) *
      clamp(1.5 - coverage, 0.15, 1.5);
    if (chance(R(state), rogueP)) {
      const loss = round(Math.max(500000, f.aum * (0.005 + rng(state) * 0.02)), 0);
      net -= loss;
      f.reputation = clamp(f.reputation - 12, 0, 100);
      f.clients = Math.round(f.clients * 0.93);
      f.aum *= 0.93;
      note(
        state,
        `${f.name}: a rogue broker ran unauthorised positions. Loss ${formatINR(loss)} and clients are leaving.${coverage < 1 ? " More compliance staff would have caught it." : ""}`,
        "bad",
      );
      news(state, `Rogue trading at ${f.name}`, `An employee hid losses of ${formatINR(loss)}.`, "business", f.countryId, "Regulators circle.");
    }
    if (coverage < 0.6 && chance(R(state), 0.03)) {
      const fine = round(1_000_000 + f.aum * 0.002, 0);
      net -= fine;
      note(state, `${f.name} fined ${formatINR(fine)} by the securities regulator for weak compliance.`, "bad");
    }
    f.cash += net;
    f.last = {
      t: dt(state),
      commissions: round(commissions, 0),
      fees: round(fees, 0),
      payroll: round(payroll, 0),
      bonus: round(bonus, 0),
      tech: round(tech, 0),
      other: round(other, 0),
      net: round(net, 0),
    };
    f.history.unshift({
      t: dt(state),
      aum: round(f.aum, 0),
      clients: f.clients,
      net: round(net, 0),
    });
    if (f.history.length > 36) f.history.length = 36;
    if (f.cash < 0) {
      // the owner must cover net-capital breaches
      const paid = spendUpTo(state.player, -f.cash, `Net-capital top-up · ${f.name}`, "biz", dt(state));
      bizFlow(state, "brokerage", -paid.paid);
      f.cash += paid.paid;
      if (f.cash < -1000) {
        note(state, `${f.name} breached its net-capital rule and was shut by the regulator.`, "bad");
        biz.brokerages = biz.brokerages.filter((x) => x.id !== f.id);
      }
    }
  }
}

/* ================================================================ tick */

export function tickFinFirms(state: GameState) {
  for (const b of state.world.banks) if (b.playerOwned) tickOneBank(state, b);
  tickFDs(state);
  tickBroker(state);
  tickBrokerages(state);
}
