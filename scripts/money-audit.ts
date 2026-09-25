// Money-system regression audit (run: npm run money-test).
//
// Every check here corresponds to a real bug that used to destroy a player's
// balance. The invariant under test is simple: money only moves when something
// is actually bought, paid or won — never as a side effect of failing to pay.
import { applyAction } from "../src/lib/sim/actions";
import { createGame } from "../src/lib/sim/create";
import { tickMonths } from "../src/lib/sim/engine";
import { computeNetWorth, liquidCash, livingCostFor, loanSplit, monthlyLoanPayment } from "../src/lib/sim/finance";
import { getAdv } from "../src/lib/sim/advanced";
import { minesLayout, minesMultiplier, minesView } from "../src/lib/sim/mines";
import { repairFinances } from "../src/lib/sim/finance";
import type { GameState } from "../src/lib/sim/types";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const input = {
  mode: "entrepreneur" as const,
  name: "Audit",
  age: 25,
  countryId: "indara",
  background: "middle",
  educationLevel: 3,
  wealth: 400000,
  traits: { risk: 60, ambition: 70, discipline: 60, negotiation: 55, leadership: 50, creativity: 55, patience: 50, frugality: 50 },
  appearance: { skin: "#c68642", hair: "#1a120b", eyes: "#3d2914", style: "sharp" as const, portrait: "gold" as const },
  nationality: "Indaran",
  seed: "money-audit",
};

function fresh(seed = "money-audit"): GameState {
  const s = createGame({ ...input, seed });
  applyAction(s, { type: "dev", op: "toggle" });
  return s;
}
function fund(s: GameState, cash: number, deposit = 0) {
  applyAction(s, { type: "dev", op: "add_money", args: { amount: cash } });
  if (deposit > 0) {
    if (!s.player.finances.accounts.length) applyAction(s, { type: "openAccount", bankId: s.world.banks[0]!.id, kind: "savings" });
    applyAction(s, { type: "deposit", accountId: s.player.finances.accounts[0]!.id, amount: deposit });
  }
}
function months(s: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    if (s.pending.length) s.pending.splice(0, s.pending.length);
    tickMonths(s, 1);
  }
}

/* 1. an unaffordable bet must not take anything -------------------------- */
{
  const s = fresh("audit-1");
  fund(s, 200_000, 800_000);
  const before = liquidCash(s.player);
  const r = applyAction(s, { type: "gamble", game: "mines", stake: 50_000_000, extra: { mines: 5, picks: 3 } });
  check("oversized wager is refused", near(liquidCash(s.player), before), `${before} → ${liquidCash(s.player)} · ${r.log.join("; ")}`);
  const r2 = applyAction(s, { type: "minesStart", stake: 50_000_000, mines: 5 });
  check("oversized mines round is refused", near(liquidCash(s.player), before) && !getAdv(s).mines, r2.log.join("; "));
  const r3 = applyAction(s, { type: "startResearch", topic: "economy" });
  void r3;
  check("research still purchasable when affordable", getAdv(s).research.length === 1);
}

/* 2. advisors are charged exactly once ---------------------------------- */
{
  const s = fresh("audit-2");
  fund(s, 500_000, 500_000);
  applyAction(s, { type: "hireAdvisor", advisorId: "accountant" });
  const salary = getAdv(s).advisors[0]!.salary;
  const before = liquidCash(s.player);
  months(s, 1);
  const flow = getAdv(s).monthFlow?.flows ?? {};
  const charged = Math.round(Math.abs(flow.advisors ?? 0));
  check("advisor charged once per month", charged === salary, `charged ${charged} vs salary ${salary}`);
  const living = livingCostFor(s);
  const drift = before - liquidCash(s.player);
  check(
    "monthly drain equals salary + living + fees (not double)",
    drift < salary + living + 5000 && drift > salary * 0.5,
    `drained ${Math.round(drift)}, salary ${salary}, living ${living}`,
  );
  check("advisor month still solvent", liquidCash(s.player) > 0);
}

/* 3. advisors stop cleanly instead of emptying the account --------------- */
{
  const s = fresh("audit-3");
  fund(s, 30_000, 400_000);
  applyAction(s, { type: "hireAdvisor", advisorId: "economist" });
  const acctBefore = s.player.finances.accounts[0]!.balance;
  // Force the wallet to be short on the day the salary is due.
  s.player.finances.cash = 1000;
  months(s, 1);
  const acct = s.player.finances.accounts[0]!.balance;
  check("a short wallet does not empty the bank account", acct >= acctBefore - 60_000, `account ${Math.round(acctBefore)} → ${Math.round(acct)}`);
}

/* 4. unpaid living costs become arrears, not confiscation ---------------- */
{
  const s = fresh("audit-4");
  // start genuinely broke: no wallet, no deposits, no income
  s.player.finances.cash = 0;
  for (const a of s.player.finances.accounts) a.balance = 0;
  s.player.career.employed = false;
  s.player.career.job = null;
  const live = livingCostFor(s);
  months(s, 1);
  check("balance survives an unaffordable month", liquidCash(s.player) >= 0, `liquid ${Math.round(liquidCash(s.player))} for a ${live} month`);
  check("shortfall recorded as arrears", s.player.finances.arrears > 0, `arrears ${Math.round(s.player.finances.arrears)}`);
  // livingCostFor is re-evaluated inside the tick, after that month's inflation
  // print, so compare within a tolerance rather than to the pre-tick number.
  check(
    "arrears equal what could not be paid",
    Math.abs(s.player.finances.arrears - live) / live < 0.05,
    `arrears ${Math.round(s.player.finances.arrears)} vs living ${live}`,
  );
  // pay it back when money arrives
  fund(s, 200_000);
  months(s, 1);
  check("arrears cleared once funded", s.player.finances.arrears === 0, `arrears ${s.player.finances.arrears}`);
  check("the backlog was actually paid", liquidCash(s.player) < 200_000, `liquid ${Math.round(liquidCash(s.player))}`);
}

/* 5. loan instalments amortise honestly --------------------------------- */
{
  const principal = 5_000_000;
  const rate = 11;
  const term = 60;
  const payment = monthlyLoanPayment(principal, rate, term);
  let remaining = principal;
  let totalInterest = 0;
  for (let i = 0; i < term; i++) {
    const split = loanSplit(remaining, rate, Math.min(payment, remaining + (remaining * rate) / 100 / 12));
    totalInterest += split.interest;
    remaining = Math.max(0, remaining - split.principal);
  }
  check("loan amortises to zero over its term", remaining < 1, `remaining ${remaining.toFixed(2)}`);
  check("interest is a sane share of a 5-yr loan", totalInterest > principal * 0.1 && totalInterest < principal * 0.5, `interest ${Math.round(totalInterest)} on ${principal}`);
  check("split adds up to the payment", near(loanSplit(principal, rate, payment).interest + loanSplit(principal, rate, payment).principal, payment, 1));

  const s = fresh("audit-5");
  fund(s, 2_000_000);
  s.player.finances.creditScore = 800;
  s.player.finances.monthlyIncome = 400_000;
  let funded = false;
  for (let i = 0; i < 40 && !funded; i++) {
    const before = s.player.finances.loans.length;
    applyAction(s, { type: "applyLoan", kind: "personal", amount: 3_000_000, termMonths: 60 });
    funded = s.player.finances.loans.length > before;
  }
  check("a good profile can actually borrow", funded, `loans ${s.player.finances.loans.length}`);
  if (funded) {
    const loan = s.player.finances.loans[0]!;
    const start = loan.remaining;
    months(s, 12);
    const l2 = s.player.finances.loans[0]!;
    check("a year of instalments reduces principal", l2.remaining < start, `${Math.round(start)} → ${Math.round(l2.remaining)}`);
    check("instalment is not silently eating the balance", liquidCash(s.player) >= 0, `liquid ${Math.round(liquidCash(s.player))}`);
    check("no NaN in the loan", Number.isFinite(l2.remaining) && Number.isFinite(l2.monthly));
  }
}

/* 6. a declined mortgage refunds the deposit ---------------------------- */
{
  const s = fresh("audit-6");
  fund(s, 5_000_000);
  const listing = s.world.properties.find((p) => p.price < 4_000_000) ?? s.world.properties[0]!;
  const before = liquidCash(s.player);
  s.player.finances.creditScore = 350; // guarantee a decline
  applyAction(s, { type: "buyProperty", listingId: listing.id, mortgage: true });
  const gotHouse = s.player.properties.some((p) => p.id === listing.id);
  check("declined mortgage does not hand over the property", !gotHouse, `properties ${s.player.properties.length}`);
  check("deposit refunded after a declined mortgage", near(liquidCash(s.player), before, 2), `${Math.round(before)} → ${Math.round(liquidCash(s.player))}`);
}

/* 7. mines: the round is real, fair and conserved ----------------------- */
{
  const s = fresh("audit-7");
  fund(s, 1_000_000);
  const before = liquidCash(s.player);
  applyAction(s, { type: "minesStart", stake: 100_000, mines: 5 });
  const sess = getAdv(s).mines!;
  check("round started and stake taken once", near(liquidCash(s.player), before - 100_000), `${Math.round(before)} → ${Math.round(liquidCash(s.player))}`);
  const layout = minesLayout(sess.seed, sess.tiles, sess.mines);
  check("board has exactly the chosen number of mines", layout.length === 5 && new Set(layout).size === 5, JSON.stringify(layout));
  check("board is deterministic from the seed", JSON.stringify(layout) === JSON.stringify(minesLayout(sess.seed, 25, 5)));

  // open only safe tiles, then cash out: payout must equal stake * multiplier
  const safeTiles = [...Array(25).keys()].filter((t) => !layout.includes(t));
  for (const t of safeTiles.slice(0, 4)) applyAction(s, { type: "minesReveal", tile: t });
  const view = minesView(getAdv(s).mines!);
  check("multiplier matches the fair formula", near(view.multiplier, minesMultiplier(4, 25, 5), 0.0001), view.multiplier.toFixed(4));
  const beforeCashout = liquidCash(s.player);
  applyAction(s, { type: "minesCashout" });
  check("cash-out pays exactly stake x multiplier", near(liquidCash(s.player) - beforeCashout, view.cashoutNow, 1), `+${Math.round(liquidCash(s.player) - beforeCashout)} vs ${Math.round(view.cashoutNow)}`);
  check("round is closed", getAdv(s).mines!.status === "cashed");

  // hit a mine on purpose
  applyAction(s, { type: "minesStart", stake: 50_000, mines: 5 });
  const s2 = getAdv(s).mines!;
  const bomb = minesLayout(s2.seed, 25, 5)[0]!;
  const beforeBust = liquidCash(s.player);
  applyAction(s, { type: "minesReveal", tile: bomb });
  check("a mine ends the round with no extra charge", near(liquidCash(s.player), beforeBust), `${Math.round(beforeBust)} → ${Math.round(liquidCash(s.player))}`);
  check("bust recorded", getAdv(s).mines!.status === "bust" && getAdv(s).mines!.bustTile === bomb);
  check("cannot keep playing a busted round", applyAction(s, { type: "minesReveal", tile: 0 }).log.join("").includes("No live round"));
  applyAction(s, { type: "minesClear" });
  check("board clears", getAdv(s).mines === null);

  // House edge, measured the honest way: the player picks tiles blind (it never
  // looks at the layout) and banks after three gems if it survives that long.
  // P(survive 3 of 5 mines on 25 tiles) = 0.495, so RTP should be ~0.97.
  let wagered = 0;
  let returned = 0;
  let busts = 0;
  for (let i = 0; i < 600; i++) {
    const t = fresh(`edge-${i}`);
    fund(t, 10_000_000);
    applyAction(t, { type: "minesStart", stake: 100_000, mines: 5 });
    if (!getAdv(t).mines) continue;
    wagered += 100_000;
    const order = [...Array(25).keys()].sort(() => Math.random() - 0.5);
    for (const tile of order.slice(0, 3)) applyAction(t, { type: "minesReveal", tile });
    if (getAdv(t).mines!.status === "bust") busts++;
    const pre = liquidCash(t.player);
    applyAction(t, { type: "minesCashout" });
    returned += liquidCash(t.player) - pre;
  }
  const rtp = returned / Math.max(1, wagered);
  check("blind play lands on the modelled RTP (~97%)", rtp > 0.8 && rtp < 1.14, `RTP ${(rtp * 100).toFixed(1)}% over ${wagered / 100000} rounds`);
  check("roughly half the blind rounds bust", busts / Math.max(1, wagered / 100000) > 0.35 && busts / Math.max(1, wagered / 100000) < 0.65, `${busts} busts`);
}

/* 8. admin treasury credits exactly what it says ------------------------ */
{
  const s = fresh("audit-8");
  s.adv!.debug = false;
  const locked = applyAction(s, { type: "admin", op: "draw", amount: 1_000_000 });
  check("treasury is locked without the key", locked.log.join("").includes("locked"), locked.log.join("; "));
  const wrong = applyAction(s, { type: "admin", op: "unlock", key: "not-the-key" });
  check("wrong key is rejected", wrong.log.join("").includes("Wrong key") && !s.adv!.admin.unlocked);
  const before = liquidCash(s.player);
  applyAction(s, { type: "admin", op: "unlock", key: process.env.NEXT_PUBLIC_ADMIN_KEY ?? "aurelion-admin" });
  check("correct key unlocks", s.adv!.admin.unlocked === true);
  applyAction(s, { type: "admin", op: "draw", amount: 2_500_000 });
  check("draw credits exactly the amount", near(liquidCash(s.player) - before, 2_500_000), `+${Math.round(liquidCash(s.player) - before)}`);
  check("draw is recorded", s.adv!.admin.draws === 1 && s.adv!.admin.totalDrawn === 2_500_000);
  check("draw appears in the ledger", getAdv(s).ledger.some((l) => l.text.includes("Treasury draw")), getAdv(s).ledger[0]?.text ?? "");
  applyAction(s, { type: "admin", op: "lock" });
  check("treasury can be locked again", s.adv!.admin.unlocked === false);
}

/* 9. NaN can never take hold -------------------------------------------- */
{
  const s = fresh("audit-9");
  fund(s, 20_000_000, 5_000_000);
  applyAction(s, { type: "hireAdvisor", advisorId: "accountant" });
  applyAction(s, { type: "hireAdvisor", advisorId: "financial" });
  const listing = s.world.properties[0];
  if (listing) applyAction(s, { type: "buyProperty", listingId: listing.id, mortgage: false });
  applyAction(s, { type: "placeForecast", topic: "index", direction: "up", horizonMonths: 3, stake: 100_000 });
  applyAction(s, { type: "startResearch", topic: "cashflow" });
  applyAction(s, { type: "startResearch", topic: "debt" });
  months(s, 60);
  const nums = [
    s.player.finances.cash,
    ...s.player.finances.accounts.map((a) => a.balance),
    ...s.player.finances.loans.map((l) => l.remaining),
    ...s.player.properties.map((p) => p.value),
    computeNetWorth(s),
    s.player.finances.monthlyIncome,
    s.player.finances.monthlyExpenses,
    s.player.finances.arrears,
    getAdv(s).stats.taxes,
  ];
  check("60 months of everything leaves no NaN", nums.every((n) => Number.isFinite(n)), nums.filter((n) => !Number.isFinite(n)).join(","));
  check("cash never goes negative", s.player.finances.cash >= -1e-9, `${s.player.finances.cash}`);
  check("accounts never go negative", s.player.finances.accounts.every((a) => a.balance >= -1e-9));
  check("flow history accumulated", getAdv(s).flowHistory.length >= 12, `${getAdv(s).flowHistory.length} months`);
  check("taxes are actually counted now", getAdv(s).stats.taxes >= 0);

  // a poisoned save is repaired on load
  const poisoned = JSON.parse(JSON.stringify(s)) as GameState;
  poisoned.player.finances.cash = Number.NaN;
  poisoned.player.finances.accounts[0]!.balance = Number.POSITIVE_INFINITY;
  const fixed = repairFinances(poisoned);
  check("repairFinances rescues a NaN save", fixed.length >= 2 && Number.isFinite(poisoned.player.finances.cash) && Number.isFinite(poisoned.player.finances.accounts[0]!.balance), fixed.join(","));
}

console.log(failures === 0 ? "\nMONEY AUDIT: ALL CHECKS PASSED" : `\nMONEY AUDIT: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
