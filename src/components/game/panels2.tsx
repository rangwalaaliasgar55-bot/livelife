"use client";

import { useState } from "react";
import {
  ADVISOR_DEFS,
  buildAnalysis,
  buildCalendar,
  CHALLENGE_DEFS,
  forecastLabel,
  getAdv,
  GOAL_DEFS,
  goalProgress,
  RESEARCH_TOPICS,
} from "@/lib/sim/advanced";
import { businessEquity, computeNetWorth, liquidCash, portfolioValue, propertyValue, totalDebt } from "@/lib/sim/finance";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { formatINR } from "@/lib/sim/util";
import { Btn, Card, Field, Input, Label, Meter, Select, Table } from "./ui";

/* ------------------------------------------------------------------ staff */

export function Staff({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const adv = getAdv(state);
  const p = state.player;
  const firms = state.world.companies.filter((c) => p.ownedCompanyIds.includes(c.id));
  const salaryTotal = adv.advisors.reduce((s, a) => s + a.salary, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <Label>Professional staff</Label>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Advisors are retained specialists. They cost a monthly salary (and a 3× retainer to hire), and their effects are real,
          measurable and small — no free advice. You currently pay {formatINR(salaryTotal)}/month.
        </p>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {ADVISOR_DEFS.map((d) => {
            const hired = adv.advisors.find((a) => a.defId === d.id);
            return (
              <div key={d.id} className={`rounded-2xl border p-3 ${hired ? "border-teal-300/30 bg-teal-300/5" : "border-white/10"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {d.role}
                      {hired ? <span className="ml-2 text-xs text-teal-300">{hired.name} · {hired.skill}/100</span> : null}
                    </p>
                    <p className="text-[11px] text-[var(--muted)]">{d.blurb}</p>
                  </div>
                  {hired ? (
                    <Btn kind="danger" onClick={() => void act({ type: "fireAdvisor", advisorId: d.id })}>
                      Dismiss
                    </Btn>
                  ) : (
                    <Btn kind="ghost" onClick={() => void act({ type: "hireAdvisor", advisorId: d.id })}>
                      Hire {formatINR(d.salary)}/mo
                    </Btn>
                  )}
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">{d.effect}</p>
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <Label>Company management (delegation)</Label>
        <p className="mt-1 text-sm text-[var(--muted)]">
          A firm you do not personally run as CEO pays a hidden management drag: costs up, quality drifts down. Hire a professional
          manager to keep it running while you live other parts of your life.
        </p>
        {firms.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">You do not own any companies yet.</p>
        ) : (
          firms.map((f) => (
            <div key={f.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 p-3">
              <div>
                <p className="font-medium">{f.name}</p>
                <p className="text-[11px] text-[var(--muted)]">
                  {f.industry} · {f.stage} · revenue {formatINR(f.revenue)} ·{" "}
                  {f.playerCeo ? "you are the day CEO" : f.manager ? `managed by ${f.manager.name} (${f.manager.skill}/100)` : "no professional manager (drag active)"}
                </p>
              </div>
              {f.playerCeo ? (
                <span className="text-xs text-[var(--muted)]">CEO — you</span>
              ) : f.manager ? (
                <Btn kind="ghost" onClick={() => void act({ type: "fireManager", companyId: f.id })}>
                  Dismiss manager
                </Btn>
              ) : (
                <Btn kind="ghost" onClick={() => void act({ type: "hireManager", companyId: f.id })}>
                  Hire manager
                </Btn>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- analysis */

export function Analysis({ state }: { state: GameState }) {
  const p = state.player;
  const { situation, options } = buildAnalysis(state);
  const cash = liquidCash(p);
  const port = portfolioValue(state);
  const props = propertyValue(p);
  const biz = businessEquity(state);
  const debt = totalDebt(p);
  const assets = cash + port + props + biz;
  const nw = computeNetWorth(state);
  const topTicker = p.holdings
    .map((h) => ({ t: h.ticker, v: (state.world.companies.find((c) => c.ticker === h.ticker)?.price ?? 0) * h.shares }))
    .sort((a, b) => b.v - a.v)[0];
  const topBiz = state.world.companies
    .map((c) => {
      const sh = c.shareholders.find((s) => s.type === "player");
      return { id: c.id, v: sh && c.shares > 0 ? (sh.shares / c.shares) * Math.max(0, c.valuation) : 0 };
    })
    .sort((a, b) => b.v - a.v)[0];
  const illiquid = props + biz;
  const liquidity = assets > 0 ? (cash + port) / assets : 1;
  const risks: { label: string; value: string; tone?: "good" | "bad" }[] = [
    { label: "Debt / assets", value: assets > 0 ? `${((debt / assets) * 100).toFixed(0)}%` : "—", tone: debt / Math.max(1, assets) > 0.5 ? "bad" : "good" },
    { label: "Property concentration", value: assets > 0 ? `${((props / assets) * 100).toFixed(0)}%` : "—", tone: props / Math.max(1, assets) > 0.7 ? "bad" : undefined },
    { label: "Single-stock max", value: assets > 0 && topTicker ? `${((topTicker.v / assets) * 100).toFixed(0)}% (${topTicker.t})` : "—" },
    { label: "Single-firm max", value: assets > 0 && topBiz ? `${((topBiz.v / assets) * 100).toFixed(0)}%` : "—" },
    { label: "Country concentration", value: "100% home (so far)" },
    { label: "Liquidity (cash+equity share)", value: `${(liquidity * 100).toFixed(0)}%`, tone: liquidity < 0.3 ? "bad" : liquidity > 0.6 ? "good" : undefined },
    { label: "Monthly burn vs cash", value: p.finances.monthlyExpenses > 0 ? `${(cash / p.finances.monthlyExpenses).toFixed(1)} months` : "—", tone: cash < p.finances.monthlyExpenses * 3 ? "bad" : undefined },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <Label>What should I do? (analysis, not advice)</Label>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{situation}</p>
        <div className="mt-4 space-y-2">
          {options.map((o) => (
            <div key={o.id} className="rounded-2xl border border-white/10 p-3 text-sm">
              <p className="font-medium">{o.label}</p>
              <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-[var(--muted)] md:grid-cols-2">
                <span>Cost: {o.cost}</span>
                <span>Risk: {o.risk}</span>
                <span>Upside: {o.upside}</span>
                <span>Opportunity cost: {o.opportunity}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-[var(--muted)]">
          This screen lays out options and their trade-offs. It will never tell you which one is the best — uncertainty is the price of
          a world that moves.
        </p>
      </Card>
      <Card>
        <Label>Personal balance sheet</Label>
        <div className="mt-3 space-y-1 text-sm">
          <Row k="Cash & accounts" v={cash} />
          <Row k="Markets portfolio" v={port} />
          <Row k="Property" v={props} />
          <Row k="Business equity" v={biz} />
          <Row k="Total assets" v={assets} bold />
          <Row k="Loans & debt" v={-debt} bad />
          <Row k="Net worth" v={nw} bold />
        </div>
        <div className="mt-4">
          <Label>Risk exposure</Label>
          <div className="mt-2 space-y-1.5">
            {risks.map((r) => (
              <div key={r.label} className="flex justify-between text-xs">
                <span className="text-[var(--muted)]">{r.label}</span>
                <span className={r.tone === "bad" ? "text-rose-300" : r.tone === "good" ? "text-teal-300" : ""}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Card className="lg:col-span-3">
        <Label>Accounting consistency</Label>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Assets ({formatINR(assets)}) = Liabilities ({formatINR(debt)}) + Equity ({formatINR(nw)}). Every transaction in the ledger and
          monthly flows posts to these accounts; no money is created or destroyed outside of explicit funding events (loans, grants,
          investment, auctions).
        </p>
      </Card>
    </div>
  );
}

function Row({ k, v, bold, bad }: { k: string; v: number; bold?: boolean; bad?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={bold ? "font-medium" : "text-[var(--muted)]"}>{k}</span>
      <span className={bold ? "font-medium text-amber-200" : bad ? "text-rose-300" : ""}>{formatINR(v)}</span>
    </div>
  );
}

/* --------------------------------------------------------------- research */

export function Research({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const adv = getAdv(state);
  const [topic, setTopic] = useState("economy");
  const [targetId, setTargetId] = useState("");
  const def = RESEARCH_TOPICS.find((t) => t.id === topic);
  const [fTopic, setFTopic] = useState<"index" | "property" | "inflation" | "growth" | "fx" | "stock">("index");
  const [fDir, setFDir] = useState<"up" | "down">("up");
  const [fHorizon, setFHorizon] = useState(3);
  const [fStake, setFStake] = useState(50000);
  const [fTicker, setFTicker] = useState("");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Label>Commission research</Label>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Studies cost money and take months. When they finish, findings land here and sharpen the information you act on — they never
          remove uncertainty.
        </p>
        <div className="mt-4 space-y-3">
          <Field label="Topic">
            <Select value={topic} onChange={(e) => setTopic(e.target.value)}>
              {RESEARCH_TOPICS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {formatINR(t.cost)} · {t.months}mo
                </option>
              ))}
            </Select>
          </Field>
          {def && (def.target === "company" || def.target === "country" || def.target === "industry") ? (
            <Field label={`Target (${def.target})`}>
              {def.target === "company" ? (
                <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">— pick ticker —</option>
                  {state.world.companies
                    .filter((c) => c.listed)
                    .slice(0, 120)
                    .map((c) => (
                      <option key={c.ticker} value={c.ticker}>
                        {c.ticker} · {c.name}
                      </option>
                    ))}
                </Select>
              ) : def.target === "country" ? (
                <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">— pick country —</option>
                  {state.world.countries.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">— pick industry —</option>
                  {[...new Set(state.world.companies.map((c) => c.industry))].map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Btn
            onClick={() =>
              void act({ type: "startResearch", topic, targetId: def && def.target !== "none" && targetId ? targetId : undefined })
            }
          >
            Start study ({formatINR(def?.cost ?? 0)})
          </Btn>
        </div>
        <div className="mt-4 space-y-2">
          {adv.research.slice(0, 6).map((r) => (
            <div key={r.id} className={`rounded-2xl border p-3 ${r.done ? "border-teal-300/30" : "border-white/10"}`}>
              <div className="flex justify-between text-sm">
                <span className="font-medium">{r.title}</span>
                <span className="text-xs text-[var(--muted)]">{r.done ? "complete" : "in field"}</span>
              </div>
              {r.done
                ? r.findings.map((f, i) => (
                    <p key={i} className="mt-1 text-xs leading-5 text-[var(--muted)]">
                      · {f}
                    </p>
                  ))
                : null}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <Label>Market forecasts</Label>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Call a direction over a horizon. Correct: stake back +30%. Wrong: stake gone. Push (flat): stake returned. Your record shows
          how well you read this world.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Market">
            <Select value={fTopic} onChange={(e) => setFTopic(e.target.value as typeof fTopic)}>
              <option value="index">Concord World Index</option>
              <option value="property">Local property index</option>
              <option value="inflation">Home-country inflation</option>
              <option value="growth">Home-country GDP growth</option>
              <option value="fx">Home currency vs base</option>
              <option value="stock">Single stock</option>
            </Select>
          </Field>
          <Field label="Direction">
            <Select value={fDir} onChange={(e) => setFDir(e.target.value as typeof fDir)}>
              <option value="up">Up</option>
              <option value="down">Down</option>
            </Select>
          </Field>
          {fTopic === "stock" ? (
            <Field label="Ticker">
              <Input value={fTicker} onChange={(e) => setFTicker(e.target.value.toUpperCase())} placeholder="e.g. the ticker symbol" />
            </Field>
          ) : null}
          <Field label="Horizon (months)">
            <Input type="number" min={1} max={24} value={fHorizon} onChange={(e) => setFHorizon(Number(e.target.value))} />
          </Field>
          <Field label="Stake (₹)">
            <Input type="number" min={1000} value={fStake} onChange={(e) => setFStake(Number(e.target.value))} />
          </Field>
        </div>
        <Btn
          className="mt-3"
          onClick={() =>
            void act({
              type: "placeForecast",
              topic: fTopic,
              targetId: fTopic === "stock" ? fTicker : undefined,
              direction: fDir,
              horizonMonths: fHorizon,
              stake: fStake,
            })
          }
        >
          Place forecast
        </Btn>
        <div className="mt-4 space-y-2">
          {adv.forecasts.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No forecasts yet.</p>
          ) : (
            adv.forecasts.slice(0, 10).map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-2xl border border-white/10 p-3 text-sm">
                <div>
                  <p>
                    {forecastLabel(state, f)} · <span className={f.direction === "up" ? "text-teal-300" : "text-rose-300"}>{f.direction}</span>
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    base {f.base.toFixed(2)} · stake {formatINR(f.stake)} · {f.placedAt}
                    {f.status !== "open" ? ` · settled ${f.resultPct?.toFixed(2)}%` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs ${
                      f.status === "won" ? "text-teal-300" : f.status === "lost" ? "text-rose-300" : f.status === "push" ? "text-amber-200" : ""
                    }`}
                  >
                    {f.status}
                  </span>
                  {f.status === "open" ? (
                    <Btn kind="ghost" onClick={() => void act({ type: "cancelForecast", forecastId: f.id })}>
                      Cancel
                    </Btn>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ stats */

export function StatsP({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const adv = getAdv(state);
  const s = adv.stats;
  const [goalId, setGoalId] = useState("net_worth");
  const [goalTarget, setGoalTarget] = useState(10000000);
  const goalDef = GOAL_DEFS.find((g) => g.id === goalId);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <Label>Lifetime statistics</Label>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          {[
            ["Total earned", s.earned],
            ["Total spent", s.spent],
            ["Taxes paid", s.taxes],
            ["Companies", s.businesses],
            ["Properties (max)", s.propertiesMax],
            ["Jobs held", s.jobs],
            ["Countries lived", s.countries.length],
            ["Elections contested", s.elections],
            ["Convictions", s.convictions],
            ["Wagered (gamble)", s.wagered],
            ["Gambling won", s.won],
            ["Biggest win", s.biggestWin],
            ["Biggest loss", s.biggestLoss],
            ["Peak net worth", s.peakNW],
            ["Achievements", state.achievements.length],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-2xl border border-white/10 p-3">
              <p className="tick">{String(k)}</p>
              <p className="mt-1 font-serif text-lg">
                {typeof v === "number" && (k as string).includes("worth") || (typeof v === "number" && ["earned", "spent", "Taxes", "Wagered", "Gambling", "Biggest"].includes(String(k)))
                  ? formatINR(v as number)
                  : String(v)}
              </p>
              {k === "Peak net worth" ? <p className="text-[10px] text-[var(--muted)]">{s.peakNWDate}</p> : null}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <Label>Personal goals</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">Set a goal; the dashboard tracks it. Progress is computed live from state.</p>
        <div className="mt-3 space-y-3">
          <Field label="Goal">
            <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              {GOAL_DEFS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </Select>
          </Field>
          {goalDef?.needsTarget ? (
            <Field label={`Target (${goalDef.hint})`}>
              <Input type="number" value={goalTarget} onChange={(e) => setGoalTarget(Number(e.target.value))} />
            </Field>
          ) : null}
          <Btn onClick={() => void act({ type: "setGoal", goalId, target: goalTarget })}>Set goal</Btn>
        </div>
        <div className="mt-4 space-y-3">
          {Object.entries(adv.goals).map(([gid, g]) => {
            const prog = goalProgress(state, gid, g.target);
            if (!prog) return null;
            return (
              <div key={gid}>
                <div className="flex justify-between text-xs">
                  <span>
                    {prog.def.label}
                    {prog.def.needsTarget ? ` · ${formatINR(g.target)}` : ""}
                  </span>
                  <span className="text-[var(--muted)]">{prog.res.text}</span>
                </div>
                <div className="mt-1">
                  <Meter label="" value={prog.pct * 100} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="lg:col-span-2">
        <Label>Challenges</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Optional objectives with deadlines. Complete one for a public credibility reward; fail and the record shows it.
        </p>
        {adv.challenge ? (
          <div className="mt-3 rounded-2xl border border-amber-200/30 bg-amber-200/5 p-3">
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                Active: {adv.challenge.title}
              </span>
              <span className="text-xs text-amber-200">{adv.challenge.status}</span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {CHALLENGE_DEFS.find((c) => c.id === adv.challenge!.defId)?.desc}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">{CHALLENGE_DEFS.find((c) => c.id === adv.challenge!.defId)?.check(state).text}</p>
            {adv.challenge.status === "active" ? (
              <Btn kind="ghost" className="mt-2" onClick={() => void act({ type: "abandonChallenge" })}>
                Abandon
              </Btn>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {CHALLENGE_DEFS.map((c) => {
            const res = c.check(state);
            return (
              <div key={c.id} className="rounded-2xl border border-white/10 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{c.title}</span>
                  <Btn kind="ghost" onClick={() => void act({ type: "startChallenge", challengeId: c.id })}>
                    Start
                  </Btn>
                </div>
                <p className="mt-1 text-[11px] text-[var(--muted)]">{c.desc}</p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">Now: {res.text}</p>
              </div>
            );
          })}
        </div>
      </Card>
      <Card>
        <Label>Transaction ledger</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">Major financial events, newest first. The monthly flow detail lives under the net worth “why”.</p>
        <div className="mt-3 max-h-96 space-y-1.5 overflow-auto">
          {adv.ledger.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Quiet so far.</p>
          ) : (
            adv.ledger.slice(0, 40).map((l) => (
              <div key={l.id} className="flex justify-between border-b border-white/5 pb-1.5 text-xs">
                <span className="text-[var(--muted)]">
                  {l.t} · {l.text}
                </span>
                <span className={l.amount >= 0 ? "text-teal-300" : "text-rose-300"}>{l.amount ? formatINR(l.amount) : "—"}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- calendar */

export function CalendarP({ state }: { state: GameState }) {
  const items = buildCalendar(state);
  const groups: { label: string; filter: (m: number) => boolean }[] = [
    { label: "This month", filter: (m) => m <= 0 },
    { label: "Next 3 months", filter: (m) => m > 0 && m <= 3 },
    { label: "Next 6 months", filter: (m) => m > 3 && m <= 6 },
    { label: "Later", filter: (m) => m > 6 },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => {
        const rows = items.filter((x) => g.filter(x.monthsAhead));
        if (!rows.length) return null;
        return (
          <Card key={g.label}>
            <Label>{g.label}</Label>
            <div className="mt-2 space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="rounded-2xl border border-white/10 p-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{r.label}</span>
                    <span className="tick">{r.kind}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{r.detail}</p>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
