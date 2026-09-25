"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildCalendar, CHALLENGE_DEFS, GOAL_DEFS, whyMarket, whyNetWorth } from "@/lib/sim/advanced";
import { applyLocal, loadLife, persistNow, persistenceStatus } from "@/lib/store";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { businessEquity, computeNetWorth, liquidCash, portfolioValue, propertyValue, totalDebt } from "@/lib/sim/finance";
import { formatDate, formatINR, formatPct, monthName } from "@/lib/sim/util";
import { Avatar, Btn, Card, Label, Modal, Spark, Stat } from "./ui";
import { Panels } from "./panels";
import { LifeView } from "./LifeView";
import { DebugModal, HowItWorks, LineListModal, NotifBell, SpeedControls, speedMs, speedMonths, TreasuryModal, type Speed } from "./overlays";

const NAV: { id: string; label: string; group: string }[] = [
  { id: "mylife", label: "My Life", group: "You" },
  { id: "dashboard", label: "Control", group: "You" },
  { id: "life", label: "Education & Health", group: "You" },
  { id: "career", label: "Career & Skills", group: "You" },
  { id: "staff", label: "Staff & Advisors", group: "You" },
  { id: "bank", label: "Banking", group: "Capital" },
  { id: "markets", label: "Markets", group: "Capital" },
  { id: "property", label: "Property", group: "Capital" },
  { id: "business", label: "Companies", group: "Capital" },
  { id: "takeovers", label: "Stakes & Takeovers", group: "Capital" },
  { id: "lifestyle", label: "Jets, Cars & Travel", group: "Capital" },
  { id: "opps", label: "Opportunities", group: "Capital" },
  { id: "world", label: "World Map", group: "World" },
  { id: "politics", label: "Politics", group: "World" },
  { id: "concord", label: "Concord", group: "World" },
  { id: "media", label: "Media & Pulse", group: "World" },
  { id: "casino", label: "Casino", group: "World" },
  { id: "under", label: "Underground", group: "World" },
  { id: "cashflow", label: "Cash Flow", group: "Insight" },
  { id: "analysis", label: "Analysis & Risk", group: "Insight" },
  { id: "research", label: "Research & Forecasts", group: "Insight" },
  { id: "stats", label: "Stats, Goals, Ledger", group: "Insight" },
  { id: "calendar", label: "Calendar", group: "Record" },
  { id: "news", label: "Newsroom", group: "Record" },
  { id: "legacy", label: "Legacy & Saves", group: "Record" },
];

const GROUPS = ["You", "Capital", "World", "Insight", "Record"];

const VIEW_HELP: Record<string, string> = {
  mylife:
    "Your life, one year at a time. Press + Age to live until your next birthday — life events stop you along the way and ask you to choose. Choices have consequences, some immediate, some years later. Relationships need attention or they fade; activities have diminishing returns within a year; habits, illness and prison are real.",
  casino:
    "Blackjack, roulette, slots, crash, hi-lo, dice, plinko and mines — each played move by move. Every outcome comes from your save's random stream; house edges are shown. Gambling builds a habit that has consequences.",
  lifestyle:
    "Buy cars, yachts and aircraft. Fly your own plane anywhere on the map (and move there), put it on the charter market or dry-lease it to an airline. Plan vacations — commercial or private.",
  takeovers:
    "Build stakes in any company through tender offers, personally or through companies you control. 10% buys a board seat, over 50% buys control. Low-ball hostile bids can trigger a poison pill.",
  dashboard: "Your life at a glance: health, cash, world conditions and the latest wire. Use the speed controls to live time.",
  life: "Education, skills, family and health. Every hour of study or practice changes what the world offers you later.",
  career: "Jobs, promotion paths, freelancing and skill practice. Skills compound; security is not infinite.",
  staff: "Hire advisors (accountant, lawyer, economists…) and professional managers. They cost monthly salary and change measurable outcomes — they are not free advice.",
  bank: "Accounts, interest, fees, loans and your credit score. Miss payments and the score falls; keep it high and financing gets cheaper.",
  markets: "Stocks, bonds and funds. Prices react to earnings, sentiment and rates — use WHY to see the drivers of any move.",
  property: "Buy, renovate, rent, refinance and develop. Values follow local demand, supply and mortgage rates.",
  business: "Your companies: P&L, equity, funding, IPO. Competitors keep moving even when you don't.",
  opps: "Grants, jobs, properties, businesses for sale, investors and auctions. Opportunities expire — so does patience.",
  world: "Ten countries with real economies. Search the atlas, travel, apply for residency, convert currency.",
  politics: "Parties, elections with opponents, bills and — if you win — policy with economic consequences.",
  concord: "The fictional UN-style body: resolutions, agencies, blocs and votes.",
  media: "Found outlets, post on social platforms, manage your brand and face the press.",
  under: "The fictional gambling economy and the criminal path. Odds are shown; house edge always is.",
  cashflow: "Where your money actually goes. Every month is broken into named flows — salary, rent, tax, living costs, instalments (interest vs principal), advisors, fees — with a 12-month history, fixed burn, runway and arrears. Commission a cash-flow audit from the Research desk for the diagnosis in words.",
  analysis: "'What should I do?' — your situation, options with cost/risk/upside, plus your balance sheet, exposure and liquidity. It never picks for you.",
  research: "Pay for studies and place market forecasts. Information reduces uncertainty, never guarantees outcomes.",
  stats: "Lifetime statistics, personal & challenge goals, and the transaction ledger that explains every big move.",
  calendar: "Upcoming elections, grant deadlines, loan instalments, bond maturities, construction completions and auctions.",
  news: "The simulated press. News is a signal from the engine, not decoration.",
  legacy: "Timeline, achievements, year-end reviews, biography export, save export/import and delete.",
};

const SPEED_VALUES: Speed[] = [0, 0.25, 0.5, 1, 2, 5, 12];
const SPEED_KEY = "aurelion.speed.v1";

function readSpeed(): Speed {
  if (typeof window === "undefined") return 0;
  try {
    const v = Number(window.localStorage.getItem(SPEED_KEY));
    return SPEED_VALUES.includes(v as Speed) ? (v as Speed) : 0;
  } catch {
    return 0;
  }
}

export function GameApp({ id }: { id: string }) {
  const [state, setState] = useState<GameState | null>(null);
  const [view, setView] = useState("mylife");
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Time is the player's to control, and the choice survives a reload. The
  // default is paused — nothing runs away from you.
  const [speed, setSpeed] = useState<Speed>(() => readSpeed());
  const [treasuryOpen, setTreasuryOpen] = useState(false);
  const [syncInfo, setSyncInfo] = useState(persistenceStatus());
  const [whyOpen, setWhyOpen] = useState<null | "nw" | "market">(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileGroup, setMobileGroup] = useState<string | null>(null);
  const [reviewSeenYear, setReviewSeenYear] = useState<number | null>(null);
  const tapRef = useRef<number[]>([]);
  const secretRef = useRef<number[]>([]);
  const busyRef = useRef(false);
  const stateRef = useRef<GameState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const chooseSpeed = useCallback((v: Speed) => {
    setSpeed(v);
    try {
      window.localStorage.setItem(SPEED_KEY, String(v));
    } catch {
      // ignore
    }
  }, []);

  // Initial load of the save (local-first, server fallback).
  useEffect(() => {
    let cancelled = false;
    loadLife(id).then((s) => {
      if (cancelled) return;
      if (s) setState(s);
      else setErr("Life not found. It may live on another device — or was deleted.");
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const act = useCallback(
    (action: PlayerAction) => {
      const cur = stateRef.current;
      if (!cur) return;
      busyRef.current = true;
      setBusy(true);
      setErr(null);
      try {
        const result = applyLocal(id, cur, action);
        setState(result.state);
        persistNow(id, result.state);
        setLog(result.log ?? []);
        setSyncInfo(persistenceStatus());
        if (result.error) setErr(result.error);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Action failed");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [id],
  );

  // The engine mutates the save in place, so this must not be memoised on the
  // state reference — it would show a stale number after every action.
  const nw = state ? computeNetWorth(state) : 0;

  // auto-tick — the interval is stable across actions (busy lives in a ref, so
  // the timer is not torn down and restarted on every single move, which used to
  // make the clock drift and feel out of control).
  useEffect(() => {
    const ms = speedMs(speed);
    if (!ms) return;
    const months = speedMonths(speed);
    const t = setInterval(() => {
      const cur = stateRef.current;
      if (!cur || cur.pending.length || !cur.player.alive || busyRef.current) return;
      act({ type: "tick", months });
    }, ms);
    return () => clearInterval(t);
  }, [speed, act]);

  // year-end review: show once, in January of the following year
  const review = state?.adv?.yearReview ?? null;

  if (!state) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="tick">{err || "Opening the world…"}</p>
      </main>
    );
  }

  const p = state.player;
  const country = state.world.countries.find((c) => c.id === p.countryId)!;
  const city = state.world.cities.find((c) => c.id === p.cityId);
  const idx = state.world.indexHistory;
  const pending = state.pending[0];

  function onLogoTap() {
    const now = Date.now();
    tapRef.current = [...tapRef.current.filter((t) => now - t < 2500), now];
    if (tapRef.current.length >= 5) {
      tapRef.current = [];
      setDebugOpen(true);
    }
  }

  // The unmarked spot: three quick clicks on the save stamp (desktop sidebar) or
  // on the "Net worth" caption (any screen) opens the owner's treasury.
  function onSecretTap() {
    const now = Date.now();
    secretRef.current = [...secretRef.current.filter((t) => now - t < 1400), now];
    if (secretRef.current.length >= 3) {
      secretRef.current = [];
      setTreasuryOpen(true);
    }
  }

  return (
    <div className="flex min-h-screen pb-16 md:pb-0">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[var(--line)] bg-[#0a0c12]/90 p-4 md:flex">
        <button onClick={onLogoTap} className="w-full text-left">
          <span className="font-serif text-2xl gold-text">AURELION</span>
          <span className="tick mt-1 block">World simulation · {state.seedLabel ?? "w?"}</span>
        </button>
        <nav className="mt-6 flex-1 space-y-4 overflow-auto pr-1">
          {GROUPS.map((g) => (
            <div key={g}>
              <p className="tick mb-2">{g}</p>
              <div className="space-y-1">
                {NAV.filter((n) => n.group === g).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => setView(n.id)}
                    className={`block w-full rounded-xl px-3 py-1.5 text-left text-sm ${view === n.id ? "bg-white/10 text-amber-200" : "text-[var(--muted)] hover:bg-white/5"}`}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-3 text-xs text-[var(--muted)]">
          <button onClick={onSecretTap} className="block w-full text-left hover:text-[var(--muted)]" title="Saved">
            Saved {state.lastSave ? new Date(state.lastSave).toLocaleTimeString() : "—"} · seed {state.seedLabel ?? "—"}
          </button>
          <p className="mt-1 text-[10px] opacity-70">{syncInfo.message || "Local save"}</p>
          {p.finances.arrears > 0 ? (
            <p className="mt-1 text-[10px] text-rose-300">Unpaid living costs {formatINR(p.finances.arrears)}</p>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[#0a0c12]/80 px-4 py-3 md:px-6">
          <button onClick={onLogoTap} className="md:hidden">
            <span className="font-serif text-xl gold-text">AURELION</span>
          </button>
          <Avatar appearance={p.appearance} name={p.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-3">
              <h1 className="font-serif text-xl md:text-2xl">{p.name}</h1>
              <span className="text-sm text-[var(--muted)]">
                {p.age} · {city?.name}, {country.name}
              </span>
            </div>
            <p className="text-xs text-[var(--muted)]">
              {formatDate(state.time.year, state.time.month)} · {p.career.job?.title ?? (p.ownedCompanyIds.length ? "Founder" : "Unaffiliated")} · {p.alive ? "Living" : "Deceased"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <button onClick={onSecretTap} className="tick block w-full cursor-default select-none text-right" title="Net worth">
                Net worth
              </button>
              <button onClick={() => setWhyOpen("nw")} className="gold-text font-serif text-lg md:text-xl hover:underline" title="Why this number?">
                {formatINR(nw)} <span className="text-xs opacity-70">?why</span>
              </button>
            </div>
            <NotifBell state={state} />
            <button
              disabled={busy || !!pending || !p.alive}
              onClick={() => act({ type: "ageUp" })}
              title="Live until your next birthday"
              className="rounded-full bg-gradient-to-r from-teal-300 to-emerald-400 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
            >
              + Age
            </button>
            <SpeedControls
              speed={speed}
              setSpeed={chooseSpeed}
              onStep={busy || !!pending || !p.alive ? undefined : (m) => act({ type: "tick", months: m })}
            />
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-4 md:px-6 xl:grid-cols-8">
          <Stat label="Cash" value={formatINR(liquidCash(p))} />
          <Stat label="Portfolio" value={formatINR(portfolioValue(state))} />
          <Stat label="Property" value={formatINR(propertyValue(p))} />
          <Stat label="Business eq." value={formatINR(businessEquity(state))} />
          <Stat label="Debt" value={formatINR(totalDebt(p))} tone="bad" />
          <Stat label={`${country.currency.code} policy rate`} value={`${country.interestRate.toFixed(2)}%`} sub={`CPI ${country.inflation.toFixed(1)}%`} />
          <Stat label="Growth" value={formatPct(country.gdpGrowth)} tone={country.gdpGrowth >= 0 ? "good" : "bad"} />
          <Stat label="Followers" value={p.social.followers.toLocaleString()} />
        </div>

        {log.length ? (
          <div className="mx-4 mb-3 rounded-2xl border border-amber-200/20 bg-amber-200/5 px-4 py-2 text-sm md:mx-6">
            {log.map((l, i) => (
              <p key={i} className="m-0">
                {l}
              </p>
            ))}
          </div>
        ) : null}
        {err ? <p className="px-4 text-sm text-rose-300 md:px-6">{err}</p> : null}

        <main className="flex-1 px-4 pb-10 md:px-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="tick text-sm">{NAV.find((n) => n.id === view)?.label ?? view}</h2>
            <button onClick={() => setHelpOpen(true)} className="text-xs text-[var(--muted)] hover:text-amber-200" title="How this works">
              ? how this works
            </button>
          </div>
          {view === "dashboard" ? (
            <Dashboard state={state} act={act} setView={setView} />
          ) : view === "mylife" ? (
            <LifeView state={state} act={act} busy={busy} setView={setView} />
          ) : (
            <Panels view={view} state={state} act={act} busy={busy} />
          )}
        </main>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--line)] bg-[#0a0c12]/95 backdrop-blur md:hidden">
        <div className="flex">
          {GROUPS.map((g) => (
            <button
              key={g}
              onClick={() => {
                if (mobileGroup === g) {
                  setMobileGroup(null);
                } else {
                  setMobileGroup(g);
                  const first = NAV.find((n) => n.group === g);
                  if (first) setView(first.id);
                }
              }}
              className={`flex-1 py-3 text-xs uppercase tracking-wider ${mobileGroup === g ? "text-amber-200" : "text-[var(--muted)]"}`}
            >
              {g}
            </button>
          ))}
        </div>
        {mobileGroup ? (
          <div className="flex gap-2 overflow-x-auto border-t border-white/5 px-2 py-2">
            {NAV.filter((n) => n.group === mobileGroup).map((n) => (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${view === n.id ? "border-amber-200/50 bg-amber-200/10 text-amber-200" : "border-white/10 text-[var(--muted)]"}`}
              >
                {n.label}
              </button>
            ))}
          </div>
        ) : null}
      </nav>

      {pending ? (
        <Modal title={pending.title}>
          <p className="text-sm leading-6 text-[var(--muted)]">{pending.body}</p>
          <p className="tick mt-3">
            {monthName(pending.month)} {pending.year}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {pending.options.map((o) => (
              <button
                key={o.id}
                disabled={busy}
                onClick={() => act({ type: "resolve", decisionId: pending.id, optionId: o.id })}
                className="rounded-2xl border border-[var(--line)] px-4 py-3 text-left hover:bg-white/5"
              >
                <div className="font-medium">{o.label}</div>
                {o.hint ? <div className="text-xs text-[var(--muted)]">{o.hint}</div> : null}
              </button>
            ))}
          </div>
        </Modal>
      ) : null}

      {whyOpen === "nw" ? (
        <LineListModal title="Why this net worth?" lines={whyNetWorth(state)} onClose={() => setWhyOpen(null)} />
      ) : null}
      {whyOpen === "market" ? (
        <LineListModal title="Market drivers" lines={whyMarket(state)} onClose={() => setWhyOpen(null)} />
      ) : null}
      {helpOpen ? (
        <HowItWorks view={view} help={VIEW_HELP[view] ?? ""} onClose={() => setHelpOpen(false)} />
      ) : null}
      {debugOpen ? (
        <DebugModal
          state={state}
          act={act}
          onClose={() => setDebugOpen(false)}
          onTreasury={() => {
            setDebugOpen(false);
            setTreasuryOpen(true);
          }}
        />
      ) : null}
      {treasuryOpen ? <TreasuryModal state={state} act={act} onClose={() => setTreasuryOpen(false)} /> : null}
      {review && review.year < state.time.year && reviewSeenYear !== review.year ? (
        <Modal title={`Year ${review.year} — the accounts close`}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="panel rounded-2xl p-3">
              <p className="tick">Net worth</p>
              <p className="font-serif text-lg">
                {formatINR(review.nwStart)} → {formatINR(review.nwEnd)}
              </p>
            </div>
            <div className="panel rounded-2xl p-3">
              <p className="tick">Cash flow</p>
              <p className="font-serif text-lg">
                {formatINR(review.earned)} in · {formatINR(review.spent)} out
              </p>
            </div>
          </div>
          {review.built.length ? (
            <div className="mt-4">
              <p className="tick">What you built</p>
              {review.built.slice(0, 5).map((b, i) => (
                <p key={i} className="mt-1 text-sm">
                  · {b}
                </p>
              ))}
            </div>
          ) : null}
          <div className="mt-4">
            <p className="tick">World</p>
            {review.world.slice(0, 3).map((w, i) => (
              <p key={i} className="mt-1 text-sm text-[var(--muted)]">
                · {w}
              </p>
            ))}
          </div>
          <div className="mt-4">
            <p className="tick">Markets</p>
            {review.markets.slice(0, 3).map((m, i) => (
              <p key={i} className="mt-1 text-sm text-[var(--muted)]">
                · {m}
              </p>
            ))}
          </div>
          <p className="mt-4 text-sm italic text-[var(--muted)]">{review.outlook}</p>
          <div className="mt-5">
            <Btn onClick={() => setReviewSeenYear(review.year)}>Close the ledger</Btn>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Dashboard({
  state,
  act,
  setView,
}: {
  state: GameState;
  act: (a: PlayerAction) => void;
  setView: (v: string) => void;
}) {
  const p = state.player;
  const country = state.world.countries.find((c) => c.id === p.countryId)!;
  const nwHist = p.finances.netWorthHistory.map((x) => x.v);
  const firms = state.world.companies.filter((c) => c.shareholders.some((s) => s.type === "player"));
  const adv = state.adv;
  const goals = adv ? Object.entries(adv.goals).slice(0, 3) : [];
  const cal = buildCalendar(state).slice(0, 3);
  const ch = adv?.challenge;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {ch && ch.status === "active" ? (
        <Card className="lg:col-span-3" >
          <div className="flex items-center justify-between">
            <div>
              <Label>Challenge · {ch.title}</Label>
              <p className="mt-1 text-sm text-[var(--muted)]">{CHALLENGE_DEFS.find((d) => d.id === ch.defId)?.desc ?? ""}</p>
            </div>
            <Btn kind="ghost" onClick={() => setView("stats")}>
              Details
            </Btn>
          </div>
        </Card>
      ) : null}
      <Card className="lg:col-span-2">
        <Label>Life</Label>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="font-serif text-3xl">{p.name}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Age {p.age} · Health {Math.round(p.health)} · Stress {Math.round(p.stress)}
            </p>
            <p className="mt-3 text-sm leading-6">
              {p.career.job
                ? `${p.career.job.title} at ${p.career.job.employer} (${formatINR(p.career.job.salary)}/yr).`
                : "No employer. The labour market is still hiring — or you could found something."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn kind="ghost" onClick={() => setView("career")}>
                Work
              </Btn>
              <Btn kind="ghost" onClick={() => setView("opps")}>
                Opportunities
              </Btn>
              <Btn kind="ghost" onClick={() => setView("analysis")}>
                What should I do?
              </Btn>
              <Btn kind="ghost" onClick={() => act({ type: "rest" })}>
                Rest
              </Btn>
              <Btn kind="ghost" onClick={() => act({ type: "network" })}>
                Network
              </Btn>
            </div>
            {goals.length ? (
              <div className="mt-4 space-y-1">
                {goals.map(([gid, g]) => (
                  <div key={gid} className="flex justify-between text-xs text-[var(--muted)]">
                    <span>{GOAL_DEFS.find((d) => d.id === gid)?.label ?? gid} · target {formatINR(g.target)}</span>
                    {g.achievedAt ? <span className="text-teal-300">done</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <Label>Net worth history</Label>
            <Spark values={nwHist.length ? nwHist : [0, 0]} />
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                Income this month
                <div className="text-teal-300">{formatINR(p.finances.monthlyIncome)}</div>
              </div>
              <div>
                Expenses
                <div className="text-rose-300">{formatINR(p.finances.monthlyExpenses)}</div>
              </div>
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <Label>World now · {country.name}</Label>
        <p className="mt-2 font-serif text-xl">{country.headOfGov}</p>
        <p className="text-xs text-[var(--muted)]">Head of government</p>
        <div className="mt-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>GDP growth</span>
            <span>{formatPct(country.gdpGrowth)}</span>
          </div>
          <div className="flex justify-between">
            <span>Inflation</span>
            <span>{country.inflation.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Unemployment</span>
            <span>{country.unemployment.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Approval</span>
            <span>{country.approval.toFixed(0)}</span>
          </div>
          <div className="flex justify-between">
            <span>AI adoption</span>
            <span>{country.aiAdoption.toFixed(0)}</span>
          </div>
        </div>
        <Btn kind="ghost" onClick={() => setView("world")}>
          Open map
        </Btn>
      </Card>
      <Card className="lg:col-span-2">
        <Label>Wire</Label>
        <ul className="mt-3 space-y-3">
          {state.news.slice(0, 5).map((n) => (
            <li key={n.id}>
              <p className="text-sm font-medium">{n.headline}</p>
              <p className="text-xs text-[var(--muted)]">
                {n.tag} · {n.impact}
              </p>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <Label>Firms you touch</Label>
        {firms.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">None yet. Found one from Companies.</p>
        ) : (
          firms.map((f) => (
            <div key={f.id} className="mt-3 border-t border-white/5 pt-3 text-sm">
              <div className="font-medium">{f.name}</div>
              <div className="text-[var(--muted)]">
                {f.industry} · {f.stage} · {formatINR(f.revenue)} rev
              </div>
            </div>
          ))
        )}
        {cal.length ? (
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="tick">Coming up</p>
            {cal.map((c, i) => (
              <p key={i} className="mt-1 text-xs text-[var(--muted)]">
                {c.monthsAhead <= 0 ? "now" : `in ${c.monthsAhead}mo`} · {c.label}
              </p>
            ))}
            <Btn kind="ghost" onClick={() => setView("calendar")}>
              Full calendar
            </Btn>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
