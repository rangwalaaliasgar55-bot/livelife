import { getAdv, hasAdvisor, ledger, tickAdvanced } from "./advanced";
import { FIRST_NAMES, INDUSTRIES, LAST_NAMES, industryMeta } from "./catalog";
import {
  computeNetWorth,
  credit,
  liquidCash,
  livingCostFor,
  loanSplit,
  money,
  monthlyLoanPayment,
  recordNetWorth,
  spend,
  spendUpTo,
  totalDebt,
} from "./finance";
import { news, note, timeline, history, unlock } from "./feed";
import { inPrison, tickLife } from "./life";
import { maybeLifeEvent, tickConsequences } from "./lifeevents";
import { tickLifestyle } from "./lifestyle";
import { tickStakes } from "./corporate";
import { hqPre, hqPost } from "./company";
import { tickFinFirms } from "./finfirms";
import { tickCasinoOps } from "./casinoops";
import { tickEstates } from "./estates";
import { accrueTax, completeStudy, studyDone, tickCivic } from "./civic";
import { getBiz } from "./biz";
import type {
  Country,
  Decision,
  GameState,
  ListedCompany,
  Opportunity,
} from "./types";
import { chance, clamp, formatDate, formatINR, monthName, mulberry32, normal, pick, round, uid } from "./util";

function rng(state: GameState): number {
  const r = mulberry32(state.rng || state.seed || 1)();
  state.rng = (Math.imul(state.rng || 1, 1664525) + 1013904223) >>> 0;
  return r;
}

export function tickMonths(state: GameState, months = 1): GameState {
  const n = clamp(months, 1, 12);
  for (let i = 0; i < n; i++) {
    if (state.pending.length) break;
    if (!state.player.alive) break;
    tickOnce(state);
  }
  return state;
}

function tickOnce(state: GameState) {
  // last month's cash-flow report goes into this year's tax book before the
  // next one is started
  accrueTax(state);
  state.ticks += 1;
  state.time.month += 1;
  if (state.time.month > 12) {
    state.time.month = 1;
    state.time.year += 1;
    yearBoundary(state);
  }
  const p = state.player;
  const birthday = state.time.month === p.birthMonth;
  if (birthday) {
    p.age += 1;
    timeline(state, `Turned ${p.age}.`, "life");
    if (p.age >= 75) {
      p.health -= 1.2 + rng(state) * 2;
    }
  }

  advanceTech(state);
  for (const c of state.world.countries) tickCountry(state, c);
  for (const city of state.world.cities) tickCity(state, city);
  for (const co of state.world.companies) tickCompany(state, co);
  tickMarkets(state);
  tickBanks(state);
  tickPlayerWork(state);
  tickPlayerMoney(state);
  tickProperties(state);
  tickPolitics(state);
  tickCrime(state);
  tickSocial(state);
  tickBiz(state);
  tickHealth(state);
  tickLife(state, birthday);
  tickLifestyle(state);
  tickStakes(state);
  tickConsequences(state);
  tickNpcs(state);
  if (!inPrison(state)) maybeEvents(state);
  maybeLifeEvent(state, birthday);
  refreshOpportunities(state);
  checkAchievements(state);
  recordNetWorth(state);
  p.influence.financial = clamp(computeNetWorth(state) / 5e6, 0, 100);
  p.influence.business = clamp(p.ownedCompanyIds.length * 12 + p.reputation.business * 0.4, 0, 100);
  p.influence.political = clamp(p.politics.popularity * 0.7 + (p.politics.role === "head" ? 40 : 0), 0, 100);
  p.influence.social = clamp(Math.log10(Math.max(10, p.social.followers)) * 12, 0, 100);
  p.influence.media = clamp(p.media.outlets.length * 18 + p.reputation.media * 0.5, 0, 100);
  p.influence.international = clamp(
    (p.citizenship.length - 1) * 15 + state.world.companies.filter((c) => c.shareholders.some((s) => s.type === "player")).length * 4,
    0,
    100,
  );
  tickAdvanced(state);
}

function yearBoundary(state: GameState) {
  state.player.finances.taxPaidYtd = 0;
  for (const g of state.world.grants) {
    if (g.deadlineYear < state.time.year) g.open = chance(rng.bind(null, state), 0.7);
    if (g.open && g.deadlineYear < state.time.year) {
      g.deadlineYear = state.time.year;
      g.deadlineMonth = 3 + Math.floor(rng(state) * 8);
    }
  }
  news(
    state,
    `${state.time.year}: the world accounts are opened`,
    "Annual ledgers reset. Governments publish budgets, firms restate earnings, and households feel last year's inflation in this year's rent.",
    "economy",
    state.player.countryId,
    "A new fiscal year changes tax, grants and elections.",
  );
}

function advanceTech(state: GameState) {
  const t = state.world.tech;
  const r = rng(state);
  t.ai = clamp(t.ai + 0.08 + r * 0.12 + state.world.companies.filter((c) => c.industry === "ai" && c.stage !== "bankrupt").length * 0.01, 0, 100);
  t.robotics = clamp(t.robotics + 0.04 + t.ai * 0.002, 0, 100);
  t.automation = clamp(t.automation + 0.05 + t.robotics * 0.002, 0, 100);
  t.cloud = clamp(t.cloud + 0.03, 0, 100);
  t.renewables = clamp(t.renewables + 0.04, 0, 100);
  t.manufacturing = clamp(t.manufacturing + 0.02 + t.automation * 0.001, 0, 100);
  for (const c of state.world.countries) {
    c.aiAdoption = clamp(c.aiAdoption + t.ai * 0.002 + (c.policy.technology - 50) * 0.01, 0, 100);
    c.techLevel = clamp(c.techLevel + 0.02 + c.aiAdoption * 0.002, 0, 100);
  }
}

function tickCountry(state: GameState, c: Country) {
  const r = rng(state);
  c.cycle += 0.07 + r * 0.03;
  const wave = Math.sin(c.cycle) * 1.4;
  const policyGrowth =
    (c.policy.business * 0.04 + c.policy.infrastructure * 0.035 + c.policy.technology * 0.03 - c.policy.tax * 0.025 - Math.max(0, c.policy.spending - 70) * 0.02) /
    12;
  const aiBoost = (state.world.tech.ai / 900) * (c.aiAdoption / 50);
  const trade = clamp(c.tradeBalance / Math.max(1, c.gdp), -0.08, 0.08) * 4;
  let growth = c.gdpGrowth * 0.92 + wave * 0.25 + policyGrowth + aiBoost + trade + normal(rng.bind(null, state), 0, 0.15);
  if (c.interestRate > 8) growth -= (c.interestRate - 8) * 0.08;
  c.gdpGrowth = clamp(growth, -8, 12);
  c.gdp *= 1 + c.gdpGrowth / 100 / 12;

  const inflTarget = 2.2 + (c.policy.spending - 50) * 0.02;
  c.inflation = clamp(c.inflation * 0.85 + inflTarget * 0.12 + (c.gdpGrowth - 2) * 0.08 + (c.interestRate < inflTarget ? 0.12 : -0.05) + normal(rng.bind(null, state), 0, 0.08), -1, 18);
  const taylor = inflTarget + 1.2 + 1.4 * (c.inflation - inflTarget) + 0.4 * (c.gdpGrowth - 2.5);
  c.interestRate = clamp(c.interestRate * 0.7 + taylor * 0.3, 0.25, 18);

  const auto = state.world.tech.automation / 140;
  c.unemployment = clamp(c.unemployment + (2.5 - c.gdpGrowth) * 0.08 + auto - (c.policy.welfare > 70 ? 0.02 : 0), 2.2, 22);

  const avgFx = 40;
  const rateDiff = c.interestRate - 5;
  c.fx = clamp(c.fx * (1 + (rateDiff * 0.0015) + (c.tradeBalance > 0 ? 0.001 : -0.001) + normal(rng.bind(null, state), 0, 0.006)), 0.2, 400);
  if (c.id === "indara") c.fx = 1;
  void avgFx;

  const monthFrac = 1 / 12;
  c.revenue =
    c.gdp * monthFrac * (c.incomeTax / 100) * 0.22 +
    c.gdp * monthFrac * (c.corpTax / 100) * 0.11 +
    c.gdp * monthFrac * (c.vat / 100) * 0.18 +
    c.gdp * monthFrac * (c.propertyTax / 100) * 0.4;
  const spendNeed = c.gdp * monthFrac * (0.22 + c.policy.spending / 280 + c.policy.welfare / 400 + c.policy.healthcare / 500);
  c.spending = spendNeed;
  const deficit = c.spending - c.revenue;
  c.debt = Math.max(0, c.debt + deficit);
  c.tradeBalance += (c.policy.trade - 50) * c.gdp * 0.000002 - c.tariff * c.gdp * 0.0000004;

  const econScore = 50 + c.gdpGrowth * 4 - c.unemployment * 1.4 - Math.max(0, c.inflation - 4) * 2.2;
  c.approval = clamp(c.approval * 0.9 + econScore * 0.1 + (c.healthcareIndex - 50) * 0.02, 8, 92);

  c.educationIndex = clamp(c.educationIndex + (c.policy.education - 50) * 0.01, 10, 99);
  c.healthcareIndex = clamp(c.healthcareIndex + (c.policy.healthcare - 50) * 0.01, 10, 99);
  c.infrastructure = clamp(c.infrastructure + (c.policy.infrastructure - 50) * 0.012, 10, 99);
  c.housingIndex = clamp(c.housingIndex + (c.policy.housing - 50) * 0.01 - (c.interestRate - 5) * 0.04, 10, 99);
  c.businessFreedom = clamp(c.businessFreedom + (c.policy.business - 50) * 0.01 - (c.corpTax - 22) * 0.02, 15, 98);
  c.crimeIndex = clamp(c.crimeIndex + (50 - c.policy.crime) * 0.02 - c.gdpGrowth * 0.05, 5, 90);
  c.population *= 1 + 0.0007;

  if (state.time.month === 1 || Math.abs(c.interestRate - taylor) > 0.8) {
    if (chance(rng.bind(null, state), 0.22)) {
      news(
        state,
        `${c.name} central bank sets policy rate at ${c.interestRate.toFixed(2)}%`,
        `Inflation prints ${c.inflation.toFixed(1)}% with growth at ${c.gdpGrowth.toFixed(1)}%. Mortgage desks and builders are already repricing.`,
        "rates",
        c.id,
        "Higher rates lift mortgage costs, cool property, and pressure equities.",
      );
    }
  }

  if (c.electionYear === state.time.year && state.time.month === 5) {
    runElection(state, c);
  }
}

function tickCity(state: GameState, city: GameState["world"]["cities"][number]) {
  const c = state.world.countries.find((x) => x.id === city.countryId)!;
  const mortgage = c.interestRate + 1.6;
  const emp = 100 - c.unemployment;
  city.demand = clamp(40 + emp * 0.35 + city.infrastructure * 0.15 + city.schools * 0.1 + city.tech * 0.08 - (mortgage - 6) * 4.5 + c.gdpGrowth * 1.2, 10, 160);
  const supplyGap = city.demand - city.housingSupply;
  const px = (supplyGap * 0.18 + c.gdpGrowth * 0.35 - (mortgage - 6) * 0.9) / 12;
  city.propertyIndex = clamp(city.propertyIndex * (1 + px / 100), 20, 600);
  city.rentIndex = clamp(city.rentIndex * (1 + (px * 0.7 + c.inflation * 0.3) / 100 / 1), 20, 500);
  city.housingSupply = clamp(city.housingSupply + (city.demand > city.housingSupply ? 0.15 : -0.05) - (mortgage > 9 ? 0.2 : 0), 20, 140);
  city.businessActivity = clamp(city.businessActivity + c.gdpGrowth * 0.08 - c.unemployment * 0.04, 15, 100);
  city.avgWage *= 1 + (c.inflation * 0.4 + c.gdpGrowth * 0.3) / 100 / 12;
  city.jobs = Math.round(city.population * (0.42 - c.unemployment / 250));
  if (city.demand > 90 && chance(rng.bind(null, state), 0.04)) {
    news(state, `${city.name} housing heats up`, `Demand index ${city.demand.toFixed(0)} against supply ${city.housingSupply.toFixed(0)}. Builders are scrambling, prices are not.`, "property", c.id, "Property values and rents in this city rise.");
  }
}

function tickCompany(state: GameState, co: ListedCompany) {
  if (co.stage === "bankrupt") return;
  const country = state.world.countries.find((c) => c.id === co.countryId)!;
  const city = state.world.cities.find((c) => c.id === co.cityId);
  const meta = industryMeta(co.industry);
  const econ = 1 + (country.gdpGrowth / 100) * meta.cyclical;
  const rateHit = 1 - Math.max(0, country.interestRate - 5) * 0.012 * meta.cyclical;
  const ai = state.world.tech.ai / 100;
  const disrupt = 1 - Math.max(0, meta.aiExpose) * ai * 0.15 + Math.max(0, -meta.aiExpose) * ai * 0.2;
  const qualityF = 0.7 + co.quality / 200;
  const priceF = 1.15 - co.priceLevel / 250;
  const mkt = 0.9 + co.marketing / 80;
  const shareDrift = (qualityF * mkt * priceF - 1) * 0.15;
  co.marketShare = clamp(co.marketShare * (1 + shareDrift / 12), 0.05, 55);

  const wage = (city?.avgWage ?? 800000) / 12;
  // Companies you control are run through Company HQ: real annual payroll by
  // department, AI agent and compute bills, strategy, expansion and capacity.
  const hq = !co.npc && state.player.ownedCompanyIds.includes(co.id) ? hqPre(state, co) : null;
  let payroll = hq ? hq.payroll : co.employees * wage * meta.wage;
  const cogs = hq ? hq.cogs : co.revenue * (0.42 - co.quality / 400);
  let mktSpend = co.revenue * (co.marketing / 100);
  let rdSpend = co.revenue * (co.rd / 100);
  const infra = hq ? hq.extra : co.ai ? co.ai.infraCost : co.revenue * 0.03;
  const interest = co.debt * (country.interestRate / 100 / 12);
  if (!co.npc) {
    if (co.playerCeo) {
      payroll *= 0.97;
    } else if (co.manager) {
      payroll *= 1 - 0.03 * (co.manager.skill / 100);
      mktSpend *= 0.98;
      co.quality = clamp(co.quality + 0.04 * (co.manager.skill / 100), 1, 99);
    } else {
      payroll *= 1.05;
      co.quality = clamp(co.quality - 0.12, 1, 99);
    }
    if (hasAdvisor(state, "marketing")) mktSpend *= 0.96;
    if (hasAdvisor(state, "tech") && co.ai) rdSpend *= 0.92;
  }

  let targetRev = co.revenue * econ * rateHit * disrupt * (0.985 + co.marketShare / 800) * (hq ? hq.revMult : 1);
  // your sales team keeps opening new accounts on top of the organic trend
  if (hq && co.stage !== "startup" && co.stage !== "idea") targetRev += hq.newBiz;
  if (co.supply) {
    if (co.supply.shortage > 30) targetRev *= 0.92;
    co.supply.shortage = clamp(co.supply.shortage + (rng(state) - 0.48) * 6, 0, 80);
    co.supply.utilization = clamp(co.supply.utilization + (country.gdpGrowth - 2) * 0.4, 30, 98);
  }
  co.revenue = Math.max(0, co.revenue * 0.7 + targetRev * 0.3);
  if (co.stage === "startup" || co.stage === "idea") {
    co.customers = Math.max(0, Math.round(co.customers * (1 - co.churn) + ((5 + co.marketing * 0.8) * qualityF + (hq ? hq.leads : 0)) * (hq ? hq.revMult : 1)));
    co.revenue = co.customers * Math.max(200, co.priceLevel * 40);
    co.churn = clamp(0.08 - co.quality / 800 + co.priceLevel / 2000, 0.01, 0.25);
    if (hq && co.revenue >= 1e7) {
      co.stage = "growth";
      timeline(state, `${co.name} passed ₹1 crore in annual revenue and is now a growth company.`, "business");
      note(state, `${co.name} graduated from startup to growth stage.`, "good");
    }
  }
  const demand = co.revenue;
  if (hq) {
    // you cannot sell what your people (and agents) cannot deliver
    if (co.revenue > hq.capacity) {
      co.revenue = hq.capacity;
      co.quality = clamp(co.quality - 0.15, 1, 99);
      if (co.stage === "startup" || co.stage === "idea") co.churn = clamp(co.churn + 0.02, 0.01, 0.3);
    }
    mktSpend = co.revenue * (co.marketing / 100);
    rdSpend = co.revenue * (co.rd / 100);
  }
  const tax = Math.max(0, (co.revenue - cogs - payroll - mktSpend - rdSpend - infra - interest) * (country.corpTax / 100));
  co.costs = cogs + payroll + mktSpend + rdSpend + infra + interest;
  co.profit = co.revenue - co.costs - tax;
  co.cash += co.profit / 12;
  co.growth = clamp(((targetRev - co.revenue) / Math.max(1, co.revenue)) * 12 * 100, -40, 80);
  if (hq)
    hqPost(state, co, hq, demand, {
      marketing: mktSpend,
      rd: rdSpend,
      interest,
      tax,
    });

  if (co.ai) {
    co.ai.modelQuality = clamp(co.ai.modelQuality + co.rd * 0.04 + state.world.tech.ai * 0.01, 1, 100);
    co.ai.infraCost = co.revenue * (0.05 + co.ai.compute / 400);
    co.ai.apiUsage = clamp(co.ai.apiUsage * (1 + co.growth / 400), 0, 1e7);
  }

  if (co.cash < 0 && co.debt > co.assets * 0.9) {
    co.stage = "distressed";
    co.distressed = true;
    co.forSale = true;
    co.askingPrice = Math.max(50000, co.valuation * 0.35);
  }
  if (co.cash < -co.revenue * 0.2 && co.stage === "distressed") {
    co.stage = "bankrupt";
    co.price = Math.max(0.5, co.price * 0.1);
    news(state, `${co.name} files for bankruptcy`, `${co.ticker} ran out of cash after a squeeze in ${country.name}. Distressed inventory will hit the market.`, "business", country.id, "Equity holders are wiped; assets may be sold cheap.");
  }

  const peBase = meta.pe * (1 - (country.interestRate - 4) * 0.03) * (1 + country.gdpGrowth / 80);
  co.pe = clamp(peBase * (0.85 + co.sentiment / 400), 4, 70);
  const eps = co.profit / Math.max(1, co.shares);
  let fair = Math.max(2, co.pe * Math.max(0.01, eps) * 12);
  if (co.stage === "startup" || co.stage === "idea") fair = (co.revenue * 8 + co.cash) / Math.max(1, co.shares);
  co.prevPrice = co.price;
  const shock = normal(rng.bind(null, state), 0, 0.035) + (co.sentiment - 50) / 800;
  co.price = Math.max(0.8, co.price * 0.85 + fair * 0.15);
  co.price = Math.max(0.8, co.price * (1 + shock));
  co.valuation = co.price * co.shares;
  co.sentiment = clamp(co.sentiment + (co.profit > 0 ? 0.4 : -0.6) + (country.gdpGrowth - 2) * 0.2, 10, 90);
  co.history.push({ t: formatDate(state.time.year, state.time.month), price: round(co.price, 2), revenue: co.revenue, profit: co.profit });
  if (co.history.length > 60) co.history.splice(0, co.history.length - 60);

  if (co.npc && chance(rng.bind(null, state), 0.04)) {
    const act = rng(state);
    if (act < 0.3) co.priceLevel *= 0.97;
    else if (act < 0.55) co.marketing += 1;
    else if (act < 0.7) co.rd += 0.5;
    else if (act < 0.85 && co.cash > co.revenue * 0.2) {
      const target = pick(rng.bind(null, state), state.world.companies.filter((x) => x.id !== co.id && x.industry === co.industry && x.valuation < co.valuation));
      if (target && chance(rng.bind(null, state), 0.15)) {
        news(state, `${co.name} rumoured to hunt ${target.name}`, "A larger competitor is circling. Pricing and talent wars usually follow.", "business", co.countryId, "Competition intensifies in this industry.");
        target.sentiment -= 4;
      }
    }
  }
}

function tickMarkets(state: GameState) {
  const listed = state.world.companies.filter((c) => c.listed && c.stage !== "bankrupt");
  const idx = listed.reduce((s, c) => s + c.price, 0) / Math.max(1, listed.length);
  const scaled = idx * 40;
  state.world.indexHistory.push({ t: formatDate(state.time.year, state.time.month), v: round(scaled, 1) });
  if (state.world.indexHistory.length > 240) state.world.indexHistory.splice(0, 1);

  for (const b of state.world.bonds) {
    const c = state.world.countries.find((x) => x.id === b.countryId);
    const y = c ? c.interestRate + (b.kind === "corp" ? 1.8 : b.kind === "muni" ? 0.6 : 0) : b.yield;
    b.yield = round(b.yield * 0.7 + y * 0.3, 2);
    b.price = round(b.face * (b.coupon / Math.max(0.2, b.yield)), 2);
  }
  for (const f of state.world.funds) {
    f.prev = f.nav;
    const holds = f.holdings
      .map((t) => state.world.companies.find((c) => c.ticker === t))
      .filter(Boolean) as ListedCompany[];
    if (!holds.length) {
      f.nav *= 1 + normal(rng.bind(null, state), 0.004, 0.02);
      continue;
    }
    const chg = holds.reduce((s, c) => s + (c.price - c.prevPrice) / Math.max(1, c.prevPrice), 0) / holds.length;
    f.nav = Math.max(2, f.nav * (1 + chg - f.expense / 100 / 12));
  }
  for (const c of state.world.countries) {
    state.world.fxHistory.push({ t: formatDate(state.time.year, state.time.month), code: c.currency.code, v: c.fx });
  }
  if (state.world.fxHistory.length > 800) state.world.fxHistory.splice(0, state.world.fxHistory.length - 800);

  for (const listing of state.world.properties) {
    const city = state.world.cities.find((x) => x.id === listing.cityId);
    if (!city) continue;
    listing.price *= 1 + (city.propertyIndex / (city.propertyIndex + 2) - 0.5) * 0.01 + (city.demand - 50) / 8000;
    listing.rent = listing.price * 0.0055 * (city.rentIndex / 100);
    if (listing.distressed) listing.price *= 0.995;
  }
}

function tickBanks(state: GameState) {
  for (const b of state.world.banks) {
    if (b.playerOwned) continue; // run by you — see finfirms.ts
    const c = state.world.countries.find((x) => x.id === b.countryId)!;
    b.savingsRate = c.interestRate * 0.38;
    b.lendingRate = c.interestRate + 3.1 + b.npl * 0.15;
    const ni = b.loans * (b.lendingRate / 100 / 12) - b.deposits * (b.savingsRate / 100 / 12);
    b.profit = ni - b.deposits * 0.0004;
    b.capital += b.profit;
    b.npl = clamp(b.npl + (c.unemployment - 6) * 0.02 - c.gdpGrowth * 0.03, 0.4, 18);
    if (c.gdpGrowth < 0) b.deposits *= 0.997;
    else b.deposits *= 1.001;
    b.loans = clamp(b.loans + (b.lendingRate < 9 ? b.deposits * 0.002 : -b.deposits * 0.001), b.deposits * 0.4, b.deposits * 0.95);
  }
  for (const ins of state.world.insurers) {
    const claims = ins.premiums * (0.62 + rng(state) * 0.2);
    ins.claims = claims;
    ins.reserves += ins.premiums - claims;
    ins.premiums *= 1.001;
  }
}

function tickPlayerWork(state: GameState) {
  const p = state.player;
  if (p.career.employed && p.career.job) {
    p.career.yearsInRole += 1 / 12;
    p.career.experience += 1 / 12;
    p.career.performance = clamp(p.career.performance + (p.traits.discipline - 50) * 0.02 + (rng(state) - 0.45) * 4, 10, 99);
    const job = p.career.job;
    for (const [sk, need] of Object.entries(job.skills)) {
      p.skills[sk] = clamp((p.skills[sk] ?? 0) + 0.15 + (need ?? 0) * 0.002, 0, 100);
    }
    if (p.career.yearsInRole > 2 && p.career.performance > 72 && chance(rng.bind(null, state), 0.08)) {
      state.pending.push({
        id: uid("dec"),
        kind: "promotion",
        title: "Promotion on the table",
        body: `${job.employer} wants to move you up. Title would rise, hours too. Salary +${Math.round(job.salary * 0.18).toLocaleString("en-IN")}/yr.`,
        year: state.time.year,
        month: state.time.month,
        options: [
          { id: "take", label: "Take it", hint: "Pay up, stress up" },
          { id: "stay", label: "Stay put" },
        ],
        context: { bump: 0.18 },
      });
    }
    if (job.demand < 30 && chance(rng.bind(null, state), 0.04)) {
      state.pending.push({
        id: uid("dec"),
        kind: "layoff",
        title: "Restructuring",
        body: `${job.employer} is cutting roles in a soft ${job.industry} market. You can take a modest package or fight to stay.`,
        year: state.time.year,
        month: state.time.month,
        options: [
          { id: "package", label: "Take the package", hint: "3 months' pay" },
          { id: "fight", label: "Try to stay", hint: "Uncertain" },
        ],
        context: {},
      });
    }
  }
  if (p.career.freelance.active) {
    p.skills[p.career.freelance.industry === "ai" ? "ai" : "programming"] = clamp((p.skills.programming ?? 0) + 0.2, 0, 100);
  }
  if (p.currentStudy) {
    p.currentStudy.gpa = clamp(p.currentStudy.gpa + (p.traits.discipline - 50) * 0.01 + (rng(state) - 0.5) * 0.05, 1, 4);
    if (studyDone(state, p.currentStudy)) {
      p.currentStudy.completed = true;
      p.currentStudy.inProgress = false;
      p.currentStudy.endYear = state.time.year;
      completeStudy(state, p.currentStudy);
      timeline(state, `Completed ${p.currentStudy.name}.`, "education");
      note(state, `You finished ${p.currentStudy.name}.`, "good");
      unlock(state, "graduate");
      p.currentStudy = null;
    }
  }
}

function tickPlayerMoney(state: GameState) {
  const p = state.player;
  const country = state.world.countries.find((c) => c.id === p.countryId)!;
  const date = formatDate(state.time.year, state.time.month);
  let income = 0;
  let expenses = 0;
  const flow: Record<string, number> = {};
  const addFlow = (k: string, v: number) => {
    if (v) flow[k] = (flow[k] ?? 0) + v;
  };

  if (p.career.employed && p.career.job) {
    const gross = p.career.job.salary / 12;
    const bonus = state.time.month === 12 ? (p.career.job.salary * p.career.job.bonusPct) / 100 : 0;
    const tax = (gross + bonus) * (country.incomeTax / 100) * 0.55;
    const net = gross + bonus - tax;
    income += net;
    p.finances.taxPaidYtd += tax;
    credit(p, net, p.career.job.title + " salary", "salary", date);
    addFlow("salary", gross + bonus);
    addFlow("taxes", -tax);
  }
  if (p.career.freelance.active) {
    const g = p.career.freelance.rate * p.career.freelance.hours * 4.3;
    const tax = g * (country.incomeTax / 100) * 0.4;
    income += g - tax;
    credit(p, g - tax, "Freelance", "freelance", date);
    addFlow("freelance", g);
    addFlow("taxes", -tax);
  }

  for (const prop of p.properties) {
    const city = state.world.cities.find((c) => c.id === prop.cityId);
    if (city) prop.value *= 1 + (city.propertyIndex - 100) / 10000;
    const rentIn = prop.rent * (prop.occupancy / 100);
    if (rentIn > 0) {
      income += rentIn;
      credit(p, rentIn, `Rent · ${prop.name}`, "rent", date);
      unlock(state, "rental");
      addFlow("rent", rentIn);
    }
    const maint = prop.maintenance + prop.tax;
    expenses += maint;
    spend(p, maint, `Upkeep · ${prop.name}`, "property", date);
    addFlow("upkeep", -maint);
    if (prop.development && prop.development.stage === "building") {
      prop.development.progress = clamp(prop.development.progress + 8 + rng(state) * 6, 0, 100);
      const burn = prop.development.budget * 0.08;
      prop.development.spent += burn;
      spend(p, burn, `Construction · ${prop.name}`, "build", date);
      expenses += burn;
      addFlow("construction", -burn);
      if (prop.development.progress >= 100) {
        prop.development.stage = "complete";
        prop.value *= 1.35;
        prop.rent = prop.value * 0.006;
        timeline(state, `Completed development at ${prop.name}.`, "property");
      }
    }
    prop.condition = clamp(prop.condition - 0.15, 10, 100);
  }

  for (const h of p.holdings) {
    const co = state.world.companies.find((c) => c.ticker === h.ticker);
    if (co && co.dividend > 0) {
      const d = (co.dividend / 12) * h.shares;
      income += d;
      credit(p, d, `${co.ticker} dividend`, "div", date);
      addFlow("dividends", d);
    }
  }
  for (const b of p.bonds) {
    const cpn = ((b.coupon / 100) * b.face * b.qty) / 12;
    income += cpn;
    credit(p, cpn, `${b.name} coupon`, "bond", date);
    addFlow("coupons", cpn);
  }

  for (const a of p.finances.accounts) {
    const bank = state.world.banks.find((b) => b.id === a.bankId);
    a.interestRate = bank ? bank.savingsRate : a.interestRate;
    const interest = a.balance * (a.interestRate / 100 / 12);
    a.balance += interest;
    income += interest;
    addFlow("interest", interest);
    if (a.fee > 0) {
      a.balance -= a.fee;
      expenses += a.fee;
      addFlow("fees", -a.fee);
    }
  }

  // Living costs run in arrears when you are short: you pay what you have and
  // the rest becomes a debt to the household, not a confiscation of the balance.
  const carried = money(p.finances.arrears);
  const live = livingCostFor(state) + carried;
  p.finances.livingCost = livingCostFor(state);
  expenses += live;
  addFlow("living", -live);
  const life = spendUpTo(p, live, "Living costs", "live", date);
  if (life.short > 0) {
    p.finances.arrears = round(life.short, 2);
    const severity = clamp(life.short / Math.max(1, live), 0, 1);
    p.stress = clamp(p.stress + 3 + severity * 8, 0, 100);
    p.happiness = clamp(p.happiness - 1.5 - severity * 4, 1, 100);
    p.health = clamp(p.health - severity * 1.2, 1, 100);
    p.finances.creditScore = clamp(p.finances.creditScore - 2 - severity * 6, 300, 900);
    addFlow("arrears", -life.short);
    shortfall(state, `Living costs short by ${formatINR(life.short)} — carried to next month.`, severity);
  } else if (carried > 0) {
    p.finances.arrears = 0;
    note(state, `Backlog cleared (${formatINR(carried)} of unpaid living costs settled).`, "good");
  }

  if (p.insurance.premium > 0) {
    expenses += p.insurance.premium;
    spend(p, p.insurance.premium, "Insurance premium", "ins", date);
    addFlow("insurance", -p.insurance.premium);
  }
  if (p.currentStudy && p.currentStudy.tuition > 0) {
    const m = p.currentStudy.tuition / 12;
    expenses += m;
    spend(p, m, "Tuition", "edu", date);
    addFlow("tuition", -m);
  }

  for (const loan of p.finances.loans) {
    if (loan.status === "paid") continue;
    // Interest accrues on the outstanding balance first; whatever is left of
    // the instalment reduces principal. Late interest capitalises.
    const interest = Math.max(0, (money(loan.remaining) * money(loan.rate)) / 100 / 12);
    const due = round(Math.min(money(loan.monthly), money(loan.remaining) + interest), 2);
    const paid = spendUpTo(p, due, `${loan.kind} loan instalment`, "loan", date);
    expenses += paid.paid;
    if (paid.paid > 0) addFlow("loans", -paid.paid);
    const split = loanSplit(loan.remaining, loan.rate, paid.paid);
    addFlow("loanInterest", -split.interest);
    loan.remaining = round(Math.max(0, money(loan.remaining) - split.principal), 2);

    if (paid.short <= 0) {
      loan.monthsLeft -= 1;
      loan.missed = 0;
      loan.status = "current";
      p.finances.paymentHistory = clamp(p.finances.paymentHistory + 0.4, 0, 100);
      p.finances.creditScore = clamp(p.finances.creditScore + 0.3, 300, 900);
      if (loan.remaining <= 1) {
        loan.status = "paid";
        loan.remaining = 0;
        note(state, `Loan paid off (${loan.kind}).`, "good");
        timeline(state, `Cleared the ${loan.kind} loan from ${loan.lender}.`, "finance");
      }
      continue;
    }

    // Shortfall: unpaid interest is added to the balance and a late fee hits.
    const lateFee = round(Math.max(250, due * 0.02), 2);
    loan.remaining = round(loan.remaining + split.interest - Math.max(0, paid.paid - interest) + lateFee, 2);
    loan.monthly = monthlyLoanPayment(loan.remaining, loan.rate, Math.max(1, loan.monthsLeft));
    loan.missed += 1;
    loan.status = loan.missed >= 3 ? "default" : "late";
    p.finances.creditScore = clamp(p.finances.creditScore - (loan.status === "default" ? 18 : 9), 300, 850);
    p.finances.paymentHistory = clamp(p.finances.paymentHistory - 8, 0, 100);
    expenses += lateFee;
    addFlow("fees", -lateFee);
    shortfall(
      state,
      `${loan.kind} loan short by ${formatINR(paid.short)} (late fee ${formatINR(lateFee)}, interest capitalised).`,
      clamp(paid.short / Math.max(1, due), 0, 1),
    );
    if (loan.status === "default" && loan.missed === 3) {
      p.finances.defaults += 1;
      note(state, `A ${loan.kind} loan has defaulted. Credit and collateral are at risk.`, "bad");
      history(state, "finance", `Defaulted on ${loan.kind} loan`);
    }
  }

  for (const cid of p.ownedCompanyIds) {
    const co = state.world.companies.find((c) => c.id === cid);
    if (!co) continue;
    // Companies you run from HQ pay out through their dividend policy instead.
    if (getBiz(state).hq[cid]) {
      if (co.profit > 0) unlock(state, "profit_month");
      continue;
    }
    if (co.profit > 0 && co.stage !== "startup" && co.stage !== "idea") {
      const sh = co.shareholders.find((s) => s.type === "player");
      if (sh) {
        const slice = (sh.shares / co.shares) * (co.profit / 12) * 0.3;
        if (slice > 0 && co.cash > slice) {
          co.cash -= slice;
          income += slice;
          credit(p, slice, `Draw from ${co.name}`, "biz", date);
          addFlow("draws", slice);
        }
      }
    }
    if (co.profit > 0) unlock(state, "profit_month");
  }

  p.finances.monthlyIncome = round(income, 2);
  p.finances.monthlyExpenses = round(expenses, 2);
  const adv = getAdv(state);
  // Totals are finalised in closeMonthFlow() once media, casinos and advisors have posted.
  adv.monthFlow = { t: date, income: round(income, 2), expenses: round(expenses, 2), flows: flow };
  adv.stats.taxes += Math.abs(flow.taxes ?? 0);

  const liquid = liquidCash(p);
  if (liquid >= 10000) unlock(state, "cash_10k");
  if (liquid >= 100000) unlock(state, "cash_1l");
}

/** A month where an obligation could not be met. Recorded once, honestly. */
function shortfall(state: GameState, text: string, severity: number) {
  const adv = getAdv(state);
  adv.shortfalls = round(money(adv.shortfalls) + severity, 2);
  note(state, text, severity > 0.5 ? "bad" : "warn");
  ledger(state, text, 0);
}

function tickProperties(state: GameState) {
  const estates = getBiz(state).estates;
  for (const prop of state.player.properties) {
    // Managed estates run real tenancies (estates.ts) and set occupancy themselves.
    if (estates[prop.id]) continue;
    const city = state.world.cities.find((c) => c.id === prop.cityId);
    if (!city) continue;
    const targetOcc = clamp(70 + (city.demand - 50) * 0.4 - (prop.rent / Math.max(1, prop.value) * 10000 - 50) * 0.3, 10, 100);
    prop.occupancy = clamp(prop.occupancy * 0.8 + targetOcc * 0.2, 0, 100);
  }
}

function tickPolitics(state: GameState) {
  const p = state.player;
  if (p.politics.role === "none") {
    for (const party of state.world.parties) {
      party.popularity = clamp(party.popularity + (rng(state) - 0.5) * 0.4, 3, 70);
    }
    return;
  }
  const country = state.world.countries.find((c) => c.id === (p.politics.countryId || p.countryId));
  if (!country) return;
  if (p.politics.role === "head") {
    country.policy = { ...country.policy, ...p.politics.platform };
    country.headOfGov = p.name;
    p.politics.popularity = clamp(p.politics.popularity * 0.85 + country.approval * 0.15, 5, 95);
    if (chance(rng.bind(null, state), 0.06)) {
      state.pending.push(scandalDecision(state));
    }
  } else {
    p.politics.popularity = clamp(p.politics.popularity + (p.skills.politics - 40) * 0.01 + (rng(state) - 0.48), 0, 90);
  }
  if (p.media.outlets.length && chance(rng.bind(null, state), 0.1)) {
    p.reputation.media += 1;
    p.politics.popularity += 0.4;
  }
}

function runElection(state: GameState, c: Country) {
  const parties = state.world.parties.filter((p) => p.countryId === c.id);
  const player = state.player;
  const running = player.politics.role !== "none" && (player.politics.countryId === c.id) && player.politics.role !== "volunteer";
  const scores = parties.map((party) => {
    const econFit = 100 - Math.abs(party.platform.tax - (c.unemployment > 8 ? 60 : 40));
    const pop = party.popularity + econFit * 0.1 + (party.id === c.rulingPartyId ? 4 : 0);
    return { party, score: pop + normal(rng.bind(null, state), 0, 4) };
  });
  if (running) {
    const name = player.politics.partyName;
    const mine = scores.find((s) => s.party.name === name || s.party.id === player.politics.partyId);
    if (mine) mine.score += player.politics.popularity * 0.35 + player.politics.campaignCash / 1e6 + player.skills.speaking * 0.08;
  }
  scores.sort((a, b) => b.score - a.score);
  const winner = scores[0]!;
  const total = scores.reduce((s, x) => s + Math.max(0.1, x.score), 0);
  const share = (winner.score / total) * 100;
  c.rulingPartyId = winner.party.id;
  c.headOfGov = winner.party.leader;
  c.policy = { ...winner.party.platform };
  c.electionYear = state.time.year + (c.government === "guided" ? 5 : 4);
  news(
    state,
    `${winner.party.name} wins in ${c.name}`,
    `Vote share ~${share.toFixed(1)}%. ${winner.party.leader} will form the next government. Markets are already pricing the manifesto.`,
    "politics",
    c.id,
    "Policy, taxes and grants will shift toward the winner's platform.",
  );
  if (running) {
    const won = winner.party.id === player.politics.partyId || winner.party.leader === player.name;
    const voteShare = won ? share : (scores.find((s) => s.party.id === player.politics.partyId)?.score ?? 5) / total * 100;
    player.politics.elections.push({
      year: state.time.year,
      office: player.politics.office || "National",
      result: won ? "won" : "lost",
      voteShare,
      turnout: 58 + rng(state) * 18,
    });
    if (won) {
      player.politics.role = "head";
      player.politics.office = "Head of Government";
      c.headOfGov = player.name;
      winner.party.leader = player.name;
      timeline(state, `Won the ${c.name} national election.`, "politics");
      unlock(state, "elected");
      unlock(state, "head");
      note(state, "You are head of government. Policy is now yours — and so are the consequences.", "good");
    } else {
      note(state, "You lost the election. The world still turns.", "warn");
      timeline(state, `Lost the ${c.name} election.`, "politics");
    }
  }
}

function tickCrime(state: GameState) {
  const p = state.player;
  if (p.crime.heat > 0) p.crime.heat = clamp(p.crime.heat - 0.6, 0, 100);
  if (p.crime.evidence > 0) p.crime.evidence = clamp(p.crime.evidence - 0.2, 0, 100);
  if (p.crime.heat > 70 && chance(rng.bind(null, state), 0.08)) {
    state.pending.push({
      id: uid("dec"),
      kind: "arrest",
      title: "Investigators at the door",
      body: "Police in this fictional world have enough heat to bring you in. You may hire counsel or cooperate. This is a game system, not a guide.",
      year: state.time.year,
      month: state.time.month,
      options: [
        { id: "lawyer", label: "Hire a lawyer", hint: "Expensive, lowers conviction odds" },
        { id: "cooperate", label: "Cooperate" },
      ],
      context: {},
    });
  }
  for (const org of p.orgs) {
    org.loyalty = clamp(org.loyalty + (rng(state) - 0.48) * 2, 10, 95);
    if (org.kind === "criminal") org.scrutiny += 0.3;
    if (org.loyalty < 30 && chance(rng.bind(null, state), 0.1)) {
      org.members = Math.max(0, org.members - Math.ceil(org.members * 0.08));
      note(state, `${org.name} suffers a splinter. Members walk.`, "warn");
    }
  }
}

function tickSocial(state: GameState) {
  const p = state.player;
  const date = formatDate(state.time.year, state.time.month);
  for (const a of p.social.platforms) {
    a.followers = Math.max(0, Math.round(a.followers * (1 + a.engagement / 400) + (p.reputation.social - 20) * 0.02));
  }
  p.social.followers = p.social.platforms.reduce((s, a) => s + a.followers, 0);

  // Outlets run a real P&L: advertising revenue follows reach, the economy and
  // inflation, and newsroom costs follow inflation too. An outlet can lose
  // money — it used to be a free ₹40k/month faucet per launch.
  const country = state.world.countries.find((c) => c.id === p.countryId)!;
  const mf = getAdv(state).monthFlow;
  for (const name of p.media.outlets) {
    const reach = 0.55 + Math.min(1.4, p.social.followers / 250000) + p.reputation.media / 220;
    const cycle = country.gdpGrowth > 1.5 ? 1.15 : country.gdpGrowth > 0 ? 1.02 : 0.78;
    const ad = round(38000 * reach * cycle * (1 + country.inflation / 300), 0);
    const costs = round(26000 * (1 + country.inflation / 220) * (0.9 + rng(state) * 0.25), 0);
    credit(p, ad, `Advertising · ${name}`, "media", date);
    if (mf) mf.flows.media = round(money(mf.flows.media) + ad, 2);
    const paid = spendUpTo(p, costs, `Newsroom costs · ${name}`, "media", date);
    if (mf) mf.flows.mediaCosts = round(money(mf.flows.mediaCosts) - paid.paid, 2);
    if (paid.short > 0) {
      p.reputation.media = clamp(p.reputation.media - 1, 0, 100);
      if (chance(rng.bind(null, state), 0.4)) {
        note(state, `${name} could not meet its newsroom costs (${formatINR(paid.short)} short). Staff are leaving.`, "warn");
      }
    }
  }
}

/** Everything the player runs for real: banks, brokerages, casinos, estates,
 *  and the civic side (taxes, benefits, the AI jobs squeeze). Runs after the
 *  money tick so each line lands in this month's cash-flow report. */
function tickBiz(state: GameState) {
  tickFinFirms(state);
  tickCasinoOps(state);
  tickEstates(state);
  tickCivic(state);
}

function tickHealth(state: GameState) {
  const p = state.player;
  p.health = clamp(p.health - (p.age > 50 ? 0.12 : 0.03) - p.stress / 400 + (p.energy > 70 ? 0.05 : -0.05), 1, 100);
  p.stress = clamp(p.stress * 0.96 + (p.career.job ? p.career.job.hours / 80 : 0) * 4, 0, 100);
  p.energy = clamp(p.energy - p.stress * 0.02 + 1.2, 5, 100);
  p.happiness = clamp(p.happiness + (computeNetWorth(state) > 0 ? 0.05 : -0.2) - p.stress * 0.02 + (p.health - 50) * 0.01, 1, 100);
  if (p.health <= 2 && p.age > 60) {
    p.alive = false;
    p.causeOfDeath = "Natural causes";
    timeline(state, `${p.name} has died at ${p.age}. A successor may continue the dynasty.`, "life");
    note(state, "This life has ended. You may continue as an heir.", "warn");
    state.pending.push({
      id: uid("dec"),
      kind: "death",
      title: "A life concludes",
      body: `${p.name} died at ${p.age}. Assets, companies, reputation and unfinished wars remain. Continue as a successor?`,
      year: state.time.year,
      month: state.time.month,
      options: [
        { id: "heir", label: "Continue as heir" },
        { id: "end", label: "Close this life" },
      ],
      context: {},
    });
  }
}

function tickNpcs(state: GameState) {
  if (chance(rng.bind(null, state), 0.2)) {
    const co = pick(rng.bind(null, state), state.world.companies.filter((c) => c.npc && c.listed));
    if (co) co.sentiment += (rng(state) - 0.5) * 6;
  }
  if (chance(rng.bind(null, state), 0.08)) {
    const city = pick(rng.bind(null, state), state.world.cities);
    city.infrastructure = clamp(city.infrastructure + 0.4, 10, 100);
    const country = state.world.countries.find((c) => c.id === city.countryId)!;
    if (chance(rng.bind(null, state), 0.4)) {
      news(state, `New infrastructure in ${city.name}`, "A highway spur and transit upgrade will slowly lift nearby land and labour demand.", "city", country.id, "Property demand and business activity rise locally.");
      city.demand += 2;
    }
  }
  if (chance(rng.bind(null, state), 0.05)) {
    const a = pick(rng.bind(null, state), state.world.countries);
    const b = pick(rng.bind(null, state), state.world.countries.filter((c) => c.id !== a.id));
    const order: Array<typeof a.relations[string]> = ["hostile", "tense", "neutral", "cordial", "friendly"];
    const cur = a.relations[b.id] ?? "neutral";
    const idx = order.indexOf(cur);
    const next = order[clamp(idx + (chance(rng.bind(null, state), 0.5) ? 1 : -1), 0, 4)]!;
    a.relations[b.id] = next;
    b.relations[a.id] = next;
    if (next === "tense" || next === "hostile") {
      a.tariff += 1;
      news(state, `${a.name} and ${b.name} relations turn ${next}`, "Trade desks are rewriting exposure. Exporters will feel this before diplomats do.", "diplomacy", a.id, "Tariffs and FX volatility may rise.");
    }
  }
}

function maybeEvents(state: GameState) {
  const r = rng(state);
  const p = state.player;
  const country = state.world.countries.find((c) => c.id === p.countryId)!;

  if (r < 0.06 && p.ownedCompanyIds.length && p.career.experience > 1) {
    const co = state.world.companies.find((c) => c.id === p.ownedCompanyIds[0]);
    if (co && co.stage !== "public" && co.stage !== "bankrupt") {
      const amount = Math.round(co.valuation * 0.12);
      const equity = 12 + Math.round(rng(state) * 10);
      state.pending.push({
        id: uid("dec"),
        kind: "investor",
        title: "Investor offer",
        body: `An angel syndicate offers ${amount.toLocaleString("en-IN")} ₹ for ${equity}% of ${co.name}. Faster growth, less of the company.`,
        year: state.time.year,
        month: state.time.month,
        options: [
          { id: "accept", label: "Accept", hint: `+₹${amount.toLocaleString("en-IN")}, −${equity}%` },
          { id: "reject", label: "Reject" },
          { id: "negotiate", label: "Negotiate", hint: "Depends on negotiation skill" },
          { id: "other", label: "Seek another investor" },
        ],
        context: { companyId: co.id, amount, equity },
      });
    }
  } else if (r < 0.09 && country.gdpGrowth < 0) {
    news(state, `${country.name} slips into contraction`, `Growth ${country.gdpGrowth.toFixed(1)}%, unemployment ${country.unemployment.toFixed(1)}%. Households cut back; credit officers tighten.`, "economy", country.id, "Revenues, hiring and property demand weaken.");
  } else if (r < 0.12 && state.world.tech.ai > 50 && chance(rng.bind(null, state), 0.5)) {
    news(state, "AI systems cross a productivity threshold", "White-collar task automation jumps. Some wages fall; AI vendors and compute suppliers rally.", "tech", p.countryId, "Job security drops in exposed industries; AI firms gain.");
    for (const job of state.world.jobs) {
      const meta = industryMeta(job.industry);
      if (meta.aiExpose > 0.4) job.demand = clamp(job.demand - 4, 5, 100);
    }
  } else if (r < 0.15) {
    const g = pick(rng.bind(null, state), state.world.grants.filter((x) => x.open && x.countryId === p.countryId));
    if (g) {
      news(state, `${country.name} opens ${g.name}`, `Funding up to ₹${g.amount.toLocaleString("en-IN")}. Eligibility: ${g.eligibility}. Not guaranteed.`, "grants", country.id, "Check the Opportunities desk.");
    }
  } else if (r < 0.18 && p.reputation.business > 30) {
    note(state, "A journalist requested comment on your holdings.", "warn");
    state.pending.push({
      id: uid("dec"),
      kind: "press",
      title: "Press enquiry",
      body: "A Concord Herald reporter is asking about related-party contracts and political donations. This is a simulation of scrutiny, not a how-to.",
      year: state.time.year,
      month: state.time.month,
      options: [
        { id: "open", label: "Give an open interview" },
        { id: "deny", label: "Issue a denial" },
        { id: "spin", label: "Short statement, no questions" },
      ],
      context: {},
    });
  } else if (r < 0.21 && country.inflation > 7) {
    news(state, `Inflation bites in ${country.name}`, `Printed at ${country.inflation.toFixed(1)}%. Real wages and bond prices are under pressure.`, "economy", country.id, "Living costs up, bond prices down, approval down.");
  }

  if (p.ownedCompanyIds.length && chance(rng.bind(null, state), 0.04)) {
    const co = state.world.companies.find((c) => c.id === p.ownedCompanyIds[0])!;
    if (co) {
      news(state, `Competitor undercuts ${co.name}`, "A rival cut prices this month. Expect churn unless quality or brand holds.", "business", co.countryId, "Market share at risk.");
      co.marketShare *= 0.97;
      co.sentiment -= 3;
    }
  }
}

function refreshOpportunities(state: GameState) {
  if (state.ticks > 1 && state.ticks % 2 !== 0) return;
  const p = state.player;
  const ops: Opportunity[] = [];
  const grants = state.world.grants.filter((g) => g.open && (g.countryId === p.countryId || rng(state) > 0.6));
  for (const g of grants.slice(0, 6)) {
    ops.push({
      id: uid("op"),
      kind: "grant",
      title: g.name,
      detail: `${g.eligibility}. Approval odds ~${Math.round(g.prob * 100)}%.`,
      countryId: g.countryId,
      value: g.amount,
      risk: 20,
      expiresTick: state.ticks + 6,
      payload: { grantId: g.id },
    });
  }
  const jobs = state.world.jobs.filter((j) => j.cityId === p.cityId || j.countryId === p.countryId).slice(0, 8);
  for (const j of jobs) {
    ops.push({
      id: uid("op"),
      kind: "job",
      title: `${j.title} · ${j.employer}`,
      detail: `₹${Math.round(j.salary).toLocaleString("en-IN")}/yr · ${j.hours}h · demand ${Math.round(j.demand)}`,
      countryId: j.countryId,
      value: j.salary,
      risk: 100 - j.security,
      expiresTick: state.ticks + 4,
      payload: { jobId: j.id },
    });
  }
  const cheap = state.world.properties.filter((x) => x.distressed || x.cityId === p.cityId).slice(0, 6);
  for (const pr of cheap) {
    ops.push({
      id: uid("op"),
      kind: pr.distressed ? "distressed" : "property",
      title: pr.name,
      detail: `${pr.kind} in ${pr.district} · ₹${Math.round(pr.price).toLocaleString("en-IN")}`,
      countryId: pr.countryId,
      value: pr.price,
      risk: pr.distressed ? 55 : 25,
      expiresTick: state.ticks + 5,
      payload: { listingId: pr.id },
    });
  }
  const forSale = state.world.companies.filter((c) => c.forSale || c.distressed).slice(0, 5);
  for (const co of forSale) {
    ops.push({
      id: uid("op"),
      kind: "business",
      title: `Buy ${co.name}`,
      detail: `${co.industry} · rev ₹${Math.round(co.revenue).toLocaleString("en-IN")} · ask ₹${Math.round(co.askingPrice).toLocaleString("en-IN")}`,
      countryId: co.countryId,
      value: co.askingPrice,
      risk: co.distressed ? 70 : 40,
      expiresTick: state.ticks + 5,
      payload: { companyId: co.id },
    });
  }
  if (p.ownedCompanyIds.length) {
    ops.push({
      id: uid("op"),
      kind: "incubator",
      title: "University incubator cohort",
      detail: "Mentorship, ₹4 lakh stipend, 6% common stock. Competitive.",
      countryId: p.countryId,
      value: 400000,
      risk: 30,
      expiresTick: state.ticks + 3,
      payload: { kind: "incubator" },
    });
    ops.push({
      id: uid("op"),
      kind: "investor",
      title: "Angel breakfast in Surajgarh",
      detail: "Warm intros. No guarantee. Bring traction.",
      countryId: "indara",
      value: 2500000,
      risk: 45,
      expiresTick: state.ticks + 3,
      payload: { kind: "angel" },
    });
  }
  if (p.career.experience > 4) {
    ops.push({
      id: uid("op"),
      kind: "contract",
      title: "Government digitisation contract",
      detail: "24-month delivery, penalty clauses, real money.",
      countryId: p.countryId,
      value: 18000000,
      risk: 40,
      expiresTick: state.ticks + 4,
      payload: { kind: "govcontract" },
    });
  }
  state.world.opportunities = ops.filter((o) => o.expiresTick > state.ticks);
}

function checkAchievements(state: GameState) {
  const nw = computeNetWorth(state);
  if (nw >= 1e7) unlock(state, "cash_1cr");
  if (nw >= 1e7) unlock(state, "million");
  if (nw >= 1e8) unlock(state, "ten_cr");
  if (nw >= 1e9) unlock(state, "hundred_cr");
  if (nw >= 1e10) unlock(state, "billion");
  if (state.player.ownedCompanyIds.length) unlock(state, "first_biz");
  if (state.player.properties.length) unlock(state, "first_prop");
  if (state.player.career.employed) unlock(state, "first_job");
  if (Object.values(state.player.skills).some((v) => v >= 90)) unlock(state, "skill_master");
  if (state.player.citizenship.length > 1) unlock(state, "citizen");
  if (state.player.media.outlets.length >= 2) unlock(state, "media");
  const countriesOp = new Set(
    state.world.companies.filter((c) => c.shareholders.some((s) => s.type === "player")).map((c) => c.countryId),
  );
  if (countriesOp.size >= 3) unlock(state, "intl");
  if (nw < 0) state.player.reputation.personal = clamp(state.player.reputation.personal - 1, 0, 100);
  if (nw > 0 && state.player.finances.defaults > 0 && nw > 500000) unlock(state, "rebuild");
  void totalDebt;
  void FIRST_NAMES;
  void LAST_NAMES;
  void INDUSTRIES;
  void monthName;
}

function scandalDecision(state: GameState): Decision {
  const kinds = [
    "A procurement award is being questioned in committee.",
    "An opposition daily alleges a conflict of interest in a family holding.",
    "A donor dinner is being framed as improper access.",
  ];
  return {
    id: uid("dec"),
    kind: "scandal",
    title: "Political weather",
    body: `${pick(rng.bind(null, state), kinds)} This is a consequence system in a fictional government — not a playbook.`,
    year: state.time.year,
    month: state.time.month,
    options: [
      { id: "resign_minister", label: "Ask a minister to resign" },
      { id: "investigate", label: "Order an inquiry" },
      { id: "ignore", label: "Ride it out" },
    ],
    context: {},
  };
}

export { news, note, timeline, history, unlock, rng };
