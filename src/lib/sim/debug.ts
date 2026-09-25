// Hidden developer tools (spec 189). Gated behind state.adv.debug, which the
// UI can only flip through the secret gesture. These mutate the authoritative
// state the same way any other system does — they never bypass validation.
import { history, note, timeline } from "./feed";
import { tickMonths } from "./engine";
import { ledger } from "./advanced";
import { credit, money } from "./finance";
import type { GameState } from "./types";
import { clamp, formatDate, formatINR, jitter, uid } from "./util";

export function devOp(state: GameState, op: string, a: Record<string, number | string> = {}): string {
  if (op === "toggle") {
    // toggle is the only way in — always allowed
    if (!state.adv) return "No state.";
    state.adv.debug = !state.adv.debug;
    return state.adv.debug ? "Dev mode ON. The treasury is reachable from the secret spot." : "Dev mode OFF.";
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

/* ------------------------------------------------- secret admin treasury */

// The treasury is the "admin only" pocket: a hidden spot in the app that, once
// unlocked with the admin key, can credit the wallet on demand. Every draw is
// posted to the ledger, the timeline and the lifetime stats, so an admin draw
// is always traceable inside the save — it is never silent money.
export const ADMIN_KEY = String(process.env.NEXT_PUBLIC_ADMIN_KEY ?? "aurelion-admin")
  .trim()
  .toLowerCase();

export function isAdmin(state: GameState): boolean {
  return Boolean(state.adv?.admin?.unlocked);
}

/** Owner-only casino x-ray is on. */
export function xrayOn(state: GameState): boolean {
  return Boolean(state.adv?.admin?.unlocked && state.adv.admin.xray);
}

export function adminOp(state: GameState, op: string, key?: string, amount?: number): string {
  const adv = state.adv;
  if (!adv) return "No state.";
  if (!adv.admin) adv.admin = { unlocked: false, draws: 0, totalDrawn: 0 };
  const date = formatDate(state.time.year, state.time.month);
  switch (op) {
    case "status":
      return adv.admin.unlocked
        ? `Treasury unlocked · ${adv.admin.draws} draws · ${formatINR(adv.admin.totalDrawn)} total.`
        : "Treasury locked. Enter the admin key.";
    case "unlock": {
      const given = String(key ?? "").trim().toLowerCase();
      // Dev mode (the 5-tap logo gesture) also counts as proof of ownership.
      if (given !== ADMIN_KEY && !adv.debug) return "Wrong key. The treasury stays locked.";
      if (adv.admin.unlocked) return "Treasury already unlocked.";
      adv.admin.unlocked = true;
      timeline(state, "Admin access granted to the treasury.", "finance");
      note(state, "Treasury unlocked. Draws are recorded in the ledger.", "good");
      return "Treasury unlocked. You can now draw funds.";
    }
    case "xray":
      if (!adv.admin.unlocked) return "Treasury locked — unlock it first.";
      adv.admin.xray = !adv.admin.xray;
      return adv.admin.xray
        ? "Casino x-ray ON. Mine positions, crash points, the dealer's hole card and the next card are visible only to you."
        : "Casino x-ray OFF.";
    case "lock":
      if (!adv.admin.unlocked) return "Treasury is already locked.";
      adv.admin.unlocked = false;
      adv.admin.xray = false;
      note(state, "Treasury locked.", "info");
      return "Treasury locked.";
    case "draw": {
      if (!adv.admin.unlocked) return "Treasury locked — unlock it first.";
      const amt = Math.round(clamp(money(amount ?? 1_000_000), 1, 1e12));
      credit(state.player, amt, "Treasury draw (admin)", "admin", date);
      adv.admin.draws += 1;
      adv.admin.totalDrawn = round2(adv.admin.totalDrawn + amt);
      adv.admin.lastDraw = date;
      ledger(state, `Treasury draw (admin) · ${adv.admin.draws}${ord(adv.admin.draws)} draw`, amt);
      note(state, `Treasury draw: ${formatINR(amt)} credited to the wallet.`, "good");
      history(state, "finance", `Admin treasury draw ${formatINR(amt)}`);
      return `+${formatINR(amt)} from the treasury. Wallet ${formatINR(state.player.finances.cash)}.`;
    }
    default:
      return `Unknown admin op: ${op}`;
  }
}

function round2(n: number) {
  return Math.round(money(n) * 100) / 100;
}
function ord(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
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
