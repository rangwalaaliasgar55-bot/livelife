// The BitLife layer: a life lived year by year.
//
// Everything here sits on top of the economic engine rather than beside it:
// money moves through finance.ts (spend / credit / arrears), stats feed the
// same health/happiness/stress numbers the engine already uses, and every
// consequence is written to the timeline so the story screen is simply the
// timeline grouped by age.
//
//   · Smarts, Looks, Karma, Fame — new personal stats
//   · People — parents, siblings, partner/spouse, exes, friends, children,
//     each with a relationship bar that decays unless you invest in it
//   · Activities — gym, library, doctor, surgery, nightclub, therapy, rehab,
//     licenses… with diminishing returns inside a year (like BitLife)
//   · Consequences — a queue of delayed outcomes: a choice made today can come
//     back years later (see lifeevents.ts)
//   · Prison, illness, addiction and mortality with real effects
import type { GameState, FamilyMember } from "./types";
import type { CasinoState } from "./casino";
import { credit, liquidCash, money, spend, spendUpTo, computeNetWorth } from "./finance";
import { history, note, timeline, unlock } from "./feed";
import { getAdv, ledger } from "./advanced";
import { rng } from "./engine";
import { chance, clamp, formatDate, formatINR, pick, round, uid } from "./util";

export type Rel =
  | "mother"
  | "father"
  | "sibling"
  | "partner"
  | "fiance"
  | "spouse"
  | "ex"
  | "friend"
  | "child"
  | "enemy";

export interface Person {
  id: string;
  name: string;
  rel: Rel;
  gender: "m" | "f";
  age: number;
  alive: boolean;
  /** Relationship bar, 0–100. Decays every year unless you invest in it. */
  bond: number;
  looks: number;
  smarts: number;
  wealth: number;
  job: string;
  since: number;
  /** Year you last spent real time with them. */
  lastSeen: number;
  famId?: string;
  prenup?: boolean;
  /** Candidate-only: how they feel about you right now. */
  interest?: number;
}

export interface Pet {
  id: string;
  name: string;
  species: "dog" | "cat" | "parrot" | "horse" | "tortoise";
  age: number;
  bond: number;
  alive: boolean;
}

export interface Illness {
  id: string;
  name: string;
  severity: number;
  months: number;
  fatal: boolean;
}

export interface Consequence {
  id: string;
  dueTick: number;
  kind: string;
  data: Record<string, number | string>;
}

export interface PrisonState {
  monthsLeft: number;
  totalMonths: number;
  facility: string;
  behavior: number;
  crime: string;
}

export interface Vehicle {
  id: string;
  modelId: string;
  name: string;
  kind: "car" | "bike" | "yacht";
  price: number;
  value: number;
  condition: number;
  yearBought: number;
  charter: boolean;
  lastIncome: number;
}

export interface Aircraft {
  id: string;
  modelId: string;
  name: string;
  tail: string;
  purchasePrice: number;
  value: number;
  condition: number;
  hours: number;
  location: string;
  mode: "private" | "charter" | "lease";
  crew: boolean;
  yearBought: number;
  grounded: number;
  lastIncome: number;
  lastCost: number;
  lessee?: string;
}

export interface Trip {
  id: string;
  year: number;
  month: number;
  cityId: string;
  countryId: string;
  tier: string;
  days: number;
  cost: number;
  private: boolean;
  highlight: string;
}

export interface StakeRecord {
  companyId: string;
  holderId: string;
  shares: number;
  cost: number;
  since: string;
}

export interface LifeState {
  version: 1;
  smarts: number;
  looks: number;
  karma: number;
  fame: number;
  addiction: { alcohol: number; gambling: number };
  people: Person[];
  candidates: Person[];
  pets: Pet[];
  illnesses: Illness[];
  consequences: Consequence[];
  licenses: string[];
  record: string[];
  prison: PrisonState | null;
  vehicles: Vehicle[];
  aircraft: Aircraft[];
  trips: Trip[];
  visited: string[];
  stakes: StakeRecord[];
  eventsSeen: Record<string, number>;
  /** Activity uses this year — returns diminish, just like BitLife. */
  uses: Record<string, number>;
  usesYear: number;
  pilotHours: number;
  lastEventTick: number;
  casino?: CasinoState;
}

const MALE = ["Arjun", "Rohan", "Julian", "Anton", "Owen", "Wei", "Rami", "Daniel", "Vikram", "Henrik", "Leo", "Mateo", "Noah", "Kai", "Dev", "Omar", "Felix", "Ravi", "Luca", "Kenji"];
const FEMALE = ["Asha", "Meera", "Sera", "Nila", "Imani", "Elsa", "Katarina", "Lila", "Maren", "Noor", "Priya", "Anika", "Zara", "Diya", "Sofia", "Ines", "Mira", "Yuki", "Tara", "Leila"];
const SURNAMES = ["Halder", "Voss", "Tan", "Reznik", "Cole", "Lindholm", "Sethi", "Okoye", "Rao", "Holt", "Reyes", "Drake", "Volkov", "Menon", "Park", "Iyer", "Nielsen", "Costa", "Berg", "Kapoor", "Silva", "Khan"];
const JOBS = ["teacher", "nurse", "engineer", "accountant", "chef", "architect", "pilot", "lawyer", "barista", "designer", "doctor", "police officer", "writer", "developer", "musician", "entrepreneur", "unemployed", "banker", "farmer", "journalist"];
const PET_NAMES = ["Biscuit", "Luna", "Mango", "Shadow", "Pepper", "Kiwi", "Bruno", "Coco", "Nova", "Tiger"];

const r = (s: GameState) => rng(s);

export function getLife(state: GameState): LifeState {
  if (!state.life) state.life = initLife(state);
  const L = state.life;
  // backfill anything a newer build expects
  L.people ??= [];
  L.candidates ??= [];
  L.pets ??= [];
  L.illnesses ??= [];
  L.consequences ??= [];
  L.licenses ??= [];
  L.record ??= [];
  L.vehicles ??= [];
  L.aircraft ??= [];
  L.trips ??= [];
  L.visited ??= [state.player.countryId];
  L.stakes ??= [];
  L.eventsSeen ??= {};
  L.uses ??= {};
  L.addiction ??= { alcohol: 0, gambling: 0 };
  if (!Number.isFinite(L.pilotHours)) L.pilotHours = 0;
  if (!Number.isFinite(L.fame)) L.fame = 0;
  if (!Number.isFinite(L.karma)) L.karma = 50;
  return L;
}

function initLife(state: GameState): LifeState {
  const p = state.player;
  const L: LifeState = {
    version: 1,
    smarts: clamp(30 + p.educationLevel * 9 + (p.traits.discipline - 50) / 4 + r(state) * 15, 5, 100),
    looks: clamp(35 + r(state) * 50, 5, 100),
    karma: 50,
    fame: 0,
    addiction: { alcohol: 0, gambling: 0 },
    people: [],
    candidates: [],
    pets: [],
    illnesses: [],
    consequences: [],
    licenses: p.age >= 18 && r(state) < 0.6 ? ["driver"] : [],
    record: [],
    prison: null,
    vehicles: [],
    aircraft: [],
    trips: [],
    visited: [p.countryId],
    stakes: [],
    eventsSeen: {},
    uses: {},
    usesYear: state.time.year,
    pilotHours: 0,
    lastEventTick: 0,
  };
  const surname = p.name.split(" ").slice(-1)[0] || pick(() => r(state), SURNAMES);
  // Bring the existing family into the relationship system.
  const parents = p.family.members.filter((m) => m.relation === "parent");
  parents.forEach((m, i) => {
    L.people.push(personFromFamily(state, m, i === 0 ? "father" : "mother"));
  });
  if (!parents.length) {
    for (const rel of ["father", "mother"] as const) {
      const age = p.age + 22 + Math.floor(r(state) * 12);
      const person = newPerson(state, rel, age, rel === "father" ? "m" : "f", surname);
      person.alive = age < 95 && r(state) > Math.max(0, (age - 60) / 60);
      L.people.push(person);
    }
  }
  for (const m of p.family.members.filter((x) => x.relation === "sibling")) L.people.push(personFromFamily(state, m, "sibling"));
  for (const m of p.family.members.filter((x) => x.relation === "child")) L.people.push(personFromFamily(state, m, "child"));
  // a couple of friends to start with
  for (let i = 0; i < 2; i++) L.people.push(newPerson(state, "friend", clamp(p.age + Math.round((r(state) - 0.5) * 6), 5, 90)));
  return L;
}

function personFromFamily(state: GameState, m: FamilyMember, rel: Rel): Person {
  const first = m.name.split(" ")[0] ?? "";
  const gender: "m" | "f" = rel === "father" ? "m" : rel === "mother" ? "f" : FEMALE.includes(first) ? "f" : MALE.includes(first) ? "m" : r(state) < 0.5 ? "m" : "f";
  return {
    id: uid("ppl"),
    name: m.name,
    rel,
    gender,
    age: m.age,
    alive: m.alive,
    bond: 55 + Math.round(r(state) * 35),
    looks: 30 + Math.round(r(state) * 60),
    smarts: 30 + Math.round(r(state) * 60),
    wealth: money(m.wealth),
    job: rel === "child" ? "student" : pick(() => r(state), JOBS),
    since: state.time.year,
    lastSeen: state.time.year,
    famId: m.id,
  };
}

export function newPerson(state: GameState, rel: Rel, age: number, gender?: "m" | "f", surname?: string): Person {
  const g = gender ?? (r(state) < 0.5 ? "m" : "f");
  const first = pick(() => r(state), g === "m" ? MALE : FEMALE);
  const city = state.world.cities.find((c) => c.id === state.player.cityId);
  const wage = city?.avgWage ?? 700000;
  return {
    id: uid("ppl"),
    name: `${first} ${surname ?? pick(() => r(state), SURNAMES)}`,
    rel,
    gender: g,
    age,
    alive: true,
    bond: rel === "enemy" ? 5 : 45 + Math.round(r(state) * 40),
    looks: clamp(Math.round(20 + r(state) * 75), 1, 100),
    smarts: clamp(Math.round(20 + r(state) * 75), 1, 100),
    wealth: Math.round(wage * (0.2 + r(state) * r(state) * 12)),
    job: age < 18 ? "student" : age > 67 ? "retired" : pick(() => r(state), JOBS),
    since: state.time.year,
    lastSeen: state.time.year,
  };
}

/* ------------------------------------------------------------ queries */

export function inPrison(state: GameState): boolean {
  return Boolean(state.life?.prison && state.life.prison.monthsLeft > 0);
}

export function partnerOf(L: LifeState): Person | undefined {
  return L.people.find((x) => x.alive && (x.rel === "partner" || x.rel === "fiance" || x.rel === "spouse"));
}

export function relLabel(p: Person): string {
  const map: Record<Rel, [string, string]> = {
    mother: ["Mother", "Mother"],
    father: ["Father", "Father"],
    sibling: ["Brother", "Sister"],
    partner: ["Boyfriend", "Girlfriend"],
    fiance: ["Fiancé", "Fiancée"],
    spouse: ["Husband", "Wife"],
    ex: ["Ex", "Ex"],
    friend: ["Friend", "Friend"],
    child: ["Son", "Daughter"],
    enemy: ["Enemy", "Enemy"],
  };
  return map[p.rel][p.gender === "m" ? 0 : 1];
}

/* ------------------------------------------------------------ effects */

export interface Effects {
  happy?: number;
  health?: number;
  smarts?: number;
  looks?: number;
  karma?: number;
  fame?: number;
  stress?: number;
  energy?: number;
  cash?: number;
  heat?: number;
  alcohol?: number;
  gambling?: number;
  rep?: number;
}

/** Record a lifestyle money flow in the monthly cash-flow report. */
export function lifeFlow(state: GameState, key: string, amount: number) {
  const mf = getAdv(state).monthFlow;
  if (mf) mf.flows[key] = round(money(mf.flows[key]) + amount, 2);
}

/** Apply a bundle of consequences and describe exactly what changed. Money
 *  that cannot be paid becomes arrears — never silently confiscated, never
 *  silently forgiven. */
export function applyEffects(state: GameState, e: Effects, reason = "Life"): string {
  const p = state.player;
  const L = getLife(state);
  const out: string[] = [];
  const stat = (label: string, d: number | undefined, get: () => number, set: (v: number) => void, invert = false) => {
    if (!d) return;
    const before = get();
    set(clamp(before + d, 0, 100));
    const real = get() - before;
    if (Math.abs(real) >= 0.5) out.push(`${label} ${real > 0 ? "+" : "−"}${Math.abs(Math.round(real))}${invert ? "" : ""}`);
  };
  stat("Happiness", e.happy, () => p.happiness, (v) => (p.happiness = Math.max(1, v)));
  stat("Health", e.health, () => p.health, (v) => (p.health = Math.max(1, v)));
  stat("Smarts", e.smarts, () => L.smarts, (v) => (L.smarts = v));
  stat("Looks", e.looks, () => L.looks, (v) => (L.looks = v));
  stat("Karma", e.karma, () => L.karma, (v) => (L.karma = v));
  stat("Fame", e.fame, () => L.fame, (v) => (L.fame = v));
  stat("Stress", e.stress, () => p.stress, (v) => (p.stress = v), true);
  stat("Energy", e.energy, () => p.energy, (v) => (p.energy = Math.max(5, v)));
  if (e.heat) {
    p.crime.heat = clamp(p.crime.heat + e.heat, 0, 100);
    out.push(`Police heat ${e.heat > 0 ? "+" : "−"}${Math.abs(Math.round(e.heat))}`);
  }
  if (e.alcohol) L.addiction.alcohol = clamp(L.addiction.alcohol + e.alcohol, 0, 100);
  if (e.gambling) L.addiction.gambling = clamp(L.addiction.gambling + e.gambling, 0, 100);
  if (e.rep) {
    p.reputation.personal = clamp(p.reputation.personal + e.rep, 0, 100);
    out.push(`Reputation ${e.rep > 0 ? "+" : "−"}${Math.abs(Math.round(e.rep))}`);
  }
  const cash = round(money(e.cash), 0);
  const date = formatDate(state.time.year, state.time.month);
  if (cash > 0) {
    credit(p, cash, reason, "life", date);
    lifeFlow(state, "lifeIncome", cash);
    out.push(`+${formatINR(cash)}`);
  } else if (cash < 0) {
    const paid = spendUpTo(p, -cash, reason, "life", date);
    lifeFlow(state, "life", -paid.paid);
    out.push(`−${formatINR(-cash)}`);
    if (paid.short > 0) {
      p.finances.arrears = round(money(p.finances.arrears) + paid.short, 2);
      p.finances.creditScore = clamp(p.finances.creditScore - 8, 300, 900);
      out.push(`(${formatINR(paid.short)} unpaid → arrears, credit −8)`);
    }
  }
  return out.join(" · ");
}

/** Queue something to happen later. */
export function schedule(state: GameState, months: number, kind: string, data: Record<string, number | string> = {}) {
  getLife(state).consequences.push({ id: uid("csq"), dueTick: state.ticks + Math.max(1, Math.round(months)), kind, data });
}

/** Take (or record) a lawful payment in full. Returns false and moves nothing
 *  when it cannot be covered. */
export function pay(state: GameState, amount: number, desc: string, key = "life"): boolean {
  const ok = spend(state.player, amount, desc, "life", formatDate(state.time.year, state.time.month));
  if (ok) lifeFlow(state, key, -amount);
  return ok;
}

/* ------------------------------------------------------------ death */

export function killPlayer(state: GameState, cause: string) {
  const p = state.player;
  if (!p.alive) return;
  p.alive = false;
  p.causeOfDeath = cause;
  timeline(state, `${p.name} died at ${p.age}: ${cause}.`, "life");
  note(state, `This life has ended (${cause}). You may continue as an heir.`, "bad");
  state.pending.push({
    id: uid("dec"),
    kind: "death",
    title: "A life concludes",
    body: `${p.name} died at ${p.age} — ${cause}. Assets, companies, relationships and unfinished business remain. Continue as a successor?`,
    year: state.time.year,
    month: state.time.month,
    options: [
      { id: "heir", label: "Continue as heir" },
      { id: "end", label: "Close this life" },
    ],
    context: {},
  });
}

/** Annual mortality hazard. Low when young, climbing steeply after 70, and
 *  scaled by health — a hard life shortens it. */
export function mortality(age: number, health: number): number {
  const base = 0.0004 * Math.exp(0.088 * (age - 30));
  const hf = clamp(1 + (60 - health) / 35, 0.35, 4);
  return clamp(base * hf, 0, 0.6);
}

/* ------------------------------------------------------------ ticking */

/** Monthly upkeep of the life layer. `birthday` is true in the month the
 *  player turns a year older. */
export function tickLife(state: GameState, birthday: boolean) {
  const p = state.player;
  if (!p.alive) return;
  const L = getLife(state);
  if (L.usesYear !== state.time.year) {
    L.uses = {};
    L.usesYear = state.time.year;
  }

  // prison
  if (L.prison && L.prison.monthsLeft > 0) {
    L.prison.monthsLeft -= 1;
    p.happiness = clamp(p.happiness - 0.8, 1, 100);
    p.stress = clamp(p.stress + 0.6, 0, 100);
    if (L.prison.monthsLeft <= 0) {
      timeline(state, `Released from ${L.prison.facility} after ${Math.round(L.prison.totalMonths / 12)} year(s).`, "crime");
      note(state, `You walked out of ${L.prison.facility}. The record stays.`, "info");
      L.prison = null;
    }
  }

  // illness
  for (const ill of L.illnesses) {
    ill.months += 1;
    p.health = clamp(p.health - ill.severity * 0.07, 1, 100);
    p.happiness = clamp(p.happiness - ill.severity * 0.05, 1, 100);
    if (ill.fatal && ill.months > 18 && chance(() => r(state), 0.03 * ill.severity / 10)) {
      killPlayer(state, `untreated ${ill.name.toLowerCase()}`);
      return;
    }
  }

  // addiction
  if (L.addiction.alcohol > 45) {
    p.health = clamp(p.health - (L.addiction.alcohol - 40) / 120, 1, 100);
    if (p.career.job) p.career.performance = clamp(p.career.performance - 0.4, 0, 100);
  }
  if (L.addiction.gambling > 55) p.stress = clamp(p.stress + 0.5, 0, 100);
  // bodies heal: health drifts back toward an age-dependent baseline (young
  // people bounce back, old age lowers the ceiling); illness and habits fight it
  const baseline = clamp(78 - Math.max(0, p.age - 45) * 1.1 - L.addiction.alcohol * 0.3, 15, 80);
  if (p.health < baseline) p.health = clamp(p.health + (baseline - p.health) * (L.illnesses.length ? 0.012 : 0.03), 1, 100);
  // a body run into the ground gives out, at any age
  if (p.health <= 3 && chance(() => r(state), 0.012)) {
    killPlayer(state, "organ failure after years of poor health");
    return;
  }
  L.addiction.alcohol = clamp(L.addiction.alcohol * 0.985, 0, 100);
  L.addiction.gambling = clamp(L.addiction.gambling * 0.97, 0, 100);

  if (birthday) yearlyLife(state, L);
}

function yearlyLife(state: GameState, L: LifeState) {
  const p = state.player;
  const year = state.time.year;
  const date = formatDate(year, state.time.month);

  // stats drift with age
  if (p.age > 35) L.looks = clamp(L.looks - (p.age > 55 ? 1.2 : 0.5), 0, 100);
  if (p.currentStudy) L.smarts = clamp(L.smarts + 2, 0, 100);
  if (p.age > 72) L.smarts = clamp(L.smarts - 0.8, 0, 100);
  L.fame = clamp(L.fame * 0.93, 0, 100);
  L.karma = clamp(L.karma + (50 - L.karma) * 0.04, 0, 100);

  // people
  for (const person of L.people) {
    if (!person.alive) continue;
    person.age += 1;
    const neglect = year - person.lastSeen;
    const decay = person.rel === "spouse" || person.rel === "partner" || person.rel === "fiance" ? 4 + neglect * 2 : person.rel === "enemy" ? 0 : 2 + neglect;
    person.bond = clamp(person.bond - decay * (0.6 + r(state) * 0.6), 0, 100);
    if (person.famId) {
      const fm = p.family.members.find((m) => m.id === person.famId);
      if (fm) fm.age = person.age;
    }
    if (person.rel === "child" && person.age === 18) {
      timeline(state, `${person.name} turned 18 and moved out.`, "family");
      person.job = pick(() => r(state), JOBS);
    }
    // natural deaths
    const hz = mortality(person.age, 70) * (person.rel === "child" ? 0.3 : 1);
    if (chance(() => r(state), hz)) {
      person.alive = false;
      const fm = person.famId ? p.family.members.find((m) => m.id === person.famId) : undefined;
      if (fm) fm.alive = false;
      const grief = Math.round(4 + (person.bond / 100) * (person.rel === "child" ? 30 : person.rel === "spouse" ? 25 : 16));
      p.happiness = clamp(p.happiness - grief, 1, 100);
      timeline(state, `${relLabel(person)} ${person.name} died at ${person.age}.`, "family");
      note(state, `${person.name} (${relLabel(person).toLowerCase()}) has died. Happiness −${grief}.`, "bad");
      if (person.rel === "mother" || person.rel === "father" || person.rel === "spouse") {
        const heirs = person.rel === "spouse" ? 1 : 1 + L.people.filter((x) => x.rel === "sibling" && x.alive).length;
        const share = round((person.wealth * (0.5 + person.bond / 200)) / heirs, 0);
        if (share > 1000) {
          credit(p, share, `Inheritance from ${person.name}`, "life", date);
          lifeFlow(state, "lifeIncome", share);
          ledger(state, `Inheritance · ${person.name}`, share);
          timeline(state, `Inherited ${formatINR(share)} from ${person.name}.`, "family");
        }
      }
      if (person.rel === "spouse" || person.rel === "partner" || person.rel === "fiance") person.rel = "ex";
    }
    // partners leave when neglected
    if ((person.rel === "partner" || person.rel === "fiance") && person.alive && person.bond < 12 && chance(() => r(state), 0.6)) {
      person.rel = "ex";
      p.happiness = clamp(p.happiness - 10, 1, 100);
      timeline(state, `${person.name} broke up with you. They said you were never there.`, "love");
      note(state, `${person.name} left you. Relationships need time, not just money.`, "bad");
    }
    if (person.rel === "spouse" && person.alive && person.bond < 10 && chance(() => r(state), 0.5)) {
      divorce(state, person, [], true);
    }
  }
  // pets
  for (const pet of L.pets) {
    if (!pet.alive) continue;
    pet.age += 1;
    pet.bond = clamp(pet.bond - 3, 0, 100);
    const life = { dog: 13, cat: 16, parrot: 40, horse: 28, tortoise: 90 }[pet.species];
    if (pet.age > life * 0.7 && chance(() => r(state), (pet.age - life * 0.7) / (life * 0.5))) {
      pet.alive = false;
      p.happiness = clamp(p.happiness - 8, 1, 100);
      timeline(state, `Your ${pet.species} ${pet.name} passed away at ${pet.age}.`, "family");
    }
  }
  // mortality for the player
  if (chance(() => r(state), mortality(p.age, p.health))) {
    const cause = p.age > 75 ? pick(() => r(state), ["heart failure", "old age", "a stroke", "pneumonia"]) : pick(() => r(state), ["a heart attack", "an aneurysm", "a sudden illness"]);
    killPlayer(state, cause);
  }
  if (L.addiction.alcohol > 80 && chance(() => r(state), 0.04)) killPlayer(state, "alcohol poisoning");
  if (p.alive && p.age >= 100) unlock(state, "centenarian");
}

/** Months until the next birthday — one press of "Age" lives exactly that. */
export function monthsToBirthday(state: GameState): number {
  const m = (state.player.birthMonth - state.time.month + 12) % 12;
  return m === 0 ? 12 : m;
}

/* ------------------------------------------------------------ relationships */

export type InteractKind =
  | "time"
  | "talk"
  | "gift"
  | "compliment"
  | "argue"
  | "insult"
  | "money"
  | "date"
  | "propose"
  | "marry"
  | "elope"
  | "breakup"
  | "divorce"
  | "baby"
  | "reconcile"
  | "vacation";

export function interact(state: GameState, personId: string, kind: InteractKind, log: string[], opts: { prenup?: boolean; wedding?: "small" | "big" } = {}) {
  const p = state.player;
  const L = getLife(state);
  const t = L.people.find((x) => x.id === personId);
  if (!t || !t.alive) {
    log.push("They are not around any more.");
    return;
  }
  if (inPrison(state) && !["talk", "argue", "insult", "breakup", "divorce"].includes(kind)) {
    log.push("Visiting hours only: from prison you can talk, argue, or end things.");
    return;
  }
  const year = state.time.year;
  const bump = (d: number) => {
    const before = t.bond;
    t.bond = clamp(t.bond + d, 0, 100);
    return Math.round(t.bond - before);
  };
  const key = `int_${t.id}_${kind}`;
  const used = L.uses[key] ?? 0;
  L.uses[key] = used + 1;
  const dim = 1 / (1 + used * 0.8);
  switch (kind) {
    case "time": {
      const d = bump((6 + r(state) * 8) * dim);
      t.lastSeen = year;
      const fx = applyEffects(state, { happy: 3 * dim, stress: -2 * dim });
      log.push(`You spent quality time with ${t.name}. Relationship ${d >= 0 ? "+" : ""}${d}. ${fx}`);
      break;
    }
    case "talk": {
      const d = bump((3 + r(state) * 5) * dim);
      t.lastSeen = Math.max(t.lastSeen, year - (inPrison(state) ? 1 : 0));
      log.push(`You had a long conversation with ${t.name}. Relationship +${d}.`);
      break;
    }
    case "compliment": {
      const d = bump((r(state) < 0.85 ? 4 : -3) * dim);
      log.push(d >= 0 ? `${t.name} smiled. Relationship +${d}.` : `${t.name} thought it sounded fake. Relationship ${d}.`);
      break;
    }
    case "gift": {
      const cost = Math.round(Math.max(2000, liquidCash(p) * 0.004));
      if (!pay(state, cost, `Gift for ${t.name}`)) {
        log.push("You cannot afford a decent gift right now.");
        return;
      }
      const d = bump((8 + r(state) * 10) * dim);
      t.lastSeen = year;
      log.push(`You gave ${t.name} a gift (${formatINR(cost)}). Relationship +${d}.`);
      break;
    }
    case "argue": {
      const win = r(state) < 0.35 + L.smarts / 300;
      const d = bump(win ? -3 : -10);
      const fx = applyEffects(state, { stress: 4, happy: win ? 1 : -3 });
      log.push(`${win ? "You won the argument" : "The argument went badly"} with ${t.name}. Relationship ${d}. ${fx}`);
      if (t.bond < 5 && t.rel === "friend") {
        t.rel = "enemy";
        log.push(`${t.name} is now your enemy.`);
      }
      break;
    }
    case "insult": {
      const d = bump(-15);
      const fx = applyEffects(state, { karma: -2 });
      log.push(`You insulted ${t.name}. Relationship ${d}. ${fx}`);
      if (t.bond < 10 && (t.rel === "friend" || t.rel === "sibling")) {
        if (t.rel === "friend") t.rel = "enemy";
        log.push(`${t.name} will remember this.`);
      }
      if (t.bond < 10 && (t.rel === "partner" || t.rel === "fiance")) {
        t.rel = "ex";
        timeline(state, `${t.name} dumped you after one insult too many.`, "love");
        log.push(`${t.name} dumped you.`);
      }
      break;
    }
    case "money": {
      if (t.age < 16) {
        log.push(`${t.name} has pocket money, not savings.`);
        return;
      }
      const willing = t.bond / 100 * (t.rel === "mother" || t.rel === "father" ? 0.9 : t.rel === "spouse" ? 0.7 : 0.4) * (used ? 0.3 : 1);
      if (r(state) < willing && t.wealth > 20000) {
        const amt = round(Math.min(t.wealth * 0.08, 20000 + t.wealth * 0.03 * (0.5 + r(state))), 0);
        t.wealth -= amt;
        bump(-4);
        credit(p, amt, `Money from ${t.name}`, "life", formatDate(year, state.time.month));
        lifeFlow(state, "lifeIncome", amt);
        log.push(`${t.name} gave you ${formatINR(amt)}. Relationship −4.`);
      } else {
        const d = bump(-7);
        log.push(`${t.name} refused to give you money. Relationship ${d}.`);
      }
      break;
    }
    case "vacation": {
      const cost = Math.round(60000 + liquidCash(p) * 0.01);
      if (!pay(state, cost, `Holiday with ${t.name}`, "travel")) {
        log.push("A holiday together is out of budget.");
        return;
      }
      const d = bump(14 * dim);
      t.lastSeen = year;
      const fx = applyEffects(state, { happy: 8, stress: -8 });
      log.push(`A week away with ${t.name} (${formatINR(cost)}). Relationship +${d}. ${fx}`);
      break;
    }
    case "date": {
      if (t.rel !== "partner" && t.rel !== "fiance" && t.rel !== "spouse") return;
      const cost = 3500;
      pay(state, cost, `Date night with ${t.name}`);
      const good = r(state) < 0.7 + (L.looks - 50) / 300;
      const d = bump(good ? 7 * dim + 2 : -4);
      t.lastSeen = year;
      applyEffects(state, { happy: good ? 3 : -1 });
      log.push(good ? `Date night went well. Relationship +${d}.` : `Date night was awkward. Relationship ${d}.`);
      break;
    }
    case "propose": {
      if (t.rel !== "partner") {
        log.push("You can only propose to someone you are dating.");
        return;
      }
      const ring = Math.round(Math.max(40000, liquidCash(p) * 0.02));
      if (!pay(state, ring, `Engagement ring for ${t.name}`)) {
        log.push(`A ring you would be proud of costs about ${formatINR(ring)}.`);
        return;
      }
      const yes = r(state) < clamp(t.bond / 100 + (year - t.since) * 0.05 - 0.15, 0.05, 0.95);
      if (yes) {
        t.rel = "fiance";
        bump(10);
        applyEffects(state, { happy: 12 });
        timeline(state, `Got engaged to ${t.name}.`, "love");
        log.push(`${t.name} said YES! (Ring ${formatINR(ring)})`);
      } else {
        bump(-12);
        applyEffects(state, { happy: -10 });
        timeline(state, `Proposed to ${t.name}. They said no.`, "love");
        log.push(`${t.name} said no. The ring (${formatINR(ring)}) is returned at a 40% loss.`);
        credit(p, ring * 0.6, "Ring returned", "life", formatDate(year, state.time.month));
      }
      break;
    }
    case "marry":
    case "elope": {
      if (t.rel !== "fiance") {
        log.push("Get engaged first.");
        return;
      }
      const big = kind === "marry" && opts.wedding === "big";
      const cost = kind === "elope" ? 15000 : big ? Math.round(Math.max(1_500_000, liquidCash(p) * 0.05)) : 250000;
      if (!pay(state, cost, `Wedding (${kind === "elope" ? "eloped" : big ? "grand" : "simple"})`)) {
        log.push(`That wedding costs ${formatINR(cost)}. Consider eloping.`);
        return;
      }
      t.rel = "spouse";
      t.prenup = Boolean(opts.prenup);
      t.since = year;
      bump(opts.prenup ? -8 : 8);
      applyEffects(state, { happy: big ? 18 : 12, fame: big ? 2 : 0 });
      unlock(state, "married");
      timeline(state, `Married ${t.name}${big ? " in a grand wedding" : kind === "elope" ? " — eloped" : ""}${opts.prenup ? " (with a prenup)" : ""}.`, "love");
      log.push(`You married ${t.name}! ${formatINR(cost)} spent.${opts.prenup ? " Prenup signed — they were a little hurt." : " No prenup: in a divorce they can claim half your liquid money."}`);
      break;
    }
    case "breakup": {
      if (t.rel !== "partner" && t.rel !== "fiance") return;
      t.rel = "ex";
      applyEffects(state, { happy: -6, stress: 3 });
      timeline(state, `Broke up with ${t.name}.`, "love");
      log.push(`You broke up with ${t.name}.`);
      break;
    }
    case "divorce": {
      if (t.rel !== "spouse") return;
      divorce(state, t, log, false);
      break;
    }
    case "reconcile": {
      if (t.rel !== "enemy" && t.rel !== "ex") return;
      if (r(state) < 0.3 + t.bond / 200) {
        t.rel = t.rel === "enemy" ? "friend" : "ex";
        bump(15);
        applyEffects(state, { karma: 3, happy: 3 });
        log.push(`${t.name} accepted your apology.`);
      } else {
        bump(-2);
        log.push(`${t.name} is not ready to forgive.`);
      }
      break;
    }
    case "baby": {
      if (t.rel !== "partner" && t.rel !== "fiance" && t.rel !== "spouse") {
        log.push("You need a partner for that.");
        return;
      }
      if (p.age > 55 && t.age > 50) {
        log.push("Biology says no. Consider adoption.");
        return;
      }
      const willing = t.bond > 45 || r(state) < 0.25;
      if (!willing) {
        bump(-5);
        log.push(`${t.name} is not ready for a baby.`);
        return;
      }
      const fertile = clamp(0.75 - Math.max(0, Math.max(p.age, t.age) - 32) * 0.03, 0.08, 0.8);
      if (r(state) < fertile) {
        const child = addChild(state, t);
        bump(8);
        applyEffects(state, { happy: 14, stress: 6 });
        log.push(`${child.name} was born! Children cost real money every month until 18.`);
      } else {
        log.push("No luck this time.");
      }
      break;
    }
  }
}

export function addChild(state: GameState, other?: Person, adopted = false): Person {
  const p = state.player;
  const L = getLife(state);
  const surname = p.name.split(" ").slice(-1)[0];
  const child = newPerson(state, "child", 0, undefined, surname);
  child.bond = 90;
  child.job = "baby";
  const fm: FamilyMember = { id: uid("fam"), name: child.name, relation: "child", age: 0, alive: true, wealth: 0, countryId: p.countryId };
  p.family.members.push(fm);
  child.famId = fm.id;
  if (!p.family.willHeirId) p.family.willHeirId = fm.id;
  L.people.push(child);
  timeline(state, `${child.name} was ${adopted ? "adopted" : "born"}${other ? ` (with ${other.name})` : ""}.`, "family");
  unlock(state, "parent");
  return child;
}

/** Divorce with teeth: without a prenup the spouse claims half of your liquid
 *  money, plus legal fees. With one, you only pay the lawyers. */
export function divorce(state: GameState, t: Person, log: string[], theyFiled: boolean) {
  const p = state.player;
  const date = formatDate(state.time.year, state.time.month);
  const fees = 150000;
  const claim = t.prenup ? 0 : round(liquidCash(p) * 0.5, 0);
  const total = claim + fees;
  const paid = spendUpTo(p, total, `Divorce settlement · ${t.name}`, "life", date);
  lifeFlow(state, "life", -paid.paid);
  if (paid.short > 0) p.finances.arrears = round(money(p.finances.arrears) + paid.short, 2);
  t.rel = "ex";
  t.wealth += claim;
  t.bond = clamp(t.bond - 20, 0, 100);
  p.happiness = clamp(p.happiness - 15, 1, 100);
  p.stress = clamp(p.stress + 12, 0, 100);
  ledger(state, `Divorce · ${t.name}${t.prenup ? " (prenup)" : ""}`, -total);
  history(state, "family", `Divorced ${t.name}`);
  timeline(state, `${theyFiled ? `${t.name} filed for divorce` : `Divorced ${t.name}`}. Settlement ${formatINR(total)}${t.prenup ? " — the prenup held" : ""}.`, "love");
  note(state, `Divorce finalised: ${formatINR(total)} ${t.prenup ? "in legal fees (prenup protected you)" : "including half your liquid money"}.`, "bad");
  log.push(`Divorce: ${formatINR(total)} gone${t.prenup ? " (prenup protected your assets)" : " — half your cash plus legal fees"}.`);
}

/** Dating: three candidates, each with visible looks/smarts/wealth. */
export function findLove(state: GameState, where: "app" | "club" | "work", log: string[]) {
  const p = state.player;
  const L = getLife(state);
  if (p.age < 16) {
    log.push("Too young.");
    return;
  }
  if (inPrison(state)) {
    log.push("Not from a cell.");
    return;
  }
  if (where === "app" && !pay(state, 999, "Dating app subscription")) {
    log.push("Can't afford the app.");
    return;
  }
  L.candidates = [];
  const pref: "m" | "f" | undefined = undefined;
  for (let i = 0; i < 3; i++) {
    const age = clamp(p.age + Math.round((r(state) - 0.5) * 12), 16, 95);
    const c = newPerson(state, "partner", age, pref);
    c.interest = clamp(Math.round(30 + (L.looks - c.looks) / 2 + L.fame / 3 + (computeNetWorth(state) > c.wealth * 3 ? 10 : 0) + r(state) * 35), 1, 99);
    if (where === "work" && p.career.job) c.job = `${p.career.job.employer} colleague`;
    L.candidates.push(c);
  }
  log.push(`${where === "app" ? "You swiped" : where === "club" ? "You worked the room" : "You noticed colleagues"} — three people caught your eye.`);
}

export function askOut(state: GameState, candidateId: string, log: string[]) {
  const L = getLife(state);
  const c = L.candidates.find((x) => x.id === candidateId);
  if (!c) return;
  const current = partnerOf(L);
  const yes = r(state) * 100 < (c.interest ?? 40);
  L.candidates = L.candidates.filter((x) => x.id !== candidateId);
  if (!yes) {
    applyEffects(state, { happy: -3 });
    log.push(`${c.name} turned you down.`);
    return;
  }
  if (current) {
    // cheating: the new person becomes a partner, the old one may find out
    schedule(state, 2 + Math.floor(r(state) * 10), "affair_found", { partnerId: current.id, loverId: c.id });
    applyEffects(state, { karma: -8, happy: 4 });
    log.push(`${c.name} said yes. You are now cheating on ${current.name}. Secrets like this tend to surface.`);
  } else {
    log.push(`${c.name} said yes! You are dating.`);
    applyEffects(state, { happy: 8 });
  }
  c.rel = "partner";
  c.since = state.time.year;
  c.lastSeen = state.time.year;
  c.bond = clamp(40 + (c.interest ?? 40) / 2, 0, 100);
  delete c.interest;
  L.people.push(c);
  timeline(state, `Started dating ${c.name} (${c.age}, ${c.job}).`, "love");
}

export function adoptPet(state: GameState, species: Pet["species"], log: string[]) {
  const cost = { dog: 15000, cat: 8000, parrot: 25000, horse: 900000, tortoise: 12000 }[species];
  if (!pay(state, cost, `Adopted a ${species}`)) {
    log.push(`A ${species} costs ${formatINR(cost)} to take home.`);
    return;
  }
  const L = getLife(state);
  const pet: Pet = { id: uid("pet"), name: pick(() => r(state), PET_NAMES), species, age: species === "horse" ? 4 : 1, bond: 70, alive: true };
  L.pets.push(pet);
  applyEffects(state, { happy: 8, stress: -4 });
  timeline(state, `Adopted a ${species} named ${pet.name}.`, "family");
  log.push(`Welcome home, ${pet.name} the ${species}!`);
}

export function adoptChild(state: GameState, log: string[]) {
  const p = state.player;
  if (p.age < 25) {
    log.push("Adoption agencies want applicants aged 25+.");
    return;
  }
  if (p.crime.convictions > 0 || getLife(state).record.length) {
    log.push("Rejected: your criminal record disqualifies you.");
    return;
  }
  if (!pay(state, 350000, "Adoption fees")) {
    log.push("Adoption costs ₹3.5 L in fees.");
    return;
  }
  const c = addChild(state, undefined, true);
  c.age = Math.floor(r(state) * 6);
  log.push(`You adopted ${c.name} (age ${c.age}).`);
}

/* ------------------------------------------------------------ activities */

export interface ActivityDef {
  id: string;
  label: string;
  group: "Mind & Body" | "Social" | "Health" | "Licenses" | "Prison" | "Risky";
  cost: number | ((s: GameState) => number);
  hint: string;
  minAge?: number;
  prisonOnly?: boolean;
}

export const ACTIVITIES: ActivityDef[] = [
  { id: "gym", label: "Gym", group: "Mind & Body", cost: 1500, hint: "Health +, Looks + (diminishing within a year)" },
  { id: "library", label: "Library", group: "Mind & Body", cost: 0, hint: "Smarts +" },
  { id: "meditate", label: "Meditate", group: "Mind & Body", cost: 0, hint: "Stress −, Happiness +" },
  { id: "martial", label: "Martial arts", group: "Mind & Body", cost: 4000, hint: "Health +, fights go better" },
  { id: "spa", label: "Spa day", group: "Mind & Body", cost: 12000, hint: "Stress −−, Looks +" },
  { id: "volunteer", label: "Volunteer", group: "Social", cost: 0, hint: "Karma +, Happiness +, Reputation +" },
  { id: "club", label: "Night club", group: "Social", cost: 5000, hint: "Meet people. Drinking habit risk." },
  { id: "party", label: "Throw a party", group: "Social", cost: (s) => Math.max(40000, Math.round(liquidCash(s.player) * 0.005)), hint: "Friends +, Fame +" },
  { id: "charity", label: "Donate to charity", group: "Social", cost: (s) => Math.max(10000, Math.round(liquidCash(s.player) * 0.02)), hint: "Karma ++, Reputation +, 2% of liquid cash" },
  { id: "doctor", label: "Doctor", group: "Health", cost: 3000, hint: "Treats illnesses (serious ones cost more)" },
  { id: "therapy", label: "Therapist", group: "Health", cost: 6000, hint: "Happiness +, Stress −" },
  { id: "rehab", label: "Rehab", group: "Health", cost: 400000, hint: "Clears alcohol & gambling habits" },
  { id: "surgery", label: "Plastic surgery", group: "Health", cost: 450000, minAge: 18, hint: "Looks +10..25 — 10% chance it goes wrong" },
  { id: "driver", label: "Driver's licence", group: "Licenses", cost: 5000, minAge: 17, hint: "Test: pass odds rise with Smarts" },
  { id: "pilot", label: "Pilot licence", group: "Licenses", cost: 1_200_000, minAge: 17, hint: "Fly your own aircraft without a crew. Fail = fee lost." },
  { id: "boat", label: "Boating licence", group: "Licenses", cost: 60000, minAge: 16, hint: "Captain your own yacht" },
  { id: "skydive", label: "Skydiving", group: "Risky", cost: 35000, minAge: 18, hint: "Happiness ++. Tiny chance of disaster." },
  { id: "street_race", label: "Street race", group: "Risky", cost: 0, minAge: 17, hint: "Needs a car. Win cash or get arrested." },
  { id: "p_workout", label: "Yard workout", group: "Prison", cost: 0, prisonOnly: true, hint: "Health +" },
  { id: "p_read", label: "Prison library", group: "Prison", cost: 0, prisonOnly: true, hint: "Smarts +, good behaviour +" },
  { id: "p_appeal", label: "Appeal sentence", group: "Prison", cost: 250000, prisonOnly: true, hint: "Lawyer: chance to cut the sentence" },
  { id: "p_escape", label: "Attempt escape", group: "Prison", cost: 0, prisonOnly: true, hint: "Freedom — or years added" },
  { id: "p_riot", label: "Start a riot", group: "Prison", cost: 0, prisonOnly: true, hint: "Chaos. Almost always a bad idea." },
];

export function activityCost(state: GameState, a: ActivityDef): number {
  return typeof a.cost === "function" ? a.cost(state) : a.cost;
}

export function doActivity(state: GameState, id: string, log: string[]) {
  const p = state.player;
  const L = getLife(state);
  const a = ACTIVITIES.find((x) => x.id === id);
  if (!a) return;
  const jailed = inPrison(state);
  if (a.prisonOnly && !jailed) {
    log.push("That's a prison activity.");
    return;
  }
  if (!a.prisonOnly && jailed) {
    log.push("You're in prison. Try the yard, the library, an appeal — or something riskier.");
    return;
  }
  if (a.minAge && p.age < a.minAge) {
    log.push(`You must be ${a.minAge}+.`);
    return;
  }
  if (L.licenses.includes(id)) {
    log.push("You already hold that licence.");
    return;
  }
  const cost = activityCost(state, a);
  if (cost > 0 && !pay(state, cost, a.label)) {
    log.push(`${a.label} costs ${formatINR(cost)}.`);
    return;
  }
  const used = L.uses[id] ?? 0;
  L.uses[id] = used + 1;
  const dim = 1 / (1 + used * 0.7);
  const say = (text: string, e: Effects) => {
    const fx = applyEffects(state, e);
    log.push(`${text}${fx ? ` ${fx}` : ""}${used >= 2 && !id.startsWith("p_") ? " (diminishing returns this year)" : ""}`);
  };
  switch (id) {
    case "gym":
      say("You hit the gym.", { health: 3 * dim, looks: 1.5 * dim, stress: -2, energy: -3 });
      break;
    case "library":
      say("You read for hours.", { smarts: 3 * dim, stress: -1 });
      break;
    case "meditate":
      say("You found some stillness.", { stress: -6 * dim, happy: 2 * dim });
      break;
    case "martial":
      say("You trained hard.", { health: 3 * dim, looks: 1 * dim, stress: -2 });
      break;
    case "spa":
      say("A day of steam and silence.", { stress: -10 * dim, looks: 1 * dim, happy: 3 * dim });
      break;
    case "volunteer":
      say("You volunteered at a shelter.", { karma: 5 * dim, happy: 3 * dim, rep: 1 * dim });
      break;
    case "charity": {
      say(`You donated ${formatINR(cost)}.`, { karma: 10 * dim, happy: 3, rep: 2, fame: cost > 1e7 ? 3 : 0 });
      if (cost > 5e6) timeline(state, `Donated ${formatINR(cost)} to charity.`, "life");
      break;
    }
    case "club": {
      const drunk = r(state) < 0.5;
      say("A long night out.", { happy: 5 * dim, stress: -3, alcohol: drunk ? 6 : 1, health: drunk ? -1 : 0 });
      if (r(state) < 0.45) findLove(state, "club", log);
      if (r(state) < 0.25) {
        const f = newPerson(state, "friend", clamp(p.age + Math.round((r(state) - 0.5) * 8), 16, 90));
        L.people.push(f);
        log.push(`You made a new friend: ${f.name}.`);
      }
      if (drunk && r(state) < 0.06) {
        L.record.push(`Drunk & disorderly (${state.time.year})`);
        say("You were arrested for being drunk and disorderly. Fined.", { cash: -20000, rep: -3 });
      }
      break;
    }
    case "party": {
      for (const f of L.people.filter((x) => x.alive && x.rel === "friend")) {
        f.bond = clamp(f.bond + 6, 0, 100);
        f.lastSeen = state.time.year;
      }
      say("You threw a party people will talk about.", { happy: 6 * dim, fame: 1.5 * dim, alcohol: 3, stress: -3 });
      break;
    }
    case "doctor": {
      if (!L.illnesses.length) {
        say("Clean bill of health.", { health: 1, stress: -1 });
        break;
      }
      for (const ill of [...L.illnesses]) {
        const bill = Math.round(ill.severity * ill.severity * 3500 * (p.insurance.health ? 0.2 : 1));
        const ok = pay(state, bill, `Treatment: ${ill.name}`);
        if (!ok) {
          log.push(`Treatment for ${ill.name} costs ${formatINR(bill)}${p.insurance.health ? " after insurance" : " (health insurance would cover 80%)"}. You couldn't pay.`);
          continue;
        }
        const cured = r(state) < clamp(0.95 - ill.severity * 0.04 - ill.months * 0.01, 0.3, 0.95);
        if (cured) {
          L.illnesses = L.illnesses.filter((x) => x.id !== ill.id);
          say(`Treated for ${ill.name} (${formatINR(bill)}${p.insurance.health ? ", insurance paid 80%" : ""}). Cured.`, { health: 6, happy: 4 });
          timeline(state, `Recovered from ${ill.name.toLowerCase()}.`, "health");
        } else {
          ill.severity = Math.max(1, ill.severity - 2);
          say(`Treated for ${ill.name} (${formatINR(bill)}). It's improving but not gone.`, { health: 2 });
        }
      }
      break;
    }
    case "therapy":
      say("Your therapist helped you untangle a few things.", { happy: 5 * dim, stress: -7 * dim });
      break;
    case "rehab":
      L.addiction = { alcohol: 0, gambling: 0 };
      say("You completed a rehab programme. Habits cleared.", { health: 5, happy: 4, karma: 2 });
      timeline(state, "Completed rehab.", "health");
      break;
    case "surgery": {
      if (r(state) < 0.1) {
        say("The surgery went wrong.", { looks: -15, health: -8, happy: -12 });
        timeline(state, "Plastic surgery was botched.", "health");
      } else {
        say("The surgery was a success.", { looks: 10 + r(state) * 15, happy: 5 });
      }
      break;
    }
    case "driver":
    case "boat":
    case "pilot": {
      const base = id === "pilot" ? 0.3 : id === "boat" ? 0.55 : 0.5;
      const pass = r(state) < clamp(base + L.smarts / 250 + (used ? 0.05 : 0), 0.1, 0.95);
      if (pass) {
        L.licenses.push(id);
        if (id === "pilot") {
          L.pilotHours += 45;
          unlock(state, "pilot");
        }
        say(`You passed the ${id === "driver" ? "driving" : id === "pilot" ? "flight" : "boating"} test!`, { happy: 6, smarts: 1 });
        timeline(state, `Earned a ${id === "driver" ? "driver's" : id} licence.`, "life");
      } else {
        say(`You failed the ${id === "driver" ? "driving" : id === "pilot" ? "check-ride" : "boating"} test. The fee is gone.`, { happy: -4 });
      }
      break;
    }
    case "skydive": {
      const roll = r(state);
      if (roll < 0.002) {
        killPlayer(state, "a skydiving accident");
        log.push("The main chute failed. So did the reserve.");
      } else if (roll < 0.02) say("A hard landing. Broken ankle.", { health: -12, happy: 4 });
      else say("Terror, then bliss.", { happy: 10 * dim, stress: -6 });
      break;
    }
    case "street_race": {
      if (!L.vehicles.some((v) => v.kind === "car" || v.kind === "bike")) {
        log.push("You need a car or bike.");
        return;
      }
      const roll = r(state);
      if (roll < 0.12) {
        L.record.push(`Illegal street racing (${state.time.year})`);
        const car = L.vehicles.find((v) => v.kind === "car" || v.kind === "bike")!;
        car.condition = clamp(car.condition - 30, 0, 100);
        say("Police boxed you in. Arrested, fined and your car was damaged.", { cash: -80000, heat: 10, rep: -4 });
      } else if (roll < 0.18) {
        say("You crashed.", { health: -18, happy: -6 });
        const car = L.vehicles.find((v) => v.kind === "car" || v.kind === "bike")!;
        car.condition = clamp(car.condition - 50, 0, 100);
        if (r(state) < 0.05) killPlayer(state, "a street racing crash");
      } else if (roll < 0.6) say("You won the race and the pot.", { cash: 50000, happy: 6, fame: 0.5 });
      else say("You lost the race. Nobody got hurt.", { happy: -1 });
      break;
    }
    case "p_workout":
      say("Push-ups in the yard.", { health: 3 * dim, looks: 1 * dim });
      break;
    case "p_read":
      if (L.prison) L.prison.behavior = clamp(L.prison.behavior + 4, 0, 100);
      say("You read everything the library had.", { smarts: 3 * dim, stress: -2 });
      break;
    case "p_appeal": {
      const pr = L.prison!;
      if (r(state) < 0.25 + L.smarts / 400) {
        const cut = Math.round(pr.monthsLeft * (0.3 + r(state) * 0.5));
        pr.monthsLeft = Math.max(0, pr.monthsLeft - cut);
        say(`Appeal succeeded: ${cut} months cut from your sentence.`, { happy: 10 });
        if (pr.monthsLeft <= 0) {
          timeline(state, "Released on appeal.", "crime");
          L.prison = null;
        }
      } else say("Appeal denied.", { happy: -5 });
      break;
    }
    case "p_escape": {
      const pr = L.prison!;
      if (r(state) < 0.08 + (p.health - 50) / 600) {
        L.prison = null;
        L.record.push(`Prison escape (${state.time.year})`);
        p.crime.wanted = true;
        say("You escaped! You're a fugitive now — police heat is extreme.", { heat: 60, happy: 12, fame: 4 });
        timeline(state, `Escaped from ${pr.facility}.`, "crime");
      } else {
        pr.monthsLeft += 24;
        pr.totalMonths += 24;
        pr.behavior = 0;
        say("Caught at the fence. Two years added to your sentence.", { health: -8, happy: -10 });
      }
      break;
    }
    case "p_riot": {
      const pr = L.prison!;
      if (r(state) < 0.1) {
        say("The riot got out of hand and you were badly hurt.", { health: -30 });
        if (r(state) < 0.15) killPlayer(state, "injuries in a prison riot");
      } else {
        pr.monthsLeft += 12;
        say("Guards restored order. A year added to your sentence.", { health: -6, happy: -4, fame: 1 });
      }
      break;
    }
  }
}

/** Sentence the player. Jobs end, freelance stops, and most of life is paused
 *  until release (or escape). */
export function sentence(state: GameState, months: number, crime: string) {
  const p = state.player;
  const L = getLife(state);
  const m = Math.max(1, Math.round(months));
  L.prison = { monthsLeft: m, totalMonths: m, facility: pick(() => r(state), ["Greyhollow Penitentiary", "Ironbend Correctional", "Saltmarsh State Prison", "Kestrel Federal Facility"]), behavior: 50, crime };
  L.record.push(`${crime} (${state.time.year}) — ${Math.round(m / 12 * 10) / 10} yrs`);
  if (p.career.job) {
    timeline(state, `Lost job at ${p.career.job.employer} after conviction.`, "career");
    p.career.employed = false;
    p.career.job = null;
  }
  p.career.freelance.active = false;
  p.happiness = clamp(p.happiness - 20, 1, 100);
  for (const x of L.people) {
    if (x.alive && x.rel !== "enemy") x.bond = clamp(x.bond - 8, 0, 100);
  }
  timeline(state, `Sentenced to ${m >= 12 ? `${Math.round(m / 12 * 10) / 10} years` : `${m} months`} for ${crime}.`, "crime");
  note(state, `Sentenced to prison for ${crime}. You lost your job.`, "bad");
}

export function addIllness(state: GameState, name: string, severity: number, fatal = false) {
  const L = getLife(state);
  if (L.illnesses.some((x) => x.name === name)) return;
  L.illnesses.push({ id: uid("ill"), name, severity, months: 0, fatal });
  timeline(state, `Diagnosed with ${name.toLowerCase()}.`, "health");
}

export function lifeSummary(state: GameState) {
  const L = getLife(state);
  const p = state.player;
  return {
    happiness: p.happiness,
    health: p.health,
    smarts: L.smarts,
    looks: L.looks,
    karma: L.karma,
    fame: L.fame,
    partner: partnerOf(L),
    prison: L.prison,
  };
}

/** The dynasty continues: rebuild the relationship web from the heir's point
 *  of view. Assets (cars, aircraft, stakes) pass down; personal things
 *  (licences, habits, illnesses, a prison term) do not. */
export function inheritLife(state: GameState, heirFamId: string | null, oldName: string) {
  const L = getLife(state);
  const old = L.people;
  const heir = old.find((x) => x.famId === heirFamId) ?? old.find((x) => x.rel === "child" && x.alive);
  const people: Person[] = [];
  for (const x of old) {
    if (heir && x.id === heir.id) continue;
    if (x.rel === "spouse" || x.rel === "partner" || x.rel === "fiance") people.push({ ...x, rel: x.gender === "m" ? "father" : "mother", bond: clamp(x.bond + 10, 0, 100) });
    else if (x.rel === "child") people.push({ ...x, rel: "sibling" });
    else if (x.rel === "friend" && x.bond > 60) people.push({ ...x, rel: "friend", bond: 40 });
  }
  // the parent who just died
  people.push({ ...newPerson(state, "father", state.player.age + 28), name: oldName, alive: false, bond: 80 });
  L.people = people;
  L.candidates = [];
  L.prison = null;
  L.illnesses = [];
  L.addiction = { alcohol: 0, gambling: 0 };
  L.licenses = state.player.age >= 18 && r(state) < 0.5 ? ["driver"] : [];
  L.pilotHours = 0;
  L.smarts = clamp((heir?.smarts ?? 50) + r(state) * 10, 5, 100);
  L.looks = clamp(heir?.looks ?? 50, 5, 100);
  L.karma = 50;
  L.fame = clamp(L.fame * 0.5, 0, 100);
  for (const a of L.aircraft) if (!a.crew) a.crew = true;
}
