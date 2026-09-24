// Hidden developer tools (spec 189). Gated behind state.adv.debug, which the
// UI can only flip through the secret gesture. These mutate the authoritative
// state the same way any other system does — they never bypass validation.
import { note } from "./feed";
import { tickMonths } from "./engine";
import type { GameState } from "./types";
import { clamp, formatDate, jitter, uid } from "./util";

export function devOp(state: GameState, op: string, a: Record<string, number | string> = {}): string {
  if (op === "toggle") {
    // toggle is the only way in — always allowed
    if (!state.adv) return "No state.";
    state.adv.debug = !state.adv.debug;
    return state.adv.debug ? "Dev mode ON." : "Dev mode OFF.";
  }
  if (!state.adv?.debug) return "Dev mode is disabled. Flip the switch below first.";
  const rng = () => Math.random();
  switch (op) {
    case "add_money": {
      const amt = clamp(Number(a.amount ?? 1_000_000), 0, 1e12);
      state.player.finances.cash += amt;
      return `+₹${amt.toLocaleString("en-IN")} cash.`;
    }
    case "advance": {
      const n = clamp(Number(a.months ?? 12), 1, 36);
      tickMonths(state, n);
      return `Advanced ${n} months to ${formatDate(state.time.year, state.time.month)}.`;
    }
    case "recession":
      for (const c of state.world.countries) {
        c.gdpGrowth = clamp(c.gdpGrowth - 3.5, -9, 12);
        c.unemployment = clamp(c.unemployment + 4, 2, 25);
        c.inflation = clamp(c.inflation - 1, -2, 18);
      }
      note(state, "Shock scenario: a synchronized global slowdown hits.", "warn");
      return "Recession triggered in all countries.";
    case "boom":
      for (const c of state.world.countries) {
        c.gdpGrowth = clamp(c.gdpGrowth + 3, -9, 12);
        c.unemployment = clamp(c.unemployment - 3, 2, 25);
        c.approval = clamp(c.approval + 4, 5, 95);
      }
      return "Boom triggered.";
    case "set_rate": {
      const rate = clamp(Number(a.rate ?? 5), 0.25, 20);
      const c = state.world.countries.find((x) => x.id === state.player.countryId);
      if (c) {
        c.interestRate = rate;
        return `${c.name} policy rate set to ${rate}%.`;
      }
      return "No home country.";
    }
    case "trigger_election": {
      const c = state.world.countries.find((x) => x.id === state.player.countryId);
      if (c) {
        c.electionYear = state.time.year;
        return `Election forced in ${c.name} this year (runs in May).`;
      }
      return "No home country.";
    }
    case "spawn_property": {
      const city = state.world.cities.find((x) => x.id === state.player.cityId);
      if (!city) return "No city.";
      const base = city.avgWage * 8 * (city.propertyIndex / 100);
      state.world.properties.unshift({
        id: uid("pr"),
        name: "Distressed block (dev)",
        kind: "apartment",
        countryId: city.countryId,
        cityId: city.id,
        district: "Old Quarter",
        size: 140,
        condition: 35,
        price: Math.round(jitter(rng, base * 1.4, 0.2)),
        rent: 0,
        occupancy: 0,
        distressed: true,
      });
      return "Distressed property spawned in your city.";
    }
    case "give_company": {
      const city = state.world.cities.find((x) => x.id === state.player.cityId);
      const c = state.world.countries.find((x) => x.id === state.player.countryId);
      if (!city || !c) return "No home city/country.";
      const co = {
        id: uid("co"),
        name: "DevForge Systems",
        ticker: "DVS",
        industry: "software" as const,
        countryId: c.id,
        cityId: city.id,
        npc: false,
        public: false,
        foundedYear: state.time.year,
        revenue: 2_000_000,
        costs: 1_700_000,
        profit: 300_000,
        cash: 800_000,
        assets: 1_200_000,
        debt: 0,
        employees: 8,
        customers: 40,
        churn: 0.1,
        quality: 55,
        priceLevel: 55,
        marketing: 25,
        rd: 20,
        marketShare: 1,
        valuation: 12_000_000,
        shares: 1_000_000,
        price: 12,
        prevPrice: 12,
        pe: 30,
        growth: 8,
        dividend: 0,
        sentiment: 55,
        stage: "startup" as const,
        product: "Dev tooling",
        model: "SaaS",
        shareholders: [{ id: "devf", name: state.player.name, type: "player" as const, shares: 1_000_000 }],
        departments: {},
        ceo: state.player.name,
        playerCeo: true,
        playerRole: "founder" as const,
        history: [],
        listed: false,
        forSale: false,
        askingPrice: 0,
        distressed: false,
      };
      state.world.companies.push(co);
      state.player.ownedCompanyIds.push(co.id);
      return "Granted a small software firm (DevForge Systems).";
    }
    case "open_grant": {
      const c = state.world.countries.find((x) => x.id === state.player.countryId);
      if (!c) return "No home country.";
      state.world.grants.unshift({
        id: uid("gr"),
        name: "Frontier Launch Grant (dev)",
        kind: "startup",
        countryId: c.id,
        amount: 20_000_000,
        equity: 0,
        eligibility: "Any registered startup",
        prob: 0.9,
        deadlineYear: state.time.year,
        deadlineMonth: clamp(state.time.month + 2, 1, 12),
        competition: 40,
        milestones: "Two reporting cycles",
        open: true,
      });
      return "High-probability grant opened.";
    }
    case "spawn_news": {
      state.news.unshift({
        id: uid("news"),
        year: state.time.year,
        month: state.time.month,
        headline: "Unscheduled event wire (dev)",
        body: "A dev-mode news item so the feed can be tested.",
        tag: "world",
        countryId: state.player.countryId,
        impact: "None.",
      });
      return "News item added.";
    }
    case "give_skill": {
      const skill = String(a.skill ?? "programming");
      state.player.skills[skill] = clamp(Number(a.level ?? 90), 0, 100);
      return `${skill} → ${Math.round(state.player.skills[skill] ?? 0)}.`;
    }
    default:
      return `Unknown dev op: ${op}`;
  }
}

export function devOpsList(): { op: string; label: string; args?: string[] }[] {
  return [
    { op: "toggle", label: "Toggle dev mode" },
    { op: "add_money", label: "Add money", args: ["amount"] },
    { op: "advance", label: "Advance months", args: ["months"] },
    { op: "recession", label: "Trigger recession" },
    { op: "boom", label: "Trigger boom" },
    { op: "set_rate", label: "Set policy rate", args: ["rate"] },
    { op: "trigger_election", label: "Trigger election" },
    { op: "spawn_property", label: "Spawn distressed property" },
    { op: "give_company", label: "Grant a company" },
    { op: "open_grant", label: "Open a grant" },
    { op: "spawn_news", label: "Add news item" },
    { op: "give_skill", label: "Set skill", args: ["skill", "level"] },
  ];
}
