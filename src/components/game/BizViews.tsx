"use client";

// Round-2 management screens: run a company from HQ, a bank, a brokerage and
// your own money with brokers and deposits; manage estates and developers; and
// deal with the government — taxes, benefits, the AI jobs squeeze, education.
// State is mutated in place by the engine, so nothing here is memoised.
import { useState, type ReactNode } from "react";
import type { GameState, ListedCompany, PlayerAction, PropertyHolding } from "@/lib/sim/types";
import type { BrokerTier, DevProject, ManagerTier, RoleId, Strategy } from "@/lib/sim/biz";
import { getBiz } from "@/lib/sim/biz";
import {
  AGENT_ROLES,
  agentCost,
  aiBillOf,
  costStructure,
  debtCapacity,
  effectiveWorkforce,
  expansionCost,
  getHQ,
  mergerQuote,
  ROLE_DEFS,
  ROLE_IDS,
  roleSalary,
  STRATEGIES,
} from "@/lib/sim/company";
import { bankMarket, bankValue, BROKER_HIRE, BROKER_TIERS, brokerageValue, capitalRatio, fdRate, getBankOps, staffNeed } from "@/lib/sim/finfirms";
import { DEV_KINDS, DEVELOPERS, devQuote, getEstate, MANAGERS, marketRent } from "@/lib/sim/estates";
import { aiJobPressure, allTracks, benefitQuote, CERTS, jobAiRisk, quoteTax, STUDY_LEVELS } from "@/lib/sim/civic";
import { industryMeta } from "@/lib/sim/catalog";
import { liquidCash } from "@/lib/sim/finance";
import { formatINR } from "@/lib/sim/util";
import { Btn, Card, Field, Input, Label, Select, Spark, Stat } from "./ui";

type Act = (a: PlayerAction) => void;
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
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

function LogList({ items }: { items: { t: string; text: string }[] }) {
  if (!items.length) return <p className="mt-2 text-xs text-[var(--muted)]">Nothing yet.</p>;
  return (
    <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs">
      {items.slice(0, 30).map((l, i) => (
        <li key={i} className="border-t border-white/5 pt-1">
          <span className="text-[var(--muted)]">{l.t}</span> · {l.text}
        </li>
      ))}
    </ul>
  );
}

/** A number box with an apply button. */
function Apply({
  label,
  init,
  onApply,
  cta = "Set",
  hint,
}: {
  label: string;
  init: number | string;
  onApply: (n: number) => void;
  cta?: string;
  hint?: string;
}) {
  const [v, setV] = useState(String(init));
  return (
    <div>
      <Field label={label}>
        <div className="flex gap-2">
          <Input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" />
          <Btn kind="ghost" onClick={() => onApply(num(v))}>
            {cta}
          </Btn>
        </div>
      </Field>
      {hint ? <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

/* ====================================================================== HQ */

export function CompanyHQView({ state, act }: { state: GameState; act: Act }) {
  const mine = state.world.companies.filter((c) => state.player.ownedCompanyIds.includes(c.id) && c.stage !== "bankrupt");
  const [sel, setSel] = useState<string | null>(null);
  const co = mine.find((c) => c.id === sel) ?? mine[0];
  if (!co) {
    return (
      <Card>
        <Label>Company HQ</Label>
        <p className="mt-2 text-sm text-[var(--muted)]">
          You don&apos;t control a company yet. Found one in Companies, or take one over in Stakes &amp; Takeovers (over 50%). Once you control a company you
          run it from here: headcount by department, pay, AI agents, strategy, new markets, the AI lab, buybacks, debt and acquisitions.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      {mine.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {mine.map((c) => (
            <Btn key={c.id} kind={c.id === co.id ? "gold" : "ghost"} onClick={() => setSel(c.id)}>
              {c.name}
            </Btn>
          ))}
        </div>
      ) : null}
      <HQBody key={co.id} state={state} act={act} co={co} />
    </div>
  );
}

function HQBody({ state, act, co }: { state: GameState; act: Act; co: ListedCompany }) {
  const biz = useBiz(act);
  const hq = getHQ(state, co);
  const rep = hq.lastReport;
  const wf = effectiveWorkforce(state, co, hq);
  const [targets, setTargets] = useState<Record<RoleId, string>>(() => ({
    eng: String(hq.roles.eng.target),
    sales: String(hq.roles.sales.target),
    ops: String(hq.roles.ops.target),
    mgmt: String(hq.roles.mgmt.target),
  }));
  const [agents, setAgents] = useState<Record<string, string>>(() => ({
    eng: String(hq.agents.eng),
    sales: String(hq.agents.sales),
    ops: String(hq.agents.ops),
  }));
  const [strategy, setStrategy] = useState<Strategy>(hq.strategy);
  const [payout, setPayout] = useState(String(Math.round(hq.payout * 100)));
  const [city, setCity] = useState("");
  const [target, setTarget] = useState("");
  const [premium, setPremium] = useState(25);
  const [funding, setFunding] = useState<"cash" | "debt" | "stock">("cash");
  const cs = costStructure(state, co);
  const ai = aiBillOf(state, co, hq);
  const monthlyBurn = Math.max(0, -co.profit / 12);
  const runway = monthlyBurn > 0 ? co.cash / monthlyBurn : Infinity;
  const planned = ROLE_IDS.reduce((s, r) => s + Math.max(0, num(targets[r])) * roleSalary(state, co, r), 0);
  const cities = state.world.cities.filter((c) => c.id !== co.cityId && !hq.markets.some((m) => m.cityId === c.id));
  const targets2 = state.world.companies.filter((c) => c.id !== co.id && c.stage !== "bankrupt" && c.shares > 0).sort((a, b) => b.valuation - a.valuation);
  const quote = target ? mergerQuote(state, co.id, target, premium) : null;
  const peers = [...state.world.companies]
    .filter((c) => c.stage !== "bankrupt" && c.employees > 0 && c.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .filter((c, i, arr) => c.industry === "ai" || arr.slice(0, i).filter((x) => x.industry !== "ai").length < 5)
    .slice(0, 10);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <Stat
          label="Revenue / month"
          value={formatINR(co.revenue / 12)}
          sub={rep ? `demand ${formatINR(rep.demand)} · capacity ${formatINR(rep.capacity)}` : co.stage}
        />
        <Stat
          label="Profit / month"
          value={formatINR(rep?.profit ?? co.profit / 12)}
          tone={(rep?.profit ?? co.profit) >= 0 ? "good" : "bad"}
          sub={`payout ${formatINR(rep?.payout ?? 0)}`}
        />
        <Stat
          label="Company cash"
          value={formatINR(co.cash)}
          tone={co.cash < 0 ? "bad" : undefined}
          sub={Number.isFinite(runway) ? `runway ${runway.toFixed(1)} months` : "cash-generative"}
        />
        <Stat
          label="People"
          value={`${co.employees} staff`}
          sub={`morale ${Math.round(hq.morale)} · ${wf.agents} AI agents · bottleneck ${ROLE_DEFS[wf.bottleneck].name.split(" ")[0]}`}
        />
      </div>

      <Card>
        <Label>CEO — free, runs your whole company</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Your CEO is <span className="text-teal-300 font-medium">free</span> — no salary for the first manager. Toggle auto-pilot and the CEO hires, fixes the bottleneck ({ROLE_DEFS[wf.bottleneck].name}), deploys agents, expands to new cities and tells you which company to buy. One click to buy what the CEO recommends.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn kind={(hq as any).ceoAuto ? "teal" : "ghost"} onClick={() => biz("hqCeoToggle", co.id, { on: !(hq as any).ceoAuto } as any)}>
            {(hq as any).ceoAuto ? "CEO auto-manages ✓ (free)" : "CEO auto-manages (free)"}
          </Btn>
          <Btn kind="gold" onClick={() => biz("hqCeoBuy", co.id)}>
            CEO: Buy this company →
          </Btn>
          <span className="text-xs text-[var(--muted)]">
            CEO pick: {(() => {
              const pool = state.world.companies.filter(c=>c.id!==co.id && c.stage!=="bankrupt" && c.valuation>0 && !state.player.ownedCompanyIds.includes(c.id));
              let best:any=null, bestScore=-1e18;
              for(const cand of pool){
                const cheap = cand.revenue/Math.max(1,cand.valuation);
                const same = cand.industry===co.industry?1.8:1.0;
                const score = cheap*1000*same + (cand.valuation<2e9?200:0);
                if(score>bestScore){bestScore=score; best=cand;}
              }
              return best ? `${best.name} (${best.industry}) · ${formatINR(best.valuation)}` : "nothing cheap right now";
            })()}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">{(hq as any).ceoAuto ? "Auto: headcount, pay, agents and expansions happen every month. You just set strategy." : "Manual: CEO is idle — you control every hire yourself."}</p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <Label>Monthly P&amp;L (last month)</Label>
          {rep ? (
            <div className="mt-2">
              <Row k="Revenue" v={formatINR(rep.revenue)} tone="good" />
              <Row k="Payroll" v={`−${formatINR(rep.payroll)}`} />
              <Row k="Hiring & severance" v={`−${formatINR(rep.hiring)}`} />
              <Row k="AI agents & compute" v={`−${formatINR(rep.aiBill)}`} />
              <Row k="Cost of goods" v={`−${formatINR(rep.cogs)}`} />
              <Row k="Marketing + R&D" v={`−${formatINR(rep.marketing + rep.rd)}`} />
              <Row k="Strategy & expansion" v={`−${formatINR(rep.strategy + rep.expansion)}`} />
              <Row k="Interest + tax" v={`−${formatINR(rep.interest + rep.tax)}`} />
              <Row k="Net" v={formatINR(rep.profit)} tone={rep.profit >= 0 ? "good" : "bad"} />
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                {rep.demand > rep.capacity
                  ? `You are turning away ${formatINR(rep.demand - rep.capacity)}/month of demand — hire (or deploy agents) in ${ROLE_DEFS[wf.bottleneck].name}.`
                  : rep.capacity > rep.demand * 1.6
                    ? "Capacity far exceeds demand: you're paying people you don't need yet. Grow sales, or trim targets."
                    : "Capacity and demand are roughly balanced."}
                {` Last month: ${rep.hires} hired, ${rep.attrition} left.`}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--muted)]">The first HQ report arrives after a month.</p>
          )}
        </Card>

        <Card>
          <Label>Workforce plan</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            HR hires about 15% of each target a month (recruiting costs 15% of a salary). Cutting a target lays people off immediately (2 months&apos;
            severance, morale scar). One manager keeps about 8 people productive.
          </p>
          <div className="mt-2 space-y-2">
            {ROLE_IDS.map((r) => (
              <div key={r} className="grid grid-cols-[1fr_80px_80px] items-center gap-2 text-sm">
                <div>
                  <p>{ROLE_DEFS[r].name}</p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {formatINR(roleSalary(state, co, r))}/yr each · {ROLE_DEFS[r].blurb}
                  </p>
                </div>
                <p className="text-right text-[var(--muted)]">{hq.roles[r].count} now</p>
                <Input value={targets[r]} onChange={(e) => setTargets({ ...targets, [r]: e.target.value })} inputMode="numeric" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Btn
              onClick={() =>
                biz("hqRoles", co.id, {
                  targets: Object.fromEntries(ROLE_IDS.map((r) => [r, Math.max(0, Math.round(num(targets[r])))])),
                })
              }
            >
              Apply plan
            </Btn>
            <span className="text-xs text-[var(--muted)]">Planned payroll {formatINR(planned / 12)}/month</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["below", "market", "above"] as const).map((p) => (
              <Btn key={p} kind={hq.pay === p ? "teal" : "ghost"} onClick={() => biz("hqPay", co.id, { pay: p })}>
                Pay {p === "market" ? "at market" : `${p} market`}
              </Btn>
            ))}
          </div>
        </Card>

        <Card>
          <Label>AI agents</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Each agent seat costs {formatINR(agentCost(state))}/yr in compute and licences and does a share of a role&apos;s automatable work. The cost falls as
            AI improves (world AI {state.world.tech.ai.toFixed(0)}
            ). Too many agents and quality slips; staff fear for their jobs.
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {AGENT_ROLES.map((r) => (
              <Field key={r} label={`${ROLE_DEFS[r].name.split(" ")[0]} (auto ${Math.round(ROLE_DEFS[r].auto * 100)}%)`}>
                <Input value={agents[r]} onChange={(e) => setAgents({ ...agents, [r]: e.target.value })} inputMode="numeric" />
              </Field>
            ))}
          </div>
          <Btn
            className="mt-2"
            onClick={() =>
              biz("hqAgents", co.id, {
                agents: Object.fromEntries(AGENT_ROLES.map((r) => [r, Math.max(0, Math.round(num(agents[r])))])),
              })
            }
          >
            Deploy
          </Btn>
          <div className="mt-3">
            <Row k="Agent seats" v={`${formatINR(ai.agents / 12)}/mo`} />
            {hq.lab ? (
              <>
                <Row k="Inference compute" v={`${formatINR(ai.inference / 12)}/mo`} />
                <Row k="Training runs" v={`${formatINR(ai.training / 12)}/mo`} />
                <Row k="Owned GPU power" v={`${formatINR(ai.power / 12)}/mo`} />
              </>
            ) : null}
            <Row k="AI bill as % of revenue" v={pct(cs.aiPct)} />
            <Row k="Payroll as % of revenue" v={pct(cs.payrollPct)} />
            <Row k="Revenue per head" v={formatINR(cs.revPerHead)} />
          </div>
        </Card>

        <Card>
          <Label>Strategy &amp; payout</Label>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {(Object.keys(STRATEGIES) as Strategy[]).map((s) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`rounded-xl border p-2 text-left text-sm ${strategy === s ? "border-amber-200/60 bg-amber-200/10" : "border-white/10 hover:bg-white/5"}`}
              >
                <p>{STRATEGIES[s].name}</p>
                <p className="text-[11px] text-[var(--muted)]">{STRATEGIES[s].blurb}</p>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-end gap-2">
            <div className="w-40">
              <Field label="Dividend payout %">
                <Input value={payout} onChange={(e) => setPayout(e.target.value)} inputMode="numeric" />
              </Field>
            </div>
            <Btn
              onClick={() =>
                biz("hqStrategy", co.id, {
                  strategy,
                  payout: Math.max(0, Math.min(100, num(payout))) / 100,
                })
              }
            >
              Set
            </Btn>
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Dividends only go out if two months of costs stay in the bank. Your share lands in your wallet.
          </p>
        </Card>

        <Card>
          <Label>New markets</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">Opening a city costs a launch budget, then an office, and ramps up over a year.</p>
          {hq.markets.length ? (
            <div className="mt-2">
              {hq.markets.map((m) => (
                <Row
                  key={m.cityId}
                  k={state.world.cities.find((c) => c.id === m.cityId)?.name ?? m.cityId}
                  v={
                    <span className="flex items-center gap-2">
                      ramp {Math.round(m.ramp * 100)}%
                      <button className="text-xs text-rose-300 underline" onClick={() => biz("hqCloseMarket", co.id, { cityId: m.cityId })}>
                        close
                      </button>
                    </span>
                  }
                />
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex gap-2">
            <Select value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">Choose a city…</option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · pop {(c.population / 1e6).toFixed(1)}M · launch {formatINR(expansionCost(state, co, c.id))}
                </option>
              ))}
            </Select>
            <Btn disabled={!city} onClick={() => biz("hqExpand", co.id, { cityId: city })}>
              Expand
            </Btn>
          </div>
        </Card>

        {co.industry === "ai" || hq.lab ? <AILab state={state} act={act} co={co} /> : null}

        <Card>
          <Label>Capital</Label>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <Apply label="Put your money in (₹)" init={1000000} cta="Inject" onApply={(n) => biz("hqInject", co.id, { amount: n })} />
            <Apply
              label="Borrow (₹)"
              init={Math.round(Math.min(5e6, debtCapacity(co)))}
              cta="Borrow"
              hint={`Room ${formatINR(debtCapacity(co))} · debt ${formatINR(co.debt)}`}
              onApply={(n) => biz("hqBorrow", co.id, { amount: n })}
            />
            <Apply label="Repay debt (₹)" init={Math.round(co.debt)} cta="Repay" onApply={(n) => biz("hqRepay", co.id, { amount: n })} />
            <Apply label="Buy back shares (₹)" init={1000000} cta="Buy back" hint="Raises your stake" onApply={(n) => biz("hqBuyback", co.id, { amount: n })} />
            <Apply
              label="Issue new shares (% of company)"
              init={5}
              cta="Issue"
              hint="Raises cash, dilutes you"
              onApply={(n) => biz("hqIssue", co.id, { pct: n })}
            />
            <Apply label="Special dividend (₹)" init={1000000} cta="Pay" onApply={(n) => biz("hqSpecial", co.id, { amount: n })} />
          </div>
        </Card>

        <Card>
          <Label>Acquire a company</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Buy another company outright with {co.name}&apos;s cash, new debt or its own shares. The board of the target decides; big combined market share
            draws the competition regulator. Integration takes months and drags morale.
          </p>
          <div className="mt-2 space-y-2">
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a target…</option>
              {targets2.slice(0, 120).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.industry}) · {formatINR(c.valuation)}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2 text-sm">
              <span className="tick w-24">Premium {premium}%</span>
              <input type="range" min={0} max={100} value={premium} onChange={(e) => setPremium(Number(e.target.value))} className="flex-1" />
            </div>
            <div className="flex gap-2">
              {(["cash", "debt", "stock"] as const).map((f) => (
                <Btn key={f} kind={funding === f ? "teal" : "ghost"} onClick={() => setFunding(f)}>
                  {f === "cash" ? "Company cash" : f === "debt" ? "New debt" : "Our shares"}
                </Btn>
              ))}
            </div>
            {quote ? (
              <div>
                <Row k="Price" v={formatINR(quote.price)} />
                <Row k="Board acceptance odds" v={pct(quote.odds, 0)} />
                <Row k="Regulator block risk" v={pct(quote.antitrust, 0)} tone={quote.antitrust > 0.2 ? "bad" : undefined} />
                <Row k="Advisory fees" v={formatINR(quote.fee)} />
                <Row k="Company cash / debt room" v={`${formatINR(co.cash)} / ${formatINR(quote.debtRoom)}`} />
                <Btn
                  className="mt-2"
                  onClick={() =>
                    biz("hqAcquire", co.id, {
                      targetId: target,
                      premium,
                      funding,
                    })
                  }
                >
                  Make the offer
                </Btn>
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <Label>AI firms vs people firms</Label>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Revenue per employee and compute bills across the biggest companies — why AI companies scale differently.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="tick text-left">
                <tr>
                  <th className="py-1">Company</th>
                  <th>Sector</th>
                  <th>Staff</th>
                  <th>Rev/head</th>
                  <th>Compute/yr</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((c) => (
                  <tr key={c.id} className={`border-t border-white/5 ${c.id === co.id ? "text-amber-200" : ""}`}>
                    <td className="py-1">{c.name}</td>
                    <td>{c.industry}</td>
                    <td>{c.employees.toLocaleString("en-IN")}</td>
                    <td>{formatINR(c.revenue / Math.max(1, c.employees))}</td>
                    <td>{c.ai ? formatINR(c.ai.infraCost) : `~${formatINR(c.revenue * 0.03)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {co.name}: {industryMeta(co.industry).name} · AI exposure {industryMeta(co.industry).aiExpose > 0 ? "high" : "low"}.
          </p>
        </Card>

        <Card>
          <Label>HQ log</Label>
          <LogList items={hq.log} />
        </Card>
      </div>
    </>
  );
}

function AILab({ state, act, co }: { state: GameState; act: Act; co: ListedCompany }) {
  const biz = useBiz(act);
  const hq = getHQ(state, co);
  const ai = aiBillOf(state, co, hq);
  return (
    <Card>
      <Label>AI lab · compute</Label>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Serving models costs inference compute (about 22% of revenue, falling as the tech matures). Training runs raise model quality, which lifts revenue.
        Owning GPU nodes (₹25 L each + ₹9 L/yr power) cuts inference cost by up to 45%.
      </p>
      <div className="mt-2">
        <Row k="Model quality" v={co.ai ? co.ai.modelQuality.toFixed(0) : "—"} />
        <Row k="Owned GPU nodes" v={hq.lab?.gpus ?? 0} />
        <Row k="Compute bill" v={`${formatINR(ai.total / 12)}/mo`} />
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Apply label="Training budget (₹/yr)" init={hq.lab?.training ?? 0} onApply={(n) => biz("hqLab", co.id, { training: n })} />
        <Apply label="Buy GPU nodes" init={2} cta="Buy" onApply={(n) => biz("hqLab", co.id, { buyGpus: n })} />
      </div>
    </Card>
  );
}

/* ========================================================== bank & brokers */

export function FinanceHub({ state, act }: { state: GameState; act: Act }) {
  const biz = useBiz(act);
  const b = getBiz(state);
  const [fdBank, setFdBank] = useState(state.world.banks[0]?.id ?? "");
  const [fdAmt, setFdAmt] = useState("500000");
  const [fdMonths, setFdMonths] = useState(12);
  const [tier, setTier] = useState<BrokerTier>("junior");
  const [brAmt, setBrAmt] = useState("200000");
  const [risk, setRisk] = useState<"careful" | "balanced" | "aggressive">("balanced");
  const [firmName, setFirmName] = useState("");
  const myBanks = state.world.banks.filter((x) => x.playerOwned);
  const npcBanks = state.world.banks.filter((x) => !x.playerOwned && x.countryId === state.player.countryId);
  const br = b.broker;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <Label>Fixed deposits</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">Lock money for a better rate. Breaking early forfeits half the interest plus 1%.</p>
        {b.fds.length ? (
          <div className="mt-2">
            {b.fds.map((fd) => (
              <Row
                key={fd.id}
                k={`${fd.bankName} · ${fd.months}m at ${fd.rate}%`}
                v={
                  <span className="flex items-center gap-2">
                    {formatINR(fd.principal + fd.accrued)}
                    <button className="text-xs text-rose-300 underline" onClick={() => biz("breakFD", fd.id)}>
                      break
                    </button>
                  </span>
                }
              />
            ))}
          </div>
        ) : null}
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <Select value={fdBank} onChange={(e) => setFdBank(e.target.value)}>
            {state.world.banks
              .filter((x) => x.countryId === state.player.countryId || x.playerOwned)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
          </Select>
          <Select value={fdMonths} onChange={(e) => setFdMonths(Number(e.target.value))}>
            {[6, 12, 36, 60].map((m) => (
              <option key={m} value={m}>
                {m} months · {fdBank ? fdRate(state, fdBank, m) : 0}%
              </option>
            ))}
          </Select>
          <Input value={fdAmt} onChange={(e) => setFdAmt(e.target.value)} inputMode="numeric" />
        </div>
        <Btn className="mt-2" onClick={() => biz("openFD", fdBank, { amount: num(fdAmt), months: fdMonths })}>
          Open deposit
        </Btn>
      </Card>

      <Card>
        <Label>Your stockbroker</Label>
        {br ? (
          <>
            <p className="mt-1 text-sm">
              {br.name} · {BROKER_TIERS[br.tier].name} · {br.risk}
            </p>
            <Row k="Account value" v={formatINR(br.value)} />
            <Row k="Put in / taken out" v={`${formatINR(br.contributed)} / ${formatINR(br.withdrawn)}`} />
            <Row k="Gain" v={formatINR(br.value + br.withdrawn - br.contributed)} tone={br.value + br.withdrawn - br.contributed >= 0 ? "good" : "bad"} />
            <Row k="Fees" v={`${br.fee}%/yr${br.perfFee ? ` + ${br.perfFee}% above high-water` : ""}`} />
            {br.history.length > 1 ? <Spark values={[...br.history].reverse().map((h) => h.value)} /> : null}
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <Apply label="Add (₹) — negative withdraws" init={100000} cta="Move" onApply={(n) => biz("brokerFund", "", { amount: n })} />
              <div className="flex items-end">
                <Btn kind="danger" onClick={() => biz("fireBroker")}>
                  Fire &amp; cash out
                </Btn>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-[var(--muted)]">Hand money to a professional. Their skill is hidden — judge them by results against the market.</p>
            <div className="mt-2 grid gap-2">
              {(Object.keys(BROKER_TIERS) as BrokerTier[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTier(t)}
                  className={`rounded-xl border p-2 text-left text-sm ${tier === t ? "border-amber-200/60 bg-amber-200/10" : "border-white/10"}`}
                >
                  {BROKER_TIERS[t].name} · {BROKER_TIERS[t].fee}%{BROKER_TIERS[t].perf ? ` + ${BROKER_TIERS[t].perf}%` : ""} · min{" "}
                  {formatINR(BROKER_TIERS[t].min)}
                  <p className="text-[11px] text-[var(--muted)]">{BROKER_TIERS[t].blurb}</p>
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input value={brAmt} onChange={(e) => setBrAmt(e.target.value)} inputMode="numeric" />
              <Select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)}>
                <option value="careful">Careful</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </Select>
            </div>
            <Btn className="mt-2" onClick={() => biz("hireBroker", "", { tier, amount: num(brAmt), risk })}>
              Hire
            </Btn>
          </>
        )}
      </Card>

      {myBanks.map((bank) => (
        <BankCard key={bank.id} state={state} act={act} bankId={bank.id} />
      ))}

      <Card>
        <Label>Buy a bank</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Buy control of a bank at a 25% premium to its value. Or charter a new one from Banking (₹2 crore capital).
        </p>
        <div className="mt-2">
          {npcBanks.slice(0, 8).map((x) => (
            <Row
              key={x.id}
              k={`${x.name} · capital ${formatINR(x.capital)} · NPL ${x.npl.toFixed(1)}%`}
              v={
                <Btn kind="ghost" onClick={() => biz("buyBank", x.id)}>
                  Buy {formatINR(bankValue(state, x) * 1.25)}
                </Btn>
              }
            />
          ))}
        </div>
      </Card>

      {b.brokerages.map((f) => (
        <BrokerageCard key={f.id} state={state} act={act} id={f.id} />
      ))}
      <Card>
        <Label>Found a brokerage firm</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          ₹50 lakh net capital. Hire brokers (they bring clients and assets), analysts (better advice, reputation), compliance (fewer rogue-trader disasters).
          Earn commissions per trade and fees on managed money. Pay salaries and bonuses.
        </p>
        <div className="mt-2 flex gap-2">
          <Input placeholder="Firm name" value={firmName} onChange={(e) => setFirmName(e.target.value)} />
          <Btn
            onClick={() =>
              biz("foundBrokerage", "", {
                name: firmName || `${state.player.name.split(" ").pop()} Securities`,
              })
            }
          >
            Found
          </Btn>
        </div>
      </Card>
    </div>
  );
}

function BankCard({ state, act, bankId }: { state: GameState; act: Act; bankId: string }) {
  const biz = useBiz(act);
  const bank = state.world.banks.find((x) => x.id === bankId)!;
  const ops = getBankOps(state, bank);
  const mkt = bankMarket(state, bank);
  const cr = capitalRatio(bank, ops);
  const [f, setF] = useState(() => ({
    depositRate: String(ops.depositRate),
    lendingRate: String(ops.lendingRate),
    risk: String(ops.risk),
    staff: String(ops.staff),
    marketing: String(ops.marketing),
    dividendPct: String(Math.round(ops.dividendPct * 100)),
  }));
  const L = ops.last;
  return (
    <Card>
      <Label>Your bank · {bank.name}</Label>
      <div className="mt-2 grid grid-cols-2 gap-x-4">
        <Row k="Capital" v={formatINR(bank.capital)} />
        <Row k="Capital ratio" v={pct(cr)} tone={cr < 0.08 ? "bad" : cr < 0.105 ? undefined : "good"} />
        <Row k="Deposits" v={formatINR(bank.deposits)} />
        <Row k="Loans" v={formatINR(bank.loans)} />
        <Row k="Bad loans (NPL)" v={`${bank.npl.toFixed(1)}%`} tone={bank.npl > 6 ? "bad" : undefined} />
        <Row k="Depositor trust" v={Math.round(ops.trust)} />
        <Row k="Branches / staff" v={`${bank.branches} / ${ops.staff} (need ≈${staffNeed(bank)})`} />
        <Row k="Market rates" v={`${mkt.deposit}% / ${mkt.lending}%`} tone="muted" />
      </div>
      {L ? (
        <div className="mt-2 text-xs">
          <p className="tick">Last month</p>
          <Row k="Net interest income" v={formatINR(L.nii)} />
          <Row k="Fees" v={formatINR(L.fees)} />
          <Row k="Operating costs" v={`−${formatINR(L.opex)}`} />
          <Row k="Bad-loan write-offs" v={`−${formatINR(L.chargeoffs)}`} />
          <Row k="Tax" v={`−${formatINR(L.tax)}`} />
          <Row k="Net profit / your dividend" v={`${formatINR(L.net)} / ${formatINR(L.dividend)}`} tone={L.net >= 0 ? "good" : "bad"} />
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(
          [
            ["depositRate", "Deposit %"],
            ["lendingRate", "Loan %"],
            ["risk", "Risk appetite"],
            ["staff", "Staff"],
            ["marketing", "Marketing ₹/mo"],
            ["dividendPct", "Dividend %"],
          ] as const
        ).map(([k, lab]) => (
          <Field key={k} label={lab}>
            <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} inputMode="decimal" />
          </Field>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn
          onClick={() =>
            biz("bankSet", bank.id, {
              depositRate: num(f.depositRate),
              lendingRate: num(f.lendingRate),
              risk: num(f.risk),
              staff: num(f.staff),
              marketing: num(f.marketing),
              dividendPct: num(f.dividendPct) / 100,
            })
          }
        >
          Apply policy
        </Btn>
        <Btn kind={ops.auto !== false ? "teal" : "ghost"} onClick={() => biz("bankSet", bank.id, { auto: true })}>
          {ops.auto !== false ? "Rates auto" : "Auto-track rates"}
        </Btn>
        <Btn kind={(ops as any).marketingAuto ? "teal" : "ghost"} onClick={() => biz("bankSet", bank.id, { marketingAuto: !(ops as any).marketingAuto } as any)}>
          {(ops as any).marketingAuto ? "Marketing auto ✓" : "Marketing auto"}
        </Btn>
        <Btn kind={(ops as any).ceoAuto ? "teal" : "ghost"} onClick={() => biz("bankSet", bank.id, { ceoAuto: !(ops as any).ceoAuto } as any)}>
          {(ops as any).ceoAuto ? "CEO auto ✓ free" : "CEO auto (free)"}
        </Btn>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="tick w-full">Branches — no limit (₹50 L fit-out each)</span>
        {[1,5,10].map(n=>(
          <Btn key={n} kind="ghost" onClick={() => biz("bankBranch", bank.id, { delta: n })}>
            +{n} {n===1?"Branch": "Branches"}
          </Btn>
        ))}
        <Btn kind="gold" onClick={() => {
          const maxBank = Math.floor((bank.capital)/5000000);
          const maxWithCash = Math.floor((bank.capital + liquidCash(state.player))/5000000);
          const max = Math.max(maxBank, maxWithCash);
          const want = Math.max(1, Math.min(200, max));
          if (want>0) biz("bankBranch", bank.id, { delta: want });
        }}>
          + MAX ({Math.floor((bank.capital + liquidCash(state.player))/5000000)})
        </Btn>
        <Btn kind="ghost" onClick={() => biz("bankBranch", bank.id, { delta: -1 })}>
          −1
        </Btn>
        <Btn kind="ghost" onClick={() => biz("bankBranch", bank.id, { delta: -5 })}>
          −5
        </Btn>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <Apply label="Inject capital (₹)" init={2000000} cta="Inject" onApply={(n) => biz("bankCapital", bank.id, { amount: n })} />
        <div className="flex items-end">
          <Btn kind="danger" onClick={() => biz("sellBank", bank.id)}>
            Sell for {formatINR(bankValue(state, bank))}
          </Btn>
        </div>
      </div>
      {ops.history.length > 1 ? (
        <div className="mt-2">
          <p className="tick">Capital, last {ops.history.length} months</p>
          <Spark values={[...ops.history].reverse().map((h) => h.capital)} />
        </div>
      ) : null}
    </Card>
  );
}

function BrokerageCard({ state, act, id }: { state: GameState; act: Act; id: string }) {
  const biz = useBiz(act);
  const firm = getBiz(state).brokerages.find((x) => x.id === id)!;
  const [f, setF] = useState(() => ({
    junior: String(firm.brokers.junior),
    senior: String(firm.brokers.senior),
    star: String(firm.brokers.star),
    analysts: String(firm.analysts),
    compliance: String(firm.compliance),
    commissionBps: String(firm.commissionBps),
    mgmtFee: String(firm.mgmtFee),
    marketing: String(firm.marketing),
    platformSpend: "0",
  }));
  const L = firm.last;
  return (
    <Card>
      <Label>Your brokerage · {firm.name}</Label>
      <div className="mt-2 grid grid-cols-2 gap-x-4">
        <Row k="Clients" v={firm.clients.toLocaleString("en-IN")} />
        <Row k="Assets under management" v={formatINR(firm.aum)} />
        <Row k="Firm cash" v={formatINR(firm.cash)} tone={firm.cash < 0 ? "bad" : undefined} />
        <Row k="Reputation / platform" v={`${Math.round(firm.reputation)} / ${Math.round(firm.platform)}`} />
        <Row k="Value" v={formatINR(brokerageValue(firm))} />
      </div>
      {L ? (
        <div className="mt-2 text-xs">
          <p className="tick">Last month</p>
          <Row k="Commissions" v={formatINR(L.commissions)} />
          <Row k="Management fees" v={formatINR(L.fees)} />
          <Row k="Salaries / bonuses" v={`−${formatINR(L.payroll)} / −${formatINR(L.bonus)}`} />
          <Row k="Tech + other" v={`−${formatINR(L.tech + L.other)}`} />
          <Row k="Net" v={formatINR(L.net)} tone={L.net >= 0 ? "good" : "bad"} />
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(Object.keys(BROKER_HIRE) as BrokerTier[]).map((t) => (
          <Field key={t} label={`${BROKER_HIRE[t].label} (${formatINR(BROKER_HIRE[t].salary)}/yr)`}>
            <Input value={f[t]} onChange={(e) => setF({ ...f, [t]: e.target.value })} inputMode="numeric" />
          </Field>
        ))}
        <Field label="Analysts">
          <Input value={f.analysts} onChange={(e) => setF({ ...f, analysts: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label="Compliance">
          <Input value={f.compliance} onChange={(e) => setF({ ...f, compliance: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label="Commission (bps/trade)">
          <Input value={f.commissionBps} onChange={(e) => setF({ ...f, commissionBps: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label="Mgmt fee (%/yr)">
          <Input value={f.mgmtFee} onChange={(e) => setF({ ...f, mgmtFee: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label="Marketing ₹/mo">
          <Input value={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label="Platform upgrade ₹">
          <Input value={f.platformSpend} onChange={(e) => setF({ ...f, platformSpend: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn onClick={() => biz("brokerageSet", firm.id, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, num(v)])))}>Apply</Btn>
        <Btn kind="danger" onClick={() => biz("sellBrokerage", firm.id)}>
          Sell firm
        </Btn>
      </div>
      <div className="mt-2">
        <Apply label="Capital in (₹) — negative takes cash out" init={1000000} cta="Move" onApply={(n) => biz("brokerageCash", firm.id, { amount: n })} />
      </div>
      {firm.history.length > 1 ? <Spark values={[...firm.history].reverse().map((h) => h.aum)} /> : null}
    </Card>
  );
}

/* ================================================================ estates */

export function EstatesView({ state, act }: { state: GameState; act: Act }) {
  const props = state.player.properties;
  if (!props.length) {
    return (
      <Card>
        <Label>Estates &amp; developers</Label>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Buy a property in Property first. Then hire a letting agent or a full-service manager, set the rent against the market, handle tenants and repairs,
          list it for sale — or hire a developer to build apartments, villas, an office tower, a mall or a hotel on it.
        </p>
      </Card>
    );
  }
  const total = props.reduce(
    (s, p) => {
      const e = getBiz(state).estates[p.id];
      return {
        rent: s.rent + (e?.lastMonth?.rent ?? 0),
        net: s.net + (e?.lastMonth?.net ?? 0),
        value: s.value + p.value,
      };
    },
    { rent: 0, net: 0, value: 0 },
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Portfolio value" value={formatINR(total.value)} sub={`${props.length} properties`} />
        <Stat label="Rent collected / month" value={formatINR(total.rent)} />
        <Stat label="Net after fees, repairs, upkeep & tax" value={formatINR(total.net)} tone={total.net >= 0 ? "good" : "bad"} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {props.map((p) => (
          <EstateCard key={p.id} state={state} act={act} prop={p} />
        ))}
      </div>
    </div>
  );
}

function EstateCard({ state, act, prop }: { state: GameState; act: Act; prop: PropertyHolding }) {
  const biz = useBiz(act);
  const e = getEstate(state, prop);
  const mkt = marketRent(state, prop);
  const [rent, setRent] = useState(String(Math.round(prop.rent || mkt)));
  const [ask, setAsk] = useState(String(Math.round(prop.value * 1.05)));
  const [kind, setKind] = useState<DevProject["kind"]>("apartments");
  const [dev, setDev] = useState<DevProject["developer"]>("reputable");
  const q = devQuote(state, prop, kind, dev);
  const pj = e.project;
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <Label>
          {prop.name} · {prop.kind}
        </Label>
        <span className="text-xs text-[var(--muted)]">{state.world.cities.find((c) => c.id === prop.cityId)?.name}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4">
        <Row k="Value" v={formatINR(prop.value)} />
        <Row k="Condition" v={`${Math.round(prop.condition)}/100`} tone={prop.condition < 40 ? "bad" : undefined} />
        <Row k="Rent asked" v={`${formatINR(prop.rent)}/mo`} />
        <Row k="Market rent" v={`${formatINR(mkt)}/mo`} tone="muted" />
        <Row
          k="Tenant"
          v={
            e.tenant ? `${e.tenant.name}${e.tenant.arrears ? ` · ${e.tenant.arrears}m arrears` : ""}` : e.listed === "rent" ? `vacant ${e.vacancyMonths}m` : "—"
          }
          tone={e.tenant?.arrears ? "bad" : undefined}
        />
        <Row k="Upkeep + property tax" v={`${formatINR(prop.maintenance + prop.tax)}/mo`} />
      </div>
      {e.lastMonth ? (
        <p className="mt-1 text-xs text-[var(--muted)]">
          Last month: rent {formatINR(e.lastMonth.rent)} · manager {formatINR(e.lastMonth.fee)} · repairs {formatINR(e.lastMonth.repairs)} · net{" "}
          <span className={e.lastMonth.net >= 0 ? "text-teal-300" : "text-rose-300"}>{formatINR(e.lastMonth.net)}</span>
        </p>
      ) : null}

      <p className="tick mt-3">Property manager · auto handled by developer</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {(Object.keys(MANAGERS) as ManagerTier[]).map((m) => (
          <Btn key={m} kind={e.manager === m ? "teal" : "ghost"} onClick={() => biz("estManager", prop.id, { tier: m })}>
            {MANAGERS[m].name}
          </Btn>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-[var(--muted)]">{MANAGERS[e.manager].blurb} · Premium = developer does all (screening, upkeep, vacancy).</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Btn kind={(e as any).autoRent ? "teal" : "ghost"} onClick={() => biz("estAuto", prop.id, { autoRent: !(e as any).autoRent } as any)}>
          {(e as any).autoRent ? "Auto-price ✓ (tracks market)" : "Auto-price"}
        </Btn>
        <Btn kind={(e as any).fullAuto ? "teal" : "ghost"} onClick={() => biz("estAuto", prop.id, { fullAuto: !(e as any).fullAuto } as any)}>
          {(e as any).fullAuto ? "Developer handles all ✓" : "Developer handles all"}
        </Btn>
      </div>
      {(e as any).autoRent ? <p className="mt-1 text-[11px] text-teal-300/80">Auto: rent follows market {formatINR(mkt)}/mo, no manual pricing needed.</p> : null}

      {!pj || pj.stage === "done" ? (
        <>
          <p className="tick mt-3">Rent &amp; sale</p>
          <div className="mt-1 grid gap-2 md:grid-cols-2">
            <div className="flex gap-2">
              <Input value={rent} onChange={(ev) => setRent(ev.target.value)} inputMode="numeric" />
              <Btn kind="ghost" onClick={() => biz("estRent", prop.id, { amount: num(rent) })}>
                List
              </Btn>
            </div>
            <div className="flex gap-2">
              <Input value={ask} onChange={(ev) => setAsk(ev.target.value)} inputMode="numeric" />
              <Btn kind="ghost" onClick={() => biz("estSale", prop.id, { ask: num(ask) })}>
                Sell
              </Btn>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn kind="ghost" onClick={() => setRent(String(Math.round(mkt)))}>
              Use market rent
            </Btn>
            <Btn kind="ghost" onClick={() => setRent(String(Math.round(mkt * 1.2)))}>
              Premium (+20%)
            </Btn>
            {e.tenant ? (
              <Btn kind="danger" onClick={() => biz("estEvict", prop.id)}>
                Evict tenant
              </Btn>
            ) : null}
            {e.listed !== "off" ? (
              <Btn kind="ghost" onClick={() => biz("estRent", prop.id, { amount: 0 })}>
                Take off market
              </Btn>
            ) : null}
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {e.listed === "sale" ? `Listed for sale at ${formatINR(e.askPrice)}. ` : ""}
            Above-market rent means longer vacancies and flightier tenants; below-market fills fast.
          </p>
        </>
      ) : null}

      {e.units ? (
        <div className="mt-3">
          <p className="tick">Units</p>
          <Row k="Built / sold / leased" v={`${e.units.built} / ${e.units.sold} / ${e.units.leased}`} />
          <Row k="Unit price / unit rent" v={`${formatINR(e.units.unitValue)} / ${formatINR(e.units.unitRent)}`} />
          <div className="mt-1 flex gap-2">
            {(["rent", "sale", "off"] as const).map((m) => (
              <Btn key={m} kind="ghost" onClick={() => biz("estUnits", prop.id, { mode: m })}>
                {m === "rent" ? "Lease units" : m === "sale" ? "Sell units" : "Hold"}
              </Btn>
            ))}
          </div>
        </div>
      ) : null}

      <p className="tick mt-3">Development</p>
      {pj && pj.stage !== "done" ? (
        <div className="mt-1">
          <Row k={`${DEV_KINDS[pj.kind].name} · ${DEVELOPERS[pj.developer].name}`} v={`${pj.stage} · ${Math.round(pj.progress)}%`} />
          <Row k="Budget / spent" v={`${formatINR(pj.budget)} / ${formatINR(pj.spent)}`} tone={pj.spent > pj.budget ? "bad" : undefined} />
          <Row k="Units · quality" v={`${pj.units} · ${Math.round(pj.quality)}`} />
          <Row k="Delays / overrun" v={`${pj.delays} months / ${pct(pj.overrun, 0)}`} />
          <div className="mt-1 h-1.5 rounded bg-white/10">
            <div className="h-1.5 rounded bg-amber-300" style={{ width: `${Math.min(100, pj.progress)}%` }} />
          </div>
          <Btn kind="danger" className="mt-2" onClick={() => biz("estCancel", prop.id)}>
            Cancel project
          </Btn>
        </div>
      ) : (
        <div className="mt-1 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select value={kind} onChange={(ev) => setKind(ev.target.value as DevProject["kind"])}>
              {(Object.keys(DEV_KINDS) as DevProject["kind"][]).map((k) => (
                <option key={k} value={k}>
                  {DEV_KINDS[k].name}
                </option>
              ))}
            </Select>
            <Select value={dev} onChange={(ev) => setDev(ev.target.value as DevProject["developer"])}>
              {(Object.keys(DEVELOPERS) as DevProject["developer"][]).map((k) => (
                <option key={k} value={k}>
                  {DEVELOPERS[k].name}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-[11px] text-[var(--muted)]">{DEVELOPERS[dev].blurb}</p>
          <Row k="Units possible" v={q.units} />
          <Row k="Budget (10% deposit, then monthly)" v={`${formatINR(q.budget)} · ~${formatINR(q.monthly)}/mo`} />
          <Row k="Time" v={`${q.months} months incl. permits`} />
          <Row k="Sale value when done" v={formatINR(q.gdv)} />
          <Row k="Developer's profit estimate" v={formatINR(q.profit)} tone={q.profit >= 0 ? "good" : "bad"} />
          <Btn onClick={() => biz("estDevelop", prop.id, { kind, developer: dev })}>Hire developer</Btn>
        </div>
      )}
      <LogList items={e.log} />
    </Card>
  );
}

/* ================================================================== civic */

export function CivicView({ state, act }: { state: GameState; act: Act }) {
  const biz = useBiz(act);
  const b = getBiz(state);
  const q = quoteTax(state);
  const ben = benefitQuote(state);
  const ai = aiJobPressure(state);
  const risk = jobAiRisk(state);
  const p = state.player;
  const [track, setTrack] = useState(allTracks()[0]?.id ?? "business");
  const [level, setLevel] = useState<string>("university");
  const lvl = STUDY_LEVELS.find((l) => l.id === level);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <Label>Income tax · {q.year} so far</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Salary tax is withheld every month. Everything else — rent, business, dividends, interest, capital gains, gambling — is settled on your return after
          the year ends (deadline July). Your choice of how to file has consequences.
        </p>
        <div className="mt-2">
          {q.lines
            .filter((l) => l.income !== 0)
            .map((l) => (
              <Row key={l.key} k={`${l.label} (${pct(l.rate, 0)})`} v={`${formatINR(l.income)} → ${formatINR(l.tax)}`} />
            ))}
          <Row k="Taxable income" v={formatINR(q.income)} />
          <Row k="Tax + surcharge" v={formatINR(q.gross + q.surcharge)} />
          <Row k="Already withheld" v={`−${formatINR(q.withheld)}`} />
          <Row k="Due on the return (so far)" v={formatINR(q.due)} tone={q.due > 0 ? "bad" : "good"} />
          {b.taxDebt > 0 ? <Row k="Unpaid tax debt (1.25%/mo)" v={formatINR(b.taxDebt)} tone="bad" /> : null}
        </div>
        {b.returns.length ? (
          <div className="mt-3 overflow-x-auto">
            <p className="tick">Past returns</p>
            <table className="w-full text-xs">
              <thead className="tick text-left">
                <tr>
                  <th>Year</th>
                  <th>Income</th>
                  <th>Due</th>
                  <th>Paid</th>
                  <th>Filed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {b.returns.map((r) => (
                  <tr key={r.year} className="border-t border-white/5">
                    <td className="py-1">{r.year}</td>
                    <td>{formatINR(r.income)}</td>
                    <td>{formatINR(r.due)}</td>
                    <td>{formatINR(r.paid)}</td>
                    <td>{r.choice}</td>
                    <td className={r.status === "audit" || r.status === "evaded" ? "text-rose-300" : ""}>
                      {r.status}
                      {r.penalty ? ` · penalty ${formatINR(r.penalty)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card>
        <Label>Benefits &amp; pension</Label>
        <Row
          k="Unemployment benefit"
          v={
            b.benefits.unemployment
              ? `claiming · ${ben.monthsLeft} months left`
              : ben.eligible
                ? `${formatINR(ben.amount)}/mo for up to 9 months`
                : ben.reason || "not eligible"
          }
        />
        <Row k="State pension (60+)" v={ben.pension ? `${formatINR(ben.pension)}/mo` : "from age 60"} />
        <Row k="Paid to you so far" v={formatINR(b.benefits.paid)} />
        <Btn className="mt-2" disabled={!ben.eligible || b.benefits.unemployment} onClick={() => biz("claimBenefit")}>
          Claim unemployment benefit
        </Btn>
        <p className="mt-1 text-[11px] text-[var(--muted)]">Benefits stop when you find work. Claiming while hiding income is fraud.</p>
      </Card>

      <Card>
        <Label>AI and the job market</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          AI adoption {pct(ai.adopt, 0)} in your country. Openings shrink in exposed sectors while AI-era roles appear. {b.aiJobsLost.toLocaleString("en-IN")}{" "}
          listings have vanished so far.
        </p>
        <Row
          k="Your job's automation risk"
          v={p.career.job ? `${(risk * 100).toFixed(1)}%/month` : "not employed"}
          tone={risk > 0.03 ? "bad" : risk > 0.01 ? undefined : "good"}
        />
        <div className="mt-2 max-h-60 overflow-y-auto text-xs">
          {ai.rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 border-t border-white/5 py-1">
              <span className="w-32 truncate">{r.name}</span>
              <div className="h-1.5 flex-1 rounded bg-white/10">
                <div className={`h-1.5 rounded ${r.cut > 0 ? "bg-rose-400" : "bg-teal-400"}`} style={{ width: `${Math.min(100, Math.abs(r.cut) * 100)}%` }} />
              </div>
              <span className={`w-16 text-right ${r.cut > 0 ? "text-rose-300" : "text-teal-300"}`}>
                {r.cut > 0 ? "−" : "+"}
                {Math.round(Math.abs(r.cut) * 100)}% jobs
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]">A relevant certification shields you from AI layoffs and raises what employers offer.</p>
      </Card>

      <Card>
        <Label>Education</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Your education level: {p.educationLevel}. {p.currentStudy ? `Now studying: ${p.currentStudy.name}.` : ""}
        </p>
        {!p.currentStudy ? (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <Select value={track} onChange={(e) => setTrack(e.target.value as typeof track)}>
              {allTracks().map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select value={level} onChange={(e) => setLevel(e.target.value)}>
              {STUDY_LEVELS.map((l) => (
                <option key={l.id} value={l.id} disabled={p.educationLevel < l.minEdu}>
                  {l.name} · {formatINR(l.tuition)}/yr · {l.years < 1 ? `${Math.round(l.years * 12)}m` : `${l.years}y`}
                  {p.educationLevel < l.minEdu ? ` (needs level ${l.minEdu})` : ""}
                </option>
              ))}
            </Select>
            <Btn
              disabled={!lvl || p.educationLevel < lvl.minEdu}
              onClick={() =>
                act({
                  type: "study",
                  track: track as never,
                  level: level as never,
                })
              }
            >
              Enrol
            </Btn>
          </div>
        ) : null}
        <p className="tick mt-3">Professional certifications</p>
        <div className="mt-1 max-h-72 space-y-1 overflow-y-auto">
          {CERTS.map((c) => {
            const held = b.certs.includes(c.id);
            return (
              <div key={c.id} className="flex items-center justify-between gap-2 border-t border-white/5 py-1 text-xs">
                <div>
                  <p className="text-sm">
                    {c.name} {held ? <span className="text-teal-300">✓ held</span> : null}
                  </p>
                  <p className="text-[var(--muted)]">
                    {formatINR(c.cost)} · {c.months} months · needs level {c.edu} · +{Math.round(c.pay * 100)}% pay · −{Math.round(c.shield * 100)}% AI risk
                  </p>
                </div>
                {!held ? (
                  <Btn kind="ghost" disabled={Boolean(p.currentStudy) || p.educationLevel < c.edu} onClick={() => biz("cert", c.id)}>
                    Start
                  </Btn>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <Label>Cash on hand</Label>
        <p className="mt-1 font-serif text-2xl">{formatINR(liquidCash(p))}</p>
      </Card>
    </div>
  );
}
