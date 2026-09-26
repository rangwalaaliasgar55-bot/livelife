// The casino floor — every game actually played, with the odds and house edge
// on the table. Play money only; nothing here touches real money.
//
// Randomness comes from seeds drawn off the save's RNG stream when a round
// starts, so a round is fixed before the first decision (a blackjack shoe, a
// crash point, a hi-lo deck) exactly like the Mines board. The admin x-ray
// (owner-only, see debug.ts) reads those seeds; players never see them.
import type { GameState } from "./types";
import { credit, liquidCash, money, spend } from "./finance";
import { getAdv, ledger } from "./advanced";
import { rng } from "./engine";
import { getLife, inPrison, lifeFlow } from "./life";
import { clamp, formatDate, formatINR, mulberry32, round, uid } from "./util";

/* ------------------------------------------------------------ cards */

export const SUITS = ["♠", "♥", "♦", "♣"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const cardRank = (c: number) => (c % 13) + 1; // 1..13
export const cardSuit = (c: number) => Math.floor(c / 13) % 4;
export const cardLabel = (c: number) => `${RANKS[cardRank(c) - 1]}${SUITS[cardSuit(c)]}`;
export const cardRed = (c: number) => cardSuit(c) === 1 || cardSuit(c) === 2;

/** A shuffled shoe of `decks` decks, derived from a seed. */
export function shoe(seed: number, decks = 6): number[] {
  const r = mulberry32(seed >>> 0);
  const cards = Array.from({ length: 52 * decks }, (_, i) => i % 52);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = cards[i]!;
    cards[i] = cards[j]!;
    cards[j] = t;
  }
  return cards;
}

/* ------------------------------------------------------------ state */

export interface BlackjackSession {
  id: string;
  stake: number;
  seed: number;
  pos: number;
  player: number[];
  dealer: number[];
  doubled: boolean;
  status: "live" | "done";
  result?: "blackjack" | "win" | "push" | "lose" | "bust" | "dealer_bust";
  payout?: number;
}

export interface CrashSession {
  id: string;
  stake: number;
  crash: number;
  auto: number | null;
  status: "live" | "cashed" | "bust";
  cashedAt?: number;
  payout?: number;
}

export interface HiLoSession {
  id: string;
  stake: number;
  seed: number;
  pos: number;
  cards: number[];
  mult: number;
  status: "live" | "cashed" | "bust";
  payout?: number;
}

export interface CasinoRecord {
  game: string;
  stake: number;
  payout: number;
  t: string;
  detail: string;
}

export interface CasinoState {
  bj: BlackjackSession | null;
  crash: CrashSession | null;
  hilo: HiLoSession | null;
  roulette: number[];
  crashHistory: number[];
  history: CasinoRecord[];
  sessions: number;
  net: number;
  lastSlots?: number[];
  lastPlinko?: { path: number[]; bucket: number; mult: number; risk: string; id: string };
  lastDice?: { roll: number; win: boolean; id: string };
  baccarat?: BaccaratRound | null;
  vp?: VideoPokerSession | null;
  wheel?: {
    seg: number;
    id: string;
    bets: Record<string, number>;
    win: number;
  } | null;
}

export function getCasino(state: GameState): CasinoState {
  const L = getLife(state);
  if (!L.casino) L.casino = { bj: null, crash: null, hilo: null, roulette: [], crashHistory: [], history: [], sessions: 0, net: 0 };
  const c = L.casino;
  c.roulette ??= [];
  c.crashHistory ??= [];
  c.history ??= [];
  return c;
}

function freshSeed(state: GameState): number {
  return ((state.rng >>> 0) ^ (Math.floor(rng(state) * 0xffffffff) >>> 0)) >>> 0;
}

const date = (s: GameState) => formatDate(s.time.year, s.time.month);

/** Take a stake. Nothing moves if it cannot be covered. */
function wager(state: GameState, game: string, stakeRaw: number, log: string[]): number {
  const stake = Math.round(money(stakeRaw));
  if (inPrison(state)) {
    log.push("No casinos in prison.");
    return 0;
  }
  if (stake <= 0) {
    log.push("Enter a stake above zero.");
    return 0;
  }
  if (stake > liquidCash(state.player)) {
    log.push(`Stake ${formatINR(stake)} exceeds your liquid cash. Nothing was taken.`);
    return 0;
  }
  if (!spend(state.player, stake, `${game} stake`, "gamble", date(state))) return 0;
  const p = state.player;
  p.gambling.lifetimeWagered += stake;
  p.gambling.bankrollSessions += 1;
  p.gambling.lastGame = game;
  lifeFlow(state, "gambling", -stake);
  const L = getLife(state);
  // the habit is a real consequence: big bets relative to your means build it faster
  L.addiction.gambling = clamp(L.addiction.gambling + 0.4 + (stake / Math.max(1, liquidCash(p) + stake)) * 6, 0, 100);
  getCasino(state).sessions += 1;
  return stake;
}

/** Pay out (0 for a loss) and record the round everywhere it belongs. */
function settle(state: GameState, game: string, stake: number, payout: number, detail: string, log: string[]) {
  const p = state.player;
  const adv = getAdv(state);
  const pay = round(Math.max(0, money(payout)), 2);
  if (pay > 0) {
    credit(p, pay, `${game} payout`, "gamble", date(state));
    lifeFlow(state, "gambling", pay);
    p.gambling.lifetimeWon += pay;
  }
  const net = round(pay - stake, 2);
  if (net < 0) {
    p.gambling.lifetimeLost += -net;
    adv.stats.biggestLoss = Math.max(adv.stats.biggestLoss, -net);
  } else adv.stats.biggestWin = Math.max(adv.stats.biggestWin, net);
  if (Math.abs(net) >= 100000) ledger(state, `${game}: ${net >= 0 ? "win" : "loss"}`, net);
  const c = getCasino(state);
  c.net = round(c.net + net, 2);
  c.history.unshift({ game, stake, payout: pay, t: date(state), detail });
  if (c.history.length > 40) c.history.length = 40;
  // losses hurt, wins feel great (briefly)
  p.happiness = clamp(p.happiness + (net > 0 ? Math.min(4, net / Math.max(20000, stake) * 2) : -Math.min(4, (-net / Math.max(1, liquidCash(p) + stake)) * 20)), 1, 100);
  log.push(`${detail} ${net >= 0 ? `+${formatINR(net)}` : `−${formatINR(-net)}`}.`);
}

/* ------------------------------------------------------------ blackjack */

export function handValue(cards: number[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = cardRank(c);
    if (r === 1) {
      aces += 1;
      total += 1;
    } else total += Math.min(10, r);
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

const isBJ = (cards: number[]) => cards.length === 2 && handValue(cards).total === 21;

function bjDraw(s: BlackjackSession): number {
  const deck = shoe(s.seed);
  const c = deck[s.pos % deck.length]!;
  s.pos += 1;
  return c;
}

/** Next card in the shoe — for the admin x-ray only. */
export function bjPeek(s: BlackjackSession): number {
  const deck = shoe(s.seed);
  return deck[s.pos % deck.length]!;
}

export function bjStart(state: GameState, stakeRaw: number, log: string[]) {
  const c = getCasino(state);
  if (c.bj && c.bj.status === "live") return void log.push("Finish the hand in play first.");
  const stake = wager(state, "Blackjack", stakeRaw, log);
  if (!stake) return;
  const s: BlackjackSession = { id: uid("bj"), stake, seed: freshSeed(state), pos: 0, player: [], dealer: [], doubled: false, status: "live" };
  s.player.push(bjDraw(s));
  s.dealer.push(bjDraw(s));
  s.player.push(bjDraw(s));
  s.dealer.push(bjDraw(s));
  c.bj = s;
  const pv = handValue(s.player).total;
  if (isBJ(s.player) || isBJ(s.dealer)) return bjFinish(state, log);
  log.push(`Dealt ${s.player.map(cardLabel).join(" ")} (${pv}) vs dealer ${cardLabel(s.dealer[0]!)} + hidden.`);
}

export function bjHit(state: GameState, log: string[]) {
  const s = getCasino(state).bj;
  if (!s || s.status !== "live") return void log.push("No hand in play.");
  const card = bjDraw(s);
  s.player.push(card);
  const v = handValue(s.player).total;
  if (v > 21) return bjFinish(state, log);
  if (v === 21) return bjStand(state, log);
  log.push(`Hit: ${cardLabel(card)} → ${v}.`);
}

export function bjStand(state: GameState, log: string[]) {
  const s = getCasino(state).bj;
  if (!s || s.status !== "live") return void log.push("No hand in play.");
  // dealer stands on all 17s
  while (handValue(s.dealer).total < 17) s.dealer.push(bjDraw(s));
  bjFinish(state, log);
}

export function bjDouble(state: GameState, log: string[]) {
  const s = getCasino(state).bj;
  if (!s || s.status !== "live") return void log.push("No hand in play.");
  if (s.player.length !== 2) return void log.push("You can only double on your first two cards.");
  if (!spend(state.player, s.stake, "Blackjack double", "gamble", date(state))) return void log.push("Not enough cash to double.");
  state.player.gambling.lifetimeWagered += s.stake;
  lifeFlow(state, "gambling", -s.stake);
  s.stake *= 2;
  s.doubled = true;
  s.player.push(bjDraw(s));
  if (handValue(s.player).total > 21) return bjFinish(state, log);
  bjStand(state, log);
}

function bjFinish(state: GameState, log: string[]) {
  const s = getCasino(state).bj!;
  const pv = handValue(s.player).total;
  const dv = handValue(s.dealer).total;
  let payout = 0;
  if (pv > 21) s.result = "bust";
  else if (isBJ(s.player) && !isBJ(s.dealer)) {
    s.result = "blackjack";
    payout = s.stake * 2.5;
  } else if (isBJ(s.dealer) && !isBJ(s.player)) s.result = "lose";
  else if (dv > 21) {
    s.result = "dealer_bust";
    payout = s.stake * 2;
  } else if (pv > dv) {
    s.result = "win";
    payout = s.stake * 2;
  } else if (pv === dv) {
    s.result = "push";
    payout = s.stake;
  } else s.result = "lose";
  s.status = "done";
  s.payout = payout;
  const label = { blackjack: "BLACKJACK! 3:2.", win: "You win.", dealer_bust: "Dealer busts — you win.", push: "Push — stake returned.", lose: "Dealer wins.", bust: "Bust." }[s.result];
  settle(state, "Blackjack", s.stake, payout, `${label} You ${pv} vs dealer ${dv}.`, log);
}

/* ------------------------------------------------------------ roulette */

export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
/** European wheel order, for drawing the wheel. */
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

export type RouletteBetKind = "straight" | "red" | "black" | "odd" | "even" | "low" | "high" | "dozen" | "column";
export interface RouletteBet {
  kind: RouletteBetKind;
  value?: number;
  amount: number;
}

export function rouletteWins(bet: RouletteBet, n: number): number {
  const a = bet.amount;
  if (bet.kind === "straight") return bet.value === n ? a * 36 : 0;
  if (n === 0) return 0;
  switch (bet.kind) {
    case "red":
      return RED.has(n) ? a * 2 : 0;
    case "black":
      return !RED.has(n) ? a * 2 : 0;
    case "odd":
      return n % 2 === 1 ? a * 2 : 0;
    case "even":
      return n % 2 === 0 ? a * 2 : 0;
    case "low":
      return n <= 18 ? a * 2 : 0;
    case "high":
      return n >= 19 ? a * 2 : 0;
    case "dozen":
      return Math.ceil(n / 12) === bet.value ? a * 3 : 0;
    case "column":
      return ((n - 1) % 3) + 1 === bet.value ? a * 3 : 0;
  }
  return 0;
}

export function rouletteSpin(state: GameState, bets: RouletteBet[], log: string[]): number | null {
  const clean = (bets ?? []).filter((b) => b && Number.isFinite(b.amount) && b.amount > 0).slice(0, 40);
  if (!clean.length) {
    log.push("Place at least one chip.");
    return null;
  }
  const total = clean.reduce((s, b) => s + Math.round(b.amount), 0);
  const stake = wager(state, "Roulette", total, log);
  if (!stake) return null;
  const n = Math.floor(rng(state) * 37);
  const win = clean.reduce((s, b) => s + rouletteWins({ ...b, amount: Math.round(b.amount) }, n), 0);
  const c = getCasino(state);
  c.roulette.unshift(n);
  if (c.roulette.length > 20) c.roulette.length = 20;
  settle(state, "Roulette", stake, win, `Ball landed on ${n} ${n === 0 ? "green" : RED.has(n) ? "red" : "black"}.`, log);
  return n;
}

/* ------------------------------------------------------------ slots */

export const SLOT_SYMBOLS = [
  { s: "🍒", w: 30, pay3: 5 },
  { s: "🍋", w: 24, pay3: 10 },
  { s: "🔔", w: 18, pay3: 20 },
  { s: "⭐", w: 13, pay3: 48 },
  { s: "💎", w: 9, pay3: 120 },
  { s: "7️⃣", w: 6, pay3: 420 },
] as const;
const SLOT_TOTAL = SLOT_SYMBOLS.reduce((s, x) => s + x.w, 0);
/** Any two cherries (not three) pay this multiple. */
export const SLOT_TWO_CHERRY = 1.5;

export function slotRTP(): number {
  let rtp = 0;
  for (const x of SLOT_SYMBOLS) rtp += (x.w / SLOT_TOTAL) ** 3 * x.pay3;
  const pc = SLOT_SYMBOLS[0].w / SLOT_TOTAL;
  rtp += 3 * pc * pc * (1 - pc) * SLOT_TWO_CHERRY;
  return rtp;
}

function slotPick(u: number): number {
  let t = u * SLOT_TOTAL;
  for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
    t -= SLOT_SYMBOLS[i]!.w;
    if (t <= 0) return i;
  }
  return SLOT_SYMBOLS.length - 1;
}

export function slotSpin(state: GameState, stakeRaw: number, log: string[]): number[] | null {
  const stake = wager(state, "Slots", stakeRaw, log);
  if (!stake) return null;
  const reels = [slotPick(rng(state)), slotPick(rng(state)), slotPick(rng(state))];
  let mult = 0;
  if (reels[0] === reels[1] && reels[1] === reels[2]) mult = SLOT_SYMBOLS[reels[0]!]!.pay3;
  else if (reels.filter((x) => x === 0).length === 2) mult = SLOT_TWO_CHERRY;
  getCasino(state).lastSlots = reels;
  settle(state, "Slots", stake, stake * mult, `${reels.map((i) => SLOT_SYMBOLS[i]!.s).join(" ")}${mult ? ` pays ${mult}×.` : " — no line."}`, log);
  return reels;
}

/* ------------------------------------------------------------ crash */

export const CRASH_EDGE = 0.03;
/** Multiplier growth: m(t) = e^(RATE·t), t in seconds. 2× at ~11.5 s. */
export const CRASH_RATE = 0.06;
export const crashAt = (ms: number) => Math.floor(Math.exp(CRASH_RATE * (ms / 1000)) * 100) / 100;
export const crashTimeFor = (m: number) => (Math.log(Math.max(1, m)) / CRASH_RATE) * 1000;

export function crashStart(state: GameState, stakeRaw: number, autoRaw: number | null | undefined, log: string[]) {
  const c = getCasino(state);
  if (c.crash && c.crash.status === "live") return void log.push("A round is already flying.");
  const stake = wager(state, "Crash", stakeRaw, log);
  if (!stake) return;
  const u = mulberry32(freshSeed(state))();
  // P(crash ≥ x) = (1 − edge) / x — the fair curve less a visible 3% edge
  const crash = Math.max(1, Math.floor(((1 - CRASH_EDGE) / Math.max(1e-9, 1 - u)) * 100) / 100);
  const auto = autoRaw && Number.isFinite(autoRaw) && autoRaw >= 1.01 ? round(autoRaw, 2) : null;
  c.crash = { id: uid("crs"), stake, crash, auto, status: "live" };
  log.push(`Round launched with ${formatINR(stake)}${auto ? `, auto cash-out at ${auto.toFixed(2)}×` : ""}. Cash out before it crashes.`);
}

/** Settle a crash round at multiplier `at`. At or past the crash point, it's gone. */
export function crashCashout(state: GameState, atRaw: number, log: string[]) {
  const c = getCasino(state);
  const s = c.crash;
  if (!s || s.status !== "live") return void log.push("No round in flight.");
  let at = Math.max(1, Math.floor(money(atRaw) * 100) / 100);
  if (s.auto && at > s.auto) at = s.auto;
  c.crashHistory.unshift(s.crash);
  if (c.crashHistory.length > 20) c.crashHistory.length = 20;
  if (at < s.crash) {
    s.status = "cashed";
    s.cashedAt = at;
    s.payout = round(s.stake * at, 2);
    settle(state, "Crash", s.stake, s.payout, `Cashed out at ${at.toFixed(2)}× (it crashed at ${s.crash.toFixed(2)}×).`, log);
  } else {
    s.status = "bust";
    s.payout = 0;
    settle(state, "Crash", s.stake, 0, `Crashed at ${s.crash.toFixed(2)}×.`, log);
  }
}

/* ------------------------------------------------------------ dice */

export const DICE_EDGE = 0.01;
export function diceOdds(target: number, over: boolean) {
  const t = clamp(target, 1, 98);
  const chance = over ? (99.99 - t) / 100 : t / 100;
  return { chance, mult: round((1 - DICE_EDGE) / Math.max(0.0001, chance), 4) };
}

export function diceRoll(state: GameState, stakeRaw: number, target: number, over: boolean, log: string[]): number | null {
  const stake = wager(state, "Dice", stakeRaw, log);
  if (!stake) return null;
  const { mult, chance } = diceOdds(target, over);
  const rollV = Math.floor(rng(state) * 10000) / 100;
  const win = over ? rollV > target : rollV < target;
  getCasino(state).lastDice = { roll: rollV, win, id: uid("dr") };
  settle(state, "Dice", stake, win ? stake * mult : 0, `Rolled ${rollV.toFixed(2)} (${over ? ">" : "<"} ${target}, ${(chance * 100).toFixed(2)}% for ${mult.toFixed(2)}×).`, log);
  return rollV;
}

/* ------------------------------------------------------------ hi-lo */

export const HILO_EDGE = 0.03;
export function hiloOdds(card: number) {
  const r = cardRank(card);
  const hi = (14 - r) / 13; // same or higher
  const lo = r / 13; // same or lower
  return { hi, lo, hiMult: round((1 - HILO_EDGE) / hi, 4), loMult: round((1 - HILO_EDGE) / lo, 4) };
}

export function hiloPeek(s: HiLoSession): number {
  const deck = shoe(s.seed, 4);
  return deck[s.pos % deck.length]!;
}

export function hiloStart(state: GameState, stakeRaw: number, log: string[]) {
  const c = getCasino(state);
  if (c.hilo && c.hilo.status === "live") return void log.push("Finish the current Hi-Lo run first.");
  const stake = wager(state, "Hi-Lo", stakeRaw, log);
  if (!stake) return;
  const s: HiLoSession = { id: uid("hl"), stake, seed: freshSeed(state), pos: 0, cards: [], mult: 1, status: "live" };
  s.cards.push(hiloPeek(s));
  s.pos += 1;
  c.hilo = s;
  log.push(`First card: ${cardLabel(s.cards[0]!)}. Higher or lower?`);
}

export function hiloGuess(state: GameState, guess: "hi" | "lo" | "skip", log: string[]) {
  const s = getCasino(state).hilo;
  if (!s || s.status !== "live") return void log.push("No run in progress.");
  const cur = s.cards[s.cards.length - 1]!;
  const next = hiloPeek(s);
  s.pos += 1;
  s.cards.push(next);
  if (s.cards.length > 30) s.cards.splice(0, s.cards.length - 30);
  if (guess === "skip") return void log.push(`Skipped to ${cardLabel(next)}.`);
  const o = hiloOdds(cur);
  const ok = guess === "hi" ? cardRank(next) >= cardRank(cur) : cardRank(next) <= cardRank(cur);
  if (ok) {
    s.mult = round(s.mult * (guess === "hi" ? o.hiMult : o.loMult), 4);
    log.push(`${cardLabel(next)} — correct. Multiplier ${s.mult.toFixed(2)}× (${formatINR(s.stake * s.mult)}).`);
    if (s.mult > 5000) hiloCashout(state, log);
  } else {
    s.status = "bust";
    s.payout = 0;
    settle(state, "Hi-Lo", s.stake, 0, `${cardLabel(next)} — wrong call.`, log);
  }
}

export function hiloCashout(state: GameState, log: string[]) {
  const s = getCasino(state).hilo;
  if (!s || s.status !== "live") return void log.push("Nothing to cash out.");
  s.status = "cashed";
  s.payout = round(s.stake * s.mult, 2);
  settle(state, "Hi-Lo", s.stake, s.payout, `Cashed out at ${s.mult.toFixed(2)}×.`, log);
}

/* ------------------------------------------------------------ plinko */

export const PLINKO_ROWS = 12;
const PLINKO_BASE: Record<"low" | "medium" | "high", number[]> = {
  low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
  medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
  high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
};
function binom(n: number, k: number) {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}
export function plinkoProbs(rows = PLINKO_ROWS): number[] {
  return Array.from({ length: rows + 1 }, (_, k) => binom(rows, k) / 2 ** rows);
}
export function plinkoRTP(risk: "low" | "medium" | "high"): number {
  const pr = plinkoProbs();
  return PLINKO_BASE[risk].reduce((s, m, i) => s + m * pr[i]!, 0);
}
/** Tables scaled so every risk level returns 97%. */
export function plinkoTable(risk: "low" | "medium" | "high"): number[] {
  const k = 0.97 / plinkoRTP(risk);
  return PLINKO_BASE[risk].map((m) => Math.round(m * k * 100) / 100);
}

export function plinkoDrop(state: GameState, stakeRaw: number, risk: "low" | "medium" | "high", log: string[]): { path: number[]; bucket: number; mult: number } | null {
  const rk = risk === "low" || risk === "high" ? risk : "medium";
  const stake = wager(state, "Plinko", stakeRaw, log);
  if (!stake) return null;
  const path: number[] = [];
  for (let i = 0; i < PLINKO_ROWS; i++) path.push(rng(state) < 0.5 ? 0 : 1);
  const bucket = path.reduce((s, x) => s + x, 0);
  const mult = plinkoTable(rk)[bucket]!;
  getCasino(state).lastPlinko = { path, bucket, mult, risk: rk, id: uid("pk") };
  settle(state, "Plinko", stake, stake * mult, `Ball dropped into slot ${bucket + 1}: ${mult}×.`, log);
  return { path, bucket, mult };
}

/* ------------------------------------------------------------ baccarat */

export interface BaccaratRound {
  id: string;
  player: number[];
  banker: number[];
  pTotal: number;
  bTotal: number;
  winner: "player" | "banker" | "tie";
  bets: { player: number; banker: number; tie: number };
  payout: number;
}

export const bacValue = (c: number) => {
  const r = cardRank(c);
  return r >= 10 ? 0 : r;
};
export const bacTotal = (cards: number[]) => cards.reduce((s, c) => s + bacValue(c), 0) % 10;

/** Punto banco with the standard tableau. Player 1:1, banker 0.95:1, tie 8:1
 *  (a tie pushes player and banker bets). Eight-deck shoe. */
export function baccaratDeal(state: GameState, betsRaw: { player?: number; banker?: number; tie?: number }, log: string[]): BaccaratRound | null {
  const bets = {
    player: Math.max(0, Math.round(money(betsRaw.player))),
    banker: Math.max(0, Math.round(money(betsRaw.banker))),
    tie: Math.max(0, Math.round(money(betsRaw.tie))),
  };
  const total = bets.player + bets.banker + bets.tie;
  if (total <= 0) {
    log.push("Put chips on Player, Banker or Tie.");
    return null;
  }
  const stake = wager(state, "Baccarat", total, log);
  if (!stake) return null;
  const deck = shoe(freshSeed(state), 8);
  let pos = 0;
  const draw = () => deck[pos++]!;
  const P = [draw(), draw()];
  const B = [draw(), draw()];
  const natural = bacTotal(P) >= 8 || bacTotal(B) >= 8;
  let p3: number | null = null;
  if (!natural) {
    if (bacTotal(P) <= 5) {
      p3 = draw();
      P.push(p3);
    }
    const bt = bacTotal(B);
    let bDraw: boolean;
    if (p3 == null) bDraw = bt <= 5;
    else {
      const v = bacValue(p3);
      bDraw = bt <= 2 || (bt === 3 && v !== 8) || (bt === 4 && v >= 2 && v <= 7) || (bt === 5 && v >= 4 && v <= 7) || (bt === 6 && (v === 6 || v === 7));
    }
    if (bDraw) B.push(draw());
  }
  const pT = bacTotal(P);
  const bT = bacTotal(B);
  const winner: BaccaratRound["winner"] = pT > bT ? "player" : bT > pT ? "banker" : "tie";
  let payout = 0;
  if (winner === "tie") payout = bets.tie * 9 + bets.player + bets.banker;
  else if (winner === "player") payout = bets.player * 2;
  else payout = bets.banker * 1.95;
  const round_: BaccaratRound = {
    id: uid("bac"),
    player: P,
    banker: B,
    pTotal: pT,
    bTotal: bT,
    winner,
    bets,
    payout: round(payout, 2),
  };
  getCasino(state).baccarat = round_;
  settle(
    state,
    "Baccarat",
    stake,
    payout,
    `Player ${P.map(cardLabel).join(" ")} (${pT}) vs Banker ${B.map(cardLabel).join(" ")} (${bT}) — ${winner === "tie" ? "tie" : `${winner} wins`}.`,
    log,
  );
  return round_;
}

/* ------------------------------------------------------------ video poker */

export interface VideoPokerSession {
  id: string;
  stake: number;
  seed: number;
  hand: number[];
  held: boolean[];
  status: "deal" | "done";
  result?: string;
  payout?: number;
}

/** Jacks or Better, full-pay 9/6 table (99.54% RTP with perfect play). */
export const VP_PAYS: { hand: string; pay: number }[] = [
  { hand: "Royal Flush", pay: 800 },
  { hand: "Straight Flush", pay: 50 },
  { hand: "Four of a Kind", pay: 25 },
  { hand: "Full House", pay: 9 },
  { hand: "Flush", pay: 6 },
  { hand: "Straight", pay: 4 },
  { hand: "Three of a Kind", pay: 3 },
  { hand: "Two Pair", pay: 2 },
  { hand: "Jacks or Better", pay: 1 },
];

export function vpEvaluate(hand: number[]): { hand: string; pay: number } {
  const ranks = hand.map(cardRank).sort((a, b) => a - b);
  const suits = hand.map(cardSuit);
  const flush = suits.every((x) => x === suits[0]);
  const uniq = [...new Set(ranks)];
  const wheel = uniq.length === 5 && ranks.join(",") === "1,2,3,4,5";
  const broadway = uniq.length === 5 && ranks.join(",") === "1,10,11,12,13";
  const straight = uniq.length === 5 && (ranks[4]! - ranks[0]! === 4 || wheel || broadway);
  const counts = Object.values(ranks.reduce<Record<number, number>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {})).sort((a, b) => b - a);
  const none = { hand: "Nothing", pay: 0 };
  const find = (h: string) => VP_PAYS.find((x) => x.hand === h)!;
  if (flush && broadway) return find("Royal Flush");
  if (flush && straight) return find("Straight Flush");
  if (counts[0] === 4) return find("Four of a Kind");
  if (counts[0] === 3 && counts[1] === 2) return find("Full House");
  if (flush) return find("Flush");
  if (straight) return find("Straight");
  if (counts[0] === 3) return find("Three of a Kind");
  if (counts[0] === 2 && counts[1] === 2) return find("Two Pair");
  if (counts[0] === 2) {
    const pair = Number(Object.entries(ranks.reduce<Record<number, number>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {})).find(([, n]) => n === 2)![0]);
    if (pair === 1 || pair >= 11) return find("Jacks or Better");
  }
  return none;
}

export function vpDeal(state: GameState, stakeRaw: number, log: string[]) {
  const c = getCasino(state);
  if (c.vp && c.vp.status === "deal") return void log.push("Finish the hand: choose holds and draw.");
  const stake = wager(state, "Video Poker", stakeRaw, log);
  if (!stake) return;
  const seed = freshSeed(state);
  const deck = shoe(seed, 1);
  c.vp = {
    id: uid("vp"),
    stake,
    seed,
    hand: deck.slice(0, 5),
    held: [false, false, false, false, false],
    status: "deal",
  };
  const now = vpEvaluate(c.vp.hand);
  log.push(`Dealt ${c.vp.hand.map(cardLabel).join(" ")}${now.pay ? ` — already ${now.hand}` : ""}. Hold what you want and draw.`);
}

/** Replacement cards that would come if you draw now (admin x-ray only). */
export function vpPeek(s: VideoPokerSession): number[] {
  return shoe(s.seed, 1).slice(5, 10);
}

export function vpDraw(state: GameState, holds: boolean[], log: string[]) {
  const c = getCasino(state);
  const s = c.vp;
  if (!s || s.status !== "deal") return void log.push("Deal a hand first.");
  const deck = shoe(s.seed, 1);
  let next = 5;
  s.held = [0, 1, 2, 3, 4].map((i) => Boolean(holds?.[i]));
  s.hand = s.hand.map((card, i) => (s.held[i] ? card : deck[next++]!));
  const res = vpEvaluate(s.hand);
  s.status = "done";
  s.result = res.hand;
  // the 9/6 table is quoted "for one": Jacks or Better returns your stake,
  // a flush returns six times it
  s.payout = s.stake * res.pay;
  settle(state, "Video Poker", s.stake, s.payout, `${s.hand.map(cardLabel).join(" ")} — ${res.hand}${res.pay ? ` (pays ${res.pay} for 1)` : ""}.`, log);
}

/* ------------------------------------------------------------ big six wheel */

/** 54 segments: 24×1, 15×2, 7×5, 4×10, 2×20, joker, logo (both 40:1). */
export const BIG_SIX: {
  id: string;
  label: string;
  pays: number;
  count: number;
}[] = [
  { id: "1", label: "₹1", pays: 1, count: 24 },
  { id: "2", label: "₹2", pays: 2, count: 15 },
  { id: "5", label: "₹5", pays: 5, count: 7 },
  { id: "10", label: "₹10", pays: 10, count: 4 },
  { id: "20", label: "₹20", pays: 20, count: 2 },
  { id: "joker", label: "Joker", pays: 40, count: 1 },
  { id: "logo", label: "Logo", pays: 40, count: 1 },
];
/** The physical order of the wheel. */
export const BIG_SIX_WHEEL: string[] = (() => {
  // spread each symbol evenly round the rim, rarest first
  const slots: (string | null)[] = Array.from({ length: 54 }, () => null);
  const order = [...BIG_SIX].sort((x, y) => x.count - y.count);
  order.forEach((sym, k) => {
    for (let j = 0; j < sym.count; j++) {
      let at = Math.floor((j * 54) / sym.count + k * 3) % 54;
      while (slots[at]) at = (at + 1) % 54;
      slots[at] = sym.id;
    }
  });
  return slots as string[];
})();
export const bigSixEdge = (id: string) => {
  const s = BIG_SIX.find((x) => x.id === id)!;
  return 1 - (s.count / 54) * (s.pays + 1);
};

export function wheelSpin(state: GameState, betsRaw: Record<string, number>, log: string[]): number | null {
  const bets: Record<string, number> = {};
  for (const s of BIG_SIX) {
    const v = Math.round(money(betsRaw?.[s.id]));
    if (v > 0) bets[s.id] = v;
  }
  const total = Object.values(bets).reduce((a, b) => a + b, 0);
  if (!total) {
    log.push("Place a bet on at least one symbol.");
    return null;
  }
  const stake = wager(state, "Big Six", total, log);
  if (!stake) return null;
  const seg = Math.floor(rng(state) * BIG_SIX_WHEEL.length);
  const hit = BIG_SIX_WHEEL[seg]!;
  const def = BIG_SIX.find((x) => x.id === hit)!;
  const win = (bets[hit] ?? 0) * (def.pays + 1);
  getCasino(state).wheel = { seg, id: uid("wh"), bets, win };
  settle(state, "Big Six", stake, win, `The wheel stopped on ${def.label} (${def.pays}:1).`, log);
  return seg;
}

/** House edge summary shown on the floor. */
export function casinoOdds() {
  return [
    { game: "Blackjack", edge: "≈0.6% with basic strategy (S17, 3:2, double any two)" },
    { game: "Roulette", edge: "2.70% (single zero)" },
    { game: "Slots", edge: `${((1 - slotRTP()) * 100).toFixed(1)}% (RTP ${(slotRTP() * 100).toFixed(1)}%)` },
    { game: "Crash", edge: `${(CRASH_EDGE * 100).toFixed(0)}%` },
    { game: "Dice", edge: `${(DICE_EDGE * 100).toFixed(0)}%` },
    { game: "Hi-Lo", edge: `${(HILO_EDGE * 100).toFixed(0)}% per call` },
    { game: "Plinko", edge: "3% on every risk level" },
    { game: "Mines", edge: "3%" },
    { game: "Baccarat", edge: "1.06% banker · 1.24% player · 14.4% tie" },
    {
      game: "Video Poker",
      edge: "0.46% with perfect Jacks-or-Better play (9/6)",
    },
    { game: "Big Six", edge: "11.1% on ₹1 up to 24.1% on Joker/Logo" },
  ];
}
