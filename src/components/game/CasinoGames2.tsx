"use client";

// Baccarat, Jacks-or-Better video poker and the Big Six wheel — played for
// real against the save's RNG — plus the owner's console for running a casino.
import { useEffect, useRef, useState } from "react";
import { BIG_SIX, BIG_SIX_WHEEL, bigSixEdge, cardLabel, cardRed, VP_PAYS, vpEvaluate, vpPeek, type CasinoState } from "@/lib/sim/casino";
import { CASINO_EXTRAS, casinoNeeds, casinoValue, getCasinoOps, STAFF_DEFS, STAFF_IDS, TABLE_DEFS, TABLE_IDS } from "@/lib/sim/casinoops";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { formatINR } from "@/lib/sim/util";
import { Btn, Card, Field, Input, Label, Select, Spark } from "./ui";

type Act = (a: PlayerAction) => void;

function Card2({ c, hidden, small }: { c?: number; hidden?: boolean; small?: boolean }) {
  const size = small ? "h-14 w-10 text-sm" : "h-24 w-16 text-xl";
  if (hidden || c == null)
    return (
      <div className={`${size} grid place-items-center rounded-lg border border-amber-200/30 bg-gradient-to-br from-[#2b1d3f] to-[#16213a] shadow-lg`}>
        <span className="text-amber-200/40">✦</span>
      </div>
    );
  return (
    <div
      className={`${size} grid place-items-center rounded-lg border border-white/20 bg-[#f6f1e4] font-semibold shadow-lg ${cardRed(c) ? "text-rose-600" : "text-slate-900"}`}
    >
      {cardLabel(c)}
    </div>
  );
}

function Chips({ chip, setChip, cash }: { chip: number; setChip: (n: number) => void; cash: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="tick">Chip</span>
      {[500, 1000, 5000, 25000, 100000, 1000000].map((v) => (
        <button
          key={v}
          onClick={() => setChip(v)}
          className={`grid h-9 w-9 place-items-center rounded-full border-2 text-[10px] font-semibold ${chip === v ? "border-amber-200 bg-amber-300 text-black" : "border-white/20 bg-white/5 text-[var(--muted)]"}`}
        >
          {v >= 100000 ? `${v / 100000}L` : v >= 1000 ? `${v / 1000}k` : v}
        </button>
      ))}
      <span className="text-[11px] text-[var(--muted)]">cash {formatINR(cash)}</span>
    </div>
  );
}

/* ------------------------------------------------------------ baccarat */

export function Baccarat({ c, act, busy, cash }: { c: CasinoState; act: Act; busy: boolean; cash: number }) {
  const [chip, setChip] = useState(1000);
  const [bets, setBets] = useState({ player: 0, banker: 0, tie: 0 });
  const [shown, setShown] = useState(99);
  const r = c.baccarat ?? null;
  const lastId = useRef(r?.id);
  // deal the cards one by one: P, B, P, B, then any third cards
  useEffect(() => {
    if (!r || r.id === lastId.current) return;
    lastId.current = r.id;
    setShown(0);
    const total = r.player.length + r.banker.length;
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= total) clearInterval(t);
    }, 380);
    return () => clearInterval(t);
  }, [r]);
  const order = r
    ? [
        ...[0, 1].flatMap((i) => [["p", i] as const, ["b", i] as const]),
        ...(r.player[2] != null ? [["p", 2] as const] : []),
        ...(r.banker[2] != null ? [["b", 2] as const] : []),
      ]
    : [];
  const visible = (side: "p" | "b", i: number) => order.findIndex(([s, j]) => s === side && j === i) < shown;
  const done = r ? shown >= r.player.length + r.banker.length : false;
  const total = bets.player + bets.banker + bets.tie;
  const spot = (k: "player" | "banker" | "tie", label: string, pays: string, cls: string) => (
    <button onClick={() => setBets({ ...bets, [k]: bets[k] + chip })} className={`relative flex-1 rounded-2xl border-2 p-4 text-center ${cls}`}>
      <p className="font-serif text-lg">{label}</p>
      <p className="text-[11px] opacity-70">{pays}</p>
      {bets[k] ? <span className="absolute -right-1 -top-1 rounded-full bg-amber-300 px-2 text-xs text-black">{formatINR(bets[k])}</span> : null}
    </button>
  );
  return (
    <Card>
      <Label>Baccarat · punto banco · 8 decks</Label>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {(["p", "b"] as const).map((side) => {
          const cards = r ? (side === "p" ? r.player : r.banker) : [];
          const tot = r ? (side === "p" ? r.pTotal : r.bTotal) : null;
          const win = r && done && ((side === "p" && r.winner === "player") || (side === "b" && r.winner === "banker"));
          return (
            <div key={side} className={`rounded-2xl border p-3 ${win ? "border-teal-300/60 bg-teal-300/10" : "border-white/10"}`}>
              <p className="tick">
                {side === "p" ? "Player" : "Banker"} {r && done ? `· ${tot}` : ""}
              </p>
              <div className="mt-2 flex gap-2">
                {r ? cards.map((card, i) => <Card2 key={i} c={card} hidden={!visible(side, i)} />) : [0, 1].map((i) => <Card2 key={i} hidden />)}
              </div>
            </div>
          );
        })}
      </div>
      {r && done ? (
        <p className={`mt-2 text-sm ${r.payout - (r.bets.player + r.bets.banker + r.bets.tie) >= 0 ? "text-teal-300" : "text-rose-300"}`}>
          {r.winner === "tie" ? "Tie" : `${r.winner === "player" ? "Player" : "Banker"} wins`} {r.pTotal}–{r.bTotal} · you get back {formatINR(r.payout)}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        {spot("player", "PLAYER", "pays 1:1", "border-sky-400/40 bg-sky-500/10")}
        {spot("tie", "TIE", "pays 8:1", "border-emerald-400/40 bg-emerald-500/10")}
        {spot("banker", "BANKER", "pays 0.95:1", "border-rose-400/40 bg-rose-500/10")}
      </div>
      <div className="mt-3">
        <Chips chip={chip} setChip={setChip} cash={cash} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn disabled={busy || !total || !done} onClick={() => act({ type: "baccaratDeal", bets })}>
          Deal · {formatINR(total)}
        </Btn>
        <Btn kind="ghost" onClick={() => setBets({ player: 0, banker: 0, tie: 0 })}>
          Clear bets
        </Btn>
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        Cards: A=1, 2–9 face value, 10/J/Q/K=0; totals count the last digit. Naturals (8–9) end the hand; otherwise the fixed tableau decides third cards. A tie
        returns Player and Banker bets. Bets stay on the table between hands.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------ video poker */

export function VideoPoker({ c, act, busy, cash, xray }: { c: CasinoState; act: Act; busy: boolean; cash: number; xray: boolean }) {
  const [stake, setStake] = useState(1000);
  const [holds, setHolds] = useState([false, false, false, false, false]);
  const s = c.vp ?? null;
  const live = s?.status === "deal";
  const cur = s ? vpEvaluate(s.hand) : null;
  const lastId = useRef(s?.id);
  useEffect(() => {
    if (s && s.id !== lastId.current) {
      lastId.current = s.id;
      setHolds([false, false, false, false, false]);
    }
  }, [s]);
  const peek = xray && s && live ? vpPeek(s) : null;
  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <Label>Video poker · Jacks or Better · 9/6 full pay</Label>
        {peek ? <span className="text-[10px] text-rose-300/70">next: {peek.map(cardLabel).join(" ")}</span> : null}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-x-4 text-[11px] md:grid-cols-5">
        {VP_PAYS.map((p) => (
          <div key={p.hand} className={`flex justify-between ${cur && cur.hand === p.hand ? "text-amber-200" : "text-[var(--muted)]"}`}>
            <span>{p.hand}</span>
            <span>{p.pay}×</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-2">
        {(s ? s.hand : [undefined, undefined, undefined, undefined, undefined]).map((card, i) => (
          <button key={i} disabled={!live} onClick={() => setHolds(holds.map((h, j) => (j === i ? !h : h)))} className="flex flex-col items-center gap-1">
            <div className={holds[i] && live ? "-translate-y-1 rounded-lg ring-2 ring-amber-300" : ""}>
              <Card2 c={card} hidden={card == null} />
            </div>
            <span className={`text-[10px] ${holds[i] && live ? "text-amber-200" : "text-transparent"}`}>HELD</span>
          </button>
        ))}
      </div>
      {s && !live ? (
        <p className={`mt-2 text-center text-sm ${(s.payout ?? 0) > s.stake ? "text-teal-300" : (s.payout ?? 0) === s.stake ? "" : "text-rose-300"}`}>
          {s.result} · back {formatINR(s.payout ?? 0)}
        </p>
      ) : live && cur ? (
        <p className="mt-2 text-center text-xs text-[var(--muted)]">{cur.pay ? `You hold ${cur.hand} already.` : "Tap cards to hold, then draw."}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!live ? (
          <>
            <div className="w-32">
              <Input type="number" min={100} value={stake} onChange={(e) => setStake(Math.max(0, Number(e.target.value)))} />
            </div>
            <Btn disabled={busy} onClick={() => act({ type: "vpDeal", stake })}>
              Deal
            </Btn>
            <span className="text-[11px] text-[var(--muted)]">cash {formatINR(cash)}</span>
          </>
        ) : (
          <Btn disabled={busy} onClick={() => act({ type: "vpDraw", holds })}>
            Draw {5 - holds.filter(Boolean).length}
          </Btn>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--muted)]">
        Pays are &quot;for one&quot;: a pair of jacks or better returns your stake. Perfect strategy returns 99.5%.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------ big six */

const SEG_COLOR: Record<string, string> = {
  "1": "#e5e7eb",
  "2": "#fbbf24",
  "5": "#60a5fa",
  "10": "#a78bfa",
  "20": "#34d399",
  joker: "#f43f5e",
  logo: "#f59e0b",
};

export function BigSix({ c, act, busy, cash }: { c: CasinoState; act: Act; busy: boolean; cash: number }) {
  const [chip, setChip] = useState(1000);
  const [bets, setBets] = useState<Record<string, number>>({});
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const w = c.wheel ?? null;
  const lastId = useRef(w?.id);
  useEffect(() => {
    if (!w || w.id === lastId.current) return;
    lastId.current = w.id;
    setSpinning(true);
    const seg = 360 / BIG_SIX_WHEEL.length;
    const target = 360 * 4 + (360 - (w.seg + 0.5) * seg);
    setAngle((a) => a - (a % 360) + target);
    const t = setTimeout(() => setSpinning(false), 3100);
    return () => clearTimeout(t);
  }, [w]);
  const total = Object.values(bets).reduce((a, b) => a + b, 0);
  const seg = 360 / BIG_SIX_WHEEL.length;
  const hit = w ? BIG_SIX_WHEEL[w.seg] : null;
  return (
    <Card>
      <Label>Big Six wheel · 54 segments</Label>
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <div className="relative h-56 w-56">
          <div
            className="absolute inset-0 rounded-full border-4 border-amber-200/50"
            style={{
              transform: `rotate(${angle}deg)`,
              transition: spinning ? "transform 3s cubic-bezier(.12,.7,.2,1)" : "none",
              background: `conic-gradient(${BIG_SIX_WHEEL.map((s, i) => `${SEG_COLOR[s]} ${i * seg}deg ${(i + 1) * seg - 0.6}deg, #0b0e14 ${(i + 1) * seg - 0.6}deg ${(i + 1) * seg}deg`).join(",")})`,
            }}
          />
          <div className="absolute inset-12 grid place-items-center rounded-full bg-[#0b0e14] text-center">
            <span className="font-serif text-2xl">{spinning ? "…" : hit ? BIG_SIX.find((x) => x.id === hit)?.label : "–"}</span>
          </div>
          <div className="absolute left-1/2 top-[-8px] h-0 w-0 -translate-x-1/2 border-x-[8px] border-t-[14px] border-x-transparent border-t-amber-200" />
        </div>
        {w && !spinning ? (
          <p className={`text-sm ${w.win > 0 ? "text-teal-300" : "text-rose-300"}`}>{w.win > 0 ? `Winner! Back ${formatINR(w.win)}` : "No win this spin."}</p>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-7">
        {BIG_SIX.map((s) => (
          <button
            key={s.id}
            onClick={() => setBets({ ...bets, [s.id]: (bets[s.id] ?? 0) + chip })}
            className={`relative rounded-xl border-2 p-2 text-center ${hit === s.id && !spinning ? "border-amber-200" : "border-white/10"}`}
            style={{ background: `${SEG_COLOR[s.id]}22` }}
          >
            <p className="font-serif">{s.label}</p>
            <p className="text-[10px] text-[var(--muted)]">
              {s.pays}:1 · {s.count}/54
            </p>
            <p className="text-[9px] text-[var(--muted)]">edge {(bigSixEdge(s.id) * 100).toFixed(1)}%</p>
            {bets[s.id] ? (
              <span className="absolute -right-1 -top-1 rounded-full bg-amber-300 px-1.5 text-[10px] text-black">{formatINR(bets[s.id]!)}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <Chips chip={chip} setChip={setChip} cash={cash} />
      </div>
      <div className="mt-3 flex gap-2">
        <Btn disabled={busy || spinning || !total} onClick={() => act({ type: "wheelSpin", bets })}>
          Spin · {formatINR(total)}
        </Btn>
        <Btn kind="ghost" onClick={() => setBets({})}>
          Clear
        </Btn>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ own & run */

export function CasinoOwner({ state, act }: { state: GameState; act: Act }) {
  const casinos = state.world.casinos;
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [city, setCity] = useState(state.player.cityId);
  const cas = casinos.find((c) => c.id === sel) ?? casinos[0];
  return (
    <div className="space-y-4">
      <Card>
        <Label>Build a casino resort</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          ₹5 crore: the building, a gaming floor (4 blackjack, 2 roulette, 2 baccarat, a poker room, a Big Six wheel, 60 slots), the cage, surveillance and a
          standard licence. Then you run it — tables, limits, staff, comps, VIP, a hotel — with real money coming in and going out every month.
        </p>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <Input placeholder="Casino name" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={city} onChange={(e) => setCity(e.target.value)}>
            {state.world.cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · pop {(c.population / 1e6).toFixed(1)}M · tourism {Math.round(c.tourism)}
              </option>
            ))}
          </Select>
          <Btn
            onClick={() =>
              act({
                type: "foundCasino",
                name: name || `${state.player.name.split(" ").pop()} Palace`,
                cityId: city,
              })
            }
          >
            Build · ₹5 Cr
          </Btn>
        </div>
      </Card>
      {casinos.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {casinos.map((c) => (
            <Btn key={c.id} kind={c.id === cas?.id ? "gold" : "ghost"} onClick={() => setSel(c.id)}>
              {c.name}
            </Btn>
          ))}
        </div>
      ) : null}
      {cas ? <CasinoConsole key={cas.id} state={state} act={act} casinoId={cas.id} /> : null}
    </div>
  );
}

function CasinoConsole({ state, act, casinoId }: { state: GameState; act: Act; casinoId: string }) {
  const cas = state.world.casinos.find((c) => c.id === casinoId)!;
  const ops = getCasinoOps(state, cas);
  const need = casinoNeeds(ops);
  const L = ops.last;
  const biz = (args: Record<string, unknown>) => act({ type: "biz", op: "casinoManage", id: cas.id, args });
  const [tables, setTables] = useState<Record<string, string>>(() => Object.fromEntries(TABLE_IDS.map((g) => [g, String(ops.tables[g])])));
  const [staff, setStaff] = useState<Record<string, string>>(() => Object.fromEntries(STAFF_IDS.map((s) => [s, String(ops.staff[s])])));
  const [f, setF] = useState(() => ({
    slots: String(ops.slots),
    minBet: String(ops.minBet),
    maxBet: String(ops.maxBet),
    slotHold: String(Math.round(ops.slotHold * 1000) / 10),
    comps: String(Math.round(ops.comps * 100)),
    marketing: String(ops.marketing),
    addRooms: "0",
  }));
  const n = (s: string) => Number(String(s).replace(/[,₹\s]/g, "")) || 0;
  const row = (k: string, v: string, tone?: string) => (
    <div className="flex justify-between border-t border-white/5 py-1 text-sm">
      <span className="text-[var(--muted)]">{k}</span>
      <span className={tone}>{v}</span>
    </div>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <Label>
          {cas.name} · last month {L ? `(${L.t})` : ""}
        </Label>
        {L ? (
          <div className="mt-2">
            {row("Guests", L.visits.toLocaleString("en-IN"))}
            {row("Handle (total bets)", formatINR(L.handle))}
            {row("Gross gaming win", formatINR(L.ggr), L.ggr >= L.theo ? "text-teal-300" : "text-rose-300")}
            {row("Theoretical win", formatINR(L.theo))}
            {row("Hotel + food & drink", formatINR(L.hotel + L.fnb))}
            {row("Online floor", formatINR(L.online ?? 0), (L.online ?? 0) >= 0 ? "text-teal-300" : "text-rose-300")}
            {row("Payroll", `−${formatINR(L.payroll)}`)}
            {row("Comps", `−${formatINR(L.comps)}`)}
            {row("Gaming tax (25% of GGR)", `−${formatINR(L.gamingTax)}`)}
            {row("Licence + marketing", `−${formatINR(L.licence + L.marketing)}`)}
            {row("Upkeep, F&B and hotel costs", `−${formatINR(L.upkeep)}`)}
            {L.incidents ? row("Incidents (cheats, fines)", `−${formatINR(L.incidents)}`, "text-rose-300") : null}
            {row("Net to you", formatINR(L.net), L.net >= 0 ? "text-teal-300" : "text-rose-300")}
            {L.note ? <p className="mt-2 text-xs text-amber-200/80">{L.note}</p> : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">The first month&apos;s numbers arrive after a month of trading.</p>
        )}
        {ops.history.length > 1 ? (
          <div className="mt-2">
            <p className="tick">Net per month</p>
            <Spark values={[...ops.history].reverse().map((h) => h.net)} />
          </div>
        ) : null}
        <div className="mt-2">
          {row("Reputation", `${Math.round(ops.reputation)}/100`)}
          {row("Book value / sale value", `${formatINR(ops.assetValue ?? 0)} / ${formatINR(casinoValue(state, cas))}`)}
        </div>
      </Card>

      {L ? (
        <Card>
          <Label>By game</Label>
          <table className="mt-2 w-full text-xs">
            <thead className="tick text-left">
              <tr>
                <th className="py-1">Game</th>
                <th>Handle</th>
                <th>House win</th>
                <th>Hold</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(L.byGame).map(([g, v]) => (
                <tr key={g} className="border-t border-white/5">
                  <td className="py-1">{TABLE_DEFS[g as keyof typeof TABLE_DEFS]?.name ?? "Slots"}</td>
                  <td>{formatINR(v.handle)}</td>
                  <td className={v.win >= 0 ? "text-teal-300" : "text-rose-300"}>{formatINR(v.win)}</td>
                  <td>{v.handle ? ((v.win / v.handle) * 100).toFixed(1) : "0"}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ops.whales.length ? (
            <div className="mt-3">
              <p className="tick">High rollers</p>
              {ops.whales.slice(0, 6).map((w, i) => (
                <div key={i} className="flex justify-between border-t border-white/5 py-1 text-xs">
                  <span className="text-[var(--muted)]">
                    {w.t} · {w.name}
                  </span>
                  <span className={w.result >= 0 ? "text-teal-300" : "text-rose-300"}>
                    {w.result >= 0 ? "house +" : "house −"}
                    {formatINR(Math.abs(w.result))}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Label>Gaming floor</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Adding tables costs the table; removing one sells it for 40%. Each table needs ~4 dealers to run round the clock.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
          {TABLE_IDS.map((g) => (
            <Field key={g} label={`${TABLE_DEFS[g].name} · ${formatINR(TABLE_DEFS[g].price)} · edge ${(TABLE_DEFS[g].edge * 100).toFixed(1)}%`}>
              <Input value={tables[g]} onChange={(e) => setTables({ ...tables, [g]: e.target.value })} inputMode="numeric" />
            </Field>
          ))}
          <Field label="Slot machines · ₹4 L each">
            <Input value={f.slots} onChange={(e) => setF({ ...f, slots: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Slot hold %">
            <Input value={f.slotHold} onChange={(e) => setF({ ...f, slotHold: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label="Table min bet ₹">
            <Input value={f.minBet} onChange={(e) => setF({ ...f, minBet: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Table max bet ₹">
            <Input value={f.maxBet} onChange={(e) => setF({ ...f, maxBet: e.target.value })} inputMode="numeric" />
          </Field>
        </div>
        <Btn
          className="mt-2"
          onClick={() =>
            biz({
              tables: Object.fromEntries(TABLE_IDS.map((g) => [g, n(tables[g]!)])),
              slots: n(f.slots),
              slotHold: n(f.slotHold) / 100,
              minBet: n(f.minBet),
              maxBet: n(f.maxBet),
            })
          }
        >
          Apply floor
        </Btn>
      </Card>

      <Card>
        <Label>Staff</Label>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
          {STAFF_IDS.map((s) => (
            <Field key={s} label={`${STAFF_DEFS[s].name} (need ${need[s]})`}>
              <Input value={staff[s]} onChange={(e) => setStaff({ ...staff, [s]: e.target.value })} inputMode="numeric" />
            </Field>
          ))}
        </div>
        <div className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
          {STAFF_IDS.map((s) => (
            <p key={s}>
              <span className={ops.staff[s] < need[s] ? "text-rose-300" : "text-teal-300"}>
                {STAFF_DEFS[s].name}: {ops.staff[s]}/{need[s]}
              </span>{" "}
              — {STAFF_DEFS[s].blurb}
            </p>
          ))}
        </div>
        <Btn
          className="mt-2"
          onClick={() =>
            biz({
              staff: Object.fromEntries(STAFF_IDS.map((s) => [s, n(staff[s]!)])),
            })
          }
        >
          Apply staffing
        </Btn>
      </Card>

      <Card>
        <Label>Events, junkets, training &amp; the online floor</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Everything here is paid for in real money and shows up in next month&apos;s P&amp;L. Nothing is cosmetic.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-4">
          <div className="flex justify-between border-t border-white/5 py-1 text-sm">
            <span className="text-[var(--muted)]">Event boost</span>
            <span>{ops.boost ? `${ops.boost.mult.toFixed(2)}× · ${ops.boost.months} mo` : "—"}</span>
          </div>
          <div className="flex justify-between border-t border-white/5 py-1 text-sm">
            <span className="text-[var(--muted)]">Junket programme</span>
            <span>{Math.round(ops.junket ?? 0)}/100</span>
          </div>
          <div className="flex justify-between border-t border-white/5 py-1 text-sm">
            <span className="text-[var(--muted)]">Floor training</span>
            <span>{Math.round(ops.training ?? 0)}/100</span>
          </div>
          <div className="flex justify-between border-t border-white/5 py-1 text-sm">
            <span className="text-[var(--muted)]">Suites / online</span>
            <span>
              {Math.round(ops.suites ?? 0)} · {ops.online ? "licensed" : "none"}
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn kind="ghost" onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "event" } })}>
            Tournament ({formatINR(ops.marketing * 2)})
          </Btn>
          <Btn kind={(ops.junket ?? 0) >= 50 ? "teal" : "ghost"} onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "junket", level: 50 } })}>
            Junket 50
          </Btn>
          <Btn kind={(ops.junket ?? 0) >= 100 ? "teal" : "ghost"} onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "junket", level: 100 } })}>
            Junket 100
          </Btn>
          <Btn kind="ghost" onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "training", level: (ops.training ?? 0) + 20 } })}>
            Train +20
          </Btn>
          <Btn kind="ghost" onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "suite", level: 5 } })}>
            +5 suites (₹7.5 Cr)
          </Btn>
          <Btn kind={ops.online ? "teal" : "ghost"} onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "online" } })}>
            {ops.online ? "Online floor live" : "Online licence ₹8 Cr"}
          </Btn>
          <Btn kind="ghost" onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "security", level: 3 } })}>
            +3 surveillance
          </Btn>
          <Btn kind="ghost" onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "odds", level: 1 } })}>
            Hold +0.5%
          </Btn>
          <Btn kind="ghost" onClick={() => act({ type: "biz", op: "casinoExtra", id: cas.id, args: { what: "odds", level: -1 } })}>
            Hold −0.5%
          </Btn>
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]">{CASINO_EXTRAS.junket.blurb}</p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">{CASINO_EXTRAS.online.blurb}</p>
        <p className="mt-1 text-[11px] text-[var(--muted)]">{CASINO_EXTRAS.training.blurb}</p>
      </Card>

      <Card>
        <Label>Guests, VIPs &amp; licence</Label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Comps (% of theo win)">
            <Input value={f.comps} onChange={(e) => setF({ ...f, comps: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label="Marketing ₹/month">
            <Input value={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.value })} inputMode="numeric" />
          </Field>
          <Field label={`Add hotel rooms (have ${ops.hotelRooms})`}>
            <Input value={f.addRooms} onChange={(e) => setF({ ...f, addRooms: e.target.value })} inputMode="numeric" />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn
            onClick={() =>
              biz({
                comps: n(f.comps) / 100,
                marketing: n(f.marketing),
                addRooms: n(f.addRooms),
              })
            }
          >
            Apply
          </Btn>
          <Btn kind={ops.vip ? "teal" : "ghost"} onClick={() => biz({ vip: !ops.vip })}>
            VIP programme {ops.vip ? "on" : "off"}
          </Btn>
          <Btn
            kind={ops.licence === "premium" ? "teal" : "ghost"}
            onClick={() =>
              biz({
                licence: ops.licence === "premium" ? "standard" : "premium",
              })
            }
          >
            {ops.licence === "premium" ? "Premium licence" : "Upgrade licence (₹1 Cr)"}
          </Btn>
          <Btn kind="danger" onClick={() => act({ type: "biz", op: "sellCasino", id: cas.id })}>
            Sell casino
          </Btn>
        </div>
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          A premium licence (₹15 L/month) lifts the table limit to ₹5 crore and allows a VIP programme — whales bring huge handle and huge swings. Hotel rooms
          bring guests and room revenue. Under-staffed cages draw AML fines; thin surveillance invites cheating rings.
        </p>
        {ops.log?.length ? (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
            {ops.log.slice(0, 20).map((l, i) => (
              <li key={i} className="border-t border-white/5 pt-1">
                <span className="text-[var(--muted)]">{l.t}</span> · {l.text}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
