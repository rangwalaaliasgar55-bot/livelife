"use client";

// Garage, marina, hangar and travel desk. Cars and yachts are consumption
// (yachts can be chartered out); aircraft are real assets: fly them yourself,
// put them on the charter market, or dry-lease them to an airline.
import { useState } from "react";
import { AIRCRAFT, VEHICLES, VACATION_TIERS, aircraftModel, cityDistanceKm, quoteFlight, quoteVacation, vehicleModel } from "@/lib/sim/lifestyle";
import type { Aircraft, LifeState } from "@/lib/sim/life";
import { liquidCash } from "@/lib/sim/finance";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { formatINR, monthName } from "@/lib/sim/util";
import { Btn, Card, Label, Select } from "./ui";

type Act = (a: PlayerAction) => void;
type Tab = "hangar" | "garage" | "travel";

export function LifestyleView({ state, act, busy }: { state: GameState; act: Act; busy: boolean }) {
  const [tab, setTab] = useState<Tab>("hangar");
  const L = state.life;
  if (!L) return <Card>Loading your life…</Card>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["hangar", `✈ Hangar (${L.aircraft.length})`],
            ["garage", `🚗 Garage & marina (${L.vehicles.length})`],
            ["travel", `🌍 Travel & vacations (${L.visited.length} countries)`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-full border px-4 py-1.5 text-sm ${tab === id ? "border-amber-200/50 bg-amber-200/10 text-amber-200" : "border-white/10 text-[var(--muted)] hover:bg-white/5"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "hangar" ? <Hangar state={state} L={L} act={act} busy={busy} /> : null}
      {tab === "garage" ? <Garage state={state} L={L} act={act} busy={busy} /> : null}
      {tab === "travel" ? <Travel state={state} L={L} act={act} busy={busy} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------ hangar */

function Hangar({ state, L, act, busy }: { state: GameState; L: LifeState; act: Act; busy: boolean }) {
  const cash = liquidCash(state.player);
  const licensed = L.licenses.includes("pilot");
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label>Your fleet</Label>
          <span className="text-xs text-[var(--muted)]">
            Pilot licence: {licensed ? `yes · ${Math.round(L.pilotHours)} h logged` : "no — get one in My Life → Activities to fly single-pilot aircraft yourself"}
          </span>
        </div>
        {!L.aircraft.length ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            No aircraft yet. A private plane is a lifestyle — or a business. On charter, it earns by the flight hour when the economy and tourism are
            strong; on lease, an airline pays a fixed monthly rent and takes on the flying. Either way it depreciates about 5.5% a year and needs
            maintenance.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {L.aircraft.map((a) => (
              <AircraftRow key={a.id} state={state} a={a} act={act} busy={busy} licensed={licensed} />
            ))}
          </div>
        )}
      </Card>
      <Card>
        <Label>Aircraft dealer</Label>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {AIRCRAFT.map((m) => {
            const monthlyLease = m.price * m.leaseYield;
            return (
              <div key={m.id} className="rounded-2xl border border-white/10 p-3">
                <div className="flex justify-between gap-2">
                  <p className="font-medium">{m.name}</p>
                  <p className="text-sm text-amber-200">{formatINR(m.price)}</p>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {m.cls} · {m.seats} seats · {m.rangeKm.toLocaleString()} km · {m.speed} km/h
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">{m.blurb}</p>
                <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
                  <span>Charter {formatINR(m.charterHour)}/h</span>
                  <span>Op. cost {formatINR(m.opHour)}/h</span>
                  <span>Crew {formatINR(m.crew)}/mo</span>
                  <span>Lease ≈ {formatINR(monthlyLease)}/mo</span>
                </div>
                <p className="mt-1 text-[10px] text-[var(--muted)]">{m.singlePilot ? "Single-pilot: you can fly it with a licence." : "Needs a professional two-pilot crew."}</p>
                <Btn className="mt-2 w-full" disabled={busy || cash < m.price} onClick={() => act({ type: "buyAircraft", modelId: m.id })}>
                  {cash < m.price ? `Need ${formatINR(m.price - cash)} more` : "Buy"}
                </Btn>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function AircraftRow({ state, a, act, busy, licensed }: { state: GameState; a: Aircraft; act: Act; busy: boolean; licensed: boolean }) {
  const m = aircraftModel(a.modelId)!;
  const [dest, setDest] = useState("");
  const here = state.world.cities.find((c) => c.id === a.location);
  const destCity = state.world.cities.find((c) => c.id === dest);
  const q = dest ? quoteFlight(state, a, state.player.cityId, dest) : null;
  const ferry = dest && a.location !== state.player.cityId ? quoteFlight(state, a, a.location, state.player.cityId) : null;
  return (
    <div className="rounded-2xl border border-white/10 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {a.name} <span className="font-mono text-xs text-amber-200">{a.tail}</span>
        </p>
        <p className="text-sm">
          worth <span className="text-amber-200">{formatINR(a.value)}</span>{" "}
          <span className="text-xs text-[var(--muted)]">(paid {formatINR(a.purchasePrice)})</span>
        </p>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
        <span>📍 {here?.name ?? "?"}</span>
        <span>
          Condition <b className={a.condition < 50 ? "text-rose-300" : ""}>{Math.round(a.condition)}%</b>
        </span>
        <span>{Math.round(a.hours).toLocaleString()} flight hours</span>
        <span>
          Last month: <span className="text-teal-300">+{formatINR(a.lastIncome)}</span> / <span className="text-rose-300">−{formatINR(a.lastCost)}</span>
        </span>
        <span>{a.grounded > 0 ? <b className="text-rose-300">Grounded {a.grounded} mo</b> : a.mode === "lease" ? `Leased to ${a.lessee}` : a.crew ? "Crew on retainer" : "You fly it"}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="tick mr-1">Use</span>
        {(["private", "charter", "lease"] as const).map((mode) => (
          <button
            key={mode}
            disabled={busy}
            onClick={() => act({ type: "aircraftMode", id: a.id, mode })}
            className={`rounded-full border px-3 py-1 text-xs capitalize ${a.mode === mode ? "border-amber-200/60 bg-amber-200/10 text-amber-200" : "border-white/10 text-[var(--muted)] hover:bg-white/5"}`}
          >
            {mode === "charter" ? "Charter it out" : mode === "lease" ? "Lease to airline" : "Private"}
          </button>
        ))}
        <span className="mx-1 text-white/20">|</span>
        {a.mode !== "lease" ? (
          <button
            disabled={busy || (a.crew && (!licensed || !m.singlePilot || a.mode === "charter"))}
            onClick={() => act({ type: "aircraftCrew", id: a.id, crew: !a.crew })}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-[var(--muted)] hover:bg-white/5 disabled:opacity-40"
            title={a.crew ? "Release the crew and fly it yourself (licence + single-pilot aircraft needed)" : "Hire a crew"}
          >
            {a.crew ? `Release crew (−${formatINR(m.crew)}/mo)` : "Hire crew"}
          </button>
        ) : null}
        <button disabled={busy || a.condition >= 99} onClick={() => act({ type: "maintainAircraft", id: a.id })} className="rounded-full border border-white/10 px-3 py-1 text-xs text-[var(--muted)] hover:bg-white/5 disabled:opacity-40">
          Full maintenance check
        </button>
        <button disabled={busy} onClick={() => act({ type: "sellAircraft", id: a.id })} className="rounded-full border border-rose-300/30 px-3 py-1 text-xs text-rose-200 hover:bg-rose-500/10">
          Sell
        </button>
      </div>
      {a.mode !== "lease" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="tick">Fly to</span>
          <div className="w-56">
            <Select value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">— choose a city —</option>
              {state.world.cities
                .filter((c) => c.id !== state.player.cityId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {state.world.countries.find((x) => x.id === c.countryId)?.name} · {cityDistanceKm(state, state.player.cityId, c.id).toLocaleString()} km
                  </option>
                ))}
            </Select>
          </div>
          {q && destCity ? (
            <>
              <span className="text-xs text-[var(--muted)]">
                {q.ok
                  ? `${q.km.toLocaleString()} km · ${q.hours} h${q.stops ? ` · ${q.stops} fuel stop(s)` : ""} · ${formatINR(q.cost + (ferry?.cost ?? 0))}${ferry ? " incl. ferry to you" : ""}`
                  : q.why}
              </span>
              <Btn disabled={busy || !q.ok} onClick={() => act({ type: "flyAircraft", id: a.id, cityId: dest })}>
                Fly & relocate
              </Btn>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ garage */

function Garage({ state, L, act, busy }: { state: GameState; L: LifeState; act: Act; busy: boolean }) {
  const cash = liquidCash(state.player);
  const [kind, setKind] = useState<"car" | "bike" | "yacht">("car");
  return (
    <div className="space-y-4">
      <Card>
        <Label>Owned</Label>
        {!L.vehicles.length ? <p className="mt-2 text-sm text-[var(--muted)]">Nothing in the garage. Cars lift happiness, supercars lift fame; yachts can be chartered out.</p> : null}
        <div className="mt-2 divide-y divide-white/5">
          {L.vehicles.map((v) => {
            const m = vehicleModel(v.modelId);
            return (
              <div key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="text-2xl">{v.kind === "yacht" ? "🛥" : v.kind === "bike" ? "🏍" : "🚗"}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{v.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    Worth {formatINR(v.value)} (paid {formatINR(v.price)}) · condition {Math.round(v.condition)}% · upkeep ≈ {formatINR(((m?.upkeep ?? 0.05) * v.price) / 12)}/mo
                    {v.kind === "yacht" && v.charter ? ` · charter last month +${formatINR(v.lastIncome)}` : ""}
                  </p>
                </div>
                {v.kind === "yacht" ? (
                  <Btn kind="ghost" disabled={busy} onClick={() => act({ type: "yachtCharter", id: v.id })}>
                    {v.charter ? "Stop charter" : "Charter out"}
                  </Btn>
                ) : null}
                <Btn kind="ghost" disabled={busy || v.condition >= 99} onClick={() => act({ type: "repairVehicle", id: v.id })}>
                  Repair
                </Btn>
                <Btn kind="danger" disabled={busy} onClick={() => act({ type: "sellVehicle", id: v.id })}>
                  Sell
                </Btn>
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Showroom</Label>
          <div className="flex gap-1">
            {(["car", "bike", "yacht"] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-xs capitalize ${kind === k ? "border-amber-200/60 text-amber-200" : "border-white/10 text-[var(--muted)]"}`}>
                {k === "yacht" ? "Yachts" : k === "bike" ? "Bikes" : "Cars"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {VEHICLES.filter((v) => v.kind === kind).map((m) => (
            <div key={m.id} className="rounded-2xl border border-white/10 p-3">
              <div className="flex justify-between gap-2">
                <p className="font-medium">{m.name}</p>
                <p className="text-sm text-amber-200">{formatINR(m.price)}</p>
              </div>
              <p className="text-xs text-[var(--muted)]">{m.blurb}</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                Happiness +{m.happy}
                {m.fame ? ` · Fame +${m.fame}` : ""} · {m.dep < 0 ? `appreciates ~${Math.round(-m.dep * 100)}%/yr` : `loses ~${Math.round(m.dep * 100)}%/yr`} · upkeep{" "}
                {Math.round(m.upkeep * 100)}%/yr
                {m.charterYield ? ` · charter up to ${formatINR(m.price * m.charterYield)}/mo` : ""}
              </p>
              <Btn className="mt-2 w-full" disabled={busy || cash < m.price} onClick={() => act({ type: "buyVehicle", modelId: m.id })}>
                {cash < m.price ? `Need ${formatINR(m.price - cash)} more` : "Buy"}
              </Btn>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ travel */

function Travel({ state, L, act, busy }: { state: GameState; L: LifeState; act: Act; busy: boolean }) {
  const cities = state.world.cities;
  const [dest, setDest] = useState(cities.find((c) => c.id !== state.player.cityId)?.id ?? "");
  const [tier, setTier] = useState<string>("standard");
  const [days, setDays] = useState(7);
  const [plane, setPlane] = useState("");
  const q = dest ? quoteVacation(state, dest, tier, days, plane || undefined) : null;
  const usable = L.aircraft.filter((a) => a.mode !== "lease" && a.grounded <= 0);
  const xs = cities.map((c) => c.x);
  const ys = cities.map((c) => c.y);
  const minX = Math.min(...xs) - 4;
  const maxX = Math.max(...xs) + 4;
  const minY = Math.min(...ys) - 4;
  const maxY = Math.max(...ys) + 4;
  const sx = (x: number) => ((x - minX) / (maxX - minX)) * 100;
  const sy = (y: number) => ((y - minY) / (maxY - minY)) * 100;
  const home = cities.find((c) => c.id === state.player.cityId);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <Label>Where to?</Label>
        <div className="grid-map relative mt-3 h-72 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {home && dest
              ? (() => {
                  const d = cities.find((c) => c.id === dest)!;
                  return <line x1={sx(home.x)} y1={sy(home.y)} x2={sx(d.x)} y2={sy(d.y)} stroke="#e4c37a" strokeWidth={0.4} strokeDasharray="1.5 1" vectorEffect="non-scaling-stroke" />;
                })()
              : null}
          </svg>
          {cities.map((c) => {
            const visited = L.visited.includes(c.countryId);
            const isHome = c.id === state.player.cityId;
            return (
              <button
                key={c.id}
                onClick={() => !isHome && setDest(c.id)}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                style={{ left: `${sx(c.x)}%`, top: `${sy(c.y)}%` }}
                title={`${c.name} · tourism ${Math.round(c.tourism)}`}
              >
                <span className={`mx-auto block h-3 w-3 rounded-full border ${isHome ? "border-teal-200 bg-teal-300" : dest === c.id ? "border-amber-100 bg-amber-300" : visited ? "border-amber-200/60 bg-amber-200/30" : "border-white/40 bg-white/10"}`} />
                <span className={`mt-0.5 block whitespace-nowrap text-[10px] ${dest === c.id ? "text-amber-200" : "text-[var(--muted)]"}`}>{c.name}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">● teal = you · gold = selected · filled = countries you&apos;ve visited ({L.visited.length}/{state.world.countries.length})</p>
        <div className="mt-4">
          <Label>Past trips</Label>
          {!L.trips.length ? <p className="mt-1 text-sm text-[var(--muted)]">No vacations yet. A week away lowers stress and lifts happiness — and sometimes something happens.</p> : null}
          <div className="mt-2 space-y-1 text-sm">
            {L.trips.slice(0, 10).map((t) => (
              <p key={t.id}>
                <span className="text-[var(--muted)]">
                  {monthName(t.month).slice(0, 3)} {t.year}
                </span>{" "}
                · {cities.find((c) => c.id === t.cityId)?.name} · {t.days} days {t.tier}
                {t.private ? " ✈ private" : ""} · {formatINR(t.cost)} <span className="text-xs text-[var(--muted)]">— {t.highlight}</span>
              </p>
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <Label>Plan the trip</Label>
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="tick mb-1">Destination</p>
            <Select value={dest} onChange={(e) => setDest(e.target.value)}>
              {cities
                .filter((c) => c.id !== state.player.cityId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {state.world.countries.find((x) => x.id === c.countryId)?.name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <p className="tick mb-1">Style</p>
            <div className="grid grid-cols-2 gap-1">
              {VACATION_TIERS.map((t) => (
                <button key={t.id} onClick={() => setTier(t.id)} className={`rounded-xl border px-2 py-1.5 text-xs ${tier === t.id ? "border-amber-200/60 bg-amber-200/10 text-amber-200" : "border-white/10 text-[var(--muted)]"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="tick mb-1">Days: {days}</p>
            <input type="range" min={3} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <p className="tick mb-1">Getting there</p>
            <Select value={plane} onChange={(e) => setPlane(e.target.value)}>
              <option value="">Commercial flights</option>
              {usable.map((a) => (
                <option key={a.id} value={a.id}>
                  My {a.name} ({a.tail})
                </option>
              ))}
            </Select>
          </div>
          {q ? (
            <div className="rounded-2xl border border-white/10 p-3 text-xs">
              <div className="flex justify-between">
                <span>Distance</span>
                <span>{q.km.toLocaleString()} km</span>
              </div>
              <div className="flex justify-between">
                <span>Flights {q.privateFlight ? "(your aircraft, fuel & fees)" : "(return)"}</span>
                <span>{formatINR(q.flight)}</span>
              </div>
              <div className="flex justify-between">
                <span>Stay · {q.days} nights</span>
                <span>{formatINR(q.hotel)}</span>
              </div>
              <div className="flex justify-between">
                <span>Activities & food</span>
                <span>{formatINR(q.activities)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-white/10 pt-1 text-sm">
                <span>Total</span>
                <span className="text-amber-200">{formatINR(q.total)}</span>
              </div>
              {q.why ? <p className="mt-1 text-rose-300">{q.why}</p> : null}
              <p className="mt-2 text-[var(--muted)]">
                Happiness +{Math.round(q.tier.happy * Math.min(1.4, q.days / 10))}, stress {Math.round(q.tier.stress * Math.min(1.4, q.days / 10))}. Over 10 days away,
                your boss notices.
              </p>
            </div>
          ) : null}
          <Btn className="w-full" disabled={busy || !q || (Boolean(plane) && !q.privateFlight)} onClick={() => act({ type: "vacation", cityId: dest, tier, days, aircraftId: plane || undefined })}>
            Book it
          </Btn>
        </div>
      </Card>
    </div>
  );
}
