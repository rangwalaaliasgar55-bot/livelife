import type { GameState, Player } from "./types";
import { formatDate, round } from "./util";

export function liquidCash(p: Player): number {
  return p.finances.cash + p.finances.accounts.reduce((s, a) => s + a.balance, 0);
}

export function totalDebt(p: Player): number {
  return p.finances.loans.reduce((s, l) => (l.status === "paid" ? s : s + l.remaining), 0);
}

export function portfolioValue(state: GameState): number {
  const p = state.player;
  let v = 0;
  for (const h of p.holdings) {
    const c = state.world.companies.find((x) => x.ticker === h.ticker);
    if (c) v += h.shares * c.price;
  }
  for (const b of p.bonds) v += b.qty * b.price;
  for (const f of p.funds) v += f.units * f.nav;
  return v;
}

export function businessEquity(state: GameState): number {
  let v = 0;
  for (const c of state.world.companies) {
    const sh = c.shareholders.find((s) => s.type === "player");
    if (!sh || c.shares <= 0) continue;
    v += (sh.shares / c.shares) * Math.max(0, c.valuation);
  }
  return v;
}

export function propertyValue(p: Player): number {
  return p.properties.reduce((s, x) => s + x.value, 0);
}

export function computeNetWorth(state: GameState): number {
  const p = state.player;
  return liquidCash(p) + portfolioValue(state) + businessEquity(state) + propertyValue(p) - totalDebt(p);
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

export function addCash(p: Player, amount: number, desc: string, cat: string, date: string) {
  p.finances.cash = Math.max(0, p.finances.cash + amount);
  const acct = p.finances.accounts[0];
  if (acct && amount !== 0) {
    if (amount < 0 && acct.balance >= -amount) {
      acct.balance += amount;
      p.finances.cash -= amount;
    } else if (amount > 0 && p.finances.cash > amount) {
      // keep as cash unless depositing
    }
    acct.transactions.unshift({
      id: `tx_${Math.random().toString(36).slice(2, 8)}`,
      date,
      desc,
      amount,
      bal: acct.balance + p.finances.cash,
      cat,
    });
    if (acct.transactions.length > 80) acct.transactions.length = 80;
  }
}

export function spend(p: Player, amount: number, desc: string, cat: string, date: string): boolean {
  if (amount <= 0) return true;
  if (p.finances.cash >= amount) {
    p.finances.cash -= amount;
    const acct = p.finances.accounts[0];
    if (acct) {
      acct.transactions.unshift({
        id: `tx_${Math.random().toString(36).slice(2, 8)}`,
        date,
        desc,
        amount: -amount,
        bal: p.finances.cash + acct.balance,
        cat,
      });
      if (acct.transactions.length > 80) acct.transactions.length = 80;
    }
    return true;
  }
  let need = amount - p.finances.cash;
  p.finances.cash = 0;
  for (const acct of p.finances.accounts) {
    const take = Math.min(acct.balance, need);
    acct.balance -= take;
    need -= take;
    acct.transactions.unshift({
      id: `tx_${Math.random().toString(36).slice(2, 8)}`,
      date,
      desc,
      amount: -take,
      bal: acct.balance,
      cat,
    });
    if (acct.transactions.length > 80) acct.transactions.length = 80;
    if (need <= 0) return true;
  }
  return false;
}

export function credit(p: Player, amount: number, desc: string, cat: string, date: string) {
  p.finances.cash += amount;
  const acct = p.finances.accounts[0];
  if (acct) {
    acct.transactions.unshift({
      id: `tx_${Math.random().toString(36).slice(2, 8)}`,
      date,
      desc,
      amount,
      bal: p.finances.cash + acct.balance,
      cat,
    });
    if (acct.transactions.length > 80) acct.transactions.length = 80;
  }
}

export function livingCostFor(state: GameState): number {
  const city = state.world.cities.find((c) => c.id === state.player.cityId);
  const country = state.world.countries.find((c) => c.id === state.player.countryId);
  const rentIdx = city?.rentIndex ?? 100;
  const infl = country?.inflation ?? 3;
  const base = 14000 * (rentIdx / 100) * (1 + infl / 200);
  const ownsHome = state.player.properties.some((p) => p.kind === "house" || p.kind === "apartment");
  return Math.round(base * (ownsHome ? 0.55 : 1) * (1 + state.player.age / 400));
}

export function monthlyLoanPayment(principal: number, annualRate: number, termMonths: number): number {
  const r = annualRate / 100 / 12;
  if (r <= 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}
