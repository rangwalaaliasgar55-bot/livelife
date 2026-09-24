"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { generateBio, whyStock } from "@/lib/sim/advanced";
import { importLife } from "@/lib/store";
import { ACHIEVEMENTS, BILL_TOPICS, COUNTRY_DEFS, INDUSTRIES, MEDIA_KINDS, MODES, SKILLS, SOCIAL_PLATFORMS, TRACKS } from "@/lib/sim/catalog";
import { computeNetWorth, liquidCash } from "@/lib/sim/finance";
import { LineListModal } from "./overlays";
import type { EducationTrack, GameState, Industry, PlayerAction, PolicyVector, SkillId } from "@/lib/sim/types";
import { formatINR, formatPct } from "@/lib/sim/util";
import { Btn, Card, Delta, Field, Input, Label, Meter, Money, Select, Spark, Table } from "./ui";
import { Analysis, CalendarP, Research, Staff, StatsP } from "./panels2";

export function Panels({
  view,
  state,
  act,
  busy,
}: {
  view: string;
  state: GameState;
  act: (a: PlayerAction) => Promise<void> | void;
  busy: boolean;
}) {
  if (view === "staff") return <Staff state={state} act={act} />;
  if (view === "analysis") return <Analysis state={state} />;
  if (view === "research") return <Research state={state} act={act} />;
  if (view === "stats") return <StatsP state={state} act={act} />;
  if (view === "calendar") return <CalendarP state={state} />;
  if (view === "life") return <Life state={state} act={act} />;
  if (view === "career") return <Career state={state} act={act} />;
  if (view === "bank") return <Bank state={state} act={act} />;
  if (view === "markets") return <Markets state={state} act={act} />;
  if (view === "property") return <PropertyP state={state} act={act} />;
  if (view === "business") return <Business state={state} act={act} />;
  if (view === "opps") return <Opps state={state} act={act} />;
  if (view === "world") return <World state={state} act={act} />;
  if (view === "politics") return <Politics state={state} act={act} />;
  if (view === "concord") return <Concord state={state} act={act} />;
  if (view === "media") return <Media state={state} act={act} />;
  if (view === "under") return <Under state={state} act={act} busy={busy} />;
  if (view === "news") return <News state={state} />;
  if (view === "legacy") return <Legacy state={state} act={act} />;
  return null;
}

function Life({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const p = state.player;
  const [track, setTrack] = useState<EducationTrack>("computer_science");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Label>Person</Label>
        <p className="mt-2 font-serif text-3xl">{p.name}</p>
        <p className="text-sm text-[var(--muted)]">
          {p.nationality} citizen of {p.citizenship.join(", ")} · visa {p.visa}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Meter label="Health" value={p.health} />
          <Meter label="Energy" value={p.energy} />
          <Meter label="Stress" value={p.stress} />
          <Meter label="Happiness" value={p.happiness} />
        </div>
        <div className="mt-4 flex gap-2">
          <Btn kind="ghost" onClick={() => void act({ type: "rest" })}>
            Rest
          </Btn>
          <Btn kind="ghost" onClick={() => void act({ type: "workout" })}>
            Train body
          </Btn>
        </div>
        <Label>Personality</Label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {Object.entries(p.traits).map(([k, v]) => (
            <Meter key={k} label={k} value={v} />
          ))}
        </div>
      </Card>
      <Card>
        <Label>Education</Label>
        <ul className="mt-2 space-y-2 text-sm">
          {p.education.map((e) => (
            <li key={e.id}>
              {e.name} · {e.institution} {e.completed ? "✓" : e.inProgress ? "(in progress)" : ""}
            </li>
          ))}
        </ul>
        {p.currentStudy ? (
          <div className="mt-3">
            <p className="text-sm">Now: {p.currentStudy.name} · GPA {p.currentStudy.gpa.toFixed(2)}</p>
            <Btn kind="ghost" onClick={() => void act({ type: "dropStudy" })}>
              Leave programme
            </Btn>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            <Select value={track} onChange={(e) => setTrack(e.target.value as EducationTrack)}>
              {TRACKS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Btn onClick={() => void act({ type: "study", track, level: "university" })}>University</Btn>
            <Btn kind="ghost" onClick={() => void act({ type: "study", track, level: "course" })}>
              Short course
            </Btn>
            <Btn kind="ghost" onClick={() => void act({ type: "study", track, level: "vocational" })}>
              Vocational
            </Btn>
          </div>
        )}
      </Card>
      <Card>
        <Label>Family</Label>
        <Table
          headers={["Name", "Relation", "Age", ""]}
          rows={p.family.members.map((m) => [
            m.name,
            m.relation,
            String(m.age),
            <Btn key={m.id} kind="ghost" onClick={() => void act({ type: "setHeir", memberId: m.id })}>
              {p.family.willHeirId === m.id ? "Heir" : "Set heir"}
            </Btn>,
          ])}
        />
        <div className="mt-3">
          <Btn kind="ghost" onClick={() => void act({ type: "haveChild" })}>
            Welcome a child
          </Btn>
        </div>
      </Card>
      <Card>
        <Label>Reputation & influence</Label>
        {Object.entries(p.reputation).map(([k, v]) => (
          <Meter key={k} label={k} value={v} />
        ))}
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          {Object.entries(p.influence).map(([k, v]) => (
            <div key={k}>
              {k}: {v.toFixed(0)}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Career({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const p = state.player;
  const jobs = state.world.jobs.filter((j) => j.countryId === p.countryId).slice(0, 24);
  const [skill, setSkill] = useState<SkillId>("programming");
  const groups = ["Technical", "Business", "Public", "Practical"];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <Label>Labour market · {p.cityId}</Label>
        <Table
          headers={["Role", "Firm", "Pay", "Need", ""]}
          rows={jobs.map((j) => [
            <span key="t">
              {j.title}
              <div className="text-[11px] text-[var(--muted)]">
                {j.industry} · {j.hours}h · demand {Math.round(j.demand)}
              </div>
            </span>,
            j.employer,
            formatINR(j.salary) + "/yr",
            `edu ${j.educationMin} · exp ${j.experienceMin}y`,
            <Btn key={j.id} kind="ghost" onClick={() => void act({ type: "applyJob", jobId: j.id })}>
              Apply
            </Btn>,
          ])}
        />
      </Card>
      <Card>
        <Label>Now</Label>
        {p.career.job ? (
          <div>
            <p className="font-serif text-2xl">{p.career.job.title}</p>
            <p className="text-sm text-[var(--muted)]">{p.career.job.employer}</p>
            <p className="mt-2">{formatINR(p.career.job.salary)} / year</p>
            <Meter label="Performance" value={p.career.performance} />
            <Btn kind="danger" onClick={() => void act({ type: "quitJob" })}>
              Resign
            </Btn>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">Unemployed.</p>
        )}
        <div className="mt-4">
          <Label>Freelance</Label>
          {p.career.freelance.active ? (
            <Btn kind="ghost" onClick={() => void act({ type: "stopFreelance" })}>
              Stop
            </Btn>
          ) : (
            <Btn kind="ghost" onClick={() => void act({ type: "freelance", industry: "software", hours: 12 })}>
              12h software gigs
            </Btn>
          )}
        </div>
        <div className="mt-4">
          <Select value={skill} onChange={(e) => setSkill(e.target.value as SkillId)}>
            {SKILLS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <div className="mt-2 flex gap-2">
            <Btn kind="ghost" onClick={() => void act({ type: "practice", skill })}>
              Practice
            </Btn>
            <Btn kind="ghost" onClick={() => void act({ type: "course", skill })}>
              Paid course ₹18k
            </Btn>
          </div>
        </div>
      </Card>
      <Card className="lg:col-span-3">
        <Label>Skill tree</Label>
        <div className="mt-3 grid gap-4 md:grid-cols-4">
          {groups.map((g) => (
            <div key={g}>
              <p className="tick">{g}</p>
              {SKILLS.filter((s) => s.group === g).map((s) => (
                <Meter key={s.id} label={s.name} value={p.skills[s.id] ?? 0} />
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Bank({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const p = state.player;
  const [amt, setAmt] = useState(10000);
  const [loanAmt, setLoanAmt] = useState(500000);
  const [fxFrom, setFxFrom] = useState("");
  const [fxTo, setFxTo] = useState("");
  const [fxAmt, setFxAmt] = useState(100000);
  const banks = state.world.banks.filter((b) => b.countryId === p.countryId);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Label>Wallet</Label>
        <p className="font-serif text-3xl gold-text">{formatINR(p.finances.cash)}</p>
        <p className="text-sm text-[var(--muted)]">Credit score {Math.round(p.finances.creditScore)} · defaults {p.finances.defaults}</p>
        <Meter label="Payment history" value={p.finances.paymentHistory} />
        <Meter label="Credit score" value={(p.finances.creditScore - 300) / 6} />
      </Card>
      <Card>
        <Label>Open / move money</Label>
        <Field label="Amount">
          <Input type="number" value={amt} onChange={(e) => setAmt(Number(e.target.value))} />
        </Field>
        <div className="mt-3 space-y-3">
          {p.finances.accounts.map((a) => (
            <div key={a.id} className="rounded-xl border border-white/10 p-3 text-sm">
              <div className="flex justify-between">
                <span>
                  {a.bankName} · {a.type}
                </span>
                <span>{formatINR(a.balance)}</span>
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                {a.interestRate.toFixed(2)}% · {a.currency}
              </p>
              <div className="mt-2 flex gap-2">
                <Btn kind="ghost" onClick={() => void act({ type: "deposit", accountId: a.id, amount: amt })}>
                  Deposit
                </Btn>
                <Btn kind="ghost" onClick={() => void act({ type: "withdraw", accountId: a.id, amount: amt })}>
                  Withdraw
                </Btn>
              </div>
              <div className="mt-2 max-h-28 overflow-auto text-[11px] text-[var(--muted)]">
                {a.transactions.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex justify-between">
                    <span>{t.desc}</span>
                    <span>{formatINR(t.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {banks.map((b) => (
            <Btn key={b.id} kind="ghost" onClick={() => void act({ type: "openAccount", bankId: b.id, kind: "savings" })}>
              Open at {b.name}
            </Btn>
          ))}
        </div>
      </Card>
      <Card>
        <Label>Credit desk</Label>
        <Field label="Principal">
          <Input type="number" value={loanAmt} onChange={(e) => setLoanAmt(Number(e.target.value))} />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["personal", "education", "home", "car", "business", "startup", "development"] as const).map((k) => (
            <Btn key={k} kind="ghost" onClick={() => void act({ type: "applyLoan", kind: k, amount: loanAmt, termMonths: k === "home" ? 240 : 60 })}>
              {k}
            </Btn>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">Banks score income, credit, collateral and leverage. Declines are real.</p>
      </Card>
      <Card>
        <Label>Loans</Label>
        {p.finances.loans.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No facilities.</p>
        ) : (
          p.finances.loans.map((l) => (
            <div key={l.id} className="mt-2 border-t border-white/5 py-2 text-sm">
              <div className="flex justify-between">
                <span>
                  {l.kind} · {l.lender}
                </span>
                <span>{l.status}</span>
              </div>
              <div>
                {formatINR(l.remaining)} @ {l.rate.toFixed(1)}% · {formatINR(l.monthly)}/mo
              </div>
              <Btn kind="ghost" onClick={() => void act({ type: "repayLoan", loanId: l.id, amount: Math.min(l.remaining, amt) })}>
                Extra pay
              </Btn>
            </div>
          ))
        )}
      </Card>
      <Card>
        <Label>FX desk</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">Convert between your accounts (foreign accounts after moving abroad). 0.2% spread; FX tracks the live model.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="From">
            <Select value={fxFrom} onChange={(e) => setFxFrom(e.target.value)}>
              <option value="">—</option>
              {p.finances.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bankName} · {a.currency}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To">
            <Select value={fxTo} onChange={(e) => setFxTo(e.target.value)}>
              <option value="">—</option>
              {p.finances.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bankName} · {a.currency}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Amount">
          <Input type="number" value={fxAmt} onChange={(e) => setFxAmt(Number(e.target.value))} />
        </Field>
        <Btn kind="ghost" className="mt-2" onClick={() => void act({ type: "fxConvert", fromId: fxFrom, toId: fxTo, amount: fxAmt })}>
          Convert
        </Btn>
      </Card>
      <Card className="lg:col-span-2">
        <Label>System banks</Label>
        <Table
          headers={["Bank", "Deposits", "Loans", "NPL", "Save", "Lend", "Yours?"]}
          rows={state.world.banks.slice(0, 16).map((b) => [
            b.name,
            formatINR(b.deposits),
            formatINR(b.loans),
            `${b.npl.toFixed(1)}%`,
            `${b.savingsRate.toFixed(2)}%`,
            `${b.lendingRate.toFixed(2)}%`,
            b.playerOwned ? "yes" : "—",
          ])}
        />
        <div className="mt-3">
          <Btn onClick={() => void act({ type: "foundBank", name: `${p.name.split(" ")[0]} Bank` })}>Charter a bank (₹2 Cr)</Btn>
        </div>
      </Card>
    </div>
  );
}

function Markets({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const [q, setQ] = useState("");
  const [shares, setShares] = useState(10);
  const [whyTick, setWhyTick] = useState<string | null>(null);
  const listed = state.world.companies.filter((c) => c.listed && c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  const idx = state.world.indexHistory.map((x) => x.v);
  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex items-end justify-between">
          <div>
            <Label>Concord Composite</Label>
            <p className="font-serif text-3xl">{idx.at(-1)?.toFixed(0) ?? "—"}</p>
          </div>
          <div className="w-1/2">
            <Spark values={idx} />
          </div>
        </div>
      </Card>
      <Card>
        <div className="mb-3 flex flex-wrap gap-3">
          <Input placeholder="Search ticker or name" value={q} onChange={(e) => setQ(e.target.value)} />
          <Field label="Shares">
            <Input type="number" value={shares} onChange={(e) => setShares(Number(e.target.value))} />
          </Field>
        </div>
        <Table
          headers={["Ticker", "Name", "Px", "Chg", "Rev", "P/E", ""]}
          rows={listed.map((c) => {
            const chg = ((c.price - c.prevPrice) / Math.max(0.01, c.prevPrice)) * 100;
            return [
              c.ticker,
              <span key="n">
                {c.name}
                <div className="text-[11px] text-[var(--muted)]">
                  {c.industry} · {c.countryId}
                </div>
              </span>,
              formatINR(c.price),
              <Delta key="d" n={chg} />,
              formatINR(c.revenue),
              c.pe.toFixed(1),
              <div key="b" className="flex gap-1">
                <Btn kind="ghost" onClick={() => void act({ type: "buyStock", ticker: c.ticker, shares })}>
                  Buy
                </Btn>
                <Btn kind="ghost" onClick={() => void act({ type: "sellStock", ticker: c.ticker, shares })}>
                  Sell
                </Btn>
                <Btn kind="ghost" onClick={() => setWhyTick(c.ticker)}>
                  Why?
                </Btn>
              </div>,
            ];
          })}
        />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Label>Bonds</Label>
          <Table
            headers={["Issue", "Yld", "Px", "Risk", ""]}
            rows={state.world.bonds.slice(0, 16).map((b) => [
              b.name,
              `${b.yield.toFixed(2)}%`,
              formatINR(b.price),
              b.risk.toFixed(0),
              <Btn key={b.id} kind="ghost" onClick={() => void act({ type: "buyBond", bondId: b.id, qty: 1 })}>
                Buy 1
              </Btn>,
            ])}
          />
        </Card>
        <Card>
          <Label>Funds</Label>
          {state.world.funds.map((f) => (
            <div key={f.id} className="mt-2 flex items-center justify-between border-t border-white/5 py-2 text-sm">
              <div>
                {f.name}
                <div className="text-[11px] text-[var(--muted)]">
                  NAV {f.nav.toFixed(2)} · {formatPct(((f.nav - f.prev) / Math.max(0.01, f.prev)) * 100)}
                </div>
              </div>
              <Btn kind="ghost" onClick={() => void act({ type: "buyFund", fundId: f.id, amount: 50000 })}>
                ₹50k
              </Btn>
            </div>
          ))}
        </Card>
      </div>
      <Card>
        <Label>Your book</Label>
        <Table
          headers={["Holding", "Qty", "Avg", "Now"]}
          rows={[
            ...state.player.holdings.map((h) => {
              const c = state.world.companies.find((x) => x.ticker === h.ticker);
              return [h.ticker, String(h.shares), formatINR(h.avgCost), formatINR((c?.price ?? 0) * h.shares)];
            }),
            ...state.player.bonds.map((b) => [b.name, String(b.qty), formatINR(b.price), formatINR(b.price * b.qty)]),
            ...state.player.funds.map((f) => [f.name, f.units.toFixed(2), formatINR(f.avgCost), formatINR(f.units * (state.world.funds.find((x) => x.id === f.id)?.nav ?? f.nav))]),
          ]}
        />
      </Card>
      {whyTick ? (
        <LineListModal title={`Why is ${whyTick} at ${state.world.companies.find((x) => x.ticker === whyTick)?.price.toFixed(2) ?? "?"}?`} lines={whyStock(state, whyTick)} onClose={() => setWhyTick(null)} />
      ) : null}
    </div>
  );
}

function PropertyP({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const listings = state.world.properties.filter((p) => p.countryId === state.player.countryId || p.distressed).slice(0, 24);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <Label>Holdings</Label>
        {state.player.properties.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No deeds yet.</p>
        ) : (
          state.player.properties.map((pr) => (
            <div key={pr.id} className="mt-3 rounded-xl border border-white/10 p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">
                  {pr.name} · {pr.kind}
                </span>
                <span>{formatINR(pr.value)}</span>
              </div>
              <p className="text-[var(--muted)]">
                {pr.district} · occ {pr.occupancy.toFixed(0)}% · rent {formatINR(pr.rent)} · cond {pr.condition.toFixed(0)}
                {pr.development ? ` · build ${pr.development.progress.toFixed(0)}%` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Btn kind="ghost" onClick={() => void act({ type: "renovate", propertyId: pr.id, spend: 200000 })}>
                  Renovate ₹2L
                </Btn>
                <Btn kind="ghost" onClick={() => void act({ type: "setRent", propertyId: pr.id, occupancyBias: 40 })}>
                  List for rent
                </Btn>
                <Btn kind="ghost" onClick={() => void act({ type: "develop", propertyId: pr.id })}>
                  Develop
                </Btn>
                <Btn kind="ghost" onClick={() => void act({ type: "sellProperty", propertyId: pr.id })}>
                  Sell
                </Btn>
              </div>
            </div>
          ))
        )}
      </Card>
      <Card className="lg:col-span-2">
        <Label>Market</Label>
        <Table
          headers={["Asset", "City", "Ask", "Rent", ""]}
          rows={listings.map((l) => [
            <span key="n">
              {l.name} {l.distressed ? "· distressed" : ""}
              <div className="text-[11px] text-[var(--muted)]">
                {l.kind} · {l.size} m² · cond {l.condition.toFixed(0)}
              </div>
            </span>,
            l.cityId,
            formatINR(l.price),
            formatINR(l.rent),
            <div key="b" className="flex gap-1">
              <Btn kind="ghost" onClick={() => void act({ type: "buyProperty", listingId: l.id, mortgage: false })}>
                Cash
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "buyProperty", listingId: l.id, mortgage: true })}>
                25% down
              </Btn>
            </div>,
          ])}
        />
      </Card>
    </div>
  );
}

function Business({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const p = state.player;
  const mine = state.world.companies.filter((c) => c.shareholders.some((s) => s.type === "player"));
  const [name, setName] = useState("Nimbus Labs");
  const [ind, setInd] = useState<Industry>("ai");
  const [cap, setCap] = useState(120000);
  const sale = state.world.companies.filter((c) => c.forSale).slice(0, 12);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Label>Incorporate</Label>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Industry">
          <Select value={ind} onChange={(e) => setInd(e.target.value as Industry)}>
            {INDUSTRIES.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Seed capital">
          <Input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        </Field>
        <div className="mt-3">
          <Btn
            onClick={() =>
              void act({
                type: "foundCompany",
                payload: {
                  name,
                  industry: ind,
                  model: "saas",
                  product: name,
                  price: 99,
                  countryId: p.countryId,
                  cityId: p.cityId,
                  capital: cap,
                  ai: ind === "ai",
                },
              })
            }
          >
            Found company
          </Btn>
        </div>
      </Card>
      <Card>
        <Label>For sale / distressed</Label>
        {sale.map((c) => (
          <div key={c.id} className="mt-2 flex items-center justify-between text-sm">
            <div>
              {c.name}
              <div className="text-[11px] text-[var(--muted)]">
                {c.industry} · {formatINR(c.revenue)} rev · ask {formatINR(c.askingPrice)}
              </div>
            </div>
            <Btn kind="ghost" onClick={() => void act({ type: "buyCompany", companyId: c.id })}>
              Buy
            </Btn>
          </div>
        ))}
      </Card>
      {mine.map((co) => {
        const sh = co.shareholders.find((s) => s.type === "player");
        const own = sh ? (sh.shares / co.shares) * 100 : 0;
        return (
          <Card key={co.id} className="lg:col-span-2">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <Label>
                  {co.ticker} · {co.stage}
                </Label>
                <p className="font-serif text-2xl">{co.name}</p>
                <p className="text-sm text-[var(--muted)]">
                  You own {own.toFixed(1)}% · CEO {co.ceo}
                </p>
              </div>
              <div className="text-right text-sm">
                <div>Valuation {formatINR(co.valuation)}</div>
                <div>Cash {formatINR(co.cash)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 text-sm">
              <div>
                Revenue <div>{formatINR(co.revenue)}</div>
              </div>
              <div>
                Costs <div>{formatINR(co.costs)}</div>
              </div>
              <div>
                Profit <div className={co.profit >= 0 ? "text-teal-300" : "text-rose-300"}>{formatINR(co.profit)}</div>
              </div>
              <div>
                Employees <div>{co.employees}</div>
              </div>
              <div>
                Customers <div>{co.customers}</div>
              </div>
              <div>
                Share <div>{co.marketShare.toFixed(2)}%</div>
              </div>
              <div>
                Quality <div>{co.quality.toFixed(0)}</div>
              </div>
              <div>
                Price lvl <div>{co.priceLevel.toFixed(0)}</div>
              </div>
            </div>
            {co.ai ? (
              <p className="mt-2 text-xs text-[var(--muted)]">
                Model {co.ai.modelQuality.toFixed(0)} · compute {co.ai.compute.toFixed(0)} · infra {formatINR(co.ai.infraCost)}
              </p>
            ) : null}
            <Spark values={co.history.map((h) => h.price)} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn kind="ghost" onClick={() => void act({ type: "manageCompany", companyId: co.id, patch: { hire: 2 } })}>
                Hire 2
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "manageCompany", companyId: co.id, patch: { fire: 1 } })}>
                Fire 1
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "manageCompany", companyId: co.id, patch: { marketing: co.marketing + 2 } })}>
                More marketing
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "manageCompany", companyId: co.id, patch: { rd: co.rd + 2 } })}>
                More R&D
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "raiseFunding", companyId: co.id, source: "angel", amount: 2500000 })}>
                Angels
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "raiseFunding", companyId: co.id, source: "vc", amount: 12000000 })}>
                VC
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "ipo", companyId: co.id })}>
                IPO
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "appointCeo", companyId: co.id, self: !co.playerCeo })}>
                {co.playerCeo ? "Step down" : "Become CEO"}
              </Btn>
            </div>
            <div className="mt-3 text-xs text-[var(--muted)]">
              Cap table: {co.shareholders.map((s) => `${s.name} ${((s.shares / co.shares) * 100).toFixed(0)}%`).join(" · ")}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Opps({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const [tab, setTab] = useState<string>("all");
  const ops = state.world.opportunities.filter((o) => tab === "all" || o.kind === tab);
  const grants = state.world.grants.filter((g) => g.open && g.countryId === state.player.countryId);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        {["all", "grant", "job", "property", "business", "investor", "incubator", "contract", "distressed"].map((t) => (
          <Btn key={t} kind={tab === t ? "gold" : "ghost"} onClick={() => setTab(t)}>
            {t}
          </Btn>
        ))}
      </div>
      <Card>
        <Label>Live board</Label>
        {ops.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Live a month to refresh the board.</p>
        ) : (
          ops.map((o) => (
            <div key={o.id} className="mt-3 flex items-start justify-between gap-3 border-t border-white/5 pt-3">
              <div>
                <p className="text-sm font-medium">{o.title}</p>
                <p className="text-xs text-[var(--muted)]">
                  {o.detail} · risk {o.risk} · {formatINR(o.value)}
                </p>
              </div>
              <Btn kind="ghost" onClick={() => void act({ type: "pursueOpportunity", opportunityId: o.id })}>
                Pursue
              </Btn>
            </div>
          ))
        )}
      </Card>
      <Card>
        <Label>Grant catalogue</Label>
        {grants.map((g) => (
          <div key={g.id} className="mt-2 flex items-center justify-between text-sm">
            <div>
              {g.name}
              <div className="text-[11px] text-[var(--muted)]">
                {g.eligibility} · p≈{Math.round(g.prob * 100)}% · {formatINR(g.amount)}
              </div>
            </div>
            <Btn kind="ghost" onClick={() => void act({ type: "applyGrant", grantId: g.id, companyId: state.player.ownedCompanyIds[0] })}>
              Apply
            </Btn>
          </div>
        ))}
      </Card>
    </div>
  );
}

function World({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const [sel, setSel] = useState(state.player.countryId);
  const [q, setQ] = useState("");
  const c = state.world.countries.find((x) => x.id === sel)!;
  const cities = state.world.cities.filter((x) => x.countryId === sel);
  const query = q.trim().toLowerCase();
  const hits: { kind: string; label: string; sub: string; go?: () => void }[] = [];
  if (query.length > 1) {
    for (const co of state.world.countries) {
      if (co.name.toLowerCase().includes(query) || co.capital.toLowerCase().includes(query)) {
        hits.push({ kind: "country", label: co.name, sub: `${co.currency.code} · growth ${co.gdpGrowth.toFixed(1)}% · rate ${co.interestRate.toFixed(2)}%`, go: () => setSel(co.id) });
      }
    }
    for (const ct of state.world.cities) {
      if (ct.name.toLowerCase().includes(query)) {
        hits.push({ kind: "city", label: ct.name, sub: `${state.world.countries.find((x) => x.id === ct.countryId)?.name} · px ${ct.propertyIndex.toFixed(0)}`, go: () => setSel(ct.countryId) });
      }
    }
    for (const co of state.world.companies.filter((x) => x.listed).slice(0, 400)) {
      if (co.name.toLowerCase().includes(query) || co.ticker.toLowerCase() === query) {
        hits.push({ kind: "company", label: `${co.name} (${co.ticker})`, sub: `${co.industry} · ₹${co.price.toFixed(2)} · ${formatINR(co.valuation)}` });
      }
    }
    for (const pt of state.world.parties) {
      if (pt.name.toLowerCase().includes(query)) {
        hits.push({ kind: "party", label: pt.name, sub: `${state.world.countries.find((x) => x.id === pt.countryId)?.name} · ${pt.seats} seats` });
      }
    }
    for (const pr of state.world.properties.slice(0, 400)) {
      if (pr.name.toLowerCase().includes(query)) {
        hits.push({ kind: "property", label: pr.name, sub: `${pr.kind} · ${formatINR(pr.price)}${pr.distressed ? " · distressed" : ""}` });
      }
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Label>Fictional atlas</Label>
          <div className="w-64 max-w-full">
            <Input
              placeholder="Search countries, cities, firms, parties…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="grid-map relative mt-3 h-[420px] overflow-hidden rounded-2xl border border-[var(--line)] bg-[#0b1020]">
          {state.world.countries.map((co) => (
            <button
              key={co.id}
              onClick={() => setSel(co.id)}
              style={{
                left: `${co.map.x}%`,
                top: `${co.map.y}%`,
                width: `${co.map.w}%`,
                height: `${co.map.h}%`,
                background: sel === co.id ? co.color : `${co.color}55`,
              }}
              className="absolute rounded-xl border border-white/20 text-[11px] text-black"
            >
              {co.name.split(" ").slice(-1)}
            </button>
          ))}
        </div>
        {query && hits.length ? (
          <div className="mt-3 max-h-64 space-y-1 overflow-auto rounded-2xl border border-[var(--line)] p-2">
            {hits.slice(0, 12).map((h, i) => (
              <button key={i} onClick={h.go} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-white/5">
                <span className="tick mr-2">{h.kind}</span>
                <span className="font-medium">{h.label}</span>
                <span className="ml-2 text-xs text-[var(--muted)]">{h.sub}</span>
              </button>
            ))}
          </div>
        ) : null}
      </Card>
      <Card>
        <p className="font-serif text-2xl">{c.name}</p>
        <p className="text-sm text-[var(--muted)]">
          {c.government} · {c.currency.name} ({c.currency.symbol}) · FX {c.fx.toFixed(2)}
        </p>
        <div className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><span>Population</span><span>{c.population.toLocaleString("en-IN")}</span></div>
          <div className="flex justify-between"><span>GDP</span><span>{formatINR(c.gdp)}</span></div>
          <div className="flex justify-between"><span>Growth</span><span>{formatPct(c.gdpGrowth)}</span></div>
          <div className="flex justify-between"><span>Inflation</span><span>{c.inflation.toFixed(1)}%</span></div>
          <div className="flex justify-between"><span>Rate</span><span>{c.interestRate.toFixed(2)}%</span></div>
          <div className="flex justify-between"><span>Jobless</span><span>{c.unemployment.toFixed(1)}%</span></div>
          <div className="flex justify-between"><span>Corp tax</span><span>{c.corpTax.toFixed(1)}%</span></div>
          <div className="flex justify-between"><span>Approval</span><span>{c.approval.toFixed(0)}</span></div>
          <div className="flex justify-between"><span>Head</span><span>{c.headOfGov}</span></div>
          <div className="flex justify-between"><span>Credit rating</span><span className="text-amber-200">{state.adv?.ratings[c.id] ?? "—"}</span></div>
        </div>
        <Label>Cities</Label>
        {cities.map((city) => (
          <div key={city.id} className="mt-2 flex items-center justify-between text-sm">
            <span>
              {city.name}
              <div className="text-[11px] text-[var(--muted)]">
                px {city.propertyIndex.toFixed(0)} · demand {city.demand.toFixed(0)}
              </div>
            </span>
            <Btn kind="ghost" onClick={() => void act({ type: "travel", countryId: c.id, cityId: city.id, intent: "move" })}>
              Move
            </Btn>
          </div>
        ))}
        <div className="mt-3 flex gap-2">
          <Btn kind="ghost" onClick={() => void act({ type: "applyResidency" })}>
            Residency
          </Btn>
          <Btn kind="ghost" onClick={() => void act({ type: "applyCitizenship" })}>
            Citizenship
          </Btn>
        </div>
      </Card>
      <Card className="lg:col-span-3">
        <Label>Relations from {c.name}</Label>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {Object.entries(c.relations).map(([k, v]) => (
            <span key={k} className="rounded-full border border-white/10 px-3 py-1">
              {COUNTRY_DEFS.find((x) => x.id === k)?.name ?? k}: {v}
            </span>
          ))}
        </div>
        <Label>World tech</Label>
        <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(state.world.tech).map(([k, v]) => (
            <Meter key={k} label={k} value={v} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Politics({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const p = state.player;
  const parties = state.world.parties.filter((x) => x.countryId === p.countryId);
  const [pname, setPname] = useState("New Civic List");
  const [bill, setBill] = useState("corp_tax");
  const country = state.world.countries.find((c) => c.id === p.countryId)!;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Label>Your office</Label>
        <p className="font-serif text-2xl">{p.politics.role === "none" ? "Private citizen" : p.politics.office || p.politics.role}</p>
        <p className="text-sm text-[var(--muted)]">
          {p.politics.partyName ?? "No party"} · popularity {p.politics.popularity.toFixed(1)}
        </p>
        <Meter label="Popularity" value={p.politics.popularity} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind="ghost" onClick={() => void act({ type: "campaign", spend: 50000 })}>
            Campaign ₹50k
          </Btn>
          <Btn kind="ghost" onClick={() => void act({ type: "runForOffice", office: "Local council" })}>
            Stand for office
          </Btn>
        </div>
      </Card>
      <Card>
        <Label>Parties in {country.name}</Label>
        {parties.map((pt) => (
          <div key={pt.id} className="mt-2 flex items-center justify-between text-sm">
            <span>
              {pt.name}
              <div className="text-[11px] text-[var(--muted)]">
                {pt.leader} · {pt.popularity.toFixed(0)}% · {pt.seats} seats
              </div>
            </span>
            <Btn kind="ghost" onClick={() => void act({ type: "joinParty", partyId: pt.id })}>
              Join
            </Btn>
          </div>
        ))}
        <div className="mt-3 flex gap-2">
          <Input value={pname} onChange={(e) => setPname(e.target.value)} />
          <Btn onClick={() => void act({ type: "createParty", name: pname, platform: { ...p.politics.platform } })}>Found party</Btn>
        </div>
      </Card>
      <Card>
        <Label>Chamber</Label>
        <Select value={bill} onChange={(e) => setBill(e.target.value)}>
          {BILL_TOPICS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </Select>
        <div className="mt-2 flex gap-2">
          <Btn kind="ghost" onClick={() => void act({ type: "proposeBill", topic: bill, magnitude: 8 })}>
            Propose +
          </Btn>
          <Btn kind="ghost" onClick={() => void act({ type: "proposeBill", topic: bill, magnitude: -8 })}>
            Propose −
          </Btn>
        </div>
        {p.politics.role === "head" || p.politics.role === "minister" ? (
          <div className="mt-4">
            <Label>Cabinet levers</Label>
            {(["tax", "welfare", "business", "education", "healthcare", "technology", "infrastructure", "environment"] as const).map((k) => (
              <div key={k} className="mt-1 flex items-center gap-2 text-sm">
                <span className="w-28">{k}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  defaultValue={country.policy[k]}
                  onMouseUp={(e) => void act({ type: "setPolicy", policy: { [k]: Number((e.target as HTMLInputElement).value) } as Partial<PolicyVector> })}
                />
                <span>{country.policy[k]}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-[var(--muted)]">Win office to set tax and spending.</p>
        )}
      </Card>
      <Card>
        <Label>Elections fought</Label>
        {p.politics.elections.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">None yet.</p>
        ) : (
          p.politics.elections.map((e, i) => (
            <div key={i} className="text-sm">
              {e.year} {e.office} · {e.result} · {e.voteShare.toFixed(1)}%
            </div>
          ))
        )}
        <p className="mt-3 text-xs text-[var(--muted)]">Next national poll in {country.name}: {country.electionYear}.</p>
      </Card>
    </div>
  );
}

function Concord({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const [title, setTitle] = useState("Shared compute safety protocol");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Label>Concord of Nations · session {state.world.con.session}</Label>
        <p className="mt-2 text-sm text-[var(--muted)]">A fictional assembly. Votes move trade, research and aid — not real-world politics.</p>
        {state.world.con.resolutions.map((r) => (
          <div key={r.id} className="mt-3 border-t border-white/5 pt-3 text-sm">
            <div className="font-medium">{r.title}</div>
            <div className="text-[var(--muted)]">
              {r.status} · yes {r.yes} / no {r.no} / abs {r.abstain}
            </div>
            <div className="mt-2 flex gap-2">
              <Btn kind="ghost" onClick={() => void act({ type: "conVote", resolutionId: r.id, vote: "yes" })}>
                Yes
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "conVote", resolutionId: r.id, vote: "no" })}>
                No
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "conVote", resolutionId: r.id, vote: "abstain" })}>
                Abstain
              </Btn>
            </div>
          </div>
        ))}
        <div className="mt-4 flex gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          <Btn onClick={() => void act({ type: "conPropose", title })}>Table</Btn>
        </div>
      </Card>
      <Card>
        <Label>Agencies & blocs</Label>
        {state.world.con.agencies.map((a) => (
          <div key={a.name} className="mt-2 text-sm">
            {a.name} · {formatINR(a.budget)} · {a.focus}
          </div>
        ))}
        <div className="mt-4">
          {state.world.con.blocs.map((b) => (
            <p key={b.name} className="text-sm">
              {b.name}: {b.members.join(", ")}
            </p>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Media({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const [topic, setTopic] = useState("markets");
  const [outlet, setOutlet] = useState("The Navpura Ledger");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Label>Pulse networks</Label>
        {state.player.social.platforms.map((a) => (
          <div key={a.platform} className="mt-2 text-sm">
            {SOCIAL_PLATFORMS.find((p) => p.id === a.platform)?.name ?? a.platform} · {a.followers.toLocaleString()} · eng {a.engagement.toFixed(0)}
            <div>
              <Btn kind="ghost" onClick={() => void act({ type: "socialPost", platform: a.platform, topic, spend: 0 })}>
                Post
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "socialPost", platform: a.platform, topic, spend: 15000 })}>
                Boost ₹15k
              </Btn>
            </div>
          </div>
        ))}
        <Field label="Topic">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
      </Card>
      <Card>
        <Label>Outlets you own</Label>
        {state.player.media.outlets.length === 0 ? <p className="text-sm text-[var(--muted)]">None.</p> : state.player.media.outlets.map((o) => <p key={o}>{o}</p>)}
        <Input className="mt-3" value={outlet} onChange={(e) => setOutlet(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-2">
          {MEDIA_KINDS.map((k) => (
            <Btn key={k} kind="ghost" onClick={() => void act({ type: "foundMedia", kind: k, name: outlet })}>
              {k}
            </Btn>
          ))}
        </div>
      </Card>
    </div>
  );
}

function Under({ state, act, busy }: { state: GameState; act: (a: PlayerAction) => void; busy: boolean }) {
  const g = state.player.gambling;
  const [stake, setStake] = useState(1000);
  const [picks, setPicks] = useState(3);
  const [org, setOrg] = useState("Circle of Ember");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Label>Fictional wagering · house games</Label>
        <p className="text-xs text-[var(--muted)]">Play money only. Probabilities shown. No real-money gambling.</p>
        <Field label="Stake ₹">
          <Input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value))} />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind="ghost" disabled={busy} onClick={() => void act({ type: "gamble", game: "roulette", stake, extra: { color: "red" } })}>
            Roulette red (48.6% of 1–36, 0 is house)
          </Btn>
          <Btn kind="ghost" disabled={busy} onClick={() => void act({ type: "gamble", game: "dice", stake, extra: { over: 5 } })}>
            Dice ≥5
          </Btn>
          <Btn kind="ghost" disabled={busy} onClick={() => void act({ type: "gamble", game: "cards", stake })}>
            Cards
          </Btn>
          <Btn kind="ghost" disabled={busy} onClick={() => void act({ type: "gamble", game: "slots", stake })}>
            Slots
          </Btn>
          <Btn kind="ghost" disabled={busy} onClick={() => void act({ type: "gamble", game: "lottery", stake })}>
            Lottery
          </Btn>
        </div>
        <div className="mt-4">
          <Label>Mines · 5×5 · 5 mines</Label>
          <p className="text-xs text-[var(--muted)]">Each safe tile raises the multiplier. Hit a mine, stake is gone. Cash-out is the modelled fair multi minus 3% house.</p>
          <Field label="Picks before cashout">
            <Input type="number" min={1} max={20} value={picks} onChange={(e) => setPicks(Number(e.target.value))} />
          </Field>
          <div className="mt-2">
            <Btn kind="teal" onClick={() => void act({ type: "gamble", game: "mines", stake, extra: { mines: 5, picks } })}>
              Run mines
            </Btn>
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          Wagered {formatINR(g.lifetimeWagered)} · won {formatINR(g.lifetimeWon)} · lost {formatINR(g.lifetimeLost)}
        </p>
      </Card>
      <Card>
        <Label>Casino company</Label>
        {state.world.casinos.map((c) => (
          <p key={c.id} className="text-sm">
            {c.name} · staff {c.staff}
          </p>
        ))}
        <Btn kind="ghost" onClick={() => void act({ type: "foundCasino", name: "Gold Palm", cityId: state.player.cityId })}>
          Open a house (₹80L)
        </Btn>
        <Label>Fictional underground</Label>
        <p className="text-xs text-[var(--muted)]">Abstract risk/reward only. Not a guide to real crime.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {["theft", "fraud", "smuggling", "cybercrime"].map((k) => (
            <Btn key={k} kind="ghost" onClick={() => void act({ type: "crimeAct", kind: k, intensity: 2 })}>
              {k}
            </Btn>
          ))}
        </div>
        <p className="mt-2 text-sm">Heat {state.player.crime.heat.toFixed(0)} · evidence {state.player.crime.evidence.toFixed(0)}</p>
        <Input className="mt-3" value={org} onChange={(e) => setOrg(e.target.value)} />
        <div className="mt-2 flex gap-2">
          <Btn kind="ghost" onClick={() => void act({ type: "foundOrg", kind: "community", name: org, doctrine: "mutual aid" })}>
            Community org
          </Btn>
          <Btn kind="ghost" onClick={() => void act({ type: "foundOrg", kind: "criminal", name: org, doctrine: "shadow trade" })}>
            Crew
          </Btn>
        </div>
        {state.player.orgs.map((o) => (
          <div key={o.id} className="mt-2 text-sm">
            {o.name} · {o.members} members · loyalty {o.loyalty.toFixed(0)}
            <div className="flex gap-1">
              <Btn kind="ghost" onClick={() => void act({ type: "orgAct", orgId: o.id, act: "recruit" })}>
                Recruit
              </Btn>
              <Btn kind="ghost" onClick={() => void act({ type: "orgAct", orgId: o.id, act: "media" })}>
                Publish
              </Btn>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function News({ state }: { state: GameState }) {
  return (
    <div className="grid gap-3">
      {state.news.map((n) => (
        <Card key={n.id}>
          <p className="tick">
            {n.tag} · {n.month}/{n.year} · {n.countryId}
          </p>
          <h3 className="font-serif text-2xl">{n.headline}</h3>
          <p className="mt-2 text-sm leading-6">{n.body}</p>
          <p className="mt-2 text-xs text-amber-200/80">Impact: {n.impact}</p>
        </Card>
      ))}
    </div>
  );
}

function download(name: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Legacy({ state, act }: { state: GameState; act: (a: PlayerAction) => void }) {
  const nw = computeNetWorth(state);
  const mode = MODES.find((m) => m.id === state.mode);
  const review = state.adv?.yearReview ?? null;
  const [bioOpen, setBioOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const res = importLife(parsed);
        if (res) {
          window.location.href = `/play?life=${res.id}`;
        } else {
          setImportMsg("That file is not a valid Aurelion save.");
        }
      } catch {
        setImportMsg("Could not read that file.");
      }
    };
    reader.readAsText(f);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <div className="flex items-center justify-between">
          <Label>Biography & timeline</Label>
          <div className="flex gap-2">
            <Btn kind="ghost" onClick={() => setBioOpen(true)}>
              Generate bio
            </Btn>
            <Btn
              kind="ghost"
              onClick={() => download(`${state.player.name.replace(/\s+/g, "_")}_aurelion.json`, JSON.stringify(state, null, 1), "application/json")}
            >
              Export save
            </Btn>
            <Btn kind="ghost" onClick={() => fileRef.current?.click()}>
              Import save
            </Btn>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onImportFile} />
          </div>
        </div>
        <p className="font-serif text-3xl">{state.player.name}</p>
        <p className="text-sm text-[var(--muted)]">
          {mode?.name} · gen {state.player.family.generation} · net {formatINR(nw)} · cash {formatINR(liquidCash(state.player))}
        </p>
        {importMsg ? <p className="mt-1 text-xs text-rose-300">{importMsg}</p> : null}
        <div className="mt-4 max-h-[480px] space-y-3 overflow-auto border-l border-amber-200/20 pl-4">
          {state.timeline.map((t) => (
            <div key={t.id}>
              <p className="tick">
                Age {t.age} · {t.month}/{t.year}
              </p>
              <p className="text-sm">{t.text}</p>
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-4">
        {review ? (
          <Card>
            <Label>Year {review.year} review</Label>
            <div className="mt-2 text-sm">
              <p>
                Net worth {formatINR(review.nwStart)} → {formatINR(review.nwEnd)}
              </p>
              <p className="text-[var(--muted)]">
                {formatINR(review.earned)} earned · {formatINR(review.spent)} spent
              </p>
            </div>
            {review.built.length ? (
              <div className="mt-3">
                <p className="tick">Built</p>
                {review.built.map((b, i) => (
                  <p key={i} className="mt-1 text-sm">
                    · {b}
                  </p>
                ))}
              </div>
            ) : null}
            {review.world.length ? (
              <div className="mt-3">
                <p className="tick">World</p>
                {review.world.map((w, i) => (
                  <p key={i} className="mt-1 text-sm text-[var(--muted)]">
                    · {w}
                  </p>
                ))}
              </div>
            ) : null}
            <p className="mt-3 text-sm italic text-[var(--muted)]">{review.outlook}</p>
          </Card>
        ) : null}
        <Card>
          <Label>Achievements {state.achievements.length}/{ACHIEVEMENTS.length}</Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ACHIEVEMENTS.map((a) => (
              <div key={a.id} className={`rounded-xl border p-2 text-xs ${state.achievements.includes(a.id) ? "border-amber-200/40 text-amber-100" : "border-white/5 text-[var(--muted)]"}`}>
                <div className="font-medium">{a.name}</div>
                {a.desc}
              </div>
            ))}
          </div>
          {!state.player.alive ? (
            <div className="mt-4">
              <Btn onClick={() => void act({ type: "continueAsHeir" })}>Continue as heir</Btn>
            </div>
          ) : null}
        </Card>
      </div>
      {bioOpen ? (
        <LineListModal title="Generated biography" lines={generateBio(state).split("\n")} onClose={() => setBioOpen(false)} />
      ) : null}
    </div>
  );
}

void Money;
void formatPct;
