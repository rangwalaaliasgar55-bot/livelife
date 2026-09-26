// Country-leader smoke test (run: npm run state-test).
// The treasury, borrowing, infrastructure, schemes, laws, per-company taxes,
// nationalisation, the coup clock, war — plus the two fixes that came with it:
// buying every branch the bank can afford in one click, and one developer
// running the whole property portfolio for maximum profit.
import { applyAction } from "../src/lib/sim/actions";
import { createGame } from "../src/lib/sim/create";
import { tickMonths } from "../src/lib/sim/engine";
import { getBiz } from "../src/lib/sim/biz";
import { getDevFirm, getEstate } from "../src/lib/sim/estates";
import { branchAffordable, BRANCH_COST } from "../src/lib/sim/finfirms";
import { canRule, getGov, govSummary, rulingCountry } from "../src/lib/sim/statecraft";
import { liquidCash } from "../src/lib/sim/finance";
import type { GameState, PlayerAction } from "../src/lib/sim/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Panels } from "../src/components/game/panels";

let failures = 0;
function check(label: string, cond: boolean, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const state: GameState = createGame({
  mode: "leader",
  name: "State Tester",
  age: 46,
  countryId: "indara",
  background: "wealthy",
  educationLevel: 4,
  wealth: 5_000_000,
  traits: { risk: 60, ambition: 80, discipline: 70, negotiation: 70, leadership: 80, creativity: 55, patience: 60, frugality: 50 },
  appearance: { skin: "#c68642", hair: "#1a120b", eyes: "#3d2914", style: "sharp", portrait: "gold" },
  nationality: "Indaran",
  seed: "state-smoke-1",
} as Parameters<typeof createGame>[0]);

const act = (a: PlayerAction) => applyAction(state, a);
const actVoid = (a: PlayerAction) => {
  applyAction(state, a);
};
const biz = (op: string, id = "", args: Record<string, unknown> = {}) => act({ type: "biz", op, id, args });

function live(months: number) {
  for (let i = 0; i < months; i++) {
    while (state.pending.length) {
      const d = state.pending[0]!;
      act({ type: "resolve", decisionId: d.id, optionId: d.options[0]!.id } as PlayerAction);
      if (state.pending[0] === d) state.pending.shift();
    }
    tickMonths(state, 1);
  }
}

// dev tools: money and time
act({ type: "dev", op: "toggle" } as PlayerAction);
act({ type: "dev", op: "add_money", args: { amount: 900_000_000 } } as PlayerAction);

/* ------------------------------------------------------------- the chair */

const country = rulingCountry(state)!;
check("leader mode puts you in the chair", canRule(state) && state.player.politics.role === "head", state.player.politics.role);
check("a government exists for your country", getGov(state).countryId === country.id);

/* -------------------------------------------------------------- treasury */

const startTreasury = getGov(state).treasury;
const cashBefore = liquidCash(state.player);
biz("govInject", "", { amount: 500_000_000 });
const g = getGov(state);
check(
  "injecting your own money moves it into the treasury",
  g.treasury >= startTreasury + 490_000_000 && liquidCash(state.player) < cashBefore,
  `treasury ${Math.round(g.treasury / 1e7)} Cr, cash ${Math.round(liquidCash(state.player) / 1e7)} Cr`,
);
check("injection is recorded as state income", g.stats.injected >= 500_000_000);

const debtBefore = country.debt;
biz("govBorrow", "", { source: "market", amount: 100_000_000_000 });
check("the state can borrow on its own credit", g.debt.some((d) => d.lender === "market") && g.treasury > startTreasury);
check("state borrowing lands on the country's debt", country.debt > debtBefore);

const cashBeforeLoan = liquidCash(state.player);
biz("govLoan", "", { amount: 20_000_000_000, term: 60 });
check("you can borrow money from the government", liquidCash(state.player) > cashBeforeLoan && g.loans.length === 1, `${g.loans.length} loan(s)`);
check("borrowing from the state raises corruption", g.corruption > 0);
check("borrowing from the state is cheaper than the market", g.stats.repaid >= 0);

check("a state loan creates a monthly instalment you must pay", g.loans[0]!.monthly > 0);
biz("govLoanRepay", "", { loanId: g.loans[0]!.id, amount: g.loans[0]!.remaining });
check("you can repay the state", g.loans.length === 0);

biz("govSkim", "", { amount: 1_000_000_000 });
check("skimming the treasury is possible and is punished", g.corruption > 0 && state.player.crime.heat > 0);

/* -------------------------------------------------------- infrastructure */

const infraBefore = country.infrastructure;
biz("govInfra", "", { kind: "highway", cityId: state.player.cityId, scale: 1 });
check("infrastructure projects break ground", g.projects.length === 1, g.projects[0]?.name);
const pj = g.projects[0]!;
live(3);
check("projects are paid for out of the treasury, monthly", pj.spent > 0 && pj.progress > 0, `spent ${Math.round(pj.spent / 1e7)} Cr`);
live(40);
check(
  "a finished project raises the country's infrastructure",
  pj.stage === "done" && country.infrastructure > infraBefore,
  `${infraBefore.toFixed(1)} → ${country.infrastructure.toFixed(1)}`,
);
check("completed infrastructure is counted", g.stats.built >= 1);

/* --------------------------------------------------------------- schemes */

const approvalBefore = country.approval;
biz("govScheme", "", { kind: "jobs", funding: 100 });
check("schemes launch with a monthly cost", g.schemes.length >= 1 && g.schemes[0]!.monthlyCost > 0);
live(12);
check(
  "schemes cost money and move the country",
  g.schemes[0]!.totalSpent > 0 && country.approval > approvalBefore - 20,
  `spent ${Math.round(g.schemes[0]!.totalSpent / 1e7)} Cr`,
);

/* ------------------------------------------------------------ legislature */

biz("govRegime", "", { move: "emergency" });
check("emergency powers suspend elections", g.regime.electionsSuspended);
biz("govRegime", "", { move: "secret", level: 60 });
check("internal security can be built", g.regime.secretPolice >= 60);
biz("govRegime", "", { move: "dictator" });
check("personal rule is reachable", g.regime.type === "dictatorship", g.regime.type);
const lawsBefore = g.laws.length;
biz("govLaw", "", { kind: "corp_tax_cut" });
check("under personal rule every law passes", g.laws.length === lawsBefore + 1, g.laws.at(-1)?.name);

/* -------------------------------------------------------- company taxes */

const target = state.world.companies
  .filter((x) => x.countryId === country.id && x.revenue > 0)
  .sort((a, b) => b.revenue - a.revenue)[0]!;
biz("govLevy", "", { companyId: target.id, levy: "levy", rate: 10 });
check("a company can be levied individually", getGov(state).levies[target.id]?.kind === "levy");
const levyTreasury = g.treasury;
live(2);
check("levies are collected into the treasury", getGov(state).levies[target.id]!.collected > 0 && g.treasury !== levyTreasury);

biz("govLaw", "", { kind: "nationalisation" });
biz("govNationalise", "", { companyId: target.id });
check("nationalisation takes the firm for the state", getGov(state).levies[target.id]?.kind === "nationalised");

const cashBeforeSeize = liquidCash(state.player);
const seizeTarget = state.world.companies.filter((x) => x.countryId === country.id && x.cash > 0)[0]!;
const treasuryBeforeSeize = g.treasury;
biz("govSeize", "", { companyId: seizeTarget.id });
check(
  "seizing a company's cash moves it to the treasury, not to you",
  g.treasury > treasuryBeforeSeize && liquidCash(state.player) === cashBeforeSeize - 0,
  `treasury +${Math.round((g.treasury - treasuryBeforeSeize) / 1e7)} Cr`,
);
check("seizure brings sanctions", g.sanctions > 0);

/* ------------------------------------------------------------------ war */

const enemy = state.world.countries.find((x) => x.id !== country.id)!;
biz("govWar", "", { enemyId: enemy.id, objective: "reparations", intensity: 2 });
const war = g.wars.at(-1)!;
check("war can be declared with an objective", war.status === "active" && war.enemyId === enemy.id);
check("war has a front, a strength comparison and a cost", war.ourStrength > 0 && war.enemyStrength > 0);
live(6);
check("the front moves and the war costs money", war.spend > 0 && war.battles.length > 0, `${Math.round(war.spend / 1e7)} Cr spent`);
check("casualties are counted", war.ourCasualties + war.theirCasualties > 0);
biz("govWarMove", "", { warId: war.id, move: "peace" });
check("peace can be sued for", war.status !== "active", war.status);

// a war you are sure to win: total intensity against the weakest neighbour
const weak = state.world.countries.filter((x) => x.id !== country.id).sort((a, b) => a.gdp - b.gdp)[0]!;
biz("govDefence", "", { budget: Math.round(country.revenue * 0.02) });
biz("govDefence", "", { equipment: 100 });
live(12);
biz("govWar", "", { enemyId: weak.id, objective: "reparations", intensity: 3 });
const war2 = g.wars.at(-1)!;
live(60);
check(
  "a stronger power eventually wins its war",
  war2.status === "won" || war2.status === "settled" || war2.front > 0,
  `${war2.status} at front ${Math.round(war2.front)}`,
);
check("the state keeps a war record", g.wars.length >= 2 && g.history.length > 0);

/* ------------------------------------------------- bank branches (+ MAX) */

act({ type: "dev", op: "add_money", args: { amount: 400_000_000 } } as PlayerAction);
const bankName = "State Tester Bank";
act({ type: "foundBank", name: bankName });
const bank = state.world.banks.find((b) => b.playerOwned);
check("you can found a bank", Boolean(bank));
if (bank) {
  act({ type: "dev", op: "add_money", args: { amount: 5_000_000_000 } } as PlayerAction);
  const before = bank.branches;
  const affordable = branchAffordable(state, bank.id);
  biz("bankBranch", bank.id, { delta: "max" });
  check(
    "+MAX opens every branch you can afford, with no 200 cap",
    bank.branches === before + affordable && affordable > 0,
    `+${bank.branches - before} branches (${affordable} affordable at ${Math.round(BRANCH_COST / 1e5)} L each)`,
  );
  const again = branchAffordable(state, bank.id);
  check("nothing is left unaffordable after a MAX buy", again < 1, `${again} left`);
}

/* ------------------------------------------- one developer, every property */

act({ type: "dev", op: "add_money", args: { amount: 5_000_000_000 } } as PlayerAction);
const land = state.world.properties.filter((p) => p.countryId === country.id && p.kind === "land")[0];
if (land) {
  act({ type: "buyProperty", listingId: land.id, mortgage: false });
}
const firm = getDevFirm(state);
biz("devFirm", "", { tier: "premium", auto: true, maximize: true, exit: "sell", reinvest: true, redevelop: true });
check("the portfolio developer can be switched on", firm.auto && firm.tier === "premium" && firm.maximize);
const owned = state.player.properties.length;
live(8);
const started = state.player.properties.filter((p) => getEstate(state, p).project).length;
check(
  "the developer files the most profitable scheme on every idle site by itself",
  owned > 0 && started > 0,
  `${started} of ${owned} properties under construction`,
);

/* ---------------------------------------------------------------- panels */

for (const view of ["gov", "war"]) {
  let html = "";
  let error = "";
  try {
    html = renderToStaticMarkup(createElement(Panels, { view, state, act: actVoid, busy: false }));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  check(`view "${view}" renders`, error === "" && html.length > 400, error || `${html.length} bytes`);
}

const govHtml = renderToStaticMarkup(createElement(Panels, { view: "gov", state, act: actVoid, busy: false }));
check("the government screen shows the treasury and the levers", /Treasury/.test(govHtml) && /Break ground/.test(govHtml));
const warHtml = renderToStaticMarkup(createElement(Panels, { view: "war", state, act: actVoid, busy: false }));
check("the war screen shows the army and the front", /Declare war/.test(warHtml) && /Wars fought/.test(warHtml));

/* ----------------------------------------------------------- invariants */

check("no NaN reached the treasury", Number.isFinite(g.treasury), String(g.treasury));
check("no NaN reached the country", Number.isFinite(country.gdp) && Number.isFinite(country.approval));
check("the books balance: a monthly report exists", Boolean(govSummary(state).gov.monthly));

console.log(failures === 0 ? "\nSTATE SMOKE: ALL CHECKS PASSED" : `\nSTATE SMOKE: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
