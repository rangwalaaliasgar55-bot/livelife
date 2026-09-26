import { ADVISOR_DEFS, CHALLENGE_DEFS, companyRating, forecastLabel, getAdv, GOAL_DEFS, ledger, RESEARCH_TOPICS, hasAdvisor } from "./advanced";
import { BILL_TOPICS, INDUSTRIES, SKILLS, TRACKS, industryMeta } from "./catalog";
import { devOp } from "./debug";
import { history, news, note, rng, tickMonths, timeline, unlock } from "./engine";
import { computeNetWorth, credit, liquidCash, money, monthlyLoanPayment, spend } from "./finance";
import { MINES_PRESETS, MINES_TILES, minesLayout, minesView, newMinesSession } from "./mines";
import { adminOp } from "./debug";
import { ACTIVITIES, addChild, adoptChild, adoptPet, askOut, doActivity, findLove, getLife, inheritLife, inPrison, interact, monthsToBirthday, sentence } from "./life";
import { resolveLifeEvent } from "./lifeevents";
import {
  buyAircraft,
  buyVehicle,
  flyAircraft,
  maintainAircraft,
  repairVehicle,
  sellAircraft,
  sellVehicle,
  setAircraftCrew,
  setAircraftMode,
  takeVacation,
  toggleYachtCharter,
} from "./lifestyle";
import { sellStake, tenderOffer } from "./corporate";
import {
  bjDouble,
  bjHit,
  bjStand,
  bjStart,
  crashCashout,
  crashStart,
  diceRoll,
  getCasino,
  hiloCashout,
  hiloGuess,
  hiloStart,
  plinkoDrop,
  rouletteSpin,
  slotSpin,
  baccaratDeal,
  vpDeal,
  vpDraw,
  wheelSpin,
} from "./casino";
import { applyBiz, BIZ_PRISON_BLOCKED } from "./bizactions";
import { certPay, jobAiRisk, resolveAiLayoff, resolveTax, STUDY_LEVELS, allTracks, taxGain } from "./civic";
import { resolveCorp } from "./company";
import { resolveBankCap, getBankOps } from "./finfirms";
import { resolveEstate } from "./estates";
import { getCasinoOps } from "./casinoops";
import { getBiz } from "./biz";

/** Things you simply cannot do from a cell. */
const PRISON_BLOCKED = new Set<string>([
  "study", "course", "applyJob", "freelance", "travel", "buyProperty", "foundCompany", "buyCompany", "gamble", "minesStart",
  "foundCasino", "foundBank", "foundInsurer", "foundMedia", "campaign", "runForOffice", "createParty", "haveChild", "workout",
  "network", "buyVehicle", "buyAircraft", "flyAircraft", "vacation", "findLove", "askOut", "adoptPet", "adoptChild",
  "bjStart", "rouletteSpin", "slotSpin", "crashStart", "diceRoll", "hiloStart", "plinkoDrop", "baccaratDeal",
  "vpDeal",
  "wheelSpin",
  "crimeAct", "applyResidency", "applyCitizenship",
]);
import type {
  Loan,
  EducationTrack,
  FoundPayload,
  GameState,
  Industry,
  ListedCompany,
  PlayerAction,
  PolicyVector,
  SkillId,
} from "./types";
import { chance, clamp, formatDate, formatINR, normal, pick, round, uid } from "./util";

export function applyAction(state: GameState, action: PlayerAction): { state: GameState; log: string[]; error?: string } {
  const log: string[] = [];
  // Anti-exploit guard (spec 163): every numeric field must be finite and sane.
  const bad = Object.values(action).some((v) => typeof v === "number" && !Number.isFinite(v));
  if (bad) return { state, log, error: "Invalid numbers in action." };
  getCasino(state); // make sure the life layer exists on older saves
  if (PRISON_BLOCKED.has(action.type) && inPrison(state)) {
    const pr = getLife(state).prison!;
    return { state, log: [`You're serving time in ${pr.facility} (${pr.monthsLeft} months left). Try the prison activities — or age up.`] };
  }
  try {
    switch (action.type) {
      case "ageUp": {
        if (!state.player.alive) {
          log.push("This life has ended.");
          break;
        }
        const before = state.player.age;
        const m = monthsToBirthday(state);
        tickMonths(state, m);
        const p = state.player;
        log.push(p.age > before ? `You are now ${p.age}.` : `Something happened at ${p.age} — decide, then age up again to continue.`);
        break;
      }
      case "activity":
        doActivity(state, action.id, log);
        void ACTIVITIES;
        break;
      case "interact":
        interact(state, action.personId, action.kind, log, { prenup: action.prenup, wedding: action.wedding });
        break;
      case "findLove":
        findLove(state, action.where, log);
        break;
      case "askOut":
        askOut(state, action.candidateId, log);
        break;
      case "adoptPet":
        adoptPet(state, action.species, log);
        break;
      case "adoptChild":
        adoptChild(state, log);
        break;
      case "buyVehicle":
        buyVehicle(state, action.modelId, log);
        break;
      case "sellVehicle":
        sellVehicle(state, action.id, log);
        break;
      case "repairVehicle":
        repairVehicle(state, action.id, log);
        break;
      case "yachtCharter":
        toggleYachtCharter(state, action.id, log);
        break;
      case "buyAircraft":
        buyAircraft(state, action.modelId, log);
        break;
      case "sellAircraft":
        sellAircraft(state, action.id, log);
        break;
      case "aircraftMode":
        setAircraftMode(state, action.id, action.mode, log);
        break;
      case "aircraftCrew":
        setAircraftCrew(state, action.id, action.crew, log);
        break;
      case "maintainAircraft":
        maintainAircraft(state, action.id, log);
        break;
      case "flyAircraft":
        flyAircraft(state, action.id, action.cityId, log);
        break;
      case "vacation":
        takeVacation(state, action.cityId, action.tier, action.days, action.aircraftId, log);
        break;
      case "tenderOffer":
        tenderOffer(state, action.companyId, action.pct, action.premium, action.buyer, log);
        break;
      case "sellStake":
        sellStake(state, action.companyId, action.holderId, action.pct, log);
        break;
      case "bjStart":
        bjStart(state, action.stake, log);
        break;
      case "bjHit":
        bjHit(state, log);
        break;
      case "bjStand":
        bjStand(state, log);
        break;
      case "bjDouble":
        bjDouble(state, log);
        break;
      case "rouletteSpin":
        rouletteSpin(state, action.bets, log);
        break;
      case "slotSpin":
        slotSpin(state, action.stake, log);
        break;
      case "crashStart":
        crashStart(state, action.stake, action.auto, log);
        break;
      case "crashCashout":
        crashCashout(state, action.at, log);
        break;
      case "diceRoll":
        diceRoll(state, action.stake, action.target, action.over, log);
        break;
      case "hiloStart":
        hiloStart(state, action.stake, log);
        break;
      case "hiloGuess":
        hiloGuess(state, action.guess, log);
        break;
      case "hiloCashout":
        hiloCashout(state, log);
        break;
      case "plinkoDrop":
        plinkoDrop(state, action.stake, action.risk, log);
        break;
      case "baccaratDeal":
        baccaratDeal(state, action.bets, log);
        break;
      case "vpDeal":
        vpDeal(state, action.stake, log);
        break;
      case "vpDraw":
        vpDraw(state, action.holds, log);
        break;
      case "wheelSpin":
        wheelSpin(state, action.bets, log);
        break;
      case "biz":
        if (inPrison(state) && BIZ_PRISON_BLOCKED.has(action.op)) {
          log.push("Not from a prison cell.");
          break;
        }
        applyBiz(state, action.op, action.id ?? "", action.args ?? {}, log);
        break;
      case "casinoClear": {
        const c = getCasino(state);
        if (action.game === "bj" && c.bj?.status !== "live") c.bj = null;
        if (action.game === "crash" && c.crash?.status !== "live") c.crash = null;
        if (action.game === "hilo" && c.hilo?.status !== "live") c.hilo = null;
        if (action.game === "vp" && c.vp?.status !== "deal") c.vp = null;
        if (action.game === "baccarat") c.baccarat = null;
        if (action.game === "wheel") c.wheel = null;
        break;
      }
      case "tick":
        tickMonths(state, action.months ?? 1);
        log.push(`Lived ${action.months ?? 1} month(s).`);
        break;
      case "study":
        startStudy(state, action.track, action.level, log);
        break;
      case "dropStudy":
        if (state.player.currentStudy) {
          state.player.currentStudy.inProgress = false;
          log.push(`Left ${state.player.currentStudy.name}.`);
          state.player.currentStudy = null;
        }
        break;
      case "selfLearn":
      case "practice":
        trainSkill(state, action.skill, 1.2, 0, log);
        break;
      case "course":
        trainSkill(state, action.skill, 4, 18000, log);
        break;
      case "applyJob":
        applyJob(state, action.jobId, log);
        break;
      case "quitJob":
        quitJob(state, log);
        break;
      case "freelance":
        state.player.career.freelance = { active: true, rate: 400 + state.player.skills.programming * 12, hours: action.hours, industry: action.industry };
        log.push(`Freelance ${action.industry}, ${action.hours}h/week.`);
        break;
      case "stopFreelance":
        state.player.career.freelance.active = false;
        log.push("Stopped freelancing.");
        break;
      case "openAccount":
        openAccount(state, action.bankId, action.kind, log);
        break;
      case "deposit":
        deposit(state, action.accountId, action.amount, log);
        break;
      case "withdraw":
        withdraw(state, action.accountId, action.amount, log);
        break;
      case "transfer":
        transfer(state, action.fromId, action.toId, action.amount, log);
        break;
      case "applyLoan":
        applyLoan(state, action.kind, action.amount, action.termMonths, log);
        break;
      case "repayLoan":
        repayLoan(state, action.loanId, action.amount, log);
        break;
      case "buyStock":
        tradeStock(state, action.ticker, action.shares, "buy", log);
        break;
      case "sellStock":
        tradeStock(state, action.ticker, action.shares, "sell", log);
        break;
      case "buyBond":
        buyBond(state, action.bondId, action.qty, log);
        break;
      case "sellBond":
        sellBond(state, action.bondId, action.qty, log);
        break;
      case "buyFund":
        buyFund(state, action.fundId, action.amount, log);
        break;
      case "sellFund":
        sellFund(state, action.fundId, action.units, log);
        break;
      case "buyProperty":
        buyProperty(state, action.listingId, action.mortgage, log);
        break;
      case "sellProperty":
        sellProperty(state, action.propertyId, log);
        break;
      case "renovate":
        renovate(state, action.propertyId, action.spend, log);
        break;
      case "setRent":
        setRent(state, action.propertyId, action.occupancyBias, log);
        break;
      case "develop":
        develop(state, action.propertyId, log);
        break;
      case "advanceBuild":
        break;
      case "foundCompany":
        foundCompany(state, action.payload, log);
        break;
      case "manageCompany":
        manageCompany(state, action.companyId, action.patch, log);
        break;
      case "raiseFunding":
        raiseFunding(state, action.companyId, action.source, action.amount, log);
        break;
      case "ipo":
        ipo(state, action.companyId, log);
        break;
      case "buyCompany":
        buyCompany(state, action.companyId, log);
        break;
      case "sellShares":
        sellShares(state, action.companyId, action.pct, log);
        break;
      case "appointCeo":
        appointCeo(state, action.companyId, action.self, log);
        break;
      case "applyGrant":
        applyGrant(state, action.grantId, action.companyId, log);
        break;
      case "pursueOpportunity":
        pursueOpportunity(state, action.opportunityId, log);
        break;
      case "travel":
        travel(state, action.countryId, action.cityId, action.intent, log);
        break;
      case "applyResidency":
        applyResidency(state, log);
        break;
      case "applyCitizenship":
        applyCitizenship(state, log);
        break;
      case "joinParty":
        joinParty(state, action.partyId, log);
        break;
      case "createParty":
        createParty(state, action.name, action.platform, log);
        break;
      case "campaign":
        campaign(state, action.spend, log);
        break;
      case "runForOffice":
        runForOffice(state, action.office, log);
        break;
      case "setPolicy":
        setPolicy(state, action.policy, log);
        break;
      case "proposeBill":
        proposeBill(state, action.topic, action.magnitude, log);
        break;
      case "appointMinister":
        log.push(`Appointed ${action.name} to cabinet.`);
        history(state, "politics", `Appointed minister ${action.name}`);
        break;
      case "conVote":
        conVote(state, action.resolutionId, action.vote, log);
        break;
      case "conPropose":
        conPropose(state, action.title, log);
        break;
      case "socialPost":
        socialPost(state, action.platform, action.topic, action.spend, log);
        break;
      case "socialGrow":
        socialGrow(state, action.platform, log);
        break;
      case "hireSocial":
        hireSocial(state, action.role, log);
        break;
      case "fireSocial":
        fireSocial(state, action.handlerId, log);
        break;
      case "foundAgency":
        foundAgency(state, action.name, log);
        break;
      case "agencyPromote":
        agencyPromote(state, action.companyId, action.budget, log);
        break;
      case "buyAICompany":
        buyAICompany(state, action.companyId, log);
        break;
      case "buyGovHelp":
        buyGovHelp(state, action.kind, log);
        break;
      case "buyPartyMember":
        buyPartyMember(state, action.partyId, log);
        break;
      case "hireSecurity":
        hireSecurity(state, action.level, log);
        break;
      case "assumePower":
        assumePower(state, log);
        break;
      case "foundMedia":
        foundMedia(state, action.kind, action.name, log);
        break;
      case "crimeAct":
        crimeAct(state, action.kind, action.intensity, log);
        break;
      case "foundOrg":
        foundOrg(state, action.kind, action.name, action.doctrine, log);
        break;
      case "orgAct":
        orgAct(state, action.orgId, action.act, log);
        break;
      case "gamble":
        gamble(state, action.game, action.stake, action.extra ?? {}, log);
        break;
      case "foundCasino":
        foundCasino(state, action.name, action.cityId, log);
        break;
      case "foundBank":
        foundBank(state, action.name, log);
        break;
      case "foundInsurer":
        foundInsurer(state, action.name, log);
        break;
      case "buyInsurance":
        buyInsurance(state, action.kind, log);
        break;
      case "haveChild":
        haveChild(state, log);
        break;
      case "setHeir":
        state.player.family.willHeirId = action.memberId;
        log.push("Heir updated.");
        break;
      case "continueAsHeir":
        continueAsHeir(state, log);
        break;
      case "interview":
        interview(state, action.tone, log);
        break;
      case "resolve":
        resolveDecision(state, action.decisionId, action.optionId, log);
        break;
      case "rest":
        state.player.energy = clamp(state.player.energy + 18, 0, 100);
        state.player.stress = clamp(state.player.stress - 10, 0, 100);
        log.push("You rested.");
        break;
      case "workout":
        state.player.health = clamp(state.player.health + 2, 0, 100);
        state.player.energy = clamp(state.player.energy - 6, 0, 100);
        log.push("Training complete.");
        break;
      case "network":
        network(state, log);
        break;
      case "createFund":
        createFund(state, action.name, action.kind, log);
        break;
      case "fxConvert":
        fxConvert(state, action.fromId, action.toId, action.amount, log);
        break;
      case "setGoal":
        setGoal(state, action.goalId, action.target, log);
        break;
      case "clearGoal":
        getAdv(state).goals[action.goalId] = undefined as unknown as { target: number };
        delete getAdv(state).goals[action.goalId];
        log.push("Goal removed.");
        break;
      case "placeForecast":
        placeForecast(state, action.topic, action.targetId, action.direction, action.horizonMonths, action.stake, log);
        break;
      case "cancelForecast": {
        const adv = getAdv(state);
        const f = adv.forecasts.find((x) => x.id === action.forecastId);
        if (f && f.status === "open") {
          f.status = "push";
          credit(state.player, f.stake, "Forecast cancelled — stake returned", "forecast", date(state));
          log.push("Forecast cancelled; stake returned.");
        } else log.push("Forecast not found or already settled.");
        break;
      }
      case "startResearch":
        startResearch(state, action.topic, action.targetId, log);
        break;
      case "hireAdvisor":
        hireAdvisor(state, action.advisorId, log);
        break;
      case "fireAdvisor": {
        const adv = getAdv(state);
        const a = adv.advisors.find((x) => x.defId === action.advisorId);
        adv.advisors = adv.advisors.filter((x) => x.defId !== action.advisorId);
        log.push(a ? `${a.name} left the staff.` : "No such advisor.");
        break;
      }
      case "hireManager":
        hireManager(state, action.companyId, log);
        break;
      case "fireManager": {
        const co = state.world.companies.find((c) => c.id === action.companyId);
        if (co) {
          co.manager = undefined;
          log.push("Manager dismissed.");
        }
        break;
      }
      case "bidAuction":
        bidAuction(state, action.lotId, log);
        break;
      case "startChallenge":
        startChallenge(state, action.challengeId, log);
        break;
      case "abandonChallenge":
        if (getAdv(state).challenge) {
          log.push("Challenge abandoned.");
          getAdv(state).challenge = null;
        }
        break;
      case "dev":
        log.push(devOp(state, action.op, action.args ?? {}));
        break;
      case "minesStart":
        minesStart(state, action.stake, action.mines, log);
        break;
      case "minesReveal":
        minesReveal(state, action.tile, log);
        break;
      case "minesCashout":
        minesCashout(state, log);
        break;
      case "minesClear":
        getAdv(state).mines = null;
        log.push("Board cleared.");
        break;
      case "admin":
        log.push(adminOp(state, action.op, action.key, action.amount));
        break;
      default:
        log.push("Unknown action");
    }
  } catch (e) {
    return { state, log, error: e instanceof Error ? e.message : "Action failed" };
  }
  return { state, log };
}

function date(state: GameState) {
  return formatDate(state.time.year, state.time.month);
}

/* ------------------------------------------------- advanced system actions */

function fxConvert(state: GameState, fromId: string, toId: string, amount: number, log: string[]) {
  const p = state.player;
  const from = p.finances.accounts.find((a) => a.id === fromId);
  const to = p.finances.accounts.find((a) => a.id === toId);
  if (!from || !to || from.id === to.id) {
    log.push("Pick two different accounts.");
    return;
  }
  amount = clamp(amount, 0, 1e15);
  if (amount <= 0) return;
  if (from.balance < amount) {
    log.push("Not enough in the source account.");
    return;
  }
  const fromC = state.world.countries.find((c) => c.id === from.countryId)!;
  const toC = state.world.countries.find((c) => c.id === to.countryId)!;
  if (fromC.id === toC.id) {
    from.balance -= amount;
    to.balance += amount;
    from.transactions.unshift({ id: uid("tx"), date: date(state), desc: "Transfer", amount: -amount, bal: from.balance, cat: "transfer" });
    to.transactions.unshift({ id: uid("tx"), date: date(state), desc: "Transfer", amount, bal: to.balance, cat: "transfer" });
    log.push(`Moved ${formatINR(amount)} between accounts.`);
    return;
  }
  const base = (amount / fromC.fx) * 0.998; // 0.2% conversion spread
  const converted = base * toC.fx;
  from.balance -= amount;
  to.balance += converted;
  from.transactions.unshift({ id: uid("tx"), date: date(state), desc: `FX out · ${fromC.currency.code}`, amount: -amount, bal: from.balance, cat: "fx" });
  to.transactions.unshift({ id: uid("tx"), date: date(state), desc: `FX in · ${toC.currency.code}`, amount: converted, bal: to.balance, cat: "fx" });
  ledger(state, `FX conversion ${fromC.currency.code} → ${toC.currency.code}`, converted - amount);
  log.push(`Converted ${formatINR(amount)} ${fromC.currency.code} → ${formatINR(converted)} ${toC.currency.code} at ${toC.fx.toFixed(2)}/${fromC.fx.toFixed(2)} (0.2% spread).`);
}

function setGoal(state: GameState, goalId: string, target: number, log: string[]) {
  const def = GOAL_DEFS.find((g) => g.id === goalId);
  if (!def) {
    log.push("Unknown goal.");
    return;
  }
  const adv = getAdv(state);
  adv.goals[goalId] = { target: clamp(target, def.needsTarget ? 1000 : 0, 1e15) };
  timeline(state, `Set goal: ${def.label}.`, "goal");
  log.push(`Goal set: ${def.label}.`);
}

function placeForecast(state: GameState, topic: string, targetId: string | undefined, direction: "up" | "down", horizonMonths: number, stake: number, log: string[]) {
  const p = state.player;
  const adv = getAdv(state);
  stake = clamp(stake, 1000, Math.min(liquidCash(p), 1e12));
  if (stake <= 0 || !spend(p, stake, "Forecast stake", "forecast", date(state))) {
    log.push("Stake unavailable (min ₹1,000, must fit liquid cash).");
    return;
  }
  const base =
    topic === "index"
      ? state.world.indexHistory[state.world.indexHistory.length - 1]?.v ?? 0
      : topic === "property"
        ? state.world.cities.find((c) => c.id === p.cityId)?.propertyIndex ?? 100
        : topic === "inflation"
          ? state.world.countries.find((c) => c.id === p.countryId)?.inflation ?? 3
          : topic === "growth"
            ? state.world.countries.find((c) => c.id === p.countryId)?.gdpGrowth ?? 2
            : topic === "fx"
              ? state.world.countries.find((c) => c.id === p.countryId)?.fx ?? 1
              : state.world.companies.find((c) => c.ticker === targetId)?.price ?? 0;
  adv.forecasts.push({
    id: uid("fc"),
    topic: topic as "index",
    targetId,
    direction,
    placedAt: date(state),
    base,
    dueTick: state.ticks + clamp(Math.round(horizonMonths), 1, 24),
    stake,
    status: "open",
  });
  log.push(`Forecast placed: ${direction} on base ${base.toFixed(2)} · stake ${formatINR(stake)} · settles in ${clamp(Math.round(horizonMonths), 1, 24)} months.`);
}

function startResearch(state: GameState, topic: string, targetId: string | undefined, log: string[]) {
  const def = RESEARCH_TOPICS.find((t) => t.id === topic);
  if (!def) {
    log.push("Unknown research topic.");
    return;
  }
  if (!spend(state.player, def.cost, `Research · ${def.title}`, "research", date(state))) {
    log.push(`Not enough cash for ${formatINR(def.cost)}.`);
    return;
  }
  const adv = getAdv(state);
  adv.research.unshift({
    id: uid("rs"),
    topic: def.id,
    targetId,
    title: def.title + (targetId ? ` · ${targetId}` : ""),
    cost: def.cost,
    dueTick: state.ticks + def.months,
    done: false,
    findings: [],
  });
  ledger(state, `Research commissioned: ${def.title}`, -def.cost);
  log.push(`Research underway: ${def.title} (done in ~${def.months} months).`);
}

function hireAdvisor(state: GameState, advisorId: string, log: string[]) {
  const def = ADVISOR_DEFS.find((a) => a.id === advisorId);
  if (!def) {
    log.push("Unknown advisor role.");
    return;
  }
  const adv = getAdv(state);
  if (adv.advisors.some((a) => a.defId === advisorId)) {
    log.push("Already on staff.");
    return;
  }
  if (!spend(state.player, def.salary * 3, `Retainer · ${def.role}`, "advisor", date(state))) {
    log.push(`Retainer of ${formatINR(def.salary * 3)} unavailable.`);
    return;
  }
  const r = () => rng(state);
  const names = ["Meera", "Tobias", "Anya", "Rafael", "Ingrid", "Dev", "Priya", "Marcus", "Lena", "Kofi"];
  const surnames = ["Sharma", "Weiss", "Kaur", "Moreau", "Lindqvist", "Patel", "Novak", "Osei"];
  adv.advisors.push({
    id: uid("adv"),
    defId: def.id,
    name: `${pick(r, names)} ${pick(r, surnames)}`,
    salary: def.salary,
    skill: Math.round(def.skill[0] + r() * (def.skill[1] - def.skill[0])),
    hiredAt: date(state),
  });
  if (adv.advisors.length >= 6) unlock(state, "cabinet");
  timeline(state, `Hired ${def.role}.`, "career");
  log.push(`${def.role} joined at ${formatINR(def.salary)}/mo. ${def.effect}`);
}

function hireManager(state: GameState, companyId: string, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co || !state.player.ownedCompanyIds.includes(companyId)) {
    log.push("Not your company.");
    return;
  }
  if (co.manager) {
    log.push("Already managed.");
    return;
  }
  const salary = Math.max(40000, Math.round(co.revenue * 0.004));
  if (!spend(state.player, salary * 3, `Recruitment · ${co.name}`, "biz", date(state))) {
    log.push(`Recruitment cost ${formatINR(salary * 3)} unavailable.`);
    return;
  }
  co.manager = { name: "Hired professional manager", salary, skill: Math.round(55 + rng(state) * 40) };
  log.push(`${co.name} now has a professional manager (${co.manager.skill}/100). Costs −, quality drifts up while you're away from the day job.`);
}

function bidAuction(state: GameState, lotId: string, log: string[]) {
  const adv = getAdv(state);
  const lot = adv.auctions.find((l) => l.id === lotId);
  if (!lot) {
    log.push("Auction no longer open.");
    return;
  }
  const price = lot.currentPrice;
  if (price > liquidCash(state.player)) {
    log.push(`Bid ${formatINR(price)} exceeds liquid cash.`);
    return;
  }
  const winP = clamp(0.45 + state.player.skills.negotiation / 250 + (lot.currentPrice < lot.fairPrice ? 0.2 : -0.15), 0.15, 0.9);
  if (!chance(rng.bind(null, state), winP)) {
    lot.currentPrice = Math.round(lot.currentPrice * 1.06);
    log.push(`Outbid. The price moved to ${formatINR(lot.currentPrice)}. Try again before it closes.`);
    return;
  }
  if (!spend(state.player, price, `Auction win · ${lot.title}`, "auction", date(state))) {
    log.push("Could not pay the winning bid.");
    return;
  }
  adv.auctions = adv.auctions.filter((l) => l.id !== lotId);
  if (lot.kind === "property") {
    const listing = state.world.properties.find((x) => x.id === lot.refId);
    if (listing) {
      state.player.properties.push({
        id: uid("ph"),
        name: listing.name,
        kind: listing.kind,
        countryId: listing.countryId,
        cityId: listing.cityId,
        district: listing.district,
        size: listing.size,
        condition: listing.condition,
        purchasePrice: price,
        value: Math.max(price, listing.price * 0.8),
        rent: listing.rent,
        occupancy: listing.occupancy,
        maintenance: price * 0.004,
        tax: price * 0.001,
        mortgaged: false,
        yearBought: state.time.year,
      });
      const idx = state.world.properties.findIndex((x) => x.id === listing.id);
      if (idx >= 0) state.world.properties.splice(idx, 1);
    }
  } else {
    const co = state.world.companies.find((x) => x.id === lot.refId);
    if (co) {
      const playerSh = co.shareholders.find((s) => s.type === "player");
      if (playerSh) playerSh.shares = co.shares;
      else co.shareholders.push({ id: uid("sh"), name: state.player.name, type: "player", shares: co.shares });
      for (const s of co.shareholders) if (s.type !== "player") s.shares = 0;
      co.forSale = false;
      co.distressed = false;
      co.stage = co.cash > 0 ? "startup" : "distressed";
      if (!state.player.ownedCompanyIds.includes(co.id)) state.player.ownedCompanyIds.push(co.id);
      co.playerCeo = true;
      co.ceo = state.player.name;
    }
  }
  getAdv(state).stats.businesses += lot.kind === "company" ? 1 : 0;
  getAdv(state).stats.propertiesMax = Math.max(getAdv(state).stats.propertiesMax, state.player.properties.length);
  ledger(state, `Auction won: ${lot.title}`, -price);
  timeline(state, `Won auction for ${lot.title} at ${formatINR(price)}.`, "finance");
  unlock(state, "auctioneer");
  note(state, `Auction won: ${lot.title} for ${formatINR(price)} (fair ~${formatINR(lot.fairPrice)}).`, "good");
  log.push(`Won ${lot.title} for ${formatINR(price)}.`);
}

function startChallenge(state: GameState, challengeId: string, log: string[]) {
  const def = CHALLENGE_DEFS.find((c) => c.id === challengeId);
  if (!def) {
    log.push("Unknown challenge.");
    return;
  }
  const adv = getAdv(state);
  if (adv.challenge && adv.challenge.status === "active") {
    log.push("Finish or abandon your current challenge first.");
    return;
  }
  const cap = challengeId === "fi_40" ? Math.max(state.ticks + 12, state.ticks + (40 - state.player.age) * 12) : state.ticks + def.years * 12;
  adv.challenge = { defId: def.id, title: def.title, startedTick: state.ticks, deadlineTick: cap, status: "active" };
  timeline(state, `Challenge accepted: ${def.title}.`, "challenge");
  log.push(`Challenge accepted: ${def.title} — deadline ${def.years === 100 ? "age 40" : `in ${def.years} years`}.`);
}

function startStudy(state: GameState, track: EducationTrack, level: GameState["player"]["education"][number]["level"], log: string[]) {
  const p = state.player;
  if (p.currentStudy) {
    log.push("Already studying.");
    return;
  }
  const t = allTracks().find((x) => x.id === track) ?? TRACKS[0]!;
  const lvl = STUDY_LEVELS.find((l) => l.id === level);
  if (!lvl) {
    log.push("Pick a programme level.");
    return;
  }
  if (p.educationLevel < lvl.minEdu) {
    log.push(`${lvl.name} needs education level ${lvl.minEdu} — you are at ${p.educationLevel}.`);
    return;
  }
  const tuition = lvl.tuition;
  const rec = {
    id: uid("edu"),
    level,
    name: `${t.name} · ${lvl.name}`,
    track,
    institution:
      level === "phd" || level === "masters"
        ? "Capital Graduate School": level === "university" ? "Capital University" : level === "course" ? "Open Network" : "Civic College",
    countryId: p.countryId,
    startYear: state.time.year,
    startTick: state.ticks,
    endYear: null,
    tuition,
    scholarship: p.educationLevel >= 3 && p.traits.discipline > 60 ? Math.round(tuition * 0.2) : 0,
    loan: 0,
    gpa: 3.0,
    completed: false,
    inProgress: true,
  };
  p.education.push(rec);
  p.currentStudy = rec;
  timeline(state, `Started ${rec.name}.`, "education");
  log.push(`Enrolled in ${rec.name}. Tuition ${formatINR(tuition)}/yr for ${lvl.years < 1 ? `${Math.round(lvl.years * 12)} months` : `${lvl.years} years`}.`);
}

function trainSkill(state: GameState, skill: SkillId, amt: number, cost: number, log: string[]) {
  if (cost && !spend(state.player, cost, `Course · ${skill}`, "edu", date(state))) {
    log.push("Cannot afford the course.");
    return;
  }
  const cur = state.player.skills[skill] ?? 0;
  state.player.skills[skill] = clamp(cur + amt * (1.1 - cur / 140), 0, 100);
  log.push(`${SKILLS.find((s) => s.id === skill)?.name ?? skill} → ${state.player.skills[skill]!.toFixed(0)}`);
}

function applyJob(state: GameState, jobId: string, log: string[]) {
  const job = state.world.jobs.find((j) => j.id === jobId);
  if (!job) {
    log.push("Job listing gone.");
    return;
  }
  const p = state.player;
  if (p.age < 16) {
    log.push("Too young.");
    return;
  }
  const eduOk = p.educationLevel >= job.educationMin;
  const expOk = p.career.experience + 0.4 >= job.experienceMin;
  let skillScore = 0;
  let need = 0;
  for (const [k, v] of Object.entries(job.skills)) {
    skillScore += p.skills[k] ?? 0;
    need += v ?? 0;
  }
  const skillOk = need === 0 || skillScore / need > 0.55;
  const country = state.world.countries.find((c) => c.id === job.countryId)!;
  const demandBoost = job.demand / 200;
  const certBonus = certPay(state, job.industry);
  const chanceP = clamp((eduOk ? 0.35 : 0.08) + (expOk ? 0.25 : 0) + (skillOk ? 0.25 : 0.05) + demandBoost - country.unemployment * 0.01 + p.reputation.professional / 400 +
      certBonus, 0.04, 0.92);
  log.push(`Interview odds ${Math.round(chanceP * 100)}% (education, experience, skills, demand).`);
  if (!chance(rng.bind(null, state), chanceP)) {
    log.push(`${job.employer} passed.`);
    note(state, `Rejected: ${job.title}`, "warn");
    return;
  }
  if (p.career.job) {
    p.career.history.push({
      title: p.career.job.title,
      employer: p.career.job.employer,
      start: `${p.career.yearsInRole.toFixed(1)}y ago`,
      end: date(state),
      salary: p.career.job.salary,
    });
  }
  p.career.employed = true;
  if (certBonus > 0) {
    job.salary = Math.round(job.salary * (1 + certBonus));
    log.push(`Your certification lifts the offer by ${Math.round(certBonus * 100)}%.`);
  }
  p.career.job = job;
  const risk = jobAiRisk(state);
  if (risk > 0.03) log.push(`Heads-up: this role is ${Math.round(risk * 1000) / 10}%/month exposed to AI automation.`);
  p.career.yearsInRole = 0;
  p.career.performance = 55;
  p.reputation.professional += 4;
  timeline(state, `Hired as ${job.title} at ${job.employer}.`, "career");
  unlock(state, "first_job");
  log.push(`You are now ${job.title} · ${formatINR(job.salary)}/yr.`);
}

function quitJob(state: GameState, log: string[]) {
  const p = state.player;
  if (!p.career.job) {
    log.push("No job to quit.");
    return;
  }
  p.career.history.push({ title: p.career.job.title, employer: p.career.job.employer, start: "", end: date(state), salary: p.career.job.salary });
  log.push(`Left ${p.career.job.title}.`);
  p.career.job = null;
  p.career.employed = false;
}

function openAccount(state: GameState, bankId: string, kind: "checking" | "savings" | "business", log: string[]) {
  const bank = state.world.banks.find((b) => b.id === bankId);
  if (!bank) {
    log.push("Bank not found.");
    return;
  }
  state.player.finances.accounts.push({
    id: uid("acct"),
    bankId: bank.id,
    bankName: bank.name,
    countryId: bank.countryId,
    type: kind,
    currency: state.world.countries.find((c) => c.id === bank.countryId)!.currency.code,
    balance: 0,
    interestRate: kind === "savings" ? bank.savingsRate : 0.2,
    fee: kind === "checking" ? 150 : 0,
    transactions: [],
  });
  log.push(`Opened ${kind} at ${bank.name}.`);
}

function deposit(state: GameState, accountId: string, amount: number, log: string[]) {
  const acct = state.player.finances.accounts.find((a) => a.id === accountId);
  if (!acct || amount <= 0) return;
  if (state.player.finances.cash < amount) {
    log.push("Not enough cash.");
    return;
  }
  state.player.finances.cash -= amount;
  acct.balance += amount;
  acct.transactions.unshift({ id: uid("tx"), date: date(state), desc: "Deposit", amount, bal: acct.balance, cat: "transfer" });
  log.push(`Deposited ${formatINR(amount)}.`);
}

function withdraw(state: GameState, accountId: string, amount: number, log: string[]) {
  const acct = state.player.finances.accounts.find((a) => a.id === accountId);
  if (!acct || amount <= 0) return;
  if (acct.balance < amount) {
    log.push("Insufficient funds.");
    return;
  }
  acct.balance -= amount;
  state.player.finances.cash += amount;
  acct.transactions.unshift({ id: uid("tx"), date: date(state), desc: "Withdrawal", amount: -amount, bal: acct.balance, cat: "transfer" });
  log.push(`Withdrew ${formatINR(amount)}.`);
}

function transfer(state: GameState, fromId: string, toId: string, amount: number, log: string[]) {
  const a = state.player.finances.accounts.find((x) => x.id === fromId);
  const b = state.player.finances.accounts.find((x) => x.id === toId);
  if (!a || !b || a.balance < amount) {
    log.push("Transfer failed.");
    return;
  }
  a.balance -= amount;
  b.balance += amount;
  log.push("Transferred.");
}

function applyLoan(state: GameState, kind: Loan["kind"], amount: number, termMonths: number, log: string[]): Loan | null {
  const p = state.player;
  const country = state.world.countries.find((c) => c.id === p.countryId)!;
  const bank = state.world.banks.find((b) => b.countryId === p.countryId)!;
  const income = Math.max(p.finances.monthlyIncome, (p.career.job?.salary ?? 0) / 12);
  const util = totalUpcoming(p) / Math.max(1, income);
  const score = p.finances.creditScore;
  let rate = bank.lendingRate + (kind === "business" ? 1.5 : kind === "personal" ? 3 : kind === "startup" ? 4 : 0);
  if (score < 580) rate += 6;
  else if (score < 660) rate += 2.5;
  else if (score > 760) rate -= 1.2;
  if (hasAdvisor(state, "financial")) rate -= 0.5;
  if (kind === "business" || kind === "startup") {
    const owned = state.world.companies.filter((c) => p.ownedCompanyIds.includes(c.id));
    if (owned.length) rate += companyRating(owned[0]!, state).spread * 0.4;
  }
  rate = Math.max(1.2, rate);
  const maxAmt = income * 12 * (score > 700 ? 6 : 3) + p.properties.reduce((s, x) => s + x.value * 0.4, 0);
  const eligible = amount <= maxAmt && score > 500 && p.finances.defaults < 3 && util < 0.65;
  const prob = clamp(0.15 + (score - 500) / 500 + (eligible ? 0.3 : -0.4) - util, 0.02, 0.9);
  log.push(`Underwrite: score ${score}, rate ~${rate.toFixed(1)}%, p(approve) ${Math.round(prob * 100)}%.`);
  if (!chance(rng.bind(null, state), prob)) {
    log.push(`Loan declined — ${amount > maxAmt ? "size exceeds what income and collateral support" : score <= 500 ? "credit score too low" : util >= 0.65 ? "existing instalments already absorb too much income" : p.finances.defaults >= 3 ? "too many past defaults" : "underwriting said no"}.`);
    note(state, "A bank declined your application.", "warn");
    history(state, "finance", `Loan declined (${kind})`);
    return null;
  }
  const monthly = monthlyLoanPayment(amount, rate, termMonths);
  const loan: Loan = {
    id: uid("ln"),
    kind,
    lender: bank.name,
    principal: amount,
    remaining: amount,
    rate,
    termMonths,
    monthsLeft: termMonths,
    monthly,
    status: "current",
    missed: 0,
  };
  p.finances.loans.push(loan);
  credit(p, amount, `${kind} loan proceeds`, "loan", date(state));
  ledger(state, `${kind} loan funded · ${rate.toFixed(1)}% · ${termMonths}mo`, amount);
  log.push(`Approved. ${formatINR(amount)} at ${rate.toFixed(1)}% · ${formatINR(monthly)}/mo (interest first, then principal).`);
  note(state, "Loan funded.", "good");
  return loan;
}

function totalUpcoming(p: GameState["player"]) {
  return p.finances.loans.filter((l) => l.status !== "paid").reduce((s, l) => s + l.monthly, 0);
}

function repayLoan(state: GameState, loanId: string, amount: number, log: string[]) {
  const loan = state.player.finances.loans.find((l) => l.id === loanId);
  if (!loan) return;
  if (!spend(state.player, amount, "Loan extra pay", "loan", date(state))) {
    log.push("Not enough cash.");
    return;
  }
  loan.remaining = Math.max(0, round(loan.remaining - amount, 2));
  if (loan.remaining <= 0) {
    loan.remaining = 0;
    loan.status = "paid";
    loan.monthly = 0;
    loan.monthsLeft = 0;
    note(state, `${loan.kind} loan cleared early.`, "good");
    timeline(state, `Repaid the ${loan.kind} loan in full.`, "finance");
  } else {
    // Re-amortise over the remaining term so the instalment reflects reality.
    loan.monthsLeft = Math.max(1, loan.monthsLeft);
    loan.monthly = monthlyLoanPayment(loan.remaining, loan.rate, loan.monthsLeft);
  }
  ledger(state, `Loan prepayment (${loan.kind})`, -amount);
  state.player.finances.creditScore = clamp(state.player.finances.creditScore + 2, 300, 900);
  log.push(`Remaining ${formatINR(loan.remaining)} · new instalment ${formatINR(loan.monthly)}/mo.`);
}

function tradeStock(state: GameState, ticker: string, shares: number, side: "buy" | "sell", log: string[]) {
  const co = state.world.companies.find((c) => c.ticker === ticker);
  if (!co || shares <= 0) {
    log.push("No such listing.");
    return;
  }
  const cost = shares * co.price;
  if (side === "buy") {
    if (!spend(state.player, cost, `Buy ${ticker}`, "inv", date(state))) {
      log.push("Need more cash.");
      return;
    }
    const h = state.player.holdings.find((x) => x.ticker === ticker);
    if (h) {
      h.avgCost = (h.avgCost * h.shares + cost) / (h.shares + shares);
      h.shares += shares;
    } else state.player.holdings.push({ ticker, shares, avgCost: co.price });
    log.push(`Bought ${shares} ${ticker} @ ${formatINR(co.price)}.`);
  } else {
    const h = state.player.holdings.find((x) => x.ticker === ticker);
    if (!h || h.shares < shares) {
      log.push("Not enough shares.");
      return;
    }
    h.shares -= shares;
    taxGain(state, cost - h.avgCost * shares);
    credit(state.player, cost, `Sell ${ticker}`, "inv", date(state));
    if (h.shares === 0) state.player.holdings = state.player.holdings.filter((x) => x.ticker !== ticker);
    log.push(`Sold ${shares} ${ticker}.`);
  }
}

function buyBond(state: GameState, bondId: string, qty: number, log: string[]) {
  const b = state.world.bonds.find((x) => x.id === bondId);
  if (!b) return;
  const cost = b.price * qty;
  if (!spend(state.player, cost, `Bond ${b.name}`, "inv", date(state))) {
    log.push("Cannot afford.");
    return;
  }
  state.player.bonds.push({ ...b, qty });
  log.push(`Bought ${qty} × ${b.name}.`);
}

function sellBond(state: GameState, bondId: string, qty: number, log: string[]) {
  const h = state.player.bonds.find((x) => x.id === bondId);
  if (!h || h.qty < qty) return;
  credit(state.player, h.price * qty, "Sell bond", "inv", date(state));
  h.qty -= qty;
  state.player.bonds = state.player.bonds.filter((x) => x.qty > 0);
  log.push("Bond sold.");
}

function buyFund(state: GameState, fundId: string, amount: number, log: string[]) {
  const f = state.world.funds.find((x) => x.id === fundId);
  if (!f) return;
  if (!spend(state.player, amount, `Fund ${f.name}`, "inv", date(state))) {
    log.push("Cannot afford.");
    return;
  }
  const units = amount / f.nav;
  const h = state.player.funds.find((x) => x.id === fundId);
  if (h) {
    h.avgCost = (h.avgCost * h.units + amount) / (h.units + units);
    h.units += units;
  } else state.player.funds.push({ id: f.id, name: f.name, kind: f.kind, units, nav: f.nav, avgCost: f.nav });
  log.push(`Invested ${formatINR(amount)} in ${f.name}.`);
}

function sellFund(state: GameState, fundId: string, units: number, log: string[]) {
  const h = state.player.funds.find((x) => x.id === fundId);
  const f = state.world.funds.find((x) => x.id === fundId);
  if (!h || !f || h.units < units) return;
  h.units -= units;
  credit(state.player, units * f.nav, "Sell fund", "inv", date(state));
  log.push("Fund units sold.");
}

function buyProperty(state: GameState, listingId: string, mortgage: boolean, log: string[]) {
  const listing = state.world.properties.find((p) => p.id === listingId);
  if (!listing) {
    log.push("Listing gone.");
    return;
  }
  const price = round(listing.distressed ? listing.price * 0.82 : listing.price, 2);
  let loan: Loan | null = null;
  if (mortgage) {
    const down = round(price * 0.25, 2);
    if (!spend(state.player, down, `Down payment ${listing.name}`, "property", date(state))) {
      log.push(`Need 25% down (${formatINR(down)}).`);
      return;
    }
    loan = applyLoan(state, "home", round(price - down, 2), 240, log);
    if (!loan) {
      // Financing fell through: give the deposit back and walk away. The old
      // code kept the deposit AND handed over the property — free houses.
      credit(state.player, down, `Deposit refunded · ${listing.name}`, "property", date(state));
      log.push("Mortgage declined — purchase cancelled, deposit refunded.");
      note(state, `The mortgage for ${listing.name} was declined. Your deposit was refunded.`, "warn");
      return;
    }
  } else if (!spend(state.player, price, `Buy ${listing.name}`, "property", date(state))) {
    log.push(`Cannot afford this property (${formatINR(price)}).`);
    return;
  }
  state.player.properties.push({
    id: listing.id,
    name: listing.name,
    kind: listing.kind,
    countryId: listing.countryId,
    cityId: listing.cityId,
    district: listing.district,
    size: listing.size,
    condition: listing.condition,
    purchasePrice: price,
    value: listing.price,
    rent: listing.kind === "house" || listing.kind === "apartment" ? 0 : listing.rent,
    occupancy: listing.kind === "house" || listing.kind === "apartment" ? 0 : listing.occupancy,
    maintenance: round(price * 0.004, 2),
    tax: round(price * 0.0012, 2),
    mortgaged: Boolean(loan),
    loanId: loan?.id,
    yearBought: state.time.year,
  });
  state.world.properties = state.world.properties.filter((p) => p.id !== listingId);
  unlock(state, "first_prop");
  timeline(state, `Bought ${listing.name}.`, "property");
  ledger(state, `Bought ${listing.name}${loan ? " (mortgaged)" : ""}`, -price);
  log.push(`Purchased ${listing.name} for ${formatINR(price)}${loan ? ` with a ${formatINR(loan.principal)} mortgage` : ""}.`);
}

function sellProperty(state: GameState, propertyId: string, log: string[]) {
  const prop = state.player.properties.find((p) => p.id === propertyId);
  if (!prop) return;
  const e = getBiz(state).estates[prop.id];
  if (e?.project && e.project.stage !== "done") return void log.push("A development is under way — cancel it or let it finish first.");
  const net = prop.value * 0.97;
  credit(state.player, net, `Sell ${prop.name}`, "property", date(state));
  taxGain(state, net - money(prop.purchasePrice || prop.value));
  state.player.properties = state.player.properties.filter((p) => p.id !== propertyId);
  delete getBiz(state).estates[prop.id];
  log.push(`Sold ${prop.name} for ${formatINR(net)} after 3% costs.`);
}

function renovate(state: GameState, propertyId: string, spendAmt: number, log: string[]) {
  const prop = state.player.properties.find((p) => p.id === propertyId);
  if (!prop) return;
  if (!spend(state.player, spendAmt, "Renovation", "property", date(state))) {
    log.push("Cannot afford renovation.");
    return;
  }
  prop.condition = clamp(prop.condition + spendAmt / (prop.value * 0.02), 0, 100);
  prop.value *= 1 + Math.min(0.18, spendAmt / prop.value);
  log.push(`Condition now ${prop.condition.toFixed(0)}.`);
}

function setRent(state: GameState, propertyId: string, occupancyBias: number, log: string[]) {
  const prop = state.player.properties.find((p) => p.id === propertyId);
  if (!prop) return;
  prop.rent = Math.max(0, prop.value * (0.003 + occupancyBias / 1000));
  log.push(`Rent set to ${formatINR(prop.rent)}/mo.`);
}

function develop(state: GameState, propertyId: string, log: string[]) {
  const prop = state.player.properties.find((p) => p.id === propertyId);
  if (!prop) return;
  if (prop.kind !== "land" && !prop.development) {
    log.push("Buy land to develop, or convert an existing site.");
  }
  const budget = prop.value * 1.4;
  prop.development = { stage: "building", budget, spent: 0, progress: 0, units: 12, delayRisk: 20 };
  log.push(`Ground broken. Budget ${formatINR(budget)}.`);
  timeline(state, `Began development at ${prop.name}.`, "property");
}

function foundCompany(state: GameState, payload: FoundPayload, log: string[]) {
  const p = state.player;
  if (payload.capital < 10000) {
    log.push("Need at least ₹10,000 capital.");
    return;
  }
  if (!spend(p, payload.capital, `Found ${payload.name}`, "biz", date(state))) {
    log.push("Not enough cash to incorporate.");
    return;
  }
  const shares = 1000000;
  const co: ListedCompany = {
    id: uid("co"),
    name: payload.name,
    ticker: payload.name.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase() + Math.floor(rng(state) * 90),
    industry: payload.industry,
    countryId: payload.countryId || p.countryId,
    cityId: payload.cityId || p.cityId,
    npc: false,
    founderId: p.id,
    public: false,
    foundedYear: state.time.year,
    revenue: 0,
    costs: payload.capital * 0.04,
    profit: -payload.capital * 0.04,
    cash: payload.capital,
    assets: payload.capital,
    debt: 0,
    employees: payload.industry === "ai" ? 3 : 1,
    customers: 0,
    churn: 0.08,
    quality: 35 + p.skills.entrepreneurship * 0.2,
    priceLevel: payload.price || 100,
    marketing: 8,
    rd: payload.ai || payload.industry === "ai" ? 18 : 6,
    marketShare: 0.1,
    valuation: payload.capital * 1.4,
    shares,
    price: (payload.capital * 1.4) / shares,
    prevPrice: 0,
    pe: industryMeta(payload.industry).pe,
    growth: 0,
    dividend: 0,
    sentiment: 48,
    stage: "startup",
    product: payload.product || payload.industry,
    model: payload.model || "b2c",
    shareholders: [{ id: p.id, name: p.name, type: "player", shares }],
    departments: { engineering: 40, sales: 20, ops: 20, finance: 10, hr: 10 },
    ceo: p.name,
    playerCeo: true,
    playerRole: "founder",
    listed: false,
    forSale: false,
    askingPrice: 0,
    distressed: false,
    history: [],
    ai: payload.ai || payload.industry === "ai" ? { compute: 20, modelQuality: 30 + p.skills.ai * 0.4, apiUsage: 0, infraCost: payload.capital * 0.03 } : undefined,
  };
  state.world.companies.push(co);
  p.ownedCompanyIds.push(co.id);
  p.reputation.business += 8;
  getAdv(state).stats.businesses += 1;
  ledger(state, `Founded ${co.name}`, -payload.capital);
  unlock(state, "first_biz");
  if (co.industry === "ai") unlock(state, "ai_founder");
  timeline(state, `Founded ${co.name} (${co.industry}).`, "business");
  log.push(`${co.name} is incorporated. You own 100%. Cash in company ${formatINR(co.cash)}.`);
  note(state, `${co.name} is live.`, "good");
}

function manageCompany(state: GameState, companyId: string, patch: { hire?: number; fire?: number; priceLevel?: number; marketing?: number; rd?: number; quality?: number }, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co) return;
  if (patch.hire) {
    co.employees += patch.hire;
    co.cash -= patch.hire * 40000;
    log.push(`Hired ${patch.hire}.`);
  }
  if (patch.fire) {
    co.employees = Math.max(0, co.employees - patch.fire);
    state.player.reputation.business -= 1;
    log.push(`Let go ${patch.fire}.`);
  }
  if (patch.priceLevel != null) co.priceLevel = clamp(patch.priceLevel, 20, 250);
  if (patch.marketing != null) co.marketing = clamp(patch.marketing, 0, 40);
  if (patch.rd != null) co.rd = clamp(patch.rd, 0, 40);
  if (patch.quality != null) co.quality = clamp(patch.quality, 1, 100);
  log.push("Company settings updated.");
}

function raiseFunding(state: GameState, companyId: string, source: string, amount: number, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co) return;
  const p = state.player;
  let equity = 8;
  let prob = 0.3;
  if (source === "friends") {
    equity = 5;
    prob = 0.55;
  }
  if (source === "angel") {
    equity = 12;
    prob = 0.28 + p.skills.negotiation / 400 + co.quality / 400;
  }
  if (source === "vc") {
    equity = 22;
    prob = 0.12 + co.growth / 200 + p.reputation.business / 400;
  }
  if (source === "bank") {
    const l = applyLoan(state, "startup", amount, 60, log);
    if (l) {
      co.cash += l.principal;
      co.debt += l.principal;
      ledger(state, `Bank facility drawn into ${co.name}`, l.principal);
    }
    return;
  }
  if (source === "crowd") {
    equity = 6;
    prob = 0.4;
  }
  log.push(`${source} odds ${Math.round(prob * 100)}% for ${equity}% of the company.`);
  if (!chance(rng.bind(null, state), prob)) {
    log.push("They passed.");
    note(state, "Fundraising failed this round.", "warn");
    return;
  }
  const give = Math.round((equity / 100) * co.shares);
  co.shares += 0;
  const playerSh = co.shareholders.find((s) => s.type === "player")!;
  playerSh.shares -= give;
  co.shareholders.push({ id: uid("inv"), name: source.toUpperCase() + " syndicate", type: source === "vc" ? "vc" : "angel", shares: give });
  co.cash += amount;
  co.valuation = Math.max(co.valuation, amount / (equity / 100));
  co.stage = "growth";
  unlock(state, "investor");
  timeline(state, `Raised ${formatINR(amount)} from ${source} for ${equity}%.`, "business");
  log.push(`Closed ${formatINR(amount)} for ${equity}%. You now own ${((playerSh.shares / co.shares) * 100).toFixed(1)}%.`);
}

function ipo(state: GameState, companyId: string, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co) return;
  if (co.revenue < 5e6 || co.stage === "idea") {
    log.push("Too early. Exchanges want revenue.");
    return;
  }
  co.public = true;
  co.listed = true;
  co.stage = "public";
  const float = Math.round(co.shares * 0.2);
  co.shares += float;
  co.shareholders.push({ id: "pub", name: "Public", type: "public", shares: float });
  co.price = co.valuation / co.shares;
  co.cash += float * co.price * 0.95;
  unlock(state, "ipo");
  timeline(state, `${co.name} listed as ${co.ticker}.`, "business");
  news(state, `${co.name} prices IPO as ${co.ticker}`, `The book was covered. Founders are suddenly very public.`, "markets", co.countryId, "Liquidity event; scrutiny rises.");
  log.push(`IPO complete. Ticker ${co.ticker}.`);
}

function buyCompany(state: GameState, companyId: string, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co) return;
  const price = co.askingPrice || co.valuation;
  if (!spend(state.player, price, `Acquire ${co.name}`, "biz", date(state))) {
    log.push("Cannot fund the acquisition.");
    return;
  }
  co.npc = false;
  co.shareholders = [{ id: state.player.id, name: state.player.name, type: "player", shares: co.shares }];
  co.playerRole = "owner";
  co.forSale = false;
  state.player.ownedCompanyIds.push(co.id);
  getAdv(state).stats.businesses += 1;
  ledger(state, `Acquired ${co.name}`, -price);
  log.push(`You acquired ${co.name}.`);
  timeline(state, `Acquired ${co.name}.`, "business");
}

function sellShares(state: GameState, companyId: string, pct: number, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co) return;
  const sh = co.shareholders.find((s) => s.type === "player");
  if (!sh) return;
  const give = Math.round(sh.shares * (pct / 100));
  sh.shares -= give;
  const proceeds = (give / co.shares) * co.valuation;
  credit(state.player, proceeds, `Sell ${co.name} shares`, "biz", date(state));
  // founder shares have almost no cost basis: most of a sale is a gain
  taxGain(state, proceeds * 0.8);
  log.push(`Sold ${pct}% for ${formatINR(proceeds)}.`);
}

function appointCeo(state: GameState, companyId: string, self: boolean, log: string[]) {
  const co = state.world.companies.find((c) => c.id === companyId);
  if (!co) return;
  co.playerCeo = self;
  co.ceo = self ? state.player.name : "Professional CEO";
  co.playerRole = self ? "ceo" : "owner";
  if (self) unlock(state, "ceo");
  log.push(self ? "You are CEO." : "You stepped back from the chair.");
}

function applyGrant(state: GameState, grantId: string, companyId: string | undefined, log: string[]) {
  const g = state.world.grants.find((x) => x.id === grantId);
  if (!g || !g.open) {
    log.push("Programme closed.");
    return;
  }
  const p = state.player;
  let ok = true;
  if (g.kind === "youth" && p.age > 30) ok = false;
  if ((g.kind === "startup" || g.kind === "ai" || g.kind === "innovation") && !p.ownedCompanyIds.length) ok = false;
  if (g.kind === "ai") {
    const co = state.world.companies.find((c) => c.id === (companyId || p.ownedCompanyIds[0]));
    if (!co || (co.industry !== "ai" && !co.ai)) ok = false;
  }
  const skillBoost = (p.skills.writing + p.skills.entrepreneurship) / 400;
  const prob = clamp((ok ? g.prob : g.prob * 0.15) + skillBoost - g.competition / 400, 0.02, 0.75);
  log.push(`Application filed. Modelled odds ${Math.round(prob * 100)}%. Not guaranteed.`);
  const roll = rng(state);
  if (roll > prob + 0.12 && roll < prob + 0.22) {
    log.push("Waitlisted.");
    note(state, `${g.name}: waitlisted.`, "warn");
    return;
  }
  if (roll > prob) {
    log.push("Rejected.");
    note(state, `${g.name} was not awarded.`, "warn");
    history(state, "grant", `Rejected: ${g.name}`);
    ledger(state, `Grant rejected: ${g.name}`, 0);
    return;
  }
  const co = companyId ? state.world.companies.find((c) => c.id === companyId) : null;
  if (co) co.cash += g.amount;
  else credit(p, g.amount, g.name, "grant", date(state));
  ledger(state, `Grant won: ${g.name}`, g.amount);
  g.open = false;
  unlock(state, "grant");
  timeline(state, `Won ${g.name} (${formatINR(g.amount)}).`, "business");
  news(state, `${p.name} awarded ${g.name}`, "A competitive public programme selected a new cohort. Reporting obligations apply.", "grants", g.countryId, "Non-dilutive capital, with milestones.");
  log.push(`Approved: ${formatINR(g.amount)}.`);
}

function pursueOpportunity(state: GameState, opportunityId: string, log: string[]) {
  const op = state.world.opportunities.find((o) => o.id === opportunityId);
  if (!op) {
    log.push("Expired.");
    return;
  }
  if (op.kind === "grant") applyGrant(state, String(op.payload.grantId), undefined, log);
  else if (op.kind === "job") applyJob(state, String(op.payload.jobId), log);
  else if (op.kind === "property" || op.kind === "distressed") buyProperty(state, String(op.payload.listingId), false, log);
  else if (op.kind === "business") buyCompany(state, String(op.payload.companyId), log);
  else if (op.kind === "investor" && state.player.ownedCompanyIds[0]) raiseFunding(state, state.player.ownedCompanyIds[0]!, "angel", 2500000, log);
  else if (op.kind === "incubator" && state.player.ownedCompanyIds[0]) {
    const co = state.world.companies.find((c) => c.id === state.player.ownedCompanyIds[0]);
    if (co && chance(rng.bind(null, state), 0.4)) {
      co.cash += 400000;
      const sh = co.shareholders.find((s) => s.type === "player")!;
      sh.shares *= 0.94;
      log.push("Incubator accepted you. ₹4 lakh in, 6% out.");
    } else log.push("Cohort was full.");
  } else if (op.kind === "contract" && state.player.ownedCompanyIds[0]) {
    const co = state.world.companies.find((c) => c.id === state.player.ownedCompanyIds[0])!;
    co.revenue += 600000;
    state.player.contracts.push({ id: uid("ct"), counterparty: "Government", kind: "gov", value: 18000000, monthsLeft: 24, penalty: 2000000, performance: 50 });
    log.push("Contract signed.");
  }
  state.world.opportunities = state.world.opportunities.filter((o) => o.id !== opportunityId);
}

function travel(state: GameState, countryId: string, cityId: string, intent: string, log: string[]) {
  const country = state.world.countries.find((c) => c.id === countryId);
  const city = state.world.cities.find((c) => c.id === cityId);
  if (!country || !city) return;
  const cost = 25000 + (intent === "move" ? 80000 : 0);
  if (!spend(state.player, cost, `Travel to ${city.name}`, "travel", date(state))) {
    log.push("Cannot afford travel.");
    return;
  }
  state.player.countryId = countryId;
  state.player.cityId = cityId;
  if (intent === "move") state.player.visa = state.player.citizenship.includes(countryId) ? "citizen" : "resident";
  else if (intent === "work") state.player.visa = "work";
  else if (intent === "study") state.player.visa = "student";
  else state.player.visa = "tourist";
  log.push(`Now in ${city.name}, ${country.name} (${state.player.visa}).`);
  timeline(state, `Travelled to ${city.name}, ${country.name}.`, "life");
}

function applyResidency(state: GameState, log: string[]) {
  const p = state.player;
  if (p.citizenship.includes(p.countryId)) {
    log.push("You are already a citizen here.");
    return;
  }
  const country = state.world.countries.find((c) => c.id === p.countryId)!;
  const prob = clamp(0.25 + p.career.experience / 40 + computeNetWorth(state) / 1e8 - country.policy.immigration / 400, 0.05, 0.8);
  if (chance(rng.bind(null, state), prob)) {
    p.visa = "resident";
    p.residency = p.countryId;
    log.push("Residency granted.");
  } else log.push("Residency refused this year.");
}

function applyCitizenship(state: GameState, log: string[]) {
  const p = state.player;
  if (p.citizenship.includes(p.countryId)) {
    log.push("Already a citizen.");
    return;
  }
  if (p.visa !== "resident" && p.visa !== "work") {
    log.push("Usually need residency first.");
    return;
  }
  const prob = 0.2 + p.reputation.personal / 300;
  if (chance(rng.bind(null, state), prob)) {
    p.citizenship.push(p.countryId);
    p.visa = "citizen";
    unlock(state, "citizen");
    timeline(state, `Gained citizenship of ${p.countryId}.`, "life");
    log.push("Citizenship granted.");
  } else log.push("Not this cycle.");
}

function joinParty(state: GameState, partyId: string, log: string[]) {
  const party = state.world.parties.find((p) => p.id === partyId);
  if (!party) return;
  state.player.politics.partyId = party.id;
  state.player.politics.partyName = party.name;
  state.player.politics.role = state.player.politics.role === "none" ? "member" : state.player.politics.role;
  state.player.politics.countryId = party.countryId;
  state.player.politics.platform = { ...party.platform };
  log.push(`Joined ${party.name}.`);
  timeline(state, `Joined ${party.name}.`, "politics");
}

function createParty(state: GameState, name: string, platform: PolicyVector, log: string[]) {
  const id = uid("pty");
  state.world.parties.push({
    id,
    countryId: state.player.countryId,
    name,
    color: "#f5d78e",
    leader: state.player.name,
    seats: 0,
    popularity: 4 + state.player.skills.politics * 0.05,
    funds: state.player.politics.campaignCash,
    members: 120,
    platform,
    playerCreated: true,
  });
  state.player.politics.partyId = id;
  state.player.politics.partyName = name;
  state.player.politics.role = "party_leader";
  state.player.politics.platform = platform;
  state.player.politics.countryId = state.player.countryId;
  unlock(state, "party");
  timeline(state, `Founded political party ${name}.`, "politics");
  log.push(`${name} is registered.`);
}

function campaign(state: GameState, spendAmt: number, log: string[]) {
  if (!spend(state.player, spendAmt, "Campaign", "politics", date(state))) {
    log.push("Need cash to campaign.");
    return;
  }
  state.player.politics.campaignCash += spendAmt * 0.2;
  state.player.politics.popularity = clamp(state.player.politics.popularity + spendAmt / 200000 + state.player.skills.speaking * 0.02, 0, 95);
  log.push(`Popularity ${state.player.politics.popularity.toFixed(1)}.`);
}

function runForOffice(state: GameState, office: string, log: string[]) {
  const p = state.player;
  if (p.age < 21) {
    log.push("Too young to stand.");
    return;
  }
  if (!p.politics.partyId) {
    log.push("Join or found a party first.");
    return;
  }
  const ladder = ["local_candidate", "local_office", "regional", "representative", "minister", "party_leader", "head"] as const;
  const idx = Math.max(0, ladder.indexOf(p.politics.role as (typeof ladder)[number]));
  p.politics.role = ladder[Math.min(idx + 1, ladder.length - 1)]!;
  p.politics.office = office;
  const country = state.world.countries.find((c) => c.id === p.countryId)!;
  const oppPop = 30 + rng(state) * 40;
  const you = p.politics.popularity + p.politics.campaignCash / 5e5 + p.skills.speaking * 0.15 + p.reputation.media * 0.1;
  const won = you + normal(rng.bind(null, state), 0, 8) > oppPop;
  p.politics.elections.push({
    year: state.time.year,
    office,
    result: won ? "won" : "lost",
    voteShare: won ? 51 + rng(state) * 10 : 35 + rng(state) * 14,
    turnout: 60,
  });
  if (won) {
    unlock(state, "elected");
    if (p.politics.role === "head") {
      country.headOfGov = p.name;
      country.rulingPartyId = p.politics.partyId!;
      unlock(state, "head");
    }
    timeline(state, `Elected ${office}.`, "politics");
    log.push(`Won ${office}.`);
  } else {
    log.push(`Lost ${office}. Competitors ran a real race.`);
    note(state, "Election lost — the other campaign was better funded or better liked.", "warn");
  }
}

function setPolicy(state: GameState, policy: Partial<PolicyVector>, log: string[]) {
  if (state.player.politics.role !== "head" && state.player.politics.role !== "minister") {
    log.push("You do not control the budget.");
    return;
  }
  state.player.politics.platform = { ...state.player.politics.platform, ...policy };
  const country = state.world.countries.find((c) => c.id === state.player.countryId)!;
  country.policy = { ...country.policy, ...policy };
  if (policy.tax != null) {
    country.corpTax = 10 + policy.tax * 0.3;
    country.incomeTax = 10 + policy.tax * 0.4;
  }
  log.push("Policy updated. The economy will respond over coming months.");
  news(state, `${country.name} shifts policy`, "Cabinet published a new mix of tax, spending and industrial priorities.", "politics", country.id, "Firms, markets and voters will reprice.");
}

function proposeBill(state: GameState, topic: string, magnitude: number, log: string[]) {
  if (state.player.politics.role === "none" || state.player.politics.role === "volunteer") {
    log.push("Need office to propose bills.");
    return;
  }
  const meta = BILL_TOPICS.find((b) => b.id === topic) ?? BILL_TOPICS[0]!;
  const yes = 40 + state.player.politics.popularity * 0.3 + (rng(state) - 0.5) * 20;
  const passed = yes > 50;
  state.player.politics.billsProposed += 1;
  if (passed) {
    const country = state.world.countries.find((c) => c.id === state.player.countryId)!;
    const key = meta.key;
    country.policy[key] = clamp(country.policy[key] + magnitude, 0, 100);
    log.push(`Bill passed: ${meta.label}.`);
    news(state, `Law passed: ${meta.label}`, `The chamber divided ${Math.round(yes)}–${Math.round(100 - yes)}.`, "politics", country.id, "Legal change will feed into the economy.");
  } else log.push(`Bill failed in the chamber (${Math.round(yes)}% yes).`);
}

function conVote(state: GameState, resolutionId: string, vote: "yes" | "no" | "abstain", log: string[]) {
  const res = state.world.con.resolutions.find((r) => r.id === resolutionId);
  if (!res) return;
  if (vote === "yes") res.yes += 1;
  if (vote === "no") res.no += 1;
  if (vote === "abstain") res.abstain += 1;
  if (res.yes + res.no + res.abstain > 12) {
    res.status = res.yes > res.no ? "passed" : "failed";
  }
  unlock(state, "con");
  log.push(`Voted ${vote} on ${res.title}.`);
}

function conPropose(state: GameState, title: string, log: string[]) {
  if (state.player.influence.international < 15 && state.player.politics.role !== "head") {
    log.push("Need more international standing.");
    return;
  }
  state.world.con.resolutions.unshift({ id: uid("res"), title, status: "proposed", yes: 0, no: 0, abstain: 0 });
  unlock(state, "con");
  log.push("Resolution submitted to the Concord.");
}

function socialPost(state: GameState, platform: string, topic: string, spendAmt: number, log: string[]) {
  if (spendAmt) spend(state.player, spendAmt, "Boosted post", "social", date(state));
  const acc = state.player.social.platforms.find((p) => p.platform === platform) ?? state.player.social.platforms[0]!;
  // SEO/editor/handlers boost virality automatically (hire does the work)
  const handlers = state.player.social.handlers ?? [];
  const seoBoost = handlers.filter(h=>h.specialty==="seo").length * 2.2;
  const editorBoost = handlers.filter(h=>h.specialty==="editor").length * 1.1;
  const handlerBoost = handlers.filter(h=>h.specialty==="handler").length * 0.9;
  const allrounderBoost = handlers.filter(h=>h.specialty==="allrounder").length * 3.5;
  const agencySeo = state.player.social.agency ? state.player.social.agency.staff.seo*0.6 : 0;
  const virality = rng(state) * (10 + state.player.skills.writing * 0.2 + state.player.skills.marketing*0.08 + spendAmt / 5000 + seoBoost + editorBoost + handlerBoost + allrounderBoost + agencySeo);
  acc.posts += 1;
  // immediate views
  const views = Math.round(virality*1200 + state.player.social.followers*0.02);
  (acc as any).views = ((acc as any).views||0) + views;
  state.player.social.views = (state.player.social.views||0) + views;
  acc.followers = Math.round(acc.followers + virality * (12 + editorBoost*2));
  acc.engagement = clamp(acc.engagement * 0.8 + virality + seoBoost*0.6, 0, 100);
  state.player.reputation.social += virality > 8 ? 2 : 0.3;
  state.player.social.brand = clamp(state.player.social.brand + virality*0.12, 0, 100);
  // instant ad payout per post: views/1000 * CPM 0.55 share
  const cpm = 140 + state.player.social.brand*2 + seoBoost*12;
  const instantAd = Math.round(views/1000 * cpm * 0.55);
  if (instantAd>0) {
    credit(state.player, instantAd, `Ad revenue · ${views.toLocaleString()} views · ${acc.platform}`, "media", date(state));
    (acc as any).revenue = ((acc as any).revenue||0) + instantAd;
    const mf = getAdv(state).monthFlow;
    if (mf) mf.flows.media = round(money(mf.flows.media)+instantAd,2);
  }
  // if you have an agency, every post also promotes your owned companies
  if (state.player.social.agency && state.player.ownedCompanyIds.length) {
    const co = state.world.companies.find(c=>c.id===state.player.ownedCompanyIds[0])!;
    if (co) {
      co.customers = Math.round(co.customers + virality*3);
      co.sentiment = clamp(co.sentiment + virality*0.08, 10, 90);
    }
  }
  log.push(`Post on ${acc.platform} (${topic}). +${Math.round(virality * 12)} followers, ${views.toLocaleString()} views, ${formatINR(instantAd)} ad revenue${state.player.social.agency?` → agency promoted ${state.player.ownedCompanyIds.length?state.world.companies.find(c=>c.id===state.player.ownedCompanyIds[0])?.name:"your brand"}`:""}.`);
  if (virality > 12) {
    news(state, `${state.player.name} goes briefly viral`, "A post punched above its weight. Brands noticed. So did critics.", "social", state.player.countryId, "Followers and scrutiny both rise.");
  }
}

function socialGrow(state: GameState, platform: string, log: string[]) {
  const acc = state.player.social.platforms.find(p=>p.platform===platform) ?? state.player.social.platforms[0]!;
  const handlers = state.player.social.handlers?.length ?? 0;
  // handlers do the work even while you sleep: passive growth tick
  const boost = handlers*6 + (state.player.social.agency? state.player.social.agency.reputation*0.4:0);
  acc.followers = Math.round(acc.followers * (1 + (acc.engagement/600) + boost/1000));
  (acc as any).views = Math.round(((acc as any).views||0) * 1.06 + acc.followers*0.05);
  state.player.social.views = (state.player.social.views||0) + Math.round(acc.followers*0.05);
  log.push(`${acc.platform} grew organically: ${acc.followers.toLocaleString()} followers, ${(acc as any).views.toLocaleString()} lifetime views. Your team works while you rest.`);
}

function hireSocial(state: GameState, role: "handler"|"editor"|"seo"|"allrounder", log: string[]) {
  state.player.social.handlers ??= [];
  const costs: Record<string,number> = { handler: 22000, editor: 32000, seo: 38000, allrounder: 55000 };
  const salary = costs[role]!;
  if (!spend(state.player, salary*2, `Hire ${role} (2 mo retainer)`, "media", date(state))) {
    log.push(`Need ${formatINR(salary*2)} to hire a ${role}.`);
    return;
  }
  const names = ["Aarav","Priya","Leo","Maya","Dev","Sofia","Kiran","Nina","Omar","Zara"];
  const name = `${names[Math.floor(rng(state)*names.length)]} ${role}`;
  state.player.social.handlers.push({ id: uid("sh"), name, skill: 55+Math.floor(rng(state)*40), salary, specialty: role });
  state.player.social.brand = clamp(state.player.social.brand + (role==="allrounder"?3:1), 0, 100);
  log.push(`Hired ${role} ${name} for ${formatINR(salary)}/mo. They start handling posting, SEO, editing and growth immediately — you don't have to post daily, they do.`);
  timeline(state, `Hired social ${role}: ${name}.`, "media");
  // also boost engagement instantly to show they work
  for (const a of state.player.social.platforms) a.engagement = clamp(a.engagement+2, 0, 100);
}

function fireSocial(state: GameState, handlerId: string, log: string[]) {
  const before = state.player.social.handlers?.length ?? 0;
  state.player.social.handlers = (state.player.social.handlers ?? []).filter(h=>h.id!==handlerId);
  log.push(before===state.player.social.handlers.length? "No such handler.":"Handler released.");
}

function foundAgency(state: GameState, name: string, log: string[]) {
  if (state.player.social.agency) { log.push("You already run an agency — expand it instead."); return; }
  if (!spend(state.player, 600000, `Found ${name} agency`, "media", date(state))) {
    log.push("Need ₹6 L to rent office, register and hire core team.");
    return;
  }
  state.player.social.agency = {
    id: uid("ag"),
    name,
    staff: { handlers: 2, editors: 1, seo: 1, allRounders: 0 },
    clients: 3,
    retainers: 3,
    reputation: 22,
    monthlyRevenue: 0,
    monthlyCosts: 0,
  };
  // auto-hire two handlers into social team as well
  if (!state.player.social.handlers) state.player.social.handlers = [];
  log.push(`${name} is open. 2 handlers + editor + SEO manager on payroll. It promotes your own companies/products every month and takes on 3 outside retainers. Hired staff do the posting, editing and SEO for you.`);
  timeline(state, `Founded media agency ${name}.`, "media");
  unlock(state, "media");
}

function agencyPromote(state: GameState, companyId: string, budget: number, log: string[]) {
  const ag = state.player.social.agency;
  if (!ag) { log.push("Found an agency first."); return; }
  const co = state.world.companies.find(c=>c.id===companyId);
  if (!co || !state.player.ownedCompanyIds.includes(companyId)) { log.push("Not your company."); return; }
  if (!spend(state.player, budget, `Agency promotion · ${co.name}`, "media", date(state))) { log.push("Need budget."); return; }
  const lift = budget/500000 + ag.reputation/120;
  co.marketing = clamp(co.marketing + 4, 0, 40);
  co.customers = Math.round(co.customers * (1+lift*0.06));
  co.revenue += budget*0.6; // promoted sales funnel back as revenue next month inside tickSocial, but give instant taste
  co.sentiment = clamp(co.sentiment + 3 + lift*2, 10, 90);
  ag.reputation = clamp(ag.reputation + budget/400000, 0, 100);
  log.push(`Agency blasted ${co.name} to ${formatINR(budget)} worth of reach across all platforms: +${(lift*6).toFixed(1)}% customers, sentiment +${(3+lift*2).toFixed(0)}. The agency also bills outside clients while you profit.`);
  timeline(state, `Agency promoted ${co.name} (${formatINR(budget)}).`, "media");
}

function buyAICompany(state: GameState, companyId: string, log: string[]) {
  const co = state.world.companies.find(c=>c.id===companyId);
  if (!co) { log.push("No such company."); return; }
  if (co.industry!=="ai" && co.industry!=="software" && !co.ai) { log.push("Not an AI company."); return; }
  const price = co.askingPrice || co.valuation*0.6;
  if (!spend(state.player, price, `Buy ${co.name} (AI)`, "biz", date(state))) { log.push(`Need ${formatINR(price)} to acquire.`); return; }
  co.npc = false;
  co.shareholders = [{ id: state.player.id, name: state.player.name, type: "player", shares: co.shares }];
  co.playerRole = "owner";
  co.forSale = false;
  if (!state.player.ownedCompanyIds.includes(co.id)) state.player.ownedCompanyIds.push(co.id);
  log.push(`Acquired AI company ${co.name} for ${formatINR(price)}. It now runs inside your portfolio — shares, model and compute are yours.`);
  timeline(state, `Acquired AI company ${co.name}.`, "business");
}

function buyGovHelp(state: GameState, kind: "relief"|"land"|"contract", log: string[]) {
  const country = state.world.countries.find(c=>c.id===state.player.countryId)!;
  if (kind==="relief") {
    const cost = 400000;
    if (!spend(state.player, cost, "Government liaison · relief", "politics", date(state))) { log.push(`Need ${formatINR(cost)} to lobby.`); return; }
    const relief = Math.round(600000 + rng(state)*800000);
    credit(state.player, relief, `Government relief · ${country.name}`, "gov", date(state));
    state.player.reputation.political = clamp(state.player.reputation.political+4, 0, 100);
    log.push(`Government sanctioned ${formatINR(relief)} relief after your liaison work (net +${formatINR(relief-cost)}). Helping the government pays.`);
    timeline(state, `Secured government relief ${formatINR(relief)}.`, "politics");
  } else if (kind==="land") {
    const landPrice = Math.round(800000 + rng(state)*1200000);
    const listing: any = { id: uid("pr"), name: `Govt. allotted industrial plot`, kind: "land", countryId: country.id, cityId: state.player.cityId, district: "New Industrial Estate", size: 2400 + Math.floor(rng(state)*4000), condition: 95, price: landPrice, rent: 0, occupancy: 0, distressed: false };
    // For demo, give discounted government land at 60% price
    const pay = Math.round(landPrice*0.6);
    if (!spend(state.player, pay, "Govt. land allotment", "property", date(state))) { log.push(`Need ${formatINR(pay)} (60% of ${formatINR(landPrice)} via govt. quota).`); return; }
    state.player.properties.push({ id: listing.id, name: listing.name, kind: "land", countryId: listing.countryId, cityId: listing.cityId, district: listing.district, size: listing.size, condition: listing.condition, purchasePrice: pay, value: landPrice, rent: 0, occupancy: 0, maintenance: pay*0.002, tax: pay*0.001, mortgaged: false, yearBought: state.time.year });
    log.push(`Government allotted ${listing.size}m² industrial land for ${formatINR(pay)} (market ${formatINR(landPrice)}). Build whatever you want: apartments, offices, mall, villas or hotel.`);
    timeline(state, `Got government land (${listing.size}m²) at 40% discount.`, "property");
  } else {
    const value = 12000000;
    const contract: any = { id: uid("ct"), counterparty: `${country.name} Govt.`, kind: "gov", value, monthsLeft: 24, penalty: 2000000, performance: 60 };
    state.player.contracts.push(contract);
    log.push(`Signed a ${formatINR(value)} government digitisation contract (24 mo). Monthly progress will credit revenue.`);
  }
}

function buyPartyMember(state: GameState, partyId: string, log: string[]) {
  const party = state.world.parties.find(p=>p.id===partyId);
  if (!party) { log.push("No such party."); return; }
  const cost = 250000;
  if (!spend(state.player, cost, `Support · ${party.name}`, "politics", date(state))) { log.push(`Need ${formatINR(cost)} to enrol patrons.`); return; }
  (state.player.politics as any).patrons = ((state.player.politics as any).patrons||0)+5;
  party.members += 800;
  state.player.politics.popularity = clamp(state.player.politics.popularity+3, 0, 95);
  state.player.influence.political = clamp(state.player.influence.political+4, 0, 100);
  log.push(`Patronised 5 influential members of ${party.name} (+800 party workers). Popularity +, political influence +, policy leverage next cycle.`);
}

function hireSecurity(state: GameState, level: number, log: string[]) {
  if (state.player.politics.role!=="head") { log.push("Only a sitting Head of Government can command full state security."); return; }
  const cost = level*180000;
  if (!spend(state.player, cost, "State security detail", "politics", date(state))) { log.push(`Need ${formatINR(cost)} for security upgrade.`); return; }
  (state.player.politics as any).security = clamp(((state.player.politics as any).security||0)+level*18, 0, 100);
  log.push(`Security detail level ${(state.player.politics as any).security}/100. Scandals are suppressed, heat decays, and at 80+ you attain FULL POWER to push any policy.`);
}

function assumePower(state: GameState, log: string[]) {
  if (state.player.politics.role!=="head") { log.push("You are not Head of Government."); return; }
  const sec = (state.player.politics as any).security||0;
  const pop = state.player.politics.popularity;
  if (sec<80 || pop<62) { log.push(`Need security 80+ and popularity 62+ (you: sec ${sec}, pop ${pop.toFixed(0)}). Keep campaigning and fund security.`); return; }
  (state.player.politics as any).fullPower = true;
  log.push(`FULL POWER assumed. You can now set any tax/welfare/business/education policy instantly, appoint ministers, and your government has full state apparatus.`);
  timeline(state, "Assumed full power as Head of Government.", "politics");
  note(state, "You now rule with full security and full power.", "good");
}

function foundMedia(state: GameState, kind: string, name: string, log: string[]) {
  if (!spend(state.player, 250000, `Found ${name}`, "media", date(state))) {
    log.push("Need ₹2.5 lakh to launch.");
    return;
  }
  state.player.media.outlets.push(name + " · " + kind);
  state.player.reputation.media += 8;
  if (state.player.media.outlets.length >= 2) unlock(state, "media");
  timeline(state, `Launched ${kind} ${name}.`, "media");
  log.push(`${name} is publishing.`);
}

function crimeAct(state: GameState, kind: string, intensity: number, log: string[]) {
  const p = state.player;
  const payout = (8000 + intensity * 12000) * (0.5 + rng(state));
  const heat = 6 + intensity * 8;
  const caught = chance(rng.bind(null, state), clamp(0.05 + p.crime.heat / 200 + intensity * 0.04, 0.04, 0.6));
  log.push(`Risk modelled at ${Math.round(clamp(0.05 + p.crime.heat / 200 + intensity * 0.04, 0.04, 0.6) * 100)}%. Fictional mechanic only.`);
  if (caught) {
    p.crime.heat += heat * 1.5;
    p.crime.evidence += 12;
    p.crime.arrests += 1;
    p.reputation.criminal += 6;
    p.reputation.personal -= 8;
    note(state, "You were implicated. Legal process begins.", "bad");
    history(state, "crime", `Caught during ${kind}`);
    log.push("The attempt failed and drew police attention.");
    return;
  }
  credit(p, payout, `Underground · ${kind}`, "crime", date(state));
  p.crime.path = true;
  p.crime.heat += heat;
  p.crime.moneyFromCrime += payout;
  p.reputation.criminal += 2;
  log.push(`Gained ${formatINR(payout)}. Heat ${p.crime.heat.toFixed(0)}.`);
}

function foundOrg(state: GameState, kind: GameState["player"]["orgs"][number]["kind"], name: string, doctrine: string, log: string[]) {
  state.player.orgs.push({
    id: uid("org"),
    kind,
    name,
    doctrine,
    members: 8,
    loyalty: 70,
    reputation: 20,
    funds: 0,
    scrutiny: kind === "criminal" ? 20 : 5,
    influence: 4,
    facilities: 0,
  });
  if (kind === "criminal") state.player.crime.organizationId = state.player.orgs[state.player.orgs.length - 1]!.id;
  log.push(`${name} founded.`);
}

function orgAct(state: GameState, orgId: string, act: string, log: string[]) {
  const org = state.player.orgs.find((o) => o.id === orgId);
  if (!org) return;
  if (act === "recruit") {
    org.members += 3 + Math.floor(rng(state) * 6);
    org.loyalty -= 1;
  }
  if (act === "media") org.reputation += 3;
  if (act === "facility") {
    if (spend(state.player, 120000, "Facility", "org", date(state))) org.facilities += 1;
  }
  if (act === "donate") {
    const d = 20000;
    if (spend(state.player, d, "Donation", "org", date(state))) org.funds += d;
  }
  log.push(`${org.name} updated.`);
}

function gamble(state: GameState, game: string, stake: number, extra: Record<string, unknown>, log: string[]) {
  if (stake <= 0) return;
  if (!spend(state.player, stake, `Wager ${game}`, "gamble", date(state))) {
    log.push("Stake exceeds bankroll.");
    return;
  }
  const p = state.player;
  p.gambling.lifetimeWagered += stake;
  p.gambling.bankrollSessions += 1;
  p.gambling.lastGame = game;
  let win = 0;
  let detail = "";
  if (game === "roulette") {
    const n = Math.floor(rng(state) * 37);
    const pickN = Number(extra.number ?? -1);
    const color = extra.color as string | undefined;
    const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    if (pickN >= 0 && pickN === n) win = stake * 36;
    else if (color === "red" && red.includes(n)) win = stake * 2;
    else if (color === "black" && n !== 0 && !red.includes(n)) win = stake * 2;
    detail = `Ball ${n}. P(single)=1/37 ≈ 2.70%, fair 36:1, house edge 2.70%.`;
  } else if (game === "dice") {
    const d = 1 + Math.floor(rng(state) * 6);
    if (d >= Number(extra.over ?? 4)) win = stake * 2.1;
    detail = `Rolled ${d}. P(≥5) on d6 = 33.3%.`;
  } else if (game === "cards") {
    const playerC = 16 + Math.floor(rng(state) * 6);
    const dealer = 16 + Math.floor(rng(state) * 6);
    if (playerC > dealer) win = stake * 1.9;
    detail = `You ${playerC} vs ${dealer}. Approx P(win) ~47% after house rules.`;
  } else if (game === "slots") {
    const sp = rng(state);
    if (sp > 0.97) win = stake * 12;
    else if (sp > 0.85) win = stake * 2;
    detail = "Three-reel fiction. RTP ~92%.";
  } else if (game === "lottery") {
    const hit = chance(rng.bind(null, state), 1 / 5000);
    if (hit) win = stake * 2500;
    detail = "P(jackpot) = 1/5000. EV << stake.";
  } else if (game === "mines") {
    // Legacy one-shot entry point: auto-plays a real round tile by tile so the
    // maths is identical to playing it by hand. The UI uses minesStart/Reveal.
    credit(p, stake, "Mines stake returned (switching to a live round)", "gamble", date(state));
    p.gambling.lifetimeWagered -= stake;
    const mines = clamp(Math.round(Number(extra.mines ?? 5)), 1, MINES_TILES - 1);
    const picks = clamp(Math.round(Number(extra.picks ?? 3)), 1, MINES_TILES - mines);
    minesStart(state, stake, mines, log);
    const sess = getAdv(state).mines;
    if (!sess || sess.status !== "live") {
      detail = "Round could not be started.";
    } else {
      const order = [...Array(MINES_TILES).keys()].sort(() => rng(state) - 0.5);
      for (const tile of order) {
        if (sess.revealed.length >= picks || sess.status !== "live") break;
        minesReveal(state, tile, log);
      }
      if (sess.status === "live") minesCashout(state, log);
      detail = `Auto-played ${picks} picks on a ${mines}-mine board. The live board in the Underground panel is the real game.`;
    }
    return; // the round settles its own money
  }
  if (win > 0) {
    credit(p, win, `Payout ${game}`, "gamble", date(state));
    p.gambling.lifetimeWon += win;
    getAdv(state).stats.biggestWin = Math.max(getAdv(state).stats.biggestWin, win - stake);
    log.push(`Won ${formatINR(win)}. ${detail}`);
  } else {
    p.gambling.lifetimeLost += stake;
    getAdv(state).stats.biggestLoss = Math.max(getAdv(state).stats.biggestLoss, stake);
    log.push(`Lost ${formatINR(stake)}. ${detail}`);
  }
  if (win - stake > 100000) ledger(state, `Big gambling win (${game})`, win - stake);
}

/* ------------------------------------------------------------------ mines */

/** Start a real round. The stake leaves your liquid money once, up front, and
 *  the board is generated from a seed — you cannot see where the mines are. */
function minesStart(state: GameState, stakeRaw: number, minesRaw: number, log: string[]) {
  const adv = getAdv(state);
  if (adv.mines && adv.mines.status === "live") {
    log.push("A round is already in progress — cash out or finish it first.");
    return;
  }
  const stake = Math.round(money(stakeRaw));
  const mines = clamp(Math.round(money(minesRaw)), 1, MINES_TILES - 1);
  if (stake <= 0) {
    log.push("Enter a stake above zero.");
    return;
  }
  const liquid = liquidCash(state.player);
  if (stake > liquid) {
    log.push(`Stake ${formatINR(stake)} exceeds your liquid cash ${formatINR(liquid)}. Nothing was taken.`);
    return;
  }
  if (!spend(state.player, stake, `Mines stake (${mines} mines)`, "gamble", date(state))) {
    log.push("Stake exceeds bankroll.");
    return;
  }
  void MINES_PRESETS;
  const seed = ((state.rng >>> 0) ^ (Math.floor(rng(state) * 0xffffffff) >>> 0)) >>> 0;
  adv.mines = newMinesSession(uid("mns"), stake, mines, seed, date(state), state.ticks);
  const p = state.player;
  p.gambling.lifetimeWagered += stake;
  p.gambling.bankrollSessions += 1;
  p.gambling.lastGame = "mines";
  const v = minesView(adv.mines);
  const mf = adv.monthFlow;
  if (mf) mf.flows.gambling = round(money(mf.flows.gambling) - stake, 2);
  log.push(
    `Round started: ${formatINR(stake)} on a 5×5 board with ${mines} mines. The first tile is ${(v.safeProb * 100).toFixed(1)}% safe; cashing out now returns your stake.`,
  );
}

/** Open one tile. Safe → the multiplier climbs. Mine → the round is over. */
function minesReveal(state: GameState, tileRaw: number, log: string[]) {
  const adv = getAdv(state);
  const sess = adv.mines;
  if (!sess || sess.status !== "live") {
    log.push("No live round — start one first.");
    return;
  }
  const tile = Math.floor(money(tileRaw));
  if (tile < 0 || tile >= sess.tiles) {
    log.push("That tile is off the board.");
    return;
  }
  if (sess.revealed.includes(tile)) {
    log.push("You already opened that tile.");
    return;
  }
  const before = minesView(sess);
  if (minesLayout(sess.seed, sess.tiles, sess.mines).includes(tile)) {
    sess.status = "bust";
    sess.bustTile = tile;
    sess.payout = 0;
    const p = state.player;
    p.gambling.lifetimeLost += sess.stake;
    adv.stats.biggestLoss = Math.max(adv.stats.biggestLoss, sess.stake);
    note(state, `Mines: tile ${tile + 1} was a mine. ${formatINR(sess.stake)} gone after ${before.safePicked} safe tiles.`, "bad");
    ledger(state, `Mines bust after ${before.safePicked} gems`, -sess.stake);
    log.push(
      `Boom — tile ${tile + 1} was a mine. Stake lost (${formatINR(sess.stake)}). You had ${before.safePicked} gems worth ${formatINR(before.cashoutNow)}.`,
    );
    return;
  }
  sess.revealed.push(tile);
  const after = minesView(sess);
  log.push(
    `Tile ${tile + 1}: gem. ${after.safePicked} safe · multiplier ${after.multiplier.toFixed(2)}× (${formatINR(after.cashoutNow)}). ` +
      (after.maxed
        ? "Every safe tile is open — cashing out."
        : `Next tile is ${(after.safeProb * 100).toFixed(1)}% safe for ${after.nextMultiplier.toFixed(2)}×.`),
  );
  if (after.maxed) minesCashout(state, log);
}

/** Bank the round at the current multiplier. */
function minesCashout(state: GameState, log: string[]) {
  const adv = getAdv(state);
  const sess = adv.mines;
  if (!sess || sess.status !== "live") {
    log.push("Nothing to cash out.");
    return;
  }
  const v = minesView(sess);
  const payout = round(v.cashoutNow, 2);
  sess.status = "cashed";
  sess.payout = payout;
  const p = state.player;
  credit(p, payout, `Mines cash-out (${v.safePicked} gems @ ${v.multiplier.toFixed(2)}×)`, "gamble", date(state));
  p.gambling.lifetimeWon += payout;
  const net = round(payout - sess.stake, 2);
  adv.stats.biggestWin = Math.max(adv.stats.biggestWin, Math.max(0, net));
  const mf = adv.monthFlow;
  if (mf) mf.flows.gambling = round(money(mf.flows.gambling) + payout, 2);
  if (net > 0) {
    note(state, `Mines cash-out: ${formatINR(payout)} (${v.multiplier.toFixed(2)}× on ${v.safePicked} gems).`, "good");
    ledger(state, `Mines cash-out · ${v.safePicked} gems · ${v.multiplier.toFixed(2)}×`, net);
  } else {
    ledger(state, `Mines cash-out · ${v.safePicked} gems`, net);
  }
  log.push(`Cashed out ${formatINR(payout)} at ${v.multiplier.toFixed(2)}× — ${net >= 0 ? "+" : "−"}${formatINR(Math.abs(net))} on the round.`);
}

export const CASINO_BUILD = 5e7;

function foundCasino(state: GameState, name: string, cityId: string, log: string[]) {
  // A real resort casino: building, gaming floor, surveillance, licence, cage.
  if (!spend(state.player, CASINO_BUILD, "Casino build", "biz", date(state))) {
    log.push(`Building a licensed casino costs ${formatINR(CASINO_BUILD)} (floor, tables, 60 slots, cage, surveillance, licence).`);
    return;
  }
  const casId = uid("cas");
  state.world.casinos.push({
    id: casId,
    name,
    cityId,
    countryId: state.player.countryId,
    games: ["roulette", "dice", "cards", "slots", "mines"],
    staff: 40,
    security: 50,
    marketing: 20,
    volume: 0,
    revenue: 0,
    costs: 200000,
    regulation: 40,
  });
  getCasinoOps(state, state.world.casinos[state.world.casinos.length - 1]!);
  unlock(state, "casino_tycoon");
  log.push(`${name} opens its doors. Run the floor from Casino → Own & run.`);
}

function foundBank(state: GameState, name: string, log: string[]) {
  const capital = 2e7;
  if (!spend(state.player, capital, "Bank capital", "biz", date(state))) {
    log.push("Regulators want ₹2 crore capital.");
    return;
  }
  state.world.banks.push({
    id: uid("bank"),
    name,
    countryId: state.player.countryId,
    // the charter comes with a starter book bought from a retiring co-op bank
    deposits: capital * 5,
    loans: capital * 3.5,
    capital,
    npl: 1,
    savingsRate: 3,
    lendingRate: 9,
    playerOwned: true,
    branches: 1,
    profit: 0,
  });
  getBankOps(state, state.world.banks[state.world.banks.length - 1]!);
  unlock(state, "banker");
  timeline(state, `Founded ${name} bank.`, "business");
  log.push("Bank chartered.");
}

function foundInsurer(state: GameState, name: string, log: string[]) {
  if (!spend(state.player, 1e7, "Insurer capital", "biz", date(state))) {
    log.push("Need ₹1 crore reserves.");
    return;
  }
  state.world.insurers.push({
    id: uid("ins"),
    name,
    countryId: state.player.countryId,
    premiums: 0,
    claims: 0,
    reserves: 1e7,
    playerOwned: true,
  });
  log.push("Insurer licensed.");
}

function buyInsurance(state: GameState, kind: "life" | "property" | "health", log: string[]) {
  state.player.insurance[kind] = true;
  state.player.insurance.premium += kind === "life" ? 1800 : 1200;
  log.push(`${kind} cover on.`);
}

function haveChild(state: GameState, log: string[]) {
  if (state.player.age < 18) {
    log.push("Not yet.");
    return;
  }
  const child = addChild(state);
  log.push(`${child.name} joins the family.`);
}

function continueAsHeir(state: GameState, log: string[]) {
  const heir = state.player.family.members.find((m) => m.id === state.player.family.willHeirId) ?? state.player.family.members.find((m) => m.relation === "child");
  if (!heir) {
    log.push("No heir.");
    return;
  }
  const old = state.player.name;
  inheritLife(state, heir.id, old);
  state.player.name = heir.name;
  state.player.age = Math.max(18, heir.age);
  state.player.alive = true;
  state.player.health = 80;
  state.player.causeOfDeath = null;
  state.player.family.generation += 1;
  state.successorUsed = true;
  ledger(state, `Inheritance: ${heir.name} continues the dynasty`, 0);
  unlock(state, "dynasty");
  timeline(state, `${heir.name} inherits the estate of ${old}.`, "family");
  log.push(`You now play ${heir.name}, generation ${state.player.family.generation}.`);
}

function interview(state: GameState, tone: string, log: string[]) {
  if (tone === "open") {
    state.player.reputation.media += 4;
    state.player.reputation.personal += 2;
  } else if (tone === "deny") {
    state.player.reputation.media -= 2;
    state.player.crime.heat += 1;
  } else {
    state.player.reputation.media += 1;
  }
  log.push("Statement issued.");
}

function network(state: GameState, log: string[]) {
  state.player.network.push({
    id: uid("npc"),
    name: `${pick(rng.bind(null, state), ["Asha", "Julian", "Sera", "Wei"])} ${pick(rng.bind(null, state), ["Tan", "Voss", "Rao"])}`,
    role: pick(rng.bind(null, state), ["investor", "journalist", "official", "founder"]),
    closeness: 20,
  });
  state.player.energy -= 4;
  log.push("You expanded the Rolodex.");
}

function createFund(state: GameState, name: string, kind: GameState["world"]["funds"][number]["kind"], log: string[]) {
  if (!spend(state.player, 5e6, "Seed fund", "inv", date(state))) {
    log.push("Need ₹50 lakh to seed a fund.");
    return;
  }
  state.world.funds.push({ id: uid("fund"), name, kind, nav: 100, prev: 100, holdings: state.world.companies.slice(0, 12).map((c) => c.ticker), expense: 0.8 });
  log.push(`${name} launched.`);
}

function resolveDecision(state: GameState, decisionId: string, optionId: string, log: string[]) {
  const d = state.pending.find((x) => x.id === decisionId);
  if (!d) return;
  state.pending = state.pending.filter((x) => x.id !== decisionId);
  if (d.kind === "life") {
    resolveLifeEvent(state, d, optionId, log);
    return;
  }
  if (d.kind === "tax") return void resolveTax(state, d, optionId, log);
  if (d.kind === "ailayoff") return void resolveAiLayoff(state, optionId, log);
  if (d.kind === "corp") return void resolveCorp(state, d, optionId, log);
  if (d.kind === "bankcap") return void resolveBankCap(state, d, optionId, log);
  if (d.kind === "estate") return void resolveEstate(state, d, optionId, log);
  if (d.kind === "investor") {
    const co = state.world.companies.find((c) => c.id === d.context.companyId);
    if (!co) return;
    let equity = Number(d.context.equity);
    let amount = Number(d.context.amount);
    if (optionId === "reject") {
      log.push("You passed on the round.");
      return;
    }
    if (optionId === "other") {
      log.push("You keep shopping the round.");
      return;
    }
    if (optionId === "negotiate") {
      const ok = chance(rng.bind(null, state), 0.35 + state.player.skills.negotiation / 200);
      if (ok) equity = Math.max(6, equity - 4);
      else amount *= 0.85;
      log.push(ok ? "Better terms." : "They tightened.");
    }
    const give = Math.round((equity / 100) * co.shares);
    const sh = co.shareholders.find((s) => s.type === "player");
    if (sh) sh.shares -= give;
    co.shareholders.push({ id: uid("inv"), name: "Angel syndicate", type: "angel", shares: give });
    co.cash += amount;
    co.valuation = Math.max(co.valuation, amount / (equity / 100));
    unlock(state, "investor");
    log.push(`Took ${formatINR(amount)} for ${equity}%.`);
  } else if (d.kind === "promotion" && optionId === "take" && state.player.career.job) {
    state.player.career.job.salary *= 1.18;
    state.player.career.job.rank += 1;
    state.player.career.job.hours += 4;
    log.push("Promoted.");
  } else if (d.kind === "layoff") {
    if (optionId === "package" && state.player.career.job) {
      credit(state.player, state.player.career.job.salary / 4, "Severance", "salary", date(state));
      quitJob(state, log);
    } else if (chance(rng.bind(null, state), 0.4)) log.push("You kept the seat — for now.");
    else {
      quitJob(state, log);
      log.push("You were cut anyway.");
    }
  } else if (d.kind === "press") {
    interview(state, optionId === "open" ? "open" : optionId === "deny" ? "deny" : "spin", log);
  } else if (d.kind === "scandal") {
    if (optionId === "ignore") {
      state.player.politics.popularity -= 6;
      state.world.countries.find((c) => c.id === state.player.countryId)!.approval -= 3;
    } else if (optionId === "investigate") {
      state.player.politics.popularity -= 1;
      state.player.reputation.political += 2;
    } else {
      state.player.politics.popularity += 1;
    }
    log.push("Handled.");
  } else if (d.kind === "arrest") {
    if (optionId === "lawyer") {
      const counselBonus = hasAdvisor(state, "lawyer") ? 0.25 : 0;
      spend(state.player, hasAdvisor(state, "lawyer") ? 60000 : 150000, "Counsel", "legal", date(state));
      if (chance(rng.bind(null, state), 0.55 + counselBonus)) {
        log.push(counselBonus ? "Charges dropped. Your retained counsel made it look procedural." : "Charges dropped.");
        state.player.crime.heat *= 0.5;
      } else {
        state.player.crime.convictions += 1;
        const c = state.player.crime;
        // Serious heat and evidence mean prison, not just a fine.
        if (chance(rng.bind(null, state), clamp(0.15 + c.evidence / 150 + c.convictions * 0.1, 0.1, 0.85))) {
          const months = Math.round(clamp(6 + c.evidence * 0.6 + c.convictions * 12 + rng(state) * 18, 6, 180));
          sentence(state, months, state.player.crime.moneyFromCrime > 5e6 ? "organised crime" : "underground dealings");
          c.heat = 0;
          c.evidence *= 0.3;
          log.push(`Convicted. Sentenced to ${months >= 12 ? `${(months / 12).toFixed(1)} years` : `${months} months`} in prison.`);
        } else {
          log.push("Convicted, but spared prison: fined. Record stained.");
          spend(state.player, 80000, "Fine", "legal", date(state));
          getLife(state).record.push(`Underground offences — fined (${state.time.year})`);
        }
      }
    } else {
      state.player.crime.heat *= 0.7;
      state.player.reputation.personal -= 4;
      if (chance(rng.bind(null, state), clamp(state.player.crime.evidence / 200, 0, 0.4))) {
        const months = Math.round(clamp(4 + state.player.crime.evidence * 0.3, 4, 60));
        sentence(state, months, "underground dealings (plea deal)");
        log.push(`You cooperated and took a plea deal: ${months} months.`);
      } else log.push("You cooperated. Heat down, reputation down.");
    }
  } else if (d.kind === "death") {
    if (optionId === "heir") continueAsHeir(state, log);
    else log.push("This dynasty ends here.");
  }
}

export { minesMultiplier, minesLayout, minesView, type MinesSession } from "./mines";
void INDUSTRIES;
void liquidCash;
void round;
