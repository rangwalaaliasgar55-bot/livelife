// Stakes, tender offers and takeovers.
//
// You (or one of your companies) can buy shares of any company in the world
// through a tender offer: name a percentage and a premium over the market
// price; holders decide whether to sell. Crossing 10% buys a board seat,
// crossing 50% (personally + through your companies) buys control — the firm
// joins your group and you run it. Boards fight low-ball hostile bids by
// diluting you, and a premium you overpay is gone the moment you pay it.
import type { GameState, ListedCompany } from "./types";
import { credit, groupStakes, money, spend } from "./finance";
import { getAdv, ledger } from "./advanced";
import { news, note, timeline, unlock } from "./feed";
import { rng } from "./engine";
import { getLife, lifeFlow } from "./life";
import { clamp, formatDate, formatINR, round } from "./util";

const date = (s: GameState) => formatDate(s.time.year, s.time.month);

/** Price per share the market is quoting right now. */
export function sharePrice(co: ListedCompany): number {
  if (co.listed && co.price > 0) return co.price;
  return Math.max(0.5, money(co.valuation) / Math.max(1, co.shares));
}

export interface ControlView {
  personal: number;
  viaCompanies: { holderId: string; name: string; shares: number }[];
  total: number;
  pct: number;
  controlled: boolean;
  boardSeat: boolean;
}

/** Everything you control in a company: your own shares plus shares held by
 *  companies you own. */
export function controlOf(state: GameState, co: ListedCompany): ControlView {
  const owned = new Set(state.player.ownedCompanyIds);
  let personal = 0;
  const via: ControlView["viaCompanies"] = [];
  for (const s of co.shareholders) {
    if (s.type === "player") personal += money(s.shares);
    else if (owned.has(s.id) && s.id !== co.id) via.push({ holderId: s.id, name: s.name, shares: money(s.shares) });
  }
  const total = personal + via.reduce((s, x) => s + x.shares, 0);
  const pct = co.shares > 0 ? (total / co.shares) * 100 : 0;
  return { personal, viaCompanies: via, total, pct, controlled: pct > 50, boardSeat: pct >= 10 };
}

/** How many holders say yes at this premium. Institutional money is
 *  price-sensitive, founders are sticky, the public is somewhere between. */
export function acceptance(state: GameState, co: ListedCompany, premiumPct: number): number {
  const prem = clamp(premiumPct, 0, 200) / 100;
  const neg = state.player.skills.negotiation ?? 0;
  const base = 0.12 + prem * 2.1 + (50 - co.sentiment) / 250 + neg / 500 + (co.stage === "distressed" ? 0.25 : 0);
  return clamp(base, 0.03, 0.97);
}

export interface TenderQuote {
  price: number;
  requested: number;
  expected: number;
  cost: number;
  fees: number;
  acceptance: number;
  pctAfter: number;
  controlAfter: boolean;
  available: number;
}

export function quoteTender(state: GameState, companyId: string, pct: number, premiumPct: number): TenderQuote | null {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co || co.stage === "bankrupt") return null;
  const ctl = controlOf(state, co);
  const owned = new Set(state.player.ownedCompanyIds);
  const available = co.shareholders.filter((s) => s.type !== "player" && !owned.has(s.id)).reduce((s, x) => s + money(x.shares), 0);
  const requested = Math.min(available, Math.round((clamp(pct, 0.1, 100) / 100) * co.shares));
  const acc = acceptance(state, co, premiumPct);
  const expected = Math.round(requested * acc);
  const price = round(sharePrice(co) * (1 + clamp(premiumPct, 0, 200) / 100), 4);
  const cost = round(expected * price, 0);
  const fees = round(cost * 0.015, 0);
  const pctAfter = co.shares > 0 ? ((ctl.total + expected) / co.shares) * 100 : 0;
  return { price, requested, expected, cost, fees, acceptance: acc, pctAfter, controlAfter: pctAfter > 50, available };
}

/** Launch a tender offer. `buyer` is "me" or the id of a company you own. */
export function tenderOffer(state: GameState, companyId: string, pct: number, premiumPct: number, buyer: string, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co) return;
  if (buyer !== "me" && buyer === companyId) return void log.push("A company can't tender for itself.");
  const q = quoteTender(state, companyId, pct, premiumPct);
  if (!q || q.requested <= 0) return void log.push("There are no shares left to buy.");
  const buyerCo = buyer === "me" ? null : state.world.companies.find((c) => c.id === buyer && state.player.ownedCompanyIds.includes(c.id));
  if (buyer !== "me" && !buyerCo) return void log.push("You can only buy through a company you control.");
  const r = rng(state);
  // Realised acceptance scatters around the model.
  const realised = clamp(q.acceptance + (r - 0.5) * 0.2, 0.02, 1);
  let got = Math.max(0, Math.round(q.requested * realised));
  if (got <= 0) return void log.push(`Holders rejected the offer at a ${premiumPct}% premium. Nothing was bought, no fees charged.`);
  let cost = round(got * q.price, 0);
  let fees = round(cost * 0.015, 0);
  // If the buyer can't fund the whole fill, scale it back.
  const budget = buyerCo ? Math.max(0, money(buyerCo.cash)) : Math.max(0, state.player.finances.cash + state.player.finances.accounts.reduce((s, a) => s + money(a.balance), 0));
  if (cost + fees > budget) {
    got = Math.floor(budget / (q.price * 1.015));
    if (got <= 0) return void log.push(`${buyerCo ? buyerCo.name : "You"} can't fund even a sliver of this offer.`);
    cost = round(got * q.price, 0);
    fees = round(cost * 0.015, 0);
    log.push("Funding limited the fill — the offer was scaled back.");
  }
  if (buyerCo) {
    buyerCo.cash = round(buyerCo.cash - cost - fees, 2);
  } else if (!spend(state.player, cost + fees, `Tender offer · ${co.name}`, "biz", date(state))) {
    return void log.push("Payment failed; nothing moved.");
  } else lifeFlow(state, "stakes", -(cost + fees));

  // take shares pro-rata from every eligible holder
  const owned = new Set(state.player.ownedCompanyIds);
  const sellers = co.shareholders.filter((s) => s.type !== "player" && !owned.has(s.id) && s.shares > 0);
  const pool = sellers.reduce((s, x) => s + x.shares, 0);
  let left = got;
  for (const s of sellers) {
    const take = Math.min(s.shares, Math.round((s.shares / pool) * got));
    s.shares -= take;
    left -= take;
  }
  if (left > 0) for (const s of sellers) {
    const take = Math.min(s.shares, left);
    s.shares -= take;
    left -= take;
    if (left <= 0) break;
  }
  got -= Math.max(0, left);
  co.shareholders = co.shareholders.filter((s) => s.shares > 0 || s.type === "player");
  const holderId = buyerCo ? buyerCo.id : "player";
  let entry = buyerCo ? co.shareholders.find((s) => s.id === buyerCo.id) : co.shareholders.find((s) => s.type === "player");
  if (!entry) {
    entry = buyerCo ? { id: buyerCo.id, name: buyerCo.name, type: "npc", shares: 0 } : { id: state.player.id, name: state.player.name, type: "player", shares: 0 };
    co.shareholders.push(entry);
  }
  entry.shares += got;
  // record cost basis
  const L = getLife(state);
  const rec = L.stakes.find((x) => x.companyId === co.id && x.holderId === holderId);
  if (rec) {
    rec.shares += got;
    rec.cost += cost + fees;
  } else L.stakes.push({ companyId: co.id, holderId, shares: got, cost: cost + fees, since: date(state) });

  // the market reprices on the news
  const impact = clamp((got / co.shares) * (premiumPct / 100) * 0.9, 0, 0.5);
  co.price = round(co.price * (1 + impact), 4);
  co.valuation = co.price * co.shares;
  co.sentiment = clamp(co.sentiment + 4, 10, 90);

  const who = buyerCo ? buyerCo.name : "You";
  ledger(state, `${who} bought ${((got / co.shares) * 100).toFixed(2)}% of ${co.name}`, -(cost + fees));
  log.push(`${who} bought ${got.toLocaleString("en-IN")} shares (${((got / co.shares) * 100).toFixed(2)}%) of ${co.name} at ${formatINR(q.price)} — ${formatINR(cost)} + ${formatINR(fees)} advisory fees. ${Math.round(realised * 100)}% of targeted holders sold.`);

  // hostile defence: a low-ball bid for a big stake gets diluted
  const ctl = controlOf(state, co);
  if (co.npc && ctl.pct > 30 && premiumPct < 20 && rng(state) < 0.55) {
    const newShares = Math.round(co.shares * 0.18);
    co.shares += newShares;
    const pub = co.shareholders.find((s) => s.type === "public");
    if (pub) pub.shares += newShares;
    else co.shareholders.push({ id: `${co.id}_pub`, name: "Public float", type: "public", shares: newShares });
    co.price = round(co.price * 0.9, 4);
    co.valuation = co.price * co.shares;
    const after = controlOf(state, co);
    log.push(`The board of ${co.name} adopted a poison pill: 18% new shares issued to existing holders. Your stake was diluted to ${after.pct.toFixed(1)}%. Bid higher to win them over.`);
    news(state, `${co.name} board fights hostile bid with poison pill`, "Directors issued new shares to existing holders after an unsolicited stake-building campaign.", "business", co.countryId, "Acquirer diluted; takeover cost rises.");
  }
  checkControl(state, co, log);
}

/** Recompute control after any stake change. */
export function checkControl(state: GameState, co: ListedCompany, log: string[]) {
  const ctl = controlOf(state, co);
  const p = state.player;
  const has = p.ownedCompanyIds.includes(co.id);
  if (ctl.controlled && !has) {
    p.ownedCompanyIds.push(co.id);
    co.npc = false;
    co.forSale = false;
    co.playerRole = co.playerRole === "founder" ? "founder" : "owner";
    if (!co.playerCeo) co.ceo = co.manager ? co.manager.name : "Professional CEO";
    getAdv(state).stats.businesses += 1;
    timeline(state, `Took control of ${co.name} (${ctl.pct.toFixed(1)}%).`, "business");
    news(state, `${p.name} takes control of ${co.name}`, `A ${ctl.pct.toFixed(1)}% controlling stake gives the new owner the board. Management changes are expected.`, "business", co.countryId, "Control changes hands.");
    note(state, `You now control ${co.name}. Manage it from Companies — hire a manager or take the CEO chair.`, "good");
    unlock(state, "takeover");
    log.push(`CONTROL: ${co.name} is now part of your group (${ctl.pct.toFixed(1)}%).`);
  } else if (!ctl.controlled && has && co.playerRole !== "founder") {
    p.ownedCompanyIds = p.ownedCompanyIds.filter((x) => x !== co.id);
    co.npc = true;
    co.playerCeo = false;
    co.playerRole = ctl.boardSeat ? "board" : "none";
    log.push(`You no longer control ${co.name} (${ctl.pct.toFixed(1)}%). It returns to independent management.`);
    timeline(state, `Lost control of ${co.name}.`, "business");
  } else if (!has && ctl.boardSeat && co.playerRole === "none") {
    co.playerRole = "board";
    log.push(`With ${ctl.pct.toFixed(1)}% you take a seat on the board of ${co.name}.`);
  }
}

/** Sell part of a stake (yours or one of your companies') back into the market. */
export function sellStake(state: GameState, companyId: string, holderId: string, pct: number, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co) return;
  const entry = holderId === "player" ? co.shareholders.find((s) => s.type === "player") : co.shareholders.find((s) => s.id === holderId);
  if (!entry || entry.shares <= 0) return void log.push("No stake to sell.");
  const qty = Math.max(1, Math.round(entry.shares * clamp(pct, 1, 100) / 100));
  // a block sale moves the market against you
  const blockDiscount = clamp(0.02 + (qty / co.shares) * 0.3, 0.02, 0.25);
  const px = sharePrice(co) * (1 - blockDiscount);
  const proceeds = round(qty * px, 0);
  entry.shares -= qty;
  const pub = co.shareholders.find((s) => s.type === "public");
  if (pub) pub.shares += qty;
  else co.shareholders.push({ id: `${co.id}_pub`, name: "Public float", type: "public", shares: qty });
  if (holderId === "player") {
    credit(state.player, proceeds, `Stake sale · ${co.name}`, "biz", date(state));
    lifeFlow(state, "stakes", proceeds);
  } else {
    const holder = state.world.companies.find((c) => c.id === holderId);
    if (holder) holder.cash += proceeds;
  }
  co.price = round(co.price * (1 - blockDiscount / 2), 4);
  co.valuation = co.price * co.shares;
  const L = getLife(state);
  const rec = L.stakes.find((x) => x.companyId === co.id && x.holderId === holderId);
  let basis = 0;
  if (rec && rec.shares > 0) {
    const frac = Math.min(1, qty / rec.shares);
    basis = rec.cost * frac;
    rec.cost -= basis;
    rec.shares = Math.max(0, rec.shares - qty);
    if (rec.shares <= 0) L.stakes = L.stakes.filter((x) => x !== rec);
  }
  const gain = basis ? proceeds - basis : 0;
  ledger(state, `Sold ${((qty / co.shares) * 100).toFixed(2)}% of ${co.name}`, proceeds);
  log.push(`Sold ${qty.toLocaleString("en-IN")} shares of ${co.name} for ${formatINR(proceeds)} (block discount ${(blockDiscount * 100).toFixed(1)}%)${basis ? ` — ${gain >= 0 ? "gain" : "loss"} ${formatINR(Math.abs(gain))} vs cost` : ""}.`);
  checkControl(state, co, log);
}

/** Value of stakes held by companies you own (counted in net worth through
 *  your share of each holding company). */
export function groupStakeValue(state: GameState): number {
  return groupStakes(state);
}

/** Monthly: stakes you bought pay dividends (to you, or to the holding company). */
export function tickStakes(state: GameState) {
  const L = getLife(state);
  if (!L.stakes.length) return;
  for (const rec of L.stakes) {
    const co = state.world.companies.find((c) => c.id === rec.companyId);
    if (!co || co.stage === "bankrupt") continue;
    // controlled firms already pay you owner draws — don't pay twice
    if (rec.holderId === "player" && state.player.ownedCompanyIds.includes(co.id)) continue;
    // dividend: listed firms pay their stated yield, private profitable firms distribute 30% of profit
    const perShare = co.dividend > 0 ? co.dividend / 12 : co.profit > 0 && !co.listed ? (co.profit * 0.3) / 12 / Math.max(1, co.shares) : 0;
    const amt = round(perShare * rec.shares, 0);
    if (amt <= 0) continue;
    if (rec.holderId === "player") {
      credit(state.player, amt, `Dividend · ${co.name} stake`, "div", date(state));
      lifeFlow(state, "dividends", amt);
    } else {
      const holder = state.world.companies.find((c) => c.id === rec.holderId);
      if (holder) holder.cash += amt;
    }
  }
}
