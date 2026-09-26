"use client";

// "My Life" — the BitLife screen. A big Age-Up button, the story of your life
// grouped by age, your stat bars, every relationship with its own bond meter
// and a menu of interactions, and the activity board.
import { useState } from "react";
import { ACTIVITIES, activityCost, partnerOf, relLabel, type InteractKind, type LifeState, type Person } from "@/lib/sim/life";
import { lifeEventCount } from "@/lib/sim/lifeevents";
import { liquidCash } from "@/lib/sim/finance";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { formatINR, monthName } from "@/lib/sim/util";
import { Btn, Card, Label } from "./ui";

type Act = (a: PlayerAction) => void;

const KIND_ICON: Record<string, string> = {
  life: "✦",
  family: "⌂",
  love: "♥",
  crime: "⚖",
  health: "✚",
  career: "▲",
  consequence: "↻",
  travel: "✈",
  business: "◆",
  education: "✎",
  finance: "₹",
  goal: "◎",
};

function Bar({ label, value, tone }: { label: string; value: number; tone?: "rose" | "teal" | "gold" | "violet" }) {
  const v = Math.max(0, Math.min(100, value));
  const color =
    tone === "rose"
      ? "linear-gradient(90deg,#f0a0a0,#e46a6a)"
      : tone === "violet"
        ? "linear-gradient(90deg,#b9a3ff,#7e6ee0)"
        : tone === "gold"
          ? "linear-gradient(90deg,#f3e2b0,#d7b15a)"
          : v < 30
            ? "linear-gradient(90deg,#f0a0a0,#e46a6a)"
            : v < 60
              ? "linear-gradient(90deg,#f3e2b0,#d7b15a)"
              : "linear-gradient(90deg,#7ee0c6,#48c09e)";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-[var(--muted)]">{label}</span>
        <span>{Math.round(v)}%</span>
      </div>
      <div className="bar mt-1">
        <span style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}

export function LifeView({ state, act, busy, setView }: { state: GameState; act: Act; busy: boolean; setView?: (v: string) => void }) {
  const L = state.life;
  const [tab, setTab] = useState<"story" | "people" | "activities">("story");
  if (!L) {
    return (
      <Card>
        <p className="text-sm text-[var(--muted)]">Your life story begins with your next action — press + Age or live a month.</p>
        <Btn className="mt-3" disabled={busy} onClick={() => act({ type: "ageUp" })}>
          + Age
        </Btn>
      </Card>
    );
  }
  const p = state.player;
  const pending = state.pending.length > 0;
  const prison = L.prison && L.prison.monthsLeft > 0 ? L.prison : null;
  const partner = partnerOf(L);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        {/* the Age-Up hero */}
        <Card className="relative overflow-hidden">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-amber-200/5 blur-2xl" />
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-20 w-20 place-items-center rounded-full border border-amber-200/30 bg-amber-200/5">
              <div className="text-center">
                <p className="font-serif text-3xl leading-none">{p.age}</p>
                <p className="tick mt-1 text-[9px]">years</p>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-serif text-2xl">{p.name}</p>
              <p className="text-sm text-[var(--muted)]">
                {p.alive ? (prison ? `Inmate at ${prison.facility}` : p.career.job?.title ?? (p.age < 18 ? "Student" : "Unemployed")) : "Deceased"}
                {partner ? ` · ${relLabel(partner)}: ${partner.name.split(" ")[0]}` : " · Single"}
                {` · ${monthName(state.time.month)} ${state.time.year}`}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Birthday in {monthName(p.birthMonth)}. {lifeEventCount()} kinds of life events can find you — every choice is remembered.
              </p>
            </div>
            <button
              disabled={busy || pending || !p.alive}
              onClick={() => act({ type: "ageUp" })}
              className="group rounded-full bg-gradient-to-br from-teal-300 to-emerald-500 px-7 py-4 text-lg font-semibold text-black shadow-[0_10px_30px_rgba(126,224,198,0.25)] transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40"
              title="Live until your next birthday. Life events will stop you along the way."
            >
              + Age
            </button>
          </div>
          {prison ? (
            <div className="mt-4 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-3 text-sm">
              <p className="font-medium text-rose-200">
                Serving {Math.ceil(prison.totalMonths / 12) > 1 ? `${(prison.totalMonths / 12).toFixed(1)} years` : `${prison.totalMonths} months`} for {prison.crime}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {prison.monthsLeft} months left · behaviour {Math.round(prison.behavior)}/100 (good behaviour means early parole). Job income, travel,
                business moves and the casino are closed to you. Try the prison activities.
              </p>
              <div className="bar mt-2">
                <span style={{ width: `${100 - (prison.monthsLeft / Math.max(1, prison.totalMonths)) * 100}%` }} />
              </div>
            </div>
          ) : null}
          {L.illnesses.length || L.addiction.alcohol > 20 || L.addiction.gambling > 20 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {L.illnesses.map((i) => (
                <span key={i.id} className={`rounded-full border px-2 py-0.5 ${i.fatal ? "border-rose-400/50 text-rose-200" : "border-amber-200/30 text-amber-200"}`}>
                  {i.name} · {Math.round(i.severity)}%
                </span>
              ))}
              {L.addiction.alcohol > 20 ? <span className="rounded-full border border-rose-300/30 px-2 py-0.5 text-rose-200">Drinking habit {Math.round(L.addiction.alcohol)}%</span> : null}
              {L.addiction.gambling > 20 ? <span className="rounded-full border border-rose-300/30 px-2 py-0.5 text-rose-200">Gambling habit {Math.round(L.addiction.gambling)}%</span> : null}
            </div>
          ) : null}
        </Card>

        <div className="flex gap-2">
          {(["story", "people", "activities"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full border px-4 py-1.5 text-sm capitalize ${tab === t ? "border-amber-200/50 bg-amber-200/10 text-amber-200" : "border-white/10 text-[var(--muted)] hover:bg-white/5"}`}
            >
              {t === "people" ? `Relationships (${L.people.filter((x) => x.alive).length})` : t}
            </button>
          ))}
        </div>

        {tab === "story" ? <Story state={state} /> : null}
        {tab === "people" ? <People state={state} L={L} act={act} busy={busy} /> : null}
        {tab === "activities" ? <Activities state={state} L={L} act={act} busy={busy} setView={setView} /> : null}
      </div>

      {/* right rail: stats */}
      <div className="space-y-4">
        <Card>
          <Label>Stats</Label>
          <div className="mt-3 space-y-3">
            <Bar label="Happiness" value={p.happiness} />
            <Bar label="Health" value={p.health} />
            <Bar label="Smarts" value={L.smarts} tone="violet" />
            <Bar label="Looks" value={L.looks} tone="gold" />
            <Bar label="Karma" value={L.karma} tone="teal" />
            <Bar label="Fame" value={L.fame} tone="gold" />
            <Bar label="Stress" value={p.stress} tone="rose" />
          </div>
        </Card>
        <Card>
          <Label>At a glance</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <Mini k="Cash" v={formatINR(liquidCash(p))} />
            <Mini k="Countries" v={String(L.visited.length)} />
            <Mini k="Pets" v={String(L.pets.filter((x) => x.alive).length)} />
            <Mini k="Children" v={String(L.people.filter((x) => x.rel === "child" && x.alive).length)} />
            <Mini k="Vehicles" v={String(L.vehicles.length)} />
            <Mini k="Aircraft" v={String(L.aircraft.length)} />
            <Mini k="Licences" v={L.licenses.length ? L.licenses.join(", ") : "none"} />
            <Mini k="Record" v={L.record.length ? `${L.record.length} entr${L.record.length === 1 ? "y" : "ies"}` : "clean"} />
          </div>
          {L.consequences.length ? (
            <p className="mt-3 text-xs text-[var(--muted)]">
              ↻ {L.consequences.length} past decision{L.consequences.length === 1 ? " is" : "s are"} still playing out. You won&apos;t know when they land.
            </p>
          ) : null}
          {L.record.length ? (
            <div className="mt-3">
              <p className="tick">Criminal record</p>
              {L.record.slice(-4).map((r, i) => (
                <p key={i} className="text-xs text-rose-200/80">
                  · {r}
                </p>
              ))}
            </div>
          ) : null}
        </Card>
        {L.pets.some((x) => x.alive) ? (
          <Card>
            <Label>Pets</Label>
            {L.pets
              .filter((x) => x.alive)
              .map((pet) => (
                <div key={pet.id} className="mt-2">
                  <div className="flex justify-between text-sm">
                    <span>
                      {pet.name} <span className="text-xs text-[var(--muted)]">· {pet.species}, {pet.age}y</span>
                    </span>
                  </div>
                  <div className="bar mt-1">
                    <span style={{ width: `${pet.bond}%` }} />
                  </div>
                </div>
              ))}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl border border-white/10 px-2 py-1.5">
      <p className="tick text-[9px]">{k}</p>
      <p className="truncate">{v}</p>
    </div>
  );
}

function Story({ state }: { state: GameState }) {
  // (state is mutated in place by the engine, so no memo — recompute each render)
  const byAge = new Map<number, typeof state.timeline>();
  for (const e of state.timeline) {
    const arr = byAge.get(e.age) ?? [];
    arr.push(e);
    byAge.set(e.age, arr);
  }
  const groups = [...byAge.entries()].sort((a, b) => b[0] - a[0]);
  if (!groups.length) return <Card>Nothing has happened yet. Press + Age.</Card>;
  return (
    <Card>
      <div className="max-h-[70vh] space-y-5 overflow-auto pr-2">
        {groups.map(([age, items]) => (
          <div key={age}>
            <p className="font-serif text-lg text-amber-200">Age {age}</p>
            <div className="mt-1 space-y-1 border-l border-white/10 pl-3">
              {items.map((e) => (
                <p key={e.id} className="text-sm leading-6">
                  <span className="mr-2 inline-block w-4 text-center text-[var(--muted)]">{KIND_ICON[e.kind] ?? "·"}</span>
                  {e.text}
                  <span className="ml-2 text-[10px] text-[var(--muted)]">
                    {monthName(e.month).slice(0, 3)} {e.year}
                  </span>
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

const GROUP_ORDER: { title: string; rels: Person["rel"][] }[] = [
  { title: "Partner", rels: ["spouse", "fiance", "partner"] },
  { title: "Parents", rels: ["mother", "father"] },
  { title: "Children", rels: ["child"] },
  { title: "Siblings", rels: ["sibling"] },
  { title: "Friends", rels: ["friend"] },
  { title: "Exes & enemies", rels: ["ex", "enemy"] },
];

function interactionsFor(t: Person, age: number): { kind: InteractKind; label: string; danger?: boolean }[] {
  const base: { kind: InteractKind; label: string; danger?: boolean }[] = [
    { kind: "time", label: "Spend time" },
    { kind: "talk", label: "Conversation" },
    { kind: "compliment", label: "Compliment" },
    { kind: "gift", label: "Gift" },
  ];
  if (t.rel === "ex" || t.rel === "enemy") return [{ kind: "talk", label: "Conversation" }, { kind: "reconcile", label: "Reconcile" }, { kind: "insult", label: "Insult", danger: true }];
  if (age >= 16 && t.age >= 16) base.push({ kind: "money", label: "Ask for money" });
  base.push({ kind: "vacation", label: "Holiday together" });
  if (t.rel === "partner" || t.rel === "fiance" || t.rel === "spouse") {
    base.push({ kind: "date", label: "Date night" });
    base.push({ kind: "baby", label: "Try for a baby" });
  }
  if (t.rel === "partner") base.push({ kind: "propose", label: "Propose 💍" });
  base.push({ kind: "argue", label: "Argue", danger: true }, { kind: "insult", label: "Insult", danger: true });
  if (t.rel === "partner" || t.rel === "fiance") base.push({ kind: "breakup", label: "Break up", danger: true });
  if (t.rel === "spouse") base.push({ kind: "divorce", label: "Divorce", danger: true });
  return base;
}

function People({ state, L, act, busy }: { state: GameState; L: LifeState; act: Act; busy: boolean }) {
  const p = state.player;
  const [open, setOpen] = useState<string | null>(null);
  const [prenup, setPrenup] = useState(true);
  const living = L.people.filter((x) => x.alive);
  const dead = L.people.filter((x) => !x.alive);
  const partner = partnerOf(L);
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Love life</Label>
          <div className="flex flex-wrap gap-2">
            <Btn kind="ghost" disabled={busy || p.age < 16} onClick={() => act({ type: "findLove", where: "app" })}>
              Dating app (₹999)
            </Btn>
            <Btn kind="ghost" disabled={busy || p.age < 18} onClick={() => act({ type: "findLove", where: "club" })}>
              Go out
            </Btn>
            <Btn kind="ghost" disabled={busy || !p.career.job} onClick={() => act({ type: "findLove", where: "work" })}>
              Office romance
            </Btn>
          </div>
        </div>
        {partner ? <p className="mt-2 text-xs text-[var(--muted)]">You&apos;re with {partner.name}. Dating someone else is cheating — and it can be discovered.</p> : null}
        {L.candidates.length ? (
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {L.candidates.map((c) => (
              <div key={c.id} className="rounded-2xl border border-white/10 p-3">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {c.age} · {c.job}
                </p>
                <div className="mt-2 space-y-1 text-xs">
                  <Bar label="Looks" value={c.looks} tone="gold" />
                  <Bar label="Smarts" value={c.smarts} tone="violet" />
                  <Bar label="Their interest" value={c.interest ?? 40} tone="teal" />
                </div>
                <Btn className="mt-2 w-full" disabled={busy} onClick={() => act({ type: "askOut", candidateId: c.id })}>
                  Ask out
                </Btn>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
          <span className="tick self-center">Adopt</span>
          {(["dog", "cat", "parrot", "horse", "tortoise"] as const).map((s) => (
            <Btn key={s} kind="ghost" disabled={busy} onClick={() => act({ type: "adoptPet", species: s })}>
              {s}
            </Btn>
          ))}
          <Btn kind="ghost" disabled={busy || p.age < 25} onClick={() => act({ type: "adoptChild" })}>
            a child
          </Btn>
        </div>
      </Card>

      {GROUP_ORDER.map((g) => {
        const list = living.filter((x) => g.rels.includes(x.rel));
        if (!list.length) return null;
        return (
          <Card key={g.title}>
            <Label>{g.title}</Label>
            <div className="mt-2 divide-y divide-white/5">
              {list.map((t) => (
                <div key={t.id} className="py-2">
                  <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === t.id ? null : t.id)}>
                    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm ${t.gender === "m" ? "bg-sky-400/15 text-sky-200" : "bg-pink-400/15 text-pink-200"}`}>
                      {t.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="truncate">
                          {t.name} <span className="text-xs text-[var(--muted)]">· {relLabel(t)}, {t.age}</span>
                        </span>
                        <span className="text-xs text-[var(--muted)]">{t.job}</span>
                      </div>
                      <div className="bar mt-1">
                        <span
                          style={{
                            width: `${t.bond}%`,
                            background: t.bond < 25 ? "linear-gradient(90deg,#f0a0a0,#e46a6a)" : undefined,
                          }}
                        />
                      </div>
                    </div>
                  </button>
                  {open === t.id ? (
                    <div className="mt-2 pl-12">
                      <p className="text-xs text-[var(--muted)]">
                        Bond {Math.round(t.bond)}/100 · looks {t.looks} · smarts {t.smarts} · wealth {formatINR(t.wealth)} · last real time together{" "}
                        {t.lastSeen === state.time.year ? "this year" : `in ${t.lastSeen}`}
                        {t.prenup ? " · prenup signed" : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {interactionsFor(t, p.age).map((i) => (
                          <button
                            key={i.kind}
                            disabled={busy}
                            onClick={() => act({ type: "interact", personId: t.id, kind: i.kind })}
                            className={`rounded-full border px-3 py-1 text-xs ${i.danger ? "border-rose-300/30 text-rose-200 hover:bg-rose-500/10" : "border-white/10 hover:bg-white/5"}`}
                          >
                            {i.label}
                          </button>
                        ))}
                      </div>
                      {t.rel === "fiance" ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/20 p-2">
                          <label className="flex items-center gap-1 text-xs">
                            <input type="checkbox" checked={prenup} onChange={(e) => setPrenup(e.target.checked)} /> Prenup
                          </label>
                          <Btn disabled={busy} onClick={() => act({ type: "interact", personId: t.id, kind: "marry", prenup, wedding: "small" })}>
                            Simple wedding
                          </Btn>
                          <Btn disabled={busy} onClick={() => act({ type: "interact", personId: t.id, kind: "marry", prenup, wedding: "big" })}>
                            Grand wedding
                          </Btn>
                          <Btn kind="ghost" disabled={busy} onClick={() => act({ type: "interact", personId: t.id, kind: "elope", prenup })}>
                            Elope
                          </Btn>
                        </div>
                      ) : null}
                    <GiftBox state={state} act={act} busy={busy} person={t} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      {dead.length ? (
        <Card>
          <Label>In memory</Label>
          <p className="mt-2 text-sm text-[var(--muted)]">{dead.map((d) => `${d.name} (${relLabel(d)}, ${d.age})`).join(" · ")}</p>
        </Card>
      ) : null}
    </div>
  );
}

function Activities({ state, L, act, busy, setView }: { state: GameState; L: LifeState; act: Act; busy: boolean; setView?: (v: string) => void }) {
  const p = state.player;
  const jailed = Boolean(L.prison && L.prison.monthsLeft > 0);
  const list = ACTIVITIES.filter((a) => (jailed ? a.prisonOnly : !a.prisonOnly));
  const groups = [...new Set(list.map((a) => a.group))];
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g}>
          <Label>{g}</Label>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {list
              .filter((a) => a.group === g)
              .map((a) => {
                const cost = activityCost(state, a);
                const used = L.usesYear === state.time.year ? L.uses[a.id] ?? 0 : 0;
                const young = a.minAge != null && p.age < a.minAge;
                const has = (a.id === "driver" || a.id === "pilot" || a.id === "boat") && L.licenses.includes(a.id);
                return (
                  <button
                    key={a.id}
                    disabled={busy || young || has}
                    onClick={() => act({ type: "activity", id: a.id })}
                    className="rounded-2xl border border-white/10 p-3 text-left transition hover:border-amber-200/30 hover:bg-white/5 disabled:opacity-40"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{a.label}</span>
                      <span className="text-xs text-amber-200">{cost ? formatINR(cost) : "free"}</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {has ? "Licence held." : young ? `Age ${a.minAge}+` : a.hint}
                      {used ? ` · done ${used}× this year` : ""}
                    </p>
                  </button>
                );
              })}
          </div>
        </Card>
      ))}
      {!jailed && setView ? (
        <Card>
          <Label>More of life</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="ghost" onClick={() => setView("lifestyle")}>
              Cars, yachts & aircraft
            </Btn>
            <Btn kind="ghost" onClick={() => setView("lifestyle")}>
              Plan a vacation
            </Btn>
            <Btn kind="ghost" onClick={() => setView("casino")}>
              Casino
            </Btn>
            <Btn kind="ghost" onClick={() => setView("life")}>
              Education & health
            </Btn>
            <Btn kind="ghost" onClick={() => setView("career")}>
              Jobs
            </Btn>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Give someone money, a car, a property or shares. Big gifts to people outside
 *  the family carry a 10% gift duty. */
function GiftBox({ state, act, busy, person }: { state: GameState; act: (a: PlayerAction) => void; busy: boolean; person: Person }) {
  const [kind, setKind] = useState<"cash" | "vehicle" | "property" | "shares">("cash");
  const [amount, setAmount] = useState("10000");
  const [ref, setRef] = useState("");
  const vehicles = state.life?.vehicles ?? [];
  const props = state.player.properties.filter((x) => !x.mortgaged);
  const holdings = state.player.holdings;
  const options =
    kind === "vehicle"
      ? vehicles.map((v) => ({
          id: v.id,
          label: `${v.name} · ${formatINR(v.value)}`,
        }))
      : kind === "property"
        ? props.map((x) => ({
            id: x.id,
            label: `${x.name} · ${formatINR(x.value)}`,
          }))
        : kind === "shares"
          ? holdings.map((h) => ({
              id: h.ticker,
              label: `${h.ticker} · ${h.shares} shares`,
            }))
          : [];
  const pick = ref && options.some((o) => o.id === ref) ? ref : (options[0]?.id ?? "");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 p-2 text-xs">
      <span className="tick">Gift</span>
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded-lg border border-white/10 bg-[#0b0e14] px-2 py-1">
        <option value="cash">Cash</option>
        <option value="vehicle">A vehicle</option>
        <option value="property">A property</option>
        <option value="shares">Shares</option>
      </select>
      {kind !== "cash" ? (
        <select value={pick} onChange={(e) => setRef(e.target.value)} className="max-w-[220px] rounded-lg border border-white/10 bg-[#0b0e14] px-2 py-1">
          {options.length ? (
            options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))
          ) : (
            <option value="">nothing to give</option>
          )}
        </select>
      ) : null}
      {kind === "cash" || kind === "shares" ? (
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="numeric"
          placeholder={kind === "cash" ? "₹" : "shares"}
          className="w-28 rounded-lg border border-white/10 bg-[#0b0e14] px-2 py-1"
        />
      ) : null}
      <button
        disabled={busy || (kind !== "cash" && !pick)}
        onClick={() =>
          act({
            type: "biz",
            op: "gift",
            id: person.id,
            args: {
              kind,
              ref: pick,
              amount: Number(amount.replace(/[,₹\s]/g, "")) || 0,
            },
          })
        }
        className="rounded-full border border-amber-200/40 px-3 py-1 text-amber-200 hover:bg-amber-200/10 disabled:opacity-40"
      >
        Give to {person.name.split(" ")[0]}
      </button>
    </div>
  );
}
