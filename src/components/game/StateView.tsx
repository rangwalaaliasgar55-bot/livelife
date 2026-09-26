"use client";

// The country-leader screens: the treasury you run, the things you build with
// it, the laws you can and cannot pass, the taxes you set company by company,
// the army you pay for and the wars you fight — and, at the end of that road,
// personal rule with a coup clock that never stops ticking.
//
// Every number here is read from the save; nothing on these screens is decor.
import { useState, type ReactNode } from "react";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import {
  canRule,
  discretionaryShare,
  getGov,
  govSummary,
  INFRA_DEFS,
  INFRA_IDS,
  infraQuote,
  LAW_DEFS,
  LAW_IDS,
  lawOdds,
  levyOf,
  militaryPower,
  rulingCountry,
  SCHEME_DEFS,
  SCHEME_IDS,
  schemeQuote,
  WAR_OBJECTIVES,
  warPreview,
} from "@/lib/sim/statecraft";
import { liquidCash } from "@/lib/sim/finance";
import { formatINR } from "@/lib/sim/util";
import { Btn, Card, Field, Input, Label, Meter, Select, Spark, Stat } from "./ui";

type Act = (a: PlayerAction) => void;

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const num = (s: string) => {
  const n = Number(String(s).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function useBiz(act: Act) {
  return (op: string, id = "", args: Record<string, unknown> = {}) => act({ type: "biz", op, id, args });
}

function Row({ k, v, tone }: { k: ReactNode; v: ReactNode; tone?: "good" | "bad" | "muted" }) {
  const c = tone === "good" ? "text-teal-300" : tone === "bad" ? "text-rose-300" : tone === "muted" ? "text-[var(--muted)]" : "";
  return (
    <div className="flex justify-between gap-3 border-t border-white/5 py-1 text-sm">
      <span className="text-[var(--muted)]">{k}</span>
      <span className={c}>{v}</span>
    </div>
  );
}

function Apply({
  label,
  init,
  cta,
  onApply,
  kind,
}: {
  label: string;
  init: number;
  cta: string;
  onApply: (n: number) => void;
  kind?: "gold" | "ghost" | "teal" | "danger";
}) {
  const [v, setV] = useState(String(init));
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <Input value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" />
        <Btn kind={kind ?? "ghost"} onClick={() => onApply(Math.max(0, Math.round(num(v))))}>
          {cta}
        </Btn>
      </div>
    </Field>
  );
}

/** Shown when the player is not in power yet. */
function NotInPower({ state }: { state: GameState }) {
  const c = rulingCountry(state);
  return (
    <Card>
      <Label>You do not hold the country</Label>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {c?.name ?? "This country"} is led by {c?.headOfGov ?? "someone else"}. Stand for office, win the election and the treasury, the
        legislature, the army and the power to tax any company are yours. Until then these screens are a preview of the machine.
      </p>
    </Card>
  );
}

/* ======================================================== government */

export function StateView({ state, act }: { state: GameState; act: Act }) {
  const biz = useBiz(act);
  const s = govSummary(state);
  const g = s.gov;
  const c = s.country;
  const ruling = canRule(state);
  const m = g.monthly;
  const treasuryHistory = [...g.history].reverse().slice(-36).map((h) => h.treasury);
  const approvalHistory = [...g.history].reverse().slice(-36).map((h) => h.approval);

  const [infraKind, setInfraKind] = useState<(typeof INFRA_IDS)[number]>("highway");
  const [infraCity, setInfraCity] = useState(state.player.cityId);
  const [scale, setScale] = useState("1");
  const q = infraQuote(state, infraKind, infraCity, num(scale));
  const cities = state.world.cities.filter((x) => x.countryId === c.id);
  const [lawKind, setLawKind] = useState<(typeof LAW_IDS)[number]>("corp_tax_cut");
  const odds = lawOdds(state, lawKind);
  const firms = state.world.companies
    .filter((x) => x.countryId === c.id && x.stage !== "bankrupt")
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 14);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Treasury" value={formatINR(s.treasury)} tone={s.treasury >= 0 ? "gold" : "bad"} />
        <Stat
          label="Monthly net"
          value={formatINR(m?.net ?? 0)}
          tone={(m?.net ?? 0) >= 0 ? "good" : "bad"}
          sub={`in ${formatINR(m?.revenue ?? 0)} · out ${formatINR(m?.spending ?? 0)}`}
        />
        <Stat label="Approval" value={c.approval.toFixed(0)} sub={`growth ${c.gdpGrowth.toFixed(1)}%`} />
        <Stat label="Debt / GDP" value={pct(s.debtRatio, 0)} tone={s.debtRatio > 0.9 ? "bad" : undefined} />
        <Stat label="Sanctions" value={`${Math.round(g.sanctions)}`} tone={g.sanctions > 30 ? "bad" : undefined} />
        <Stat label="Military power" value={`${s.power}`} sub={g.wars.some((w) => w.status === "active") ? "at war" : "at peace"} />
      </div>

      {!ruling ? <NotInPower state={state} /> : null}

      {/* ------------------------------------------------------ treasury */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <Label>The treasury · {c.name}</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The state&apos;s own money. It receives {formatINR(s.revenue)} a month of current receipts (plus levies and tribute) and pays for
            schemes, construction, the army, the war and the debt. Your personal cash is separate — until you move it.
          </p>
          <div className="mt-2">
            <Row k="Discretionary receipts" v={`${formatINR(s.revenue)}/mo`} tone="good" />
            <Row k="Schemes" v={`−${formatINR(s.schemeCost)}/mo`} />
            <Row k="Construction" v={`−${formatINR(s.projectCost)}/mo`} />
            <Row k="Defence" v={`−${formatINR(g.defence.budget)}/mo`} />
            <Row k="War" v={`−${formatINR(s.warCost)}/mo`} tone={s.warCost ? "bad" : "muted"} />
            <Row k="Debt service" v={`−${formatINR(s.debtService)}/mo`} />
            <Row k="Last month" v={formatINR(m?.net ?? 0)} tone={(m?.net ?? 0) >= 0 ? "good" : "bad"} />
            <Row k="Your own cash" v={formatINR(liquidCash(state.player))} tone="muted" />
          </div>
          {treasuryHistory.length > 2 ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="tick">Treasury</p>
                <Spark values={treasuryHistory} />
              </div>
              <div>
                <p className="tick">Approval</p>
                <Spark values={approvalHistory} color="#5eead4" />
              </div>
            </div>
          ) : null}
        </Card>

        <Card>
          <Label>Put money in · borrow · take out</Label>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <Apply label="Inject your own money (buys approval & machinery)" init={5e9} cta="Inject" onApply={(n) => biz("govInject", "", { amount: n })} kind="gold" />
            <Apply
              label="Borrow from the state (subsidised, on your signature)"
              init={2e9}
              cta="Borrow"
              onApply={(n) => biz("govLoan", "", { amount: n, term: 60 })}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="ghost" onClick={() => biz("govBorrow", "", { source: "market", amount: discretionaryShare(c) * 12 })}>
              Market issue {formatINR(discretionaryShare(c) * 12)}
            </Btn>
            <Btn kind="ghost" onClick={() => biz("govBorrow", "", { source: "central", amount: discretionaryShare(c) * 6 })}>
              Central bank {formatINR(discretionaryShare(c) * 6)}
            </Btn>
            <Btn kind="ghost" disabled={!c.conMember} onClick={() => biz("govBorrow", "", { source: "concord", amount: discretionaryShare(c) * 24 })}>
              Concord facility {formatINR(discretionaryShare(c) * 24)}
            </Btn>
            <Btn kind="danger" onClick={() => biz("govSkim", "", { amount: Math.round(s.treasury * 0.2) })}>
              Skim 20% of the treasury
            </Btn>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Borrowing raises the country&apos;s debt and its spread. Skimming is theft from the state: it lands in your pocket, raises corruption
            and heat, and the audit office writes it down.
          </p>
          <div className="mt-3">
            <p className="tick">State debt</p>
            {g.debt.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">Nothing borrowed.</p>
            ) : (
              g.debt.slice(0, 6).map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 border-t border-white/5 py-1 text-xs">
                  <span>
                    {d.lender} · {d.rate.toFixed(2)}% · {formatINR(d.remaining)} left
                  </span>
                  <Btn kind="ghost" onClick={() => biz("govDebtRepay", "", { debtId: d.id, amount: Math.min(d.remaining, Math.round(s.treasury * 0.5)) })}>
                    Repay
                  </Btn>
                </div>
              ))
            )}
          </div>
          <div className="mt-3">
            <p className="tick">Money you owe the state</p>
            {g.loans.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">You have not borrowed from the treasury.</p>
            ) : (
              g.loans.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-2 border-t border-white/5 py-1 text-xs">
                  <span>
                    {formatINR(l.remaining)} at {l.rate.toFixed(2)}% · {formatINR(l.monthly)}/mo
                  </span>
                  <Btn kind="ghost" onClick={() => biz("govLoanRepay", "", { loanId: l.id, amount: l.remaining })}>
                    Clear
                  </Btn>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* ----------------------------------------------- infrastructure */}
        <Card>
          <Label>Build the country</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Every project is paid for monthly out of the treasury. A project you cannot fund stalls — and voters notice half-built bridges.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <Field label="Project">
              <Select value={infraKind} onChange={(e) => setInfraKind(e.target.value as typeof infraKind)}>
                {INFRA_IDS.map((k) => (
                  <option key={k} value={k}>
                    {INFRA_DEFS[k].name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Where">
              <Select value={infraCity} onChange={(e) => setInfraCity(e.target.value)}>
                {(cities.length ? cities : state.world.cities).map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name} · infra {Math.round(ct.infrastructure)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Scale (1–10×)">
              <Input value={scale} onChange={(e) => setScale(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{INFRA_DEFS[infraKind].blurb}</p>
          <div className="mt-2">
            <Row k="Budget" v={formatINR(q.budget)} />
            <Row k="Monthly draw" v={`${formatINR(q.monthly)} × ${q.months} months`} />
            <Row
              k="On completion"
              v={Object.entries(q.effects)
                .map(([k, v]) => `${k} +${(Number(v) * Math.pow(q.scale, 0.85)).toFixed(1)}`)
                .join(" · ")}
              tone="good"
            />
          </div>
          <Btn className="mt-2" disabled={!ruling} onClick={() => biz("govInfra", "", { kind: infraKind, cityId: infraCity, scale: num(scale) })}>
            Break ground ({formatINR(q.budget * 0.08)} deposit)
          </Btn>
          <div className="mt-3">
            <p className="tick">On site</p>
            {g.projects.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">Nothing under construction.</p>
            ) : (
              g.projects.map((pj) => (
                <div key={pj.id} className="border-t border-white/5 py-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {pj.name} · {pj.stage === "done" ? "complete" : `${Math.round(pj.progress)}%`}
                      {pj.stage === "stalled" ? " · STALLED (no money)" : ""}
                    </span>
                    {pj.stage !== "done" ? (
                      <Btn kind="danger" onClick={() => biz("govInfraCancel", "", { projectId: pj.id })}>
                        Cancel
                      </Btn>
                    ) : null}
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-white/10">
                    <div className="h-1.5 rounded bg-teal-300" style={{ width: `${Math.min(100, pj.progress)}%` }} />
                  </div>
                  <span className="text-[var(--muted)]">
                    {formatINR(pj.spent)} of {formatINR(pj.budget)} · started {pj.startYear}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* ----------------------------------------------------- schemes */}
        <Card>
          <Label>Government schemes</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Recurring programmes. Each one costs the treasury every month and pays you back in approval, jobs, health and growth — slowly, and only
            while you keep funding it.
          </p>
          <div className="mt-2 max-h-96 space-y-1 overflow-y-auto text-xs">
            {SCHEME_IDS.map((k) => {
              const live = g.schemes.find((x) => x.kind === k && x.countryId === c.id);
              const cost = schemeQuote(state, k, 100).monthlyCost;
              return (
                <div key={k} className="border-t border-white/5 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <b>{SCHEME_DEFS[k].name}</b>
                      <span className="ml-1 text-[var(--muted)]">{live ? `funded ${live.funding}% · ${formatINR(live.monthlyCost)}/mo` : `${formatINR(cost)}/mo at 100%`}</span>
                    </span>
                    <span className="flex gap-1">
                      {[0, 25, 50, 100].map((f) => (
                        <Btn key={f} kind={live?.funding === f ? "teal" : "ghost"} onClick={() => biz("govScheme", "", { kind: k, funding: f })}>
                          {f}
                        </Btn>
                      ))}
                    </span>
                  </div>
                  <p className="text-[var(--muted)]">{SCHEME_DEFS[k].blurb}</p>
                </div>
              );
            })}
          </div>
        </Card>

        {/* -------------------------------------------------------- laws */}
        <Card>
          <Label>The legislature</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Support comes from your party&apos;s share of the seats, your popularity, the members you have patronised — and, if you have suspended
            the constitution, from fear. Bills that fail still cost you a point of approval.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <Field label="Bill">
              <Select value={lawKind} onChange={(e) => setLawKind(e.target.value as typeof lawKind)}>
                {LAW_IDS.map((k) => (
                  <option key={k} value={k}>
                    {LAW_DEFS[k].name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Btn disabled={!ruling} onClick={() => biz("govLaw", "", { kind: lawKind })}>
                Put it to the vote ({odds.support}%{odds.auto ? " · by decree" : ""})
              </Btn>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{LAW_DEFS[lawKind].blurb}</p>
          <div className="mt-2">
            <Row k="Your seats" v={pct(odds.seatPct, 0)} />
            <Row k="Expected support" v={odds.auto ? "decree — it passes" : `${odds.support}%`} tone={odds.auto || odds.support >= 50 ? "good" : "bad"} />
          </div>
          <div className="mt-3">
            <p className="tick">On the statute book</p>
            {g.laws.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">Nothing passed yet.</p>
            ) : (
              g.laws
                .slice(-8)
                .reverse()
                .map((l) => (
                  <div key={l.id} className="flex justify-between border-t border-white/5 py-1 text-xs">
                    <span>{l.name}</span>
                    <span className="text-[var(--muted)]">
                      {l.month}/{l.year} · {l.support}%
                    </span>
                  </div>
                ))
            )}
          </div>
        </Card>

        {/* -------------------------------------------- corporate taxes */}
        <Card className="xl:col-span-2">
          <Label>Tax any company · company by company</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Standard corporate tax in {c.name} is {c.corpTax.toFixed(1)}%. On top of that you can levy a turnover tax on any firm, subsidy it,
            exempt it entirely, nationalise it (once the framework is law) or seize its cash. Every one of these is visible to every other board in
            the country.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="tick text-left">
                <tr>
                  <th className="py-1">Company</th>
                  <th>Turnover/mo</th>
                  <th>Profit/mo</th>
                  <th>Status</th>
                  <th className="text-right">Your levers</th>
                </tr>
              </thead>
              <tbody>
                {firms.map((co) => {
                  const lv = levyOf(state, co);
                  const lev = (v: number) => biz("govLevy", "", { companyId: co.id, levy: "levy", rate: v });
                  return (
                    <tr key={co.id} className="border-t border-white/5">
                      <td className="py-1 pr-2">
                        <span className="font-medium">{co.name}</span>
                        <div className="text-[var(--muted)]">
                          {co.industry} · sentiment {Math.round(co.sentiment)}
                        </div>
                      </td>
                      <td>{formatINR(co.revenue / 12)}</td>
                      <td className={co.profit >= 0 ? "text-teal-300" : "text-rose-300"}>{formatINR(co.profit / 12)}</td>
                      <td>
                        {lv
                          ? lv.kind === "levy"
                            ? `levy ${lv.rate}% · ${formatINR(lv.collected)} taken`
                            : lv.kind === "subsidy"
                              ? `subsidy ${lv.rate}%`
                              : lv.kind === "exempt"
                                ? "tax exempt"
                                : "state-owned"
                          : "standard"}
                      </td>
                      <td className="py-1">
                        <div className="flex flex-wrap justify-end gap-1">
                          <Btn kind={lv?.kind === "levy" && lv.rate === 5 ? "teal" : "ghost"} onClick={() => lev(5)}>
                            Levy 5%
                          </Btn>
                          <Btn kind={lv?.kind === "levy" && lv.rate === 15 ? "teal" : "ghost"} onClick={() => lev(15)}>
                            Levy 15%
                          </Btn>
                          <Btn kind={lv?.kind === "subsidy" ? "teal" : "ghost"} onClick={() => biz("govLevy", "", { companyId: co.id, levy: "subsidy", rate: 5 })}>
                            Subsidise 5%
                          </Btn>
                          <Btn kind={lv?.kind === "exempt" ? "teal" : "ghost"} onClick={() => biz("govLevy", "", { companyId: co.id, levy: "exempt", rate: 0 })}>
                            Exempt
                          </Btn>
                          <Btn kind="ghost" onClick={() => biz("govLevy", "", { companyId: co.id, levy: "none", rate: 0 })}>
                            Reset
                          </Btn>
                          <Btn kind="ghost" onClick={() => biz("govNationalise", "", { companyId: co.id })}>
                            Nationalise
                          </Btn>
                          <Btn kind="danger" onClick={() => biz("govSeize", "", { companyId: co.id })}>
                            Seize cash
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Nationalisation pays sixty per cent of the last valuation — including your own shares — and every future profit flows to the treasury at
            an efficiency cost. Seizing cash is faster and far more expensive in the long run.
          </p>
        </Card>

        {/* ------------------------------------------------------ regime */}
        <Card className="xl:col-span-2">
          <Label>
            The constitution · {g.regime.type}
            {g.regime.electionsSuspended ? " · elections suspended" : ""}
          </Label>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div>
              <Meter label="Legitimacy" value={g.regime.legitimacy} />
              <Meter label="Unrest" value={g.regime.unrest} />
              <Meter label="Press freedom" value={g.regime.pressFreedom} />
            </div>
            <div>
              <Meter label="Internal security" value={g.regime.secretPolice} />
              <Meter label="Sanctions" value={g.sanctions} />
              <Meter label="Corruption" value={g.corruption} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind={g.regime.electionsSuspended ? "teal" : "ghost"} disabled={!ruling} onClick={() => biz("govRegime", "", { move: "emergency" })}>
              Declare emergency (suspend elections)
            </Btn>
            <Btn kind={!g.regime.electionsSuspended ? "teal" : "ghost"} disabled={!ruling} onClick={() => biz("govRegime", "", { move: "restore" })}>
              Restore constitutional order
            </Btn>
            <Btn kind="ghost" disabled={!ruling} onClick={() => biz("govRegime", "", { move: "censor", level: 20 })}>
              Tighten the press
            </Btn>
            <Btn kind="ghost" disabled={!ruling} onClick={() => biz("govRegime", "", { move: "secret", level: 25 })}>
              Build internal security (+25)
            </Btn>
            <Btn kind="ghost" disabled={!ruling} onClick={() => biz("govRegime", "", { move: "dissolve" })}>
              Dissolve the chamber
            </Btn>
            <Btn kind="ghost" disabled={!ruling} onClick={() => biz("govRegime", "", { move: "referendum" })}>
              Call a referendum
            </Btn>
            <Btn kind="ghost" disabled={!ruling} onClick={() => biz("govRegime", "", { move: "purge" })}>
              Purge the officer corps
            </Btn>
            <Btn kind="ghost" disabled={!ruling} onClick={() => biz("govRegime", "", { move: "amnesty" })}>
              Amnesty
            </Btn>
            <Btn kind="danger" disabled={!ruling} onClick={() => biz("govRegime", "", { move: "dictator" })}>
              Assume personal rule
            </Btn>
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Personal rule needs emergency powers, internal security at 45+ and either popularity 50+ or full power. Once you have it every law
            passes by decree, elections never come — and unrest, legitimacy and the generals decide how long you last.
            {g.regime.coups ? ` You have already survived ${g.regime.coups} attempt${g.regime.coups === 1 ? "" : "s"}.` : ""}
          </p>
        </Card>

        <Card className="xl:col-span-2">
          <Label>State ledger</Label>
          {g.log.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto text-xs">
              {g.log.slice(0, 40).map((l, i) => (
                <li key={i} className="border-t border-white/5 pt-1">
                  <span className="text-[var(--muted)]">{l.t}</span> · {l.text}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ============================================================= war */

export function WarView({ state, act }: { state: GameState; act: Act }) {
  const biz = useBiz(act);
  const s = govSummary(state);
  const g = s.gov;
  const c = s.country;
  const ruling = canRule(state);
  const enemies = state.world.countries.filter((x) => x.id !== c.id);
  const [enemy, setEnemy] = useState(enemies[0]?.id ?? "");
  const [objective, setObjective] = useState<keyof typeof WAR_OBJECTIVES>("reparations");
  const [intensity, setIntensity] = useState(2);
  const preview = warPreview(state, enemy, intensity as 1 | 2 | 3);
  const [budget, setBudget] = useState(String(g.defence.budget));
  const [equip, setEquip] = useState(String(Math.round(g.defence.equipment)));
  const active = g.wars.filter((w) => w.status === "active");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Military power" value={`${s.power}`} sub={`readiness ${Math.round(g.defence.readiness)}/100`} />
        <Stat label="Defence budget" value={`${formatINR(g.defence.budget)}/mo`} />
        <Stat label="Equipment" value={`${Math.round(g.defence.equipment)}/100`} />
        <Stat label="Personnel" value={`${Math.round(g.defence.personnel)}/100`} />
        <Stat label="Wars" value={`${g.stats.warsWon} won · ${g.stats.warsLost} lost`} tone={g.stats.warsLost ? "bad" : undefined} />
      </div>

      {!ruling ? <NotInPower state={state} /> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <Label>The army you pay for</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Power is not a number you set — it is GDP, population, technology, infrastructure, the budget you vote, the equipment you bought, the
            allies you still have, and how tired the country is.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <Field label="Monthly budget ₹">
              <Input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Equipment programme (0–100)">
              <Input value={equip} onChange={(e) => setEquip(e.target.value)} inputMode="numeric" />
            </Field>
            <div className="flex items-end">
              <Btn
                disabled={!ruling}
                onClick={() => biz("govDefence", "", { budget: Math.max(0, Math.round(num(budget))), equipment: clamp100(num(equip)) })}
              >
                Set budget &amp; equipment
              </Btn>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {[10, 25, 50, 75, 100].map((v) => (
              <Btn key={v} kind="ghost" disabled={!ruling} onClick={() => biz("govDefence", "", { equipment: v })}>
                Equipment {v}
              </Btn>
            ))}
            <Btn kind="ghost" disabled={!ruling} onClick={() => biz("govLaw", "", { kind: "conscription" })}>
              Conscription act
            </Btn>
          </div>
          <div className="mt-2">
            <Row k="Readiness" v={`${Math.round(g.defence.readiness)}/100`} tone={g.defence.readiness > 55 ? "good" : g.defence.readiness < 30 ? "bad" : undefined} />
            <Row k="Tribute in" v={`${formatINR(g.tribute.filter((t) => t.monthly > 0).reduce((a, t) => a + t.monthly, 0))}/mo`} tone="good" />
            <Row k="Reparations out" v={`−${formatINR(Math.abs(g.tribute.filter((t) => t.monthly < 0).reduce((a, t) => a + t.monthly, 0)))}/mo`} tone="bad" />
            <Row k="Territories annexed" v={g.stats.annexed.length ? g.stats.annexed.length : "none"} />
          </div>
        </Card>

        <Card>
          <Label>Declare war</Label>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <Field label="On">
              <Select value={enemy} onChange={(e) => setEnemy(e.target.value)}>
                {enemies.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {c.relations[e.id] ?? "neutral"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Objective">
              <Select value={objective} onChange={(e) => setObjective(e.target.value as typeof objective)}>
                {(Object.keys(WAR_OBJECTIVES) as (keyof typeof WAR_OBJECTIVES)[]).map((k) => (
                  <option key={k} value={k}>
                    {WAR_OBJECTIVES[k].name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Intensity ${intensity}/3`}>
              <input type="range" min={1} max={3} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} className="mt-3 w-full" />
            </Field>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">{WAR_OBJECTIVES[objective].blurb}</p>
          {preview ? (
            <div className="mt-2">
              <Row k="Your strength" v={`${preview.our}`} />
              <Row k="Their strength" v={`${preview.theirs}`} />
              <Row k="Share of force" v={preview.odds} tone={preview.ratio > 0.55 ? "good" : preview.ratio < 0.45 ? "bad" : undefined} />
              <Row k="Cost" v={`≈${formatINR(preview.monthly)}/month`} tone="bad" />
              <Row k="Expected casualties" v={`${preview.casualties.toLocaleString("en-IN")}/year`} tone="bad" />
            </div>
          ) : null}
          <Btn
            className="mt-2"
            kind="danger"
            disabled={!ruling || active.length > 0}
            onClick={() => biz("govWar", "", { enemyId: enemy, objective, intensity })}
          >
            {active.length ? "Settle the open front first" : "Declare war"}
          </Btn>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            A war with no cause brings sanctions, and every country that was friendly to your enemy stops being friendly to you. Losing costs you
            reparations, a quarter of your approval and possibly the chair itself.
          </p>
        </Card>

        {active.map((w) => {
          const e = state.world.countries.find((x) => x.id === w.enemyId);
          return (
            <Card key={w.id} className="xl:col-span-2">
              <Label>
                Front · {c.name} vs {e?.name}
              </Label>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Objective {WAR_OBJECTIVES[w.objective].name.toLowerCase()} · intensity {w.intensity}/3 · opened {w.startYear}
              </p>
              <div className="mt-2 grid gap-3 md:grid-cols-4">
                <div>
                  <Meter label="Front line (−100 to +100)" value={w.front + 100} max={200} />
                  <p className="text-[11px] text-[var(--muted)]">
                    {w.front >= 60 ? "You are inside their territory" : w.front >= 0 ? "Contested" : w.front >= -60 ? "They hold the initiative" : "They are at your border"}
                  </p>
                </div>
                <div>
                  <Meter label="Territory held" value={w.occupation} />
                  <Meter label="War exhaustion" value={w.exhaustion} />
                </div>
                <div>
                  <Row k="Your casualties" v={w.ourCasualties.toLocaleString("en-IN")} tone="bad" />
                  <Row k="Their casualties" v={w.theirCasualties.toLocaleString("en-IN")} />
                  <Row k="Spent so far" v={formatINR(w.spend)} tone="bad" />
                </div>
                <div>
                  <Row k="Your strength" v={`${w.ourStrength}`} />
                  <Row k="Their strength" v={`${w.enemyStrength}`} />
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Btn kind="ghost" onClick={() => biz("govWarMove", "", { warId: w.id, move: "escalate" })}>
                      Escalate
                    </Btn>
                    <Btn kind="ghost" onClick={() => biz("govWarMove", "", { warId: w.id, move: "deescalate" })}>
                      Dial back
                    </Btn>
                    <Btn kind="gold" onClick={() => biz("govWarMove", "", { warId: w.id, move: "peace" })}>
                      Sue for peace
                    </Btn>
                    <Btn kind="danger" onClick={() => biz("govWarMove", "", { warId: w.id, move: "annex" })}>
                      Annex (needs front +100)
                    </Btn>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <p className="tick">Dispatches</p>
                <div className="mt-1 max-h-48 space-y-1 overflow-y-auto text-xs">
                  {w.battles.slice(0, 20).map((b, i) => (
                    <div key={i} className="flex justify-between gap-2 border-t border-white/5 py-1">
                      <span className="min-w-0 truncate">
                        {b.t} · {b.text}
                      </span>
                      <span className={b.swing >= 0 ? "text-teal-300" : "text-rose-300"}>
                        {b.swing >= 0 ? "+" : ""}
                        {b.swing} · −{b.ourLoss.toLocaleString("en-IN")} / −{b.theirLoss.toLocaleString("en-IN")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          );
        })}

        <Card className="xl:col-span-2">
          <Label>The world, by force</Label>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="tick text-left">
                <tr>
                  <th className="py-1">Country</th>
                  <th>GDP</th>
                  <th>Population</th>
                  <th>Tech</th>
                  <th>Power</th>
                  <th>Relation</th>
                  <th>Your odds</th>
                </tr>
              </thead>
              <tbody>
                {state.world.countries
                  .filter((x) => x.id !== c.id)
                  .map((o) => {
                    const p = warPreview(state, o.id, 2);
                    return (
                      <tr key={o.id} className="border-t border-white/5">
                        <td className="py-1 pr-2 font-medium">{o.name}</td>
                        <td>{formatINR(o.gdp)}</td>
                        <td>{(o.population / 1e6).toFixed(0)}M</td>
                        <td>{Math.round(o.techLevel)}</td>
                        <td>{Math.round(militaryPower(state, o, getGov(state), true))}</td>
                        <td>{c.relations[o.id] ?? "neutral"}</td>
                        <td className={p && p.ratio > 0.55 ? "text-teal-300" : p && p.ratio < 0.45 ? "text-rose-300" : ""}>{p ? p.odds : "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">Odds are the share of force at intensity 2, before luck and before anyone else joins in.</p>
        </Card>

        <Card className="xl:col-span-2">
          <Label>Wars fought</Label>
          {g.wars.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">None. The country has been at peace.</p>
          ) : (
            <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto text-xs">
              {g.wars
                .slice()
                .reverse()
                .map((w) => (
                  <li key={w.id} className="border-t border-white/5 pt-1">
                    <span className="text-[var(--muted)]">
                      {w.startYear} · {state.world.countries.find((x) => x.id === w.enemyId)?.name ?? w.enemyId} · {w.status}
                    </span>{" "}
                    · {w.outcome || "ongoing"} · {formatINR(w.spend)} spent · {w.ourCasualties.toLocaleString("en-IN")} of your people
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
