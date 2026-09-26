// Lifestyle assets with real economics: cars, yachts and aircraft that cost
// money every month, lose value, wear out, and — if you put them to work —
// earn it back through charters and leases. Plus vacations anywhere in the
// world, flown commercial or on your own jet.
import type { GameState } from "./types";
import { credit, lifestyleAssets, liquidCash, money } from "./finance";
import { ledger } from "./advanced";
import { news, note, timeline, unlock } from "./feed";
import { rng } from "./engine";
import { applyEffects, getLife, inPrison, killPlayer, lifeFlow, newPerson, pay, type Aircraft, type Vehicle } from "./life";
import { clamp, formatDate, formatINR, pick, round, uid } from "./util";

/* ------------------------------------------------------------ catalogues */

export interface VehicleModel {
  id: string;
  name: string;
  kind: "car" | "bike" | "yacht";
  price: number;
  /** annual depreciation */
  dep: number;
  /** annual running cost as a share of price (insurance, fuel, berth, crew) */
  upkeep: number;
  happy: number;
  looks: number;
  fame: number;
  /** yachts only: monthly charter yield on price at full demand */
  charterYield?: number;
  blurb: string;
}

export const VEHICLES: VehicleModel[] = [
  { id: "hatch", name: "Civic-class hatchback", kind: "car", price: 650_000, dep: 0.14, upkeep: 0.09, happy: 3, looks: 0, fame: 0, blurb: "Reliable, cheap, invisible." },
  { id: "sedan", name: "Meridian executive sedan", kind: "car", price: 1_800_000, dep: 0.13, upkeep: 0.06, happy: 5, looks: 0, fame: 0, blurb: "Comfortable daily driver." },
  { id: "suv", name: "Atlas 4×4 SUV", kind: "car", price: 4_500_000, dep: 0.12, upkeep: 0.05, happy: 6, looks: 1, fame: 0, blurb: "Big, tall, thirsty." },
  { id: "lux", name: "Sovereign S-Class limousine", kind: "car", price: 12_000_000, dep: 0.11, upkeep: 0.04, happy: 8, looks: 2, fame: 1, blurb: "Arrive like a minister." },
  { id: "super", name: "Rosso Furia V12 supercar", kind: "car", price: 45_000_000, dep: 0.06, upkeep: 0.03, happy: 12, looks: 4, fame: 3, blurb: "Loud. Very loud." },
  { id: "hyper", name: "Aurel Hyperion hypercar (limited run)", kind: "car", price: 250_000_000, dep: -0.02, upkeep: 0.015, happy: 15, looks: 5, fame: 6, blurb: "One of 99. Tends to appreciate." },
  { id: "scooter", name: "City scooter", kind: "bike", price: 120_000, dep: 0.15, upkeep: 0.08, happy: 2, looks: 0, fame: 0, blurb: "Beat the traffic." },
  { id: "tourer", name: "Kestrel 1200 tourer motorcycle", kind: "bike", price: 2_500_000, dep: 0.1, upkeep: 0.05, happy: 7, looks: 2, fame: 0, blurb: "Mountain roads, open sky." },
  { id: "daycruiser", name: "Coastline 32 day cruiser", kind: "yacht", price: 25_000_000, dep: 0.08, upkeep: 0.07, happy: 8, looks: 1, fame: 1, charterYield: 0.011, blurb: "Weekend trips along the coast." },
  { id: "motoryacht", name: "Azure 70 motor yacht", kind: "yacht", price: 400_000_000, dep: 0.07, upkeep: 0.08, happy: 12, looks: 2, fame: 4, charterYield: 0.012, blurb: "Four cabins, a crew of five." },
  { id: "superyacht", name: "Leviathan 110m superyacht", kind: "yacht", price: 4_000_000_000, dep: 0.06, upkeep: 0.09, happy: 16, looks: 3, fame: 10, charterYield: 0.013, blurb: "Helipad, submarine, 40 crew." },
];

export interface AircraftModel {
  id: string;
  name: string;
  cls: string;
  price: number;
  seats: number;
  rangeKm: number;
  speed: number;
  /** operating cost per flight hour (fuel, fees, maintenance reserve) */
  opHour: number;
  /** charter revenue per flight hour */
  charterHour: number;
  /** monthly crew salaries when retained */
  crew: number;
  /** monthly lease income as a share of value */
  leaseYield: number;
  /** can a private pilot licence fly it? */
  singlePilot: boolean;
  blurb: string;
}

export const AIRCRAFT: AircraftModel[] = [
  { id: "skylark", name: "Skylark 172", cls: "Single-engine prop", price: 35_000_000, seats: 4, rangeKm: 1200, speed: 220, opHour: 20_000, charterHour: 38_000, crew: 300_000, leaseYield: 0.009, singlePilot: true, blurb: "The trainer everyone learns on." },
  { id: "kestrel", name: "Kestrel TP-9", cls: "Turboprop", price: 280_000_000, seats: 9, rangeKm: 2800, speed: 520, opHour: 110_000, charterHour: 210_000, crew: 800_000, leaseYield: 0.0085, singlePilot: true, blurb: "Short strips, island hops." },
  { id: "swift", name: "Aurel Swift LJ", cls: "Light jet", price: 750_000_000, seats: 7, rangeKm: 3700, speed: 780, opHour: 220_000, charterHour: 410_000, crew: 1_400_000, leaseYield: 0.008, singlePilot: true, blurb: "Your first real jet." },
  { id: "meridian", name: "Meridian M600", cls: "Midsize jet", price: 1_800_000_000, seats: 10, rangeKm: 6000, speed: 850, opHour: 380_000, charterHour: 780_000, crew: 2_200_000, leaseYield: 0.0078, singlePilot: false, blurb: "Coast to coast, stand-up cabin." },
  { id: "zenith", name: "Zenith Global 8000", cls: "Ultra-long-range jet", price: 5_500_000_000, seats: 16, rangeKm: 14000, speed: 900, opHour: 700_000, charterHour: 1_650_000, crew: 4_000_000, leaseYield: 0.0075, singlePilot: false, blurb: "Anywhere on the map, non-stop." },
  { id: "a180", name: "AeroLine A180", cls: "Narrow-body airliner", price: 9_000_000_000, seats: 180, rangeKm: 6100, speed: 830, opHour: 900_000, charterHour: 2_400_000, crew: 7_000_000, leaseYield: 0.0072, singlePilot: false, blurb: "Lease it to an airline — or run group charters." },
  { id: "titan", name: "Titan W350", cls: "Wide-body airliner", price: 28_000_000_000, seats: 350, rangeKm: 13500, speed: 900, opHour: 2_200_000, charterHour: 5_800_000, crew: 16_000_000, leaseYield: 0.007, singlePilot: false, blurb: "The flagship of a flag carrier." },
];

export const vehicleModel = (id: string) => VEHICLES.find((v) => v.id === id);
export const aircraftModel = (id: string) => AIRCRAFT.find((a) => a.id === id);

const date = (s: GameState) => formatDate(s.time.year, s.time.month);
const r = (s: GameState) => rng(s);

/* ------------------------------------------------------------ geography */

export function cityDistanceKm(state: GameState, a: string, b: string): number {
  if (a === b) return 0;
  const A = state.world.cities.find((c) => c.id === a);
  const B = state.world.cities.find((c) => c.id === b);
  if (!A || !B) return 3000;
  return Math.round(Math.max(150, Math.hypot(A.x - B.x, A.y - B.y) * 140));
}

/* ------------------------------------------------------------ vehicles */

export function buyVehicle(state: GameState, modelId: string, log: string[]) {
  const m = vehicleModel(modelId);
  if (!m) return;
  if (inPrison(state)) return void log.push("Not from prison.");
  if (!pay(state, m.price, `Bought ${m.name}`, "life")) return void log.push(`${m.name} costs ${formatINR(m.price)}.`);
  const L = getLife(state);
  const v: Vehicle = { id: uid("veh"), modelId: m.id, name: m.name, kind: m.kind, price: m.price, value: m.price, condition: 100, yearBought: state.time.year, charter: false, lastIncome: 0 };
  L.vehicles.push(v);
  const fx = applyEffects(state, { happy: m.happy, looks: m.looks, fame: m.fame });
  ledger(state, `Bought ${m.name}`, -m.price);
  timeline(state, `Bought a ${m.name} for ${formatINR(m.price)}.`, "life");
  if (m.kind === "yacht") unlock(state, "yacht");
  if (m.id === "hyper" || m.id === "super") unlock(state, "petrolhead");
  log.push(`You bought a ${m.name}. ${fx}${m.kind === "car" && !L.licenses.includes("driver") ? " (No driver's licence — a chauffeur is added to monthly costs.)" : ""}`);
}

export function sellVehicle(state: GameState, id: string, log: string[]) {
  const L = getLife(state);
  const v = L.vehicles.find((x) => x.id === id);
  if (!v) return;
  const proceeds = round(v.value * (0.9 + v.condition / 1000), 0);
  credit(state.player, proceeds, `Sold ${v.name}`, "life", date(state));
  lifeFlow(state, "lifeIncome", proceeds);
  L.vehicles = L.vehicles.filter((x) => x.id !== id);
  ledger(state, `Sold ${v.name}`, proceeds);
  log.push(`Sold the ${v.name} for ${formatINR(proceeds)} (paid ${formatINR(v.price)}).`);
}

export function toggleYachtCharter(state: GameState, id: string, log: string[]) {
  const v = getLife(state).vehicles.find((x) => x.id === id);
  if (!v || v.kind !== "yacht") return;
  v.charter = !v.charter;
  log.push(v.charter ? `${v.name} is now listed for charter. Income depends on the season and her condition.` : `${v.name} is back to private use.`);
}

export function repairVehicle(state: GameState, id: string, log: string[]) {
  const v = getLife(state).vehicles.find((x) => x.id === id);
  if (!v) return;
  const cost = round(v.price * ((100 - v.condition) / 100) * 0.1, -2);
  if (cost <= 0) return void log.push("Already in perfect condition.");
  if (!pay(state, cost, `Repairs · ${v.name}`, "aviation")) return void log.push(`Repairs cost ${formatINR(cost)}.`);
  v.condition = 100;
  log.push(`${v.name} fully repaired for ${formatINR(cost)}.`);
}

/* ------------------------------------------------------------ aircraft */

function tailNumber(state: GameState): string {
  const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
  let s = "AU-";
  for (let i = 0; i < 3; i++) s += letters[Math.floor(r(state) * letters.length)];
  return s;
}

export function buyAircraft(state: GameState, modelId: string, log: string[]) {
  const m = aircraftModel(modelId);
  if (!m) return;
  if (inPrison(state)) return void log.push("Not from prison.");
  if (!pay(state, m.price, `Bought ${m.name}`, "aviation")) return void log.push(`The ${m.name} costs ${formatINR(m.price)}. Your liquid cash is ${formatINR(liquidCash(state.player))}.`);
  const L = getLife(state);
  const a: Aircraft = {
    id: uid("ac"),
    modelId: m.id,
    name: m.name,
    tail: tailNumber(state),
    purchasePrice: m.price,
    value: m.price,
    condition: 100,
    hours: 0,
    location: state.player.cityId,
    mode: "private",
    crew: !(m.singlePilot && L.licenses.includes("pilot")),
    yearBought: state.time.year,
    grounded: 0,
    lastIncome: 0,
    lastCost: 0,
  };
  L.aircraft.push(a);
  applyEffects(state, { happy: 10, fame: m.price > 1e9 ? 6 : 3 });
  ledger(state, `Bought aircraft ${a.tail} (${m.name})`, -m.price);
  timeline(state, `Took delivery of a ${m.name} (${a.tail}).`, "life");
  unlock(state, "wings");
  if (L.aircraft.length >= 5) unlock(state, "fleet");
  log.push(`Your ${m.name} (${a.tail}) is in the hangar at ${state.world.cities.find((c) => c.id === a.location)?.name}. ${a.crew ? "A crew is on retainer." : "You're licensed to fly it yourself."}`);
}

export function sellAircraft(state: GameState, id: string, log: string[]) {
  const L = getLife(state);
  const a = L.aircraft.find((x) => x.id === id);
  if (!a) return;
  const proceeds = round(a.value * (0.88 + a.condition / 1000), 0);
  credit(state.player, proceeds, `Sold aircraft ${a.tail}`, "aviation", date(state));
  lifeFlow(state, "charter", proceeds);
  L.aircraft = L.aircraft.filter((x) => x.id !== id);
  ledger(state, `Sold aircraft ${a.tail}`, proceeds);
  timeline(state, `Sold ${a.name} ${a.tail} for ${formatINR(proceeds)}.`, "life");
  log.push(`Sold ${a.tail} for ${formatINR(proceeds)} (bought for ${formatINR(a.purchasePrice)}).`);
}

export function setAircraftMode(state: GameState, id: string, mode: Aircraft["mode"], log: string[]) {
  const a = getLife(state).aircraft.find((x) => x.id === id);
  const m = a ? aircraftModel(a.modelId) : undefined;
  if (!a || !m) return;
  a.mode = mode;
  if (mode === "lease") {
    a.lessee = pick(() => r(state), ["Aurelion Airways", "Nordmark Air", "Zhenhua Skylines", "Solara Wings", "Kairos Jet", "Meridia Coastal"]);
    log.push(`${a.tail} is on a dry lease to ${a.lessee} at ${formatINR(a.value * m.leaseYield)}/month. They fly it, crew it and wear it out. Lessees can default in a downturn.`);
  } else if (mode === "charter") {
    a.crew = true;
    delete a.lessee;
    log.push(`${a.tail} is on the charter market at ${formatINR(m.charterHour)}/hr. You pay crew, fuel and maintenance; bookings follow the economy, tourism and the aircraft's condition.`);
  } else {
    delete a.lessee;
    log.push(`${a.tail} is back for your private use.`);
  }
}

export function setAircraftCrew(state: GameState, id: string, crew: boolean, log: string[]) {
  const L = getLife(state);
  const a = L.aircraft.find((x) => x.id === id);
  const m = a ? aircraftModel(a.modelId) : undefined;
  if (!a || !m) return;
  if (!crew && (!L.licenses.includes("pilot") || !m.singlePilot)) return void log.push(m.singlePilot ? "You need a pilot licence to fly without a crew." : `The ${m.name} requires a professional two-pilot crew.`);
  if (!crew && a.mode === "charter") return void log.push("Charter operations need a professional crew.");
  a.crew = crew;
  log.push(crew ? `Crew retained for ${a.tail}: ${formatINR(m.crew)}/month.` : `Crew released. You'll fly ${a.tail} yourself.`);
}

export function maintainAircraft(state: GameState, id: string, log: string[]) {
  const a = getLife(state).aircraft.find((x) => x.id === id);
  if (!a) return;
  const cost = round(a.purchasePrice * ((100 - a.condition) / 100) * 0.12 + a.purchasePrice * 0.002, -3);
  if (!pay(state, cost, `Heavy maintenance · ${a.tail}`, "aviation")) return void log.push(`A full check costs ${formatINR(cost)}.`);
  a.condition = 100;
  a.grounded = Math.max(a.grounded, 1);
  log.push(`${a.tail} went through a full maintenance check (${formatINR(cost)}). Condition 100%; out of service for a month.`);
}

export interface FlightQuote {
  km: number;
  hours: number;
  stops: number;
  cost: number;
  crewFee: number;
  ok: boolean;
  why?: string;
}

export function quoteFlight(state: GameState, a: Aircraft, from: string, to: string, roundTrip = false): FlightQuote {
  const m = aircraftModel(a.modelId)!;
  const km = cityDistanceKm(state, from, to) * (roundTrip ? 2 : 1);
  const leg = cityDistanceKm(state, from, to);
  const stops = Math.max(0, Math.ceil(leg / m.rangeKm) - 1);
  const hours = round(km / m.speed + stops * 0.8 * (roundTrip ? 2 : 1), 1);
  const crewFee = a.crew ? 0 : 0;
  const cost = round(hours * m.opHour + stops * 150000, -2);
  if (a.grounded > 0) return { km, hours, stops, cost, crewFee, ok: false, why: `Grounded for ${a.grounded} more month(s).` };
  if (a.mode === "lease") return { km, hours, stops, cost, crewFee, ok: false, why: `On lease to ${a.lessee}. Recall it first.` };
  if (stops > 3) return { km, hours, stops, cost, crewFee, ok: false, why: "Too far for this aircraft." };
  return { km, hours, stops, cost, crewFee, ok: true };
}

/** Fly your own aircraft somewhere (and move there). */
export function flyAircraft(state: GameState, id: string, cityId: string, log: string[]) {
  const L = getLife(state);
  const a = L.aircraft.find((x) => x.id === id);
  const city = state.world.cities.find((c) => c.id === cityId);
  if (!a || !city) return;
  if (inPrison(state)) return void log.push("Not from prison.");
  // ferry the aircraft to you first if it's parked elsewhere
  const ferry = a.location !== state.player.cityId ? quoteFlight(state, a, a.location, state.player.cityId) : null;
  const q = quoteFlight(state, a, state.player.cityId, cityId);
  if (!q.ok) return void log.push(q.why ?? "Can't fly.");
  const total = q.cost + (ferry?.cost ?? 0);
  if (!pay(state, total, `Flight ${a.tail} → ${city.name}`, "aviation")) return void log.push(`This flight costs ${formatINR(total)} in fuel and fees.`);
  const fx = flightRisk(state, a, q.hours);
  if (!state.player.alive) return;
  a.hours += q.hours + (ferry?.hours ?? 0);
  a.condition = clamp(a.condition - (q.hours + (ferry?.hours ?? 0)) * 0.05, 0, 100);
  a.location = cityId;
  if (!a.crew) L.pilotHours += q.hours;
  const p = state.player;
  p.countryId = city.countryId;
  p.cityId = city.id;
  p.visa = p.citizenship.includes(city.countryId) ? "citizen" : p.visa === "resident" && p.residency === city.countryId ? "resident" : "tourist";
  if (!L.visited.includes(city.countryId)) L.visited.push(city.countryId);
  checkGlobetrotter(state);
  timeline(state, `Flew ${a.tail} to ${city.name} (${q.km.toLocaleString()} km${a.crew ? "" : ", at the controls yourself"}).`, "travel");
  log.push(`Flew ${a.name} ${a.tail} to ${city.name}: ${q.km.toLocaleString()} km, ${q.hours} h${q.stops ? `, ${q.stops} fuel stop(s)` : ""}, ${formatINR(total)}.${fx ? ` ${fx}` : ""}`);
}

/** Flying yourself is cheaper and cooler — and riskier, especially in a tired
 *  aircraft with a new licence. */
function flightRisk(state: GameState, a: Aircraft, hours: number): string {
  const L = getLife(state);
  const selfFly = !a.crew;
  const skill = clamp(L.pilotHours / 500, 0, 1);
  const base = (a.condition < 40 ? (40 - a.condition) / 4000 : 0) + (selfFly ? 0.004 * (1 - skill * 0.8) : 0.0005);
  const risk = clamp(base * Math.max(1, hours / 2), 0, 0.2);
  if (r(state) >= risk) return "";
  if (r(state) < 0.25) {
    const loss = round(a.value, 0);
    getLife(state).aircraft = L.aircraft.filter((x) => x.id !== a.id);
    const payout = round(loss * 0.7, 0);
    credit(state.player, payout, `Hull insurance · ${a.tail}`, "aviation", date(state));
    news(state, `Private aircraft ${a.tail} lost`, "Investigators are at the scene. Maintenance and pilot records will be examined.", "aviation", state.player.countryId, "Hull loss; insurers pay 70%.");
    if (r(state) < 0.5) {
      killPlayer(state, `a crash in ${a.name} ${a.tail}`);
      return "The aircraft went down.";
    }
    applyEffects(state, { health: -45, happy: -20, fame: 5 });
    return `The ${a.name} crashed on landing. You survived with serious injuries. Insurance paid ${formatINR(payout)} of ${formatINR(loss)}.`;
  }
  a.condition = clamp(a.condition - 25, 0, 100);
  a.grounded = 2;
  applyEffects(state, { stress: 15, health: -5 });
  return "A hard landing damaged the gear — grounded for two months.";
}

/* ------------------------------------------------------------ vacations */

export const VACATION_TIERS = [
  { id: "backpack", label: "Backpacker", hotel: 0.35, flight: 1, happy: 8, stress: -8 },
  { id: "standard", label: "Standard", hotel: 1, flight: 1, happy: 12, stress: -12 },
  { id: "luxury", label: "Luxury (business class)", hotel: 4, flight: 3.5, happy: 16, stress: -16 },
  { id: "ultra", label: "Ultra (first class, villa)", hotel: 14, flight: 7, happy: 20, stress: -20 },
] as const;

export function quoteVacation(state: GameState, cityId: string, tierId: string, days: number, aircraftId?: string) {
  const tier = VACATION_TIERS.find((t) => t.id === tierId) ?? VACATION_TIERS[1];
  const city = state.world.cities.find((c) => c.id === cityId);
  const km = cityDistanceKm(state, state.player.cityId, cityId);
  const d = clamp(Math.round(days), 3, 30);
  const hotel = round(4500 * ((city?.propertyIndex ?? 100) / 100) * tier.hotel * d, -2);
  let flight = round((3000 + km * 4.2) * 2 * tier.flight, -2);
  let privateFlight = false;
  let why: string | undefined;
  if (aircraftId) {
    const a = getLife(state).aircraft.find((x) => x.id === aircraftId);
    if (a) {
      const q = quoteFlight(state, a, a.location, cityId, false);
      const back = quoteFlight(state, a, cityId, state.player.cityId, false);
      const toMe = a.location !== state.player.cityId ? quoteFlight(state, a, a.location, state.player.cityId) : null;
      if (q.ok && back.ok) {
        flight = round((toMe?.cost ?? 0) + quoteFlight(state, a, state.player.cityId, cityId, true).cost, -2);
        privateFlight = true;
      } else why = q.why ?? back.why;
    }
  }
  const activities = round(hotel * 0.4, -2);
  return { km, days: d, hotel, flight, activities, total: hotel + flight + activities, tier, privateFlight, why, city };
}

export function takeVacation(state: GameState, cityId: string, tierId: string, days: number, aircraftId: string | undefined, log: string[]) {
  const p = state.player;
  const L = getLife(state);
  if (inPrison(state)) return void log.push("Nice try.");
  const q = quoteVacation(state, cityId, tierId, days, aircraftId);
  if (!q.city) return;
  if (aircraftId && !q.privateFlight) return void log.push(q.why ?? "Your aircraft can't make that trip right now.");
  if (!pay(state, q.total, `Vacation · ${q.city.name}`, "travel")) return void log.push(`This trip costs ${formatINR(q.total)}.`);
  const country = state.world.countries.find((c) => c.id === q.city!.countryId);
  const scale = Math.min(1.4, q.days / 10);
  const e = { happy: q.tier.happy * scale, stress: q.tier.stress * scale, health: 2 * scale, energy: 15, fame: q.privateFlight ? 1 : 0 };
  const fx = applyEffects(state, e);
  if (aircraftId && q.privateFlight) {
    const a = L.aircraft.find((x) => x.id === aircraftId)!;
    const hrs = (q.km * 2) / (aircraftModel(a.modelId)!.speed || 800);
    a.hours += hrs;
    a.condition = clamp(a.condition - hrs * 0.05, 0, 100);
    a.location = p.cityId;
    if (!a.crew) L.pilotHours += hrs;
  }
  // work notices when you're gone
  if (p.career.job && q.days > 10) p.career.performance = clamp(p.career.performance - (q.days - 10) * 0.5, 0, 100);
  for (const x of L.people) if (x.alive && (x.rel === "spouse" || x.rel === "partner" || x.rel === "fiance" || x.rel === "child")) x.bond = clamp(x.bond - 2, 0, 100);
  const highlight = vacationEvent(state, q.city.id, q.tier.id, log);
  L.trips.unshift({ id: uid("trip"), year: state.time.year, month: state.time.month, cityId: q.city.id, countryId: q.city.countryId, tier: q.tier.id, days: q.days, cost: q.total, private: q.privateFlight, highlight });
  if (L.trips.length > 40) L.trips.length = 40;
  if (!L.visited.includes(q.city.countryId)) L.visited.push(q.city.countryId);
  checkGlobetrotter(state);
  timeline(state, `${q.days}-day ${q.tier.label.toLowerCase()} vacation in ${q.city.name}, ${country?.name}${q.privateFlight ? " (flew private)" : ""}. ${highlight}`, "travel");
  log.unshift(`Vacation in ${q.city.name}: ${formatINR(q.total)} (flights ${formatINR(q.flight)}, stay ${formatINR(q.hotel)}). ${fx}`);
}

function vacationEvent(state: GameState, cityId: string, tier: string, log: string[]): string {
  const p = state.player;
  const L = getLife(state);
  const x = r(state);
  const city = state.world.cities.find((c) => c.id === cityId)!;
  if (x < 0.12 && !L.people.some((y) => y.alive && (y.rel === "partner" || y.rel === "spouse" || y.rel === "fiance")) && p.age >= 18) {
    const c = newPerson(state, "partner", clamp(p.age + Math.round((r(state) - 0.5) * 8), 18, 80));
    c.bond = 60;
    L.people.push(c);
    log.push(`Holiday romance! You met ${c.name} and you're now dating.`);
    return `Met ${c.name} on the beach.`;
  }
  if (x < 0.2) {
    applyEffects(state, { health: -6, happy: -4 });
    log.push("Food poisoning ruined two days.");
    return "Food poisoning.";
  }
  if (x < 0.26) {
    const lost = Math.min(money(p.finances.cash), 20000 + r(state) * 30000);
    applyEffects(state, { cash: -Math.round(lost), stress: 5 });
    log.push("Pickpocketed in the old town.");
    return "Pickpocketed.";
  }
  if (x < 0.34) {
    p.network.push({ id: uid("npc"), name: `${pick(() => r(state), ["Omar", "Ines", "Felix", "Yuki"])} ${pick(() => r(state), ["Berg", "Costa", "Park"])}`, role: "investor", closeness: 35 });
    log.push("You met an investor at the hotel bar — a valuable contact.");
    return "Met an investor.";
  }
  if (x < 0.38 && tier !== "backpack") {
    const win = round(30000 + r(state) * 200000, -3);
    applyEffects(state, { cash: win, happy: 3 });
    log.push(`Lucky night at the ${city.name} casino: +${formatINR(win)}.`);
    return "Won at the local casino.";
  }
  if (x < 0.4) {
    applyEffects(state, { health: -15 });
    log.push("Scuba accident — decompression sickness. You recovered, slowly.");
    return "Scuba accident.";
  }
  return pick(() => r(state), ["Perfect weather.", "Sunsets you'll never forget.", "You came home a new person.", "Great food, better company.", "You finally slept."]);
}

function checkGlobetrotter(state: GameState) {
  const L = getLife(state);
  if (L.visited.length >= state.world.countries.length) unlock(state, "globetrotter");
}

/* ------------------------------------------------------------ monthly */

export function tickLifestyle(state: GameState) {
  const L = getLife(state);
  if (!L.vehicles.length && !L.aircraft.length) return;
  const p = state.player;
  const d = date(state);
  const country = state.world.countries.find((c) => c.id === p.countryId);
  const econ = country ? clamp(1 + country.gdpGrowth / 15, 0.6, 1.4) : 1;

  let costs = 0;
  for (const v of L.vehicles) {
    const m = vehicleModel(v.modelId);
    if (!m) continue;
    v.value = Math.max(0, round(v.value * (1 - m.dep / 12) * (v.condition < 50 ? 0.998 : 1), 0));
    v.condition = clamp(v.condition - (m.kind === "yacht" ? 0.35 : 0.25), 0, 100);
    let upkeep = (m.price * m.upkeep) / 12;
    if (m.kind === "car" && !L.licenses.includes("driver")) upkeep += 35000; // chauffeur
    v.lastIncome = 0;
    if (m.kind === "yacht" && v.charter && m.charterYield) {
      const season = [6, 7, 8, 12].includes(state.time.month) ? 1.35 : [1, 2, 11].includes(state.time.month) ? 0.6 : 1;
      const util = clamp(season * econ * (0.4 + v.condition / 170) * (0.8 + r(state) * 0.4), 0, 1.6);
      const inc = round(m.price * m.charterYield * util, 0);
      v.condition = clamp(v.condition - 0.6 * util, 0, 100);
      upkeep *= 1.25;
      credit(p, inc, `Charter · ${v.name}`, "charter", d);
      lifeFlow(state, "charter", inc);
      v.lastIncome = inc;
    }
    costs += upkeep;
  }

  for (const a of L.aircraft) {
    const m = aircraftModel(a.modelId);
    if (!m) continue;
    a.value = Math.max(0, round(a.value * (1 - 0.055 / 12) * (a.condition < 40 ? 0.997 : 1), 0));
    const fixed = a.purchasePrice * 0.0009 + a.purchasePrice * 0.0035 / 12; // hangar + hull insurance
    let cost = fixed;
    let income = 0;
    if (a.grounded > 0) a.grounded -= 1;
    if (a.mode === "lease") {
      if (a.grounded <= 0) {
        income = a.value * m.leaseYield;
        a.condition = clamp(a.condition - 0.5, 0, 100);
        a.hours += 180;
        const stress = country && country.gdpGrowth < 0 ? 0.03 : 0.006;
        if (r(state) < stress) {
          a.condition = clamp(a.condition - 12, 0, 100);
          a.grounded = 3;
          a.mode = "private";
          note(state, `${a.lessee} defaulted on the lease of ${a.tail}. The aircraft came back tired and needs a new lessee.`, "bad");
          timeline(state, `Lessee ${a.lessee} defaulted on ${a.tail}.`, "business");
          delete a.lessee;
        }
      }
    } else if (a.mode === "charter") {
      cost += m.crew;
      if (a.grounded <= 0) {
        const city = state.world.cities.find((c) => c.id === a.location);
        const demand = clamp(econ * (0.55 + (city?.tourism ?? 50) / 150 + (city?.businessActivity ?? 60) / 300) * (0.45 + a.condition / 180) * (1 + L.fame / 400) * (0.75 + r(state) * 0.5), 0.1, 2);
        const hours = round(40 * demand, 1);
        income = hours * m.charterHour;
        cost += hours * m.opHour;
        a.hours += hours;
        a.condition = clamp(a.condition - hours * 0.045, 0, 100);
        const incident = a.condition < 45 ? (45 - a.condition) / 900 : 0.0008;
        if (r(state) < incident) {
          const repair = round(a.purchasePrice * 0.06, -3);
          const paid = pay(state, repair, `Incident repairs · ${a.tail}`, "aviation");
          a.condition = clamp(a.condition - 20, 0, 100);
          a.grounded = 2;
          applyEffects(state, { rep: -3 });
          note(state, `Incident on a charter flight: ${a.tail} grounded for 2 months${paid ? `, ${formatINR(repair)} in repairs` : " — you couldn't pay for repairs"}.`, "bad");
          news(state, `Charter jet ${a.tail} diverts after in-flight fault`, "Passengers were unhurt. The operator's maintenance programme is under review.", "aviation", p.countryId, "Bookings dip for the operator.");
        }
      }
    } else if (a.crew) cost += m.crew;
    a.lastIncome = round(income, 0);
    a.lastCost = round(cost, 0);
    if (income > 0) {
      credit(p, income, `${a.mode === "lease" ? "Lease" : "Charter"} · ${a.tail}`, "charter", d);
      lifeFlow(state, "charter", income);
    }
    costs += cost;
  }

  if (costs > 0) {
    const paid = pay(state, round(costs, 0), "Vehicles, yachts & aircraft running costs", "aviation");
    if (!paid) {
      const have = liquidCash(p);
      const short = round(costs - have, 0);
      if (have > 0) pay(state, have, "Vehicles & aircraft running costs (part)", "aviation");
      p.finances.arrears = round(money(p.finances.arrears) + short, 2);
      p.finances.creditScore = clamp(p.finances.creditScore - 6, 300, 900);
      for (const a of L.aircraft) a.condition = clamp(a.condition - 2, 0, 100);
      note(state, `You couldn't cover ${formatINR(short)} of vehicle & aircraft costs. Arrears grow; unpaid mechanics cut corners.`, "bad");
    }
  }
}

export function lifestyleValue(state: GameState): number {
  return lifestyleAssets(state);
}
