// Real estate, run properly. Every property you own has a tenancy: set an
// actual rent in rupees (the market rate is shown), list it and wait for a
// tenant, deal with late payers, damage and lease renewals — or hire a
// property manager (6% or 10% of the rent) who screens tenants, keeps the
// place in condition and handles evictions. Hire a developer to turn land into
// apartments, offices, a mall, villas or a hotel; then lease or sell the units.
import type { GameState, PropertyHolding } from "./types";
import { bizFlow, bizQueue, getBiz, pushLog, type DevProject, type EstateOps, type ManagerTier } from "./biz";
import { credit, money, spend, spendUpTo } from "./finance";
import { note, timeline, unlock } from "./feed";
import { rng } from "./engine";
import { queueHandlers, taxGain } from "./civic";
import { chance, clamp, formatDate, formatINR, pick, round } from "./util";

const dt = (s: GameState) => formatDate(s.time.year, s.time.month);
const R = (s: GameState) => () => rng(s);

export const MANAGERS: Record<ManagerTier, { name: string; pct: number; flat: number; blurb: string }> = {
  none: {
    name: "Self-managed",
    pct: 0,
    flat: 0,
    blurb: "You handle tenants and repairs. Condition slips, vacancies drag.",
  },
  basic: {
    name: "Letting agent",
    pct: 0.06,
    flat: 2000,
    blurb: "6% of rent. Finds tenants faster, basic upkeep, handles late payers.",
  },
  premium: {
    name: "Full-service manager",
    pct: 0.1,
    flat: 5000,
    blurb: "10% of rent. Screens hard, keeps condition high, evicts, renews at market.",
  },
};

export const DEV_KINDS: Record<
  DevProject["kind"],
  {
    name: string;
    per: number;
    unitMult: number;
    cost: number;
    months: number;
    to: PropertyHolding["kind"];
  }
> = {
  apartments: {
    name: "Apartment block",
    per: 25,
    unitMult: 1.0,
    cost: 0.55,
    months: 24,
    to: "apartment",
  },
  villas: {
    name: "Gated villas",
    per: 120,
    unitMult: 2.6,
    cost: 0.5,
    months: 18,
    to: "house",
  },
  offices: {
    name: "Office tower",
    per: 40,
    unitMult: 1.4,
    cost: 0.6,
    months: 28,
    to: "office",
  },
  mall: {
    name: "Shopping mall",
    per: 30,
    unitMult: 1.8,
    cost: 0.65,
    months: 34,
    to: "commercial",
  },
  hotel: {
    name: "Hotel",
    per: 20,
    unitMult: 0.7,
    cost: 0.7,
    months: 30,
    to: "hotel",
  },
};

export const DEVELOPERS: Record<
  DevProject["developer"],
  {
    name: string;
    cost: number;
    time: number;
    quality: number;
    delay: number;
    overrun: number;
    blurb: string;
  }
> = {
  budget: {
    name: "Budget builder",
    cost: 0.85,
    time: 1.1,
    quality: 55,
    delay: 0.1,
    overrun: 0.08,
    blurb: "Cheap. Delays, overruns, permit trouble, lower resale.",
  },
  reputable: {
    name: "Reputable developer",
    cost: 1.0,
    time: 1.0,
    quality: 72,
    delay: 0.05,
    overrun: 0.04,
    blurb: "Market price, usually on time.",
  },
  premium: {
    name: "Premium developer",
    cost: 1.25,
    time: 0.9,
    quality: 90,
    delay: 0.025,
    overrun: 0.02,
    blurb: "Costs more, builds faster, units fetch 20% more.",
  },
};

const TENANTS = [
  "the Kapoor family",
  "a young couple",
  "two students",
  "a startup",
  "a retired teacher",
  "a doctor's family",
  "a software engineer",
  "a law firm",
  "a cafe owner",
  "a travel agency",
  "an NGO",
  "a consulting firm",
];

function cityOf(state: GameState, prop: PropertyHolding) {
  return state.world.cities.find((c) => c.id === prop.cityId);
}

export function getEstate(state: GameState, prop: PropertyHolding): EstateOps {
  const b = getBiz(state);
  let e = b.estates[prop.id] as EstateOps | undefined;
  if (!e) {
    e = {
      manager: "premium",
      tenant: null,
      vacancyMonths: 0,
      listed: prop.rent > 0 ? "rent" : "off",
      askPrice: round(prop.value * 1.05, 0),
      project: null,
      units: null,
      log: [],
      lastMonth: null,
      autoRent: true,
      fullAuto: true,
    } as EstateOps;
    if (prop.rent > 0 && prop.occupancy > 50)
      e.tenant = {
        name: pick(R(state), TENANTS),
        quality: 50 + Math.round(rng(state) * 40),
        since: state.ticks,
        lease: 11,
        arrears: 0,
      };
    b.estates[prop.id] = e;
  }
  if (e.autoRent == null) e.autoRent = true;
  if ((e as any).fullAuto == null) (e as any).fullAuto = e.manager==="premium";
  return e;
}

/** What the market would pay per month for this property as it stands. */
export function marketRent(state: GameState, prop: PropertyHolding): number {
  const city = cityOf(state, prop);
  const e = getBiz(state).estates[prop.id];
  if (e?.units) return round((e.units.built - e.units.sold) * e.units.unitRent, 0);
  if (prop.kind === "land") return round(prop.value * 0.0008, 0);
  return round(prop.value * 0.005 * ((city?.rentIndex ?? 100) / 100) * (0.7 + prop.condition / 330), 0);
}

export function unitValueFor(state: GameState, prop: PropertyHolding, kind: DevProject["kind"]): number {
  const city = cityOf(state, prop);
  const base = (city?.avgWage ?? 800000) * 8 * ((city?.propertyIndex ?? 100) / 100);
  return round(base * DEV_KINDS[kind].unitMult, 0);
}

export function devQuote(state: GameState, prop: PropertyHolding, kind: DevProject["kind"], developer: DevProject["developer"], unitsWanted?: number) {
  const k = DEV_KINDS[kind];
  const d = DEVELOPERS[developer];
  const maxUnits = Math.max(1, Math.floor(prop.size / k.per) * (prop.kind === "land" ? 1 : 0.5));
  const units = clamp(Math.round(unitsWanted ?? maxUnits), 1, Math.max(1, Math.round(maxUnits)));
  const uv = unitValueFor(state, prop, kind);
  const budget = round(units * uv * k.cost * d.cost, 0);
  const months = Math.round(k.months * d.time) + 3;
  const gdv = round(units * uv * (d.quality / 72), 0);
  return {
    units,
    maxUnits: Math.round(maxUnits),
    unitValue: uv,
    budget,
    months,
    gdv,
    profit: gdv - budget,
    monthly: round(budget / Math.max(1, months - 3), 0),
  };
}

/* ------------------------------------------------------------ actions */

function mine(state: GameState, id: string, log: string[]) {
  const prop = state.player.properties.find((p) => p.id === id);
  if (!prop) log.push("You don't own that property.");
  return prop;
}

export function setEstateAuto(state: GameState, propId: string, patch: Partial<Pick<EstateOps,"autoRent"|"fullAuto">>, log: string[]) {
  const prop = mine(state, propId, log); if(!prop) return;
  const e = getEstate(state, prop);
  if (patch.autoRent!=null) e.autoRent = Boolean(patch.autoRent);
  if (patch.fullAuto!=null) (e as any).fullAuto = Boolean((patch as any).fullAuto);
  if ((e as any).fullAuto) e.manager="premium";
  pushLog(e.log, dt(state), `Auto: rent ${e.autoRent?"on":"off"}, developer-full ${ (e as any).fullAuto?"on":"off"}.`);
  log.push(`${prop.name}: auto-rent ${e.autoRent?"tracks market":"manual"}${ (e as any).fullAuto?", developer handles everything (premium manager, upkeep, vacancy)":""}.`);
}

export function setManager(state: GameState, propId: string, tier: ManagerTier, log: string[]) {
  const prop = mine(state, propId, log);
  if (!prop) return;
  const e = getEstate(state, prop);
  e.manager = tier;
  pushLog(e.log, dt(state), `Manager: ${MANAGERS[tier].name}.`);
  log.push(
    `${prop.name}: ${MANAGERS[tier].name}${tier !== "none" ? ` (${MANAGERS[tier].pct * 100}% of rent + ${formatINR(MANAGERS[tier].flat)}/month)` : ""}.`,
  );
}

export function setRentAmount(state: GameState, propId: string, amountRaw: number, log: string[]) {
  const prop = mine(state, propId, log);
  if (!prop) return;
  const e = getEstate(state, prop);
  const amt = Math.max(0, Math.round(money(amountRaw)));
  const mkt = marketRent(state, prop);
  if (e.units) e.units.unitRent = round(amt / Math.max(1, e.units.built - e.units.sold), 0);
  prop.rent = amt;
  e.listed = amt > 0 ? "rent" : "off";
  const ratio = amt / Math.max(1, mkt);
  log.push(
    `${prop.name}: asking ${formatINR(amt)}/month (market ≈ ${formatINR(mkt)}). ${amt === 0 ? "Taken off the rental market." : ratio > 1.25 ? "Well above market — expect a long vacancy." : ratio < 0.85 ? "Below market — tenants will queue." : "Close to market."}${e.tenant ? " The current tenant keeps their lease rate until renewal." : ""}`,
  );
}

export function listForSale(state: GameState, propId: string, askRaw: number, log: string[]) {
  const prop = mine(state, propId, log);
  if (!prop) return;
  const e = getEstate(state, prop);
  const ask = Math.round(money(askRaw));
  if (ask <= 0) {
    e.listed = prop.rent > 0 ? "rent" : "off";
    log.push("Sale listing withdrawn.");
    return;
  }
  e.askPrice = ask;
  e.listed = "sale";
  log.push(
    `${prop.name} listed at ${formatINR(ask)} (${Math.round((ask / Math.max(1, prop.value) - 1) * 100)}% vs valuation). Buyers come faster near value; 2% agent fee on sale.`,
  );
}

export function evict(state: GameState, propId: string, log: string[]) {
  const prop = mine(state, propId, log);
  if (!prop) return;
  const e = getEstate(state, prop);
  if (!e.tenant) {
    log.push("No tenant.");
    return;
  }
  const cost = round(prop.rent * (e.manager === "premium" ? 0.5 : 1.5), 0);
  const paid = spendUpTo(state.player, cost, `Eviction · ${prop.name}`, "property", dt(state));
  bizFlow(state, "estateRepairs", -paid.paid);
  pushLog(e.log, dt(state), `Evicted ${e.tenant.name}.`);
  log.push(`Evicted ${e.tenant.name}. Legal costs ${formatINR(paid.paid)}.`);
  e.tenant = null;
  e.vacancyMonths = 0;
}

export function startProject(
  state: GameState,
  propId: string,
  kind: DevProject["kind"],
  developer: DevProject["developer"],
  units: number | undefined,
  log: string[],
) {
  const prop = mine(state, propId, log);
  if (!prop) return;
  const e = getEstate(state, prop);
  if (e.project && e.project.stage !== "done") {
    log.push("A project is already running here.");
    return;
  }
  if (!DEV_KINDS[kind] || !DEVELOPERS[developer]) return;
  if (e.tenant) {
    log.push("Evict or wait out the tenant before redeveloping.");
    return;
  }
  const q = devQuote(state, prop, kind, developer, units);
  const deposit = round(q.budget * 0.1, 0);
  if (!spend(state.player, deposit, `Developer deposit · ${prop.name}`, "build", dt(state))) {
    log.push(`${DEVELOPERS[developer].name} wants a 10% deposit (${formatINR(deposit)}) to start. Budget ${formatINR(q.budget)}.`);
    return;
  }
  bizFlow(state, "construction", -deposit);
  e.project = {
    kind,
    developer,
    units: q.units,
    budget: q.budget,
    spent: deposit,
    progress: 0,
    months: q.months,
    quality: DEVELOPERS[developer].quality,
    stage: "permits",
    delays: 0,
    overrun: 0,
  };
  e.listed = "off";
  prop.rent = 0;
  pushLog(e.log, dt(state), `Hired ${DEVELOPERS[developer].name}: ${q.units}-unit ${DEV_KINDS[kind].name}, budget ${formatINR(q.budget)}.`);
  timeline(state, `Started a ${DEV_KINDS[kind].name.toLowerCase()} at ${prop.name}.`, "property");
  log.push(
    `${DEVELOPERS[developer].name} starts on a ${q.units}-unit ${DEV_KINDS[kind].name.toLowerCase()}: ${formatINR(q.budget)} budget over ~${q.months} months (≈${formatINR(q.monthly)}/month once permits clear). Projected value on completion ${formatINR(q.gdv)}.`,
  );
}

export function cancelProject(state: GameState, propId: string, log: string[]) {
  const prop = mine(state, propId, log);
  if (!prop) return;
  const e = getEstate(state, prop);
  if (!e.project || e.project.stage === "done") return;
  prop.value += e.project.spent * 0.35;
  log.push(`Project cancelled. ${formatINR(e.project.spent)} spent; about a third survives as site value.`);
  e.project = null;
}

export function setUnitsMode(state: GameState, propId: string, mode: "rent" | "sale" | "off", log: string[]) {
  const prop = mine(state, propId, log);
  if (!prop) return;
  const e = getEstate(state, prop);
  if (!e.units) {
    log.push("No finished units here.");
    return;
  }
  e.listed = mode;
  if (mode === "rent") prop.rent = round((e.units.built - e.units.sold) * e.units.unitRent, 0);
  log.push(
    mode === "sale"
      ? `Units listed for sale at ${formatINR(e.units.unitValue)} each (buyers absorb a few a month).`
      : mode === "rent"
        ? `Units listed for rent at ${formatINR(e.units.unitRent)}/month each.`
        : "Units held back.",
  );
}

/* ------------------------------------------------------------ monthly */

function tickProperty(state: GameState, prop: PropertyHolding) {
  const e = getEstate(state, prop);
  const city = cityOf(state, prop);
  const demand = city?.demand ?? 60;
  const r = R(state);
  const mgr = MANAGERS[e.manager];

  // --- development
  if (e.project && e.project.stage !== "done") {
    const pj = e.project;
    const dev = DEVELOPERS[pj.developer];
    if (pj.stage === "permits") {
      pj.progress += 34;
      if (pj.developer === "budget" && chance(r, 0.05)) {
        pj.progress = 0;
        pushLog(e.log, dt(state), "Permit application rejected — resubmitting.");
        note(state, `${prop.name}: permits rejected. The budget builder has to resubmit.`, "warn");
      }
      if (pj.progress >= 100) {
        pj.stage = "construction";
        pj.progress = 0;
        pushLog(e.log, dt(state), "Permits approved. Construction starts.");
      }
    } else {
      const draw = round(pj.budget / Math.max(1, pj.months - 3), 0);
      const paid = spendUpTo(state.player, draw, `Construction · ${prop.name}`, "build", dt(state));
      bizFlow(state, "construction", -paid.paid);
      pj.spent += paid.paid;
      if (paid.short > 0) {
        pushLog(e.log, dt(state), "Site idle — the developer wasn't paid.");
        note(state, `${prop.name}: you couldn't pay the ${formatINR(draw)} construction draw. Work stopped this month.`, "bad");
      } else {
        let step = 100 / Math.max(1, pj.months - 3);
        if (chance(r, dev.delay)) {
          step *= 0.2;
          pj.delays += 1;
          pj.months += 1;
          pushLog(
            e.log,
            dt(state),
            pick(r, ["Monsoon flooding halted work.", "Labour shortage on site.", "Steel delivery delayed.", "Inspection failed — rework needed."]),
          );
        }
        if (chance(r, dev.overrun)) {
          const extra = round(pj.budget * (0.03 + r() * 0.07), 0);
          pj.budget += extra;
          pj.overrun += extra;
          pushLog(e.log, dt(state), `Cost overrun ${formatINR(extra)}.`);
          note(state, `${prop.name}: the developer reports a ${formatINR(extra)} cost overrun.`, "warn");
        }
        pj.progress = clamp(pj.progress + step, 0, 100);
        if (pj.progress >= 85) pj.stage = "finishing";
        if (pj.progress >= 100) finishProject(state, prop, e);
      }
    }
    return;
  }

  // --- units: lease or sell a few each month
  if (e.units) {
    const u = e.units;
    const absorb = Math.max(1, Math.round((u.built / 12) * (0.4 + demand / 100)));
    if (e.listed === "sale" && u.sold < u.built) {
      const n = Math.min(u.built - u.sold, Math.round(absorb * (0.5 + r())));
      if (n > 0) {
        const vacantFirst = Math.min(n, u.built - u.sold - u.leased);
        const fromLeased = n - vacantFirst;
        u.leased = Math.max(0, u.leased - fromLeased);
        u.sold += n;
        const proceeds = round(n * u.unitValue * 0.98, 0);
        credit(state.player, proceeds, `Sold ${n} unit(s) · ${prop.name}`, "property", dt(state));
        bizFlow(state, "unitSales", proceeds);
        taxGain(state, n * u.unitValue * 0.35);
        prop.value = Math.max(0, prop.value - n * u.unitValue);
        pushLog(e.log, dt(state), `Sold ${n} unit(s) for ${formatINR(proceeds)}.`);
      }
      if (u.sold >= u.built) note(state, `${prop.name}: every unit sold.`, "good");
    } else if (e.listed === "rent") {
      const free = u.built - u.sold - u.leased;
      const mkt = marketUnitRent(state, prop, u);
      const pull = clamp(
        0.5 + (1 - u.unitRent / Math.max(1, mkt)) * 2 + (demand - 50) / 100 + (e.manager === "premium" ? 0.3 : e.manager === "basic" ? 0.15 : 0),
        0.05,
        1.5,
      );
      u.leased += Math.min(free, Math.round(absorb * pull));
      u.leased -= Math.round(u.leased * (e.manager === "premium" ? 0.01 : 0.025));
    }
    const rentable = Math.max(1, u.built - u.sold);
    prop.rent = e.listed === "rent" ? round(rentable * u.unitRent, 0) : 0;
    prop.occupancy = e.listed === "rent" ? clamp((u.leased / rentable) * 100, 0, 100) : 0;
  } else if (e.listed === "rent" && prop.rent > 0) {
    // --- single tenancy
    const mkt = marketRent(state, prop);
    if (!e.tenant) {
      e.vacancyMonths += 1;
      const p = clamp(
        0.35 +
          (1 - prop.rent / Math.max(1, mkt)) * 1.5 +
          (e.manager === "premium" ? 0.3 : e.manager === "basic" ? 0.18 : 0) +
          (demand - 50) / 200 +
          (prop.condition - 60) / 200,
        0.02,
        0.95,
      );
      if (chance(r, p)) {
        const q = clamp(Math.round(35 + r() * 50 + (e.manager === "premium" ? 20 : e.manager === "basic" ? 8 : 0)), 5, 99);
        e.tenant = {
          name: pick(r, TENANTS),
          quality: q,
          since: state.ticks,
          lease: pick(r, [11, 11, 24]),
          arrears: 0,
        };
        e.vacancyMonths = 0;
        pushLog(e.log, dt(state), `New tenant: ${e.tenant.name} at ${formatINR(prop.rent)}/month.`);
      }
    }
    if (e.tenant) {
      const t = e.tenant;
      const pays = !chance(r, (100 - t.quality) / 900 + (prop.rent > mkt * 1.3 ? 0.05 : 0));
      if (pays) {
        prop.occupancy = 100;
        if (t.arrears > 0 && chance(r, 0.3)) t.arrears = 0;
      } else {
        prop.occupancy = 0;
        t.arrears += 1;
        pushLog(e.log, dt(state), `${t.name} missed the rent.`);
        if (t.arrears >= 3) {
          if (e.manager === "none") {
            state.pending.push({
              id: `dec_ev_${prop.id}_${state.ticks}`,
              kind: "estate",
              title: `${prop.name}: tenant 3 months behind`,
              body: `${t.name} hasn't paid for three months (${formatINR(prop.rent * 3)} owed).`,
              year: state.time.year,
              month: state.time.month,
              options: [
                {
                  id: "evict",
                  label: "Start eviction",
                  hint: `Legal ≈ ${formatINR(prop.rent * 1.5)}, then vacancy`,
                },
                {
                  id: "plan",
                  label: "Offer a payment plan",
                  hint: "50% they recover",
                },
                { id: "wait", label: "Wait" },
              ],
              context: { propId: prop.id },
            });
          } else {
            pushLog(e.log, dt(state), `Manager evicted ${t.name} for arrears.`);
            e.tenant = null;
          }
        }
      }
      // damage and lease ends
      if (e.tenant && chance(r, (100 - t.quality) / 2500)) {
        prop.condition = clamp(prop.condition - 8, 5, 100);
        pushLog(e.log, dt(state), `${t.name} damaged the property (condition −8).`);
      }
      if (e.tenant && state.ticks - t.since >= t.lease) {
        const stay = chance(r, clamp(0.65 + (e.manager === "premium" ? 0.15 : 0) - (prop.condition < 50 ? 0.2 : 0), 0.2, 0.9));
        if (stay) {
          t.since = state.ticks;
          if (e.manager === "premium" && mkt > prop.rent * 1.05) {
            prop.rent = round(Math.min(mkt, prop.rent * 1.08), 0);
            pushLog(e.log, dt(state), `Lease renewed; rent raised to ${formatINR(prop.rent)}.`);
          } else pushLog(e.log, dt(state), "Lease renewed.");
        } else {
          pushLog(e.log, dt(state), `${t.name} moved out at lease end.`);
          e.tenant = null;
        }
      }
    } else prop.occupancy = 0;
  } else {
    prop.occupancy = 0;
  }

  // --- sale listing
  if (e.listed === "sale" && !e.units) {
    const p = clamp(0.35 - (e.askPrice / Math.max(1, prop.value) - 1) * 3 + (demand - 50) / 150, 0.02, 0.9);
    if (chance(r, p)) {
      const fee = e.askPrice * 0.02;
      const net = round(e.askPrice - fee, 0);
      credit(state.player, net, `Sold ${prop.name}`, "property", dt(state));
      bizFlow(state, "unitSales", net);
      taxGain(state, e.askPrice - prop.purchasePrice);
      state.player.properties = state.player.properties.filter((x) => x.id !== prop.id);
      delete getBiz(state).estates[prop.id];
      note(state, `${prop.name} sold for ${formatINR(e.askPrice)} (agent fee ${formatINR(fee)}).`, "good");
      timeline(state, `Sold ${prop.name} for ${formatINR(e.askPrice)}.`, "property");
      return;
    }
  }

  // --- autoRent: developer/premium handles pricing
  if (e.autoRent && e.listed==="rent" && !e.units && !e.project) {
    const mr = marketRent(state, prop);
    if (mr>0 && Math.abs(prop.rent - mr)/Math.max(1,mr) > 0.06) {
      prop.rent = Math.round(mr);
    }
  }
  if ((e as any).fullAuto && e.manager!=="premium") e.manager = "premium";
  // --- condition, manager fees, repairs
  const collected = prop.rent * (prop.occupancy / 100);
  let fee = 0;
  let repairs = 0;
  if (e.manager !== "none") {
    fee = round(collected * mgr.pct + mgr.flat, 0);
    const keep = e.manager === "premium" ? 0.25 : 0.12; // condition points restored
    repairs = round(prop.value * (e.manager === "premium" ? 0.0006 : 0.0004), 0);
    prop.condition = clamp(prop.condition + keep, 5, e.manager === "premium" ? 95 : 85);
  } else prop.condition = clamp(prop.condition - 0.1, 5, 100);
  const cost = fee + repairs;
  if (cost > 0) {
    const paid = spendUpTo(state.player, cost, `Property manager · ${prop.name}`, "property", dt(state));
    bizFlow(state, "estateFees", -Math.min(paid.paid, fee));
    bizFlow(state, "estateRepairs", -Math.max(0, paid.paid - fee));
  }
  if (prop.condition < 25 && chance(r, 0.08)) {
    const fine = round(prop.value * 0.004, 0);
    const paid = spendUpTo(state.player, fine, `Code violation · ${prop.name}`, "property", dt(state));
    bizFlow(state, "estateRepairs", -paid.paid);
    note(state, `${prop.name}: city inspectors fined you ${formatINR(fine)} for disrepair. Renovate or hire a manager.`, "bad");
  }
  e.lastMonth = {
    rent: round(collected, 0),
    fee,
    repairs,
    net: round(collected - fee - repairs - prop.maintenance - prop.tax, 0),
  };
}

function marketUnitRent(state: GameState, prop: PropertyHolding, u: NonNullable<EstateOps["units"]>) {
  const city = cityOf(state, prop);
  return round(u.unitValue * 0.0045 * ((city?.rentIndex ?? 100) / 100), 0);
}

function finishProject(state: GameState, prop: PropertyHolding, e: EstateOps) {
  const pj = e.project!;
  const k = DEV_KINDS[pj.kind];
  const uv = round(unitValueFor(state, prop, pj.kind) * (pj.quality / 72), 0);
  pj.stage = "done";
  pj.progress = 100;
  const city = cityOf(state, prop);
  e.units = {
    built: pj.units,
    sold: 0,
    leased: 0,
    unitValue: uv,
    unitRent: round(uv * 0.0045 * ((city?.rentIndex ?? 100) / 100), 0),
  };
  prop.kind = k.to;
  prop.value = round(prop.value * 0.4 + pj.units * uv, 0);
  prop.condition = pj.quality;
  prop.maintenance = round(prop.value * 0.0015, 0);
  prop.tax = round(prop.value * 0.0008, 0);
  prop.name = prop.name.includes("·") ? prop.name : `${prop.name} · ${k.name}`;
  e.listed = "rent";
  prop.rent = round(pj.units * e.units.unitRent, 0);
  prop.occupancy = 0;
  pushLog(e.log, dt(state), `Completed: ${pj.units} units worth ${formatINR(uv)} each.`);
  timeline(state, `Completed a ${pj.units}-unit ${k.name.toLowerCase()} (${formatINR(pj.units * uv)} of units).`, "property");
  note(state, `${prop.name} is complete: ${pj.units} units at ${formatINR(uv)} each. Lease them or list them for sale.`, "good");
  unlock(state, "developer");
}

export function resolveEstate(state: GameState, d: { context: Record<string, unknown> }, opt: string, log: string[]) {
  const prop = state.player.properties.find((p) => p.id === d.context.propId);
  if (!prop) return;
  const e = getEstate(state, prop);
  if (!e.tenant) return;
  if (opt === "evict") evict(state, prop.id, log);
  else if (opt === "plan") {
    if (chance(R(state), 0.5)) {
      const back = round(prop.rent * e.tenant.arrears * 0.8, 0);
      credit(state.player, back, `Arrears recovered · ${prop.name}`, "rent", dt(state));
      bizFlow(state, "rent", back);
      e.tenant.arrears = 0;
      log.push(`The plan worked: ${formatINR(back)} recovered.`);
    } else {
      bizQueue(state, 2, "est:skip", { propId: prop.id });
      log.push("They agreed to the plan… we'll see.");
    }
  } else log.push("You wait.");
}

queueHandlers.est = (state, _kind, data) => {
  const prop = state.player.properties.find((p) => p.id === data.propId);
  if (!prop) return;
  const e = getEstate(state, prop);
  if (e.tenant && e.tenant.arrears > 0) {
    note(state, `${e.tenant.name} skipped out on ${prop.name} owing ${formatINR(prop.rent * e.tenant.arrears)}.`, "bad");
    e.tenant = null;
    prop.condition = clamp(prop.condition - 10, 5, 100);
  }
};

export function tickEstates(state: GameState) {
  for (const prop of [...state.player.properties]) tickProperty(state, prop);
}
