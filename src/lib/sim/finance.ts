// Balance-sheet helpers. Every rupee that moves goes through this file, so the
// rules are strict:
//   1. Money is never destroyed by a failed payment. An obligation you cannot
//      cover leaves your balance untouched and is recorded as a shortfall —
//      the consequences are credit/stress/arrears, not confiscation.
//   2. Money is never created out of thin air: every credit and debit posts a
//      statement line, so the ledger always explains the balance.
//   3. No NaN ever reaches a balance. One NaN silently destroys a whole save,
//      so every entry point is guarded.
import type { GameState, Player } from "./types";
import { formatDate, round } from "./util";

const EPS = 1e-6;

/** Coerce anything into a finite rupee amount. NaN/Infinity become 0. */
export function money(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function liquidCash(p: Player): number {
  return money(p.finances.cash) + (p.finances.accounts ?? []).reduce((s, a) => s + money(a.balance), 0);
}

export function totalDebt(p: Player): number {
  return p.finances.loans.reduce((s, l) => (l.status === "paid" ? s : s + money(l.remaining)), 0);
}

export function portfolioValue(state: GameState): number {
  const p = state.player;
  let v = 0;
  for (const h of p.holdings) {
    const c = state.world.companies.find((x) => x.ticker === h.ticker);
    if (c) v += money(h.shares) * money(c.price);
  }
  for (const b of p.bonds) v += money(b.qty) * money(b.price);
  for (const f of p.funds) v += money(f.units) * money(f.nav);
  return v;
}

export function businessEquity(state: GameState): number {
  let v = 0;
  for (const c of state.world.companies) {
    const sh = c.shareholders.find((s) => s.type === "player");
    if (!sh || c.shares <= 0) continue;
    v += (money(sh.shares) / c.shares) * Math.max(0, money(c.valuation));
  }
  return v;
}

export function propertyValue(p: Player): number {
  return p.properties.reduce((s, x) => s + money(x.value), 0);
}

/** Cars, yachts and aircraft at their current (depreciated) value. */
export function lifestyleAssets(state: GameState): number {
  const L = state.life;
  if (!L) return 0;
  return (L.vehicles ?? []).reduce((s, v) => s + money(v.value), 0) + (L.aircraft ?? []).reduce((s, a) => s + money(a.value), 0);
}

/** Stakes held by companies you control, at your share of the holder. */
export function groupStakes(state: GameState): number {
  const owned = new Set(state.player.ownedCompanyIds);
  if (!owned.size) return 0;
  let v = 0;
  for (const co of state.world.companies) {
    if (co.shares <= 0) continue;
    for (const s of co.shareholders) {
      if (s.type === "player" || !owned.has(s.id) || s.id === co.id) continue;
      const holder = state.world.companies.find((c) => c.id === s.id);
      const mine = holder?.shareholders.find((x) => x.type === "player");
      if (!holder || !mine || holder.shares <= 0) continue;
      v += (money(s.shares) / co.shares) * Math.max(0, money(co.valuation)) * (money(mine.shares) / holder.shares);
    }
  }
  return v;
}

/** Things you run for real, at conservative book value: fixed deposits, money
 *  with your broker, your bank's capital, your brokerage, your casinos — less
 *  any unpaid tax. Read straight off state so this file stays import-free. */
export function ventureAssets(state: GameState): number {
  const b = state.biz;
  if (!b) return 0;
  let v = 0;
  for (const fd of b.fds ?? []) v += money(fd.principal) + money(fd.accrued);
  if (b.broker) v += Math.max(0, money(b.broker.value));
  for (const bank of state.world.banks) if (bank.playerOwned) v += Math.max(0, money(bank.capital));
  for (const f of b.brokerages ?? []) v += Math.max(0, money(f.cash)) + money(f.aum) * 0.01;
  for (const c of state.world.casinos) v += money(b.casinos?.[c.id]?.assetValue);
  return v - money(b.taxDebt);
}

export function computeNetWorth(state: GameState): number {
  const p = state.player;
  return liquidCash(p) + portfolioValue(state) + businessEquity(state) + propertyValue(p) + lifestyleAssets(state) + groupStakes(state) +
    ventureAssets(state) - totalDebt(p);
}

export function recordNetWorth(state: GameState) {
  const v = computeNetWorth(state);
  const t = formatDate(state.time.year, state.time.month);
  const hist = state.player.finances.netWorthHistory;
  hist.push({ t, v: round(v, 0) });
  if (hist.length > 240) hist.splice(0, hist.length - 240);
  const inc = state.player.finances.monthlyIncome;
  state.player.finances.incomeHistory.push({ t, v: round(inc, 0) });
  if (state.player.finances.incomeHistory.length > 240) {
    state.player.finances.incomeHistory.splice(0, state.player.finances.incomeHistory.length - 240);
  }
  return v;
}

/* ------------------------------------------------------------- statements */

function postStatement(
  p: Player,
  acct: Player["finances"]["accounts"][number] | undefined,
  amount: number,
  desc: string,
  cat: string,
  date: string,
) {
  if (!acct || amount === 0) return;
  acct.transactions.unshift({
    id: `tx_${Math.random().toString(36).slice(2, 8)}`,
    date,
    desc,
    amount: round(amount, 2),
    // "balance after" is shown as total liquid money — wallet + accounts —
    // because a wallet payment still belongs on the statement.
    bal: round(liquidCash(p), 2),
    cat,
  });
  if (acct.transactions.length > 80) acct.transactions.length = 80;
}

/** Move money out of the player's liquid pool: wallet first, then accounts.
 *  Caller must already have checked affordability (see spend / spendUpTo). */
function takeFromLiquid(p: Player, amount: number, desc: string, cat: string, date: string): number {
  let need = round(money(amount), 2);
  const primary = p.finances.accounts[0];
  const wallet = money(p.finances.cash);
  if (wallet > 0 && need > 0) {
    const take = Math.min(wallet, need);
    p.finances.cash = round(wallet - take, 2);
    need = round(need - take, 2);
    postStatement(p, primary, -take, desc, cat, date);
  }
  for (const acct of p.finances.accounts) {
    if (need <= EPS) break;
    const bal = money(acct.balance);
    if (bal <= 0) continue;
    const take = Math.min(bal, need);
    acct.balance = round(bal - take, 2);
    need = round(need - take, 2);
    postStatement(p, acct, -take, desc, cat, date);
  }
  return round(money(amount) - Math.max(0, need), 2);
}

/* ------------------------------------------------------------------ money */

/** Pay `amount` in full, or do nothing at all.
 *  Returns false when the player cannot cover it — and, critically, moves no
 *  money. The old implementation drained the wallet and every account and then
 *  reported failure, which is how balances used to "vanish". */
export function spend(p: Player, amount: number, desc: string, cat: string, date: string): boolean {
  const amt = money(amount);
  if (amt <= 0) return true;
  if (!Number.isFinite(amt)) return false;
  if (liquidCash(p) + EPS < amt) return false;
  takeFromLiquid(p, amt, desc, cat, date);
  return true;
}

/** Pay as much as possible. Used for obligations that can genuinely run in
 *  arrears (living costs, loan instalments): the shortfall is returned so the
 *  caller can apply real consequences instead of confiscating the balance. */
export function spendUpTo(p: Player, amount: number, desc: string, cat: string, date: string): { paid: number; short: number } {
  const amt = money(amount);
  if (amt <= 0) return { paid: 0, short: 0 };
  const have = liquidCash(p);
  const paid = Math.max(0, Math.min(have, amt));
  if (paid > EPS) takeFromLiquid(p, paid, paid + EPS < amt ? `${desc} (part)` : desc, cat, date);
  return { paid: round(paid, 2), short: round(amt - paid, 2) };
}

/** Money in. Always lands in the wallet; the statement line mirrors it. */
export function credit(p: Player, amount: number, desc: string, cat: string, date: string) {
  const amt = money(amount);
  if (amt === 0) return;
  p.finances.cash = round(money(p.finances.cash) + amt, 2);
  postStatement(p, p.finances.accounts[0], amt, desc, cat, date);
}

/** Signed convenience wrapper: positive credits, negative spends.
 *  Returns false when a debit could not be covered (nothing moves). */
export function addCash(p: Player, amount: number, desc: string, cat: string, date: string): boolean {
  const amt = money(amount);
  if (amt === 0) return true;
  if (amt > 0) {
    credit(p, amt, desc, cat, date);
    return true;
  }
  return spend(p, -amt, desc, cat, date);
}

/** One-time repair pass for a loaded save: any non-finite balance (from an old
 *  buggy build or a hand-edited save file) is reset to 0 instead of poisoning
 *  every later calculation. */
export function repairFinances(state: GameState): string[] {
  const fixed: string[] = [];
  const p = state.player;
  if (!p?.finances) return fixed;
  const f = p.finances;
  if (!Number.isFinite(f.cash)) {
    fixed.push("wallet");
    f.cash = 0;
  }
  f.cash = Math.max(0, round(f.cash, 2));
  for (const a of f.accounts ?? []) {
    if (!Number.isFinite(a.balance)) {
      fixed.push(`account ${a.bankName}`);
      a.balance = 0;
    }
    a.balance = round(a.balance, 2);
    a.interestRate = Number.isFinite(a.interestRate) ? a.interestRate : 0;
    a.fee = Number.isFinite(a.fee) ? Math.max(0, a.fee) : 0;
    if (!Array.isArray(a.transactions)) a.transactions = [];
  }
  for (const l of f.loans ?? []) {
    for (const k of ["principal", "remaining", "rate", "monthly", "monthsLeft", "termMonths", "missed"] as const) {
      if (!Number.isFinite(l[k])) {
        fixed.push(`loan ${l.kind}`);
        (l as unknown as Record<string, number>)[k] = 0;
      }
    }
    l.remaining = Math.max(0, round(l.remaining, 2));
  }
  f.creditScore = Number.isFinite(f.creditScore) ? f.creditScore : 600;
  f.paymentHistory = Number.isFinite(f.paymentHistory) ? f.paymentHistory : 60;
  f.defaults = Number.isFinite(f.defaults) ? Math.max(0, Math.round(f.defaults)) : 0;
  f.monthlyIncome = Number.isFinite(f.monthlyIncome) ? f.monthlyIncome : 0;
  f.monthlyExpenses = Number.isFinite(f.monthlyExpenses) ? f.monthlyExpenses : 0;
  f.livingCost = Number.isFinite(f.livingCost) ? f.livingCost : 0;
  f.taxPaidYtd = Number.isFinite(f.taxPaidYtd) ? f.taxPaidYtd : 0;
  if (!Array.isArray(f.netWorthHistory)) f.netWorthHistory = [];
  if (!Array.isArray(f.incomeHistory)) f.incomeHistory = [];
  for (const prop of p.properties ?? []) {
    for (const k of ["value", "rent", "occupancy", "maintenance", "tax", "purchasePrice", "condition", "size"] as const) {
      if (!Number.isFinite(prop[k])) {
        fixed.push(`property ${prop.name}`);
        (prop as unknown as Record<string, number>)[k] = k === "condition" ? 60 : 0;
      }
    }
  }
  return fixed;
}

export function livingCostFor(state: GameState): number {
  const city = state.world.cities.find((c) => c.id === state.player.cityId);
  const country = state.world.countries.find((c) => c.id === state.player.countryId);
  const rentIdx = money(city?.rentIndex ?? 100) || 100;
  const infl = money(country?.inflation ?? 3);
  const base = 14000 * (rentIdx / 100) * (1 + infl / 200);
  const ownsHome = state.player.properties.some((p) => p.kind === "house" || p.kind === "apartment");
  const dependants = (state.player.family?.members ?? []).filter((m) => m.relation === "child" && m.alive).length;
  // A household costs more than one person: +12% per child, capped at +60%.
  const household = 1 + Math.min(0.6, dependants * 0.12);
  return Math.round(base * (ownsHome ? 0.55 : 1) * (1 + state.player.age / 400) * household);
}

export function monthlyLoanPayment(principal: number, annualRate: number, termMonths: number): number {
  const p = Math.max(0, money(principal));
  const n = Math.max(1, Math.round(money(termMonths)));
  const r = money(annualRate) / 100 / 12;
  if (r <= 0) return round(p / n, 2);
  return round((p * r) / (1 - Math.pow(1 + r, -n)), 2);
}

/** Split an instalment into its interest and principal parts. */
export function loanSplit(remaining: number, annualRate: number, payment: number): { interest: number; principal: number } {
  const interest = Math.min(money(payment), Math.max(0, (money(remaining) * money(annualRate)) / 100 / 12));
  return { interest: round(interest, 2), principal: round(Math.max(0, money(payment) - interest), 2) };
}

/** Months of runway left at the current burn rate. Infinity when not burning. */
export function runwayMonths(state: GameState): number {
  const f = state.player.finances;
  const burn = money(f.monthlyExpenses) - money(f.monthlyIncome);
  if (burn <= 0) return Infinity;
  return Math.max(0, liquidCash(state.player) / burn);
}
