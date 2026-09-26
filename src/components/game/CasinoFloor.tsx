"use client";

// The casino floor. Every game is played move by move against the engine: the
// shoe, wheel, reels and crash point are drawn from the save's own RNG, so
// nothing can be re-rolled by refreshing. Odds and house edge are always shown.
import { useEffect, useRef, useState } from "react";
import {
  cardLabel,
  cardRank,
  cardRed,
  casinoOdds,
  CRASH_RATE,
  crashAt,
  diceOdds,
  handValue,
  bjPeek,
  hiloOdds,
  hiloPeek,
  PLINKO_ROWS,
  plinkoTable,
  RED,
  SLOT_SYMBOLS,
  SLOT_TWO_CHERRY,
  WHEEL,
  type CasinoState,
  type RouletteBet,
} from "@/lib/sim/casino";
import { xrayOn } from "@/lib/sim/debug";
import { liquidCash } from "@/lib/sim/finance";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { formatINR } from "@/lib/sim/util";
import { Btn, Card, Input, Label } from "./ui";
import { MinesGame } from "./MinesGame";
import { Baccarat, BigSix, CasinoOwner, VideoPoker } from "./CasinoGames2";

type Act = (a: PlayerAction) => void;
type GameId = "blackjack" | "baccarat" | "vpoker" | "roulette" | "bigsix" | "slots" | "crash" | "dice" | "hilo" | "plinko" | "mines" | "own";

const GAMES: { id: GameId; label: string; icon: string; blurb: string }[] = [
  { id: "blackjack", label: "Blackjack", icon: "🂡", blurb: "Hit, stand, double. Dealer stands on 17." },
  { id: "baccarat", label: "Baccarat", icon: "♦", blurb: "Player, Banker or Tie. The high-roller game." },
  { id: "vpoker", label: "Video Poker", icon: "🃏", blurb: "Jacks or Better. Hold, draw, get paid." },
  { id: "roulette", label: "Roulette", icon: "◎", blurb: "Single-zero wheel. Place chips, spin." },
  { id: "bigsix", label: "Big Six", icon: "✺", blurb: "The money wheel. 54 segments, up to 40:1." },
  { id: "slots", label: "Slots", icon: "7", blurb: "Three reels, one line." },
  { id: "crash", label: "Crash", icon: "↗", blurb: "Ride the multiplier. Bail before it crashes." },
  { id: "hilo", label: "Hi-Lo", icon: "⇅", blurb: "Higher or lower — chain the calls." },
  { id: "dice", label: "Dice", icon: "⚄", blurb: "Pick your odds, roll 0–100." },
  { id: "plinko", label: "Plinko", icon: "▾", blurb: "Drop the ball through 12 rows of pegs." },
  { id: "mines", label: "Mines", icon: "✱", blurb: "5×5 board, find gems, dodge mines." },
  { id: "own", label: "Own & run", icon: "🏛", blurb: "Build and run your own casino." },
];

const EMPTY: CasinoState = { bj: null, crash: null, hilo: null, roulette: [], crashHistory: [], history: [], sessions: 0, net: 0 };

function Stake({ value, set, cash }: { value: number; set: (n: number) => void; cash: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="w-32">
        <Input type="number" min={100} value={value} onChange={(e) => set(Math.max(0, Number(e.target.value)))} />
      </div>
      {[1000, 10000, 100000, 1000000].map((v) => (
        <button key={v} onClick={() => set(v)} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-[var(--muted)] hover:text-amber-200">
          {v >= 100000 ? `${v / 100000}L` : `${v / 1000}k`}
        </button>
      ))}
      <button onClick={() => set(Math.max(100, Math.round(value / 2)))} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-[var(--muted)]">
        ½
      </button>
      <button onClick={() => set(Math.round(value * 2))} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-[var(--muted)]">
        2×
      </button>
      <span className="text-[11px] text-[var(--muted)]">cash {formatINR(cash)}</span>
    </div>
  );
}

function PlayingCard({ c, hidden, peek, small }: { c?: number; hidden?: boolean; peek?: boolean; small?: boolean }) {
  const size = small ? "h-14 w-10 text-sm" : "h-24 w-16 text-xl";
  if (hidden || c == null) {
    return (
      <div className={`${size} relative grid place-items-center rounded-lg border border-amber-200/30 bg-gradient-to-br from-[#2b1d3f] to-[#16213a] shadow-lg`}>
        <span className="text-amber-200/40">✦</span>
        {peek && c != null ? (
          <span className={`absolute bottom-1 right-1 text-[10px] ${cardRed(c) ? "text-rose-400/70" : "text-white/50"}`}>{cardLabel(c)}</span>
        ) : null}
      </div>
    );
  }
  return (
    <div className={`${size} grid place-items-center rounded-lg border border-white/20 bg-[#f6f1e4] font-semibold shadow-lg ${cardRed(c) ? "text-rose-600" : "text-slate-900"}`}>
      {cardLabel(c)}
    </div>
  );
}

export function CasinoFloor({ state, act, busy }: { state: GameState; act: Act; busy: boolean }) {
  const [game, setGame] = useState<GameId>("blackjack");
  const c = state.life?.casino ?? EMPTY;
  const cash = liquidCash(state.player);
  const xray = xrayOn(state);
  const habit = state.life?.addiction.gambling ?? 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2 md:grid-cols-6 2xl:grid-cols-12">
        {GAMES.map((g) => (
          <button
            key={g.id}
            onClick={() => setGame(g.id)}
            className={`rounded-2xl border p-2 text-center transition ${game === g.id ? "border-amber-200/60 bg-amber-200/10" : "border-white/10 hover:bg-white/5"}`}
            title={g.blurb}
          >
            <div className="text-2xl">{g.icon}</div>
            <div className={`text-xs ${game === g.id ? "text-amber-200" : "text-[var(--muted)]"}`}>{g.label}</div>
          </button>
        ))}
      </div>
      {game === "own" ? (
        <CasinoOwner state={state} act={act} />
      ) : (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div>
            {game === "baccarat" ? <Baccarat c={c} act={act} busy={busy} cash={cash} /> : null}
            {game === "vpoker" ? <VideoPoker c={c} act={act} busy={busy} cash={cash} xray={xray} /> : null}
            {game === "bigsix" ? <BigSix c={c} act={act} busy={busy} cash={cash} /> : null}
          {game === "blackjack" ? <Blackjack c={c} act={act} busy={busy} cash={cash} xray={xray} /> : null}
          {game === "roulette" ? <Roulette c={c} act={act} busy={busy} cash={cash} /> : null}
          {game === "slots" ? <Slots c={c} act={act} busy={busy} cash={cash} /> : null}
          {game === "crash" ? <Crash c={c} act={act} busy={busy} cash={cash} xray={xray} /> : null}
          {game === "hilo" ? <HiLo c={c} act={act} busy={busy} cash={cash} xray={xray} /> : null}
          {game === "dice" ? <Dice c={c} act={act} busy={busy} cash={cash} /> : null}
          {game === "plinko" ? <Plinko c={c} act={act} busy={busy} cash={cash} /> : null}
          {game === "mines" ? <MinesGame state={state} act={act} busy={busy} /> : null}
        </div>
        <div className="space-y-4">
          <Card>
            <Label>Your floor record</Label>
            <p className={`mt-2 font-serif text-2xl ${c.net >= 0 ? "text-teal-300" : "text-rose-300"}`}>
              {c.net >= 0 ? "+" : "−"}
              {formatINR(Math.abs(c.net))}
            </p>
            <p className="text-xs text-[var(--muted)]">{c.sessions} rounds on the new floor · lifetime wagered {formatINR(state.player.gambling.lifetimeWagered)}</p>
            {habit > 15 ? (
              <div className="mt-3 rounded-xl border border-rose-300/30 bg-rose-500/10 p-2 text-xs text-rose-200">
                Gambling habit {Math.round(habit)}%. It grows with every bet — large bets relative to your cash grow it fast. Above 60% it starts costing you
                money, relationships and sleep. Rehab clears it (Activities).
              </div>
            ) : null}
            <div className="mt-3 max-h-72 space-y-1 overflow-auto text-xs">
              {c.history.slice(0, 20).map((h, i) => (
                <div key={i} className="flex justify-between gap-2 border-b border-white/5 py-1">
                  <span className="truncate text-[var(--muted)]">
                    {h.game} · {h.detail}
                  </span>
                  <span className={h.payout - h.stake >= 0 ? "text-teal-300" : "text-rose-300"}>
                    {h.payout - h.stake >= 0 ? "+" : "−"}
                    {formatINR(Math.abs(h.payout - h.stake))}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <Label>House edge</Label>
            <div className="mt-2 space-y-1 text-xs">
              {casinoOdds().map((o) => (
                <div key={o.game} className="flex justify-between gap-2">
                  <span>{o.game}</span>
                  <span className="text-right text-[var(--muted)]">{o.edge}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-[var(--muted)]">Over enough rounds the house always wins. Every outcome comes from your save&apos;s own random stream.</p>
          </Card>
        </div>
      </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ blackjack */

function Blackjack({ c, act, busy, cash, xray }: { c: CasinoState; act: Act; busy: boolean; cash: number; xray: boolean }) {
  const [stake, setStake] = useState(10000);
  const s = c.bj;
  const live = s?.status === "live";
  const pv = s ? handValue(s.player) : null;
  const dv = s ? handValue(live ? s.dealer.slice(0, 1) : s.dealer) : null;
  const resultText: Record<string, string> = {
    blackjack: "Blackjack! Paid 3:2",
    win: "You win",
    dealer_bust: "Dealer busts — you win",
    push: "Push",
    lose: "Dealer wins",
    bust: "Bust",
  };
  return (
    <Card className="bg-gradient-to-b from-emerald-950/40 to-transparent">
      <div className="flex items-center justify-between">
        <Label>Blackjack · 6-deck shoe · dealer stands on all 17s</Label>
        {xray && s && live ? <span className="text-[10px] text-rose-300/70">next: {cardLabel(bjPeek(s))}</span> : null}
      </div>
      <div className="mt-4 min-h-[260px] rounded-3xl border border-emerald-300/10 bg-emerald-900/10 p-4">
        <p className="tick">Dealer {s ? `· ${dv?.total}${live ? " + ?" : ""}` : ""}</p>
        <div className="mt-2 flex gap-2">
          {s ? s.dealer.map((card, i) => <PlayingCard key={i} c={card} hidden={live && i === 1} peek={xray} />) : <PlayingCard hidden />}
        </div>
        <p className="tick mt-6">You {s ? `· ${pv?.total}${pv?.soft ? " (soft)" : ""}` : ""}</p>
        <div className="mt-2 flex flex-wrap gap-2">{s ? s.player.map((card, i) => <PlayingCard key={i} c={card} />) : <PlayingCard hidden />}</div>
        {s && !live ? (
          <p className={`mt-4 font-serif text-xl ${s.payout && s.payout > s.stake ? "text-teal-300" : s.payout === s.stake ? "text-amber-200" : "text-rose-300"}`}>
            {resultText[s.result ?? "lose"]} · {s.payout ? `paid ${formatINR(s.payout)}` : `lost ${formatINR(s.stake)}`}
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {live ? (
          <>
            <Btn disabled={busy} onClick={() => act({ type: "bjHit" })}>
              Hit
            </Btn>
            <Btn kind="teal" disabled={busy} onClick={() => act({ type: "bjStand" })}>
              Stand
            </Btn>
            <Btn kind="ghost" disabled={busy || s!.player.length !== 2 || cash < s!.stake} onClick={() => act({ type: "bjDouble" })}>
              Double ({formatINR(s!.stake)})
            </Btn>
            <span className="text-xs text-[var(--muted)]">Stake {formatINR(s!.stake)}</span>
          </>
        ) : (
          <>
            <Stake value={stake} set={setStake} cash={cash} />
            <Btn disabled={busy || stake <= 0} onClick={() => act({ type: "bjStart", stake })}>
              Deal
            </Btn>
          </>
        )}
      </div>
      {live && pv ? <p className="mt-2 text-xs text-[var(--muted)]">Basic strategy hint: {bjHint(pv.total, pv.soft, cardRank(s!.dealer[0]!))}</p> : null}
    </Card>
  );
}

function bjHint(total: number, soft: boolean, up: number): string {
  const d = up === 1 ? 11 : Math.min(10, up);
  if (soft) {
    if (total >= 19) return "stand";
    if (total === 18) return d >= 9 ? "hit" : "stand (double vs 3–6)";
    return d >= 4 && d <= 6 ? "double if you can, else hit" : "hit";
  }
  if (total >= 17) return "stand";
  if (total >= 13) return d <= 6 ? "stand" : "hit";
  if (total === 12) return d >= 4 && d <= 6 ? "stand" : "hit";
  if (total === 11) return "double";
  if (total === 10) return d <= 9 ? "double" : "hit";
  if (total === 9) return d >= 3 && d <= 6 ? "double" : "hit";
  return "hit";
}

/* ------------------------------------------------------------ roulette */

function Roulette({ c, act, busy, cash }: { c: CasinoState; act: Act; busy: boolean; cash: number }) {
  const [chip, setChip] = useState(1000);
  const [bets, setBets] = useState<RouletteBet[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [angle, setAngle] = useState(0);
  const last = c.roulette[0];
  const total = bets.reduce((s, b) => s + b.amount, 0);
  const add = (kind: RouletteBet["kind"], value?: number) => {
    setBets((prev) => {
      const i = prev.findIndex((b) => b.kind === kind && b.value === value);
      if (i >= 0) return prev.map((b, j) => (j === i ? { ...b, amount: b.amount + chip } : b));
      return [...prev, { kind, value, amount: chip }];
    });
  };
  const on = (kind: RouletteBet["kind"], value?: number) => bets.find((b) => b.kind === kind && b.value === value)?.amount ?? 0;
  const spin = () => {
    setSpinning(true);
    act({ type: "rouletteSpin", bets });
  };
  // when a new number lands, turn the wheel to it
  const prevLen = useRef(c.sessions);
  useEffect(() => {
    const key = c.sessions;
    if (!spinning) return;
    if (key === prevLen.current) {
      // the spin was refused (e.g. not enough cash) — stop waiting
      const t = setTimeout(() => setSpinning(false), 400);
      return () => clearTimeout(t);
    }
    prevLen.current = key;
    const idx = WHEEL.indexOf(c.roulette[0]!);
    const target = 360 * 5 + (360 - (idx / WHEEL.length) * 360);
    setAngle((a) => a - (a % 360) + target);
    const t = setTimeout(() => setSpinning(false), 2600);
    return () => clearTimeout(t);
  }, [c.roulette, c.sessions, spinning]);
  const cell = (n: number) => (
    <button
      key={n}
      onClick={() => add("straight", n)}
      className={`relative h-9 rounded text-xs font-medium ${n === 0 ? "bg-emerald-600/70" : RED.has(n) ? "bg-rose-700/80" : "bg-slate-800"} ${last === n && !spinning ? "ring-2 ring-amber-200" : ""}`}
    >
      {n}
      {on("straight", n) ? <span className="absolute -right-1 -top-1 rounded-full bg-amber-300 px-1 text-[8px] text-black">{short(on("straight", n))}</span> : null}
    </button>
  );
  const outside = (kind: RouletteBet["kind"], label: string, value?: number, cls = "") => (
    <button onClick={() => add(kind, value)} className={`relative rounded border border-white/10 py-2 text-xs hover:bg-white/5 ${cls}`}>
      {label}
      {on(kind, value) ? <span className="absolute -right-1 -top-1 rounded-full bg-amber-300 px-1 text-[8px] text-black">{short(on(kind, value))}</span> : null}
    </button>
  );
  return (
    <Card>
      <Label>Roulette · single zero · straight pays 35:1</Label>
      <div className="mt-4 flex flex-wrap items-center gap-6">
        <div className="relative h-44 w-44">
          <div
            className="absolute inset-0 rounded-full border-4 border-amber-200/40"
            style={{
              transform: `rotate(${angle}deg)`,
              transition: spinning ? "transform 2.5s cubic-bezier(.17,.67,.2,1)" : "none",
              background: `conic-gradient(${WHEEL.map((n, i) => `${n === 0 ? "#0f9b6c" : RED.has(n) ? "#b91c1c" : "#111827"} ${(i / WHEEL.length) * 360}deg ${((i + 1) / WHEEL.length) * 360}deg`).join(",")})`,
            }}
          />
          <div className="absolute inset-8 grid place-items-center rounded-full bg-[#0b0e14] font-serif text-3xl">{spinning ? "…" : last ?? "–"}</div>
          <div className="absolute left-1/2 top-[-6px] h-0 w-0 -translate-x-1/2 border-x-[7px] border-t-[12px] border-x-transparent border-t-amber-200" />
        </div>
        <div className="text-xs text-[var(--muted)]">
          <p className="tick">Last numbers</p>
          <div className="mt-1 flex max-w-[260px] flex-wrap gap-1">
            {c.roulette.slice(spinning ? 1 : 0, 14).map((n, i) => (
              <span key={i} className={`grid h-6 w-6 place-items-center rounded-full text-[10px] text-white ${n === 0 ? "bg-emerald-600" : RED.has(n) ? "bg-rose-700" : "bg-slate-700"}`}>
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-[520px] grid-cols-[40px_repeat(12,minmax(0,1fr))] gap-1">
          <div className="row-span-3">{<div className="h-full">{cell(0)}</div>}</div>
          {[3, 2, 1].map((row) => Array.from({ length: 12 }, (_, col) => cell(col * 3 + row)))}
        </div>
        <div className="mt-1 grid min-w-[520px] grid-cols-3 gap-1 pl-[44px]">
          {outside("dozen", "1st 12", 1)}
          {outside("dozen", "2nd 12", 2)}
          {outside("dozen", "3rd 12", 3)}
        </div>
        <div className="mt-1 grid min-w-[520px] grid-cols-6 gap-1 pl-[44px]">
          {outside("low", "1–18")}
          {outside("even", "Even")}
          {outside("red", "Red", undefined, "bg-rose-700/40")}
          {outside("black", "Black", undefined, "bg-slate-800")}
          {outside("odd", "Odd")}
          {outside("high", "19–36")}
        </div>
        <div className="mt-1 grid min-w-[520px] grid-cols-3 gap-1 pl-[44px]">
          {outside("column", "Column 1", 1)}
          {outside("column", "Column 2", 2)}
          {outside("column", "Column 3", 3)}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="tick">Chip</span>
        {[500, 1000, 5000, 25000, 100000, 1000000].map((v) => (
          <button
            key={v}
            onClick={() => setChip(v)}
            className={`h-9 w-9 rounded-full border-2 text-[10px] font-semibold ${chip === v ? "border-amber-200 bg-amber-200/20 text-amber-200" : "border-white/20 text-[var(--muted)]"}`}
          >
            {short(v)}
          </button>
        ))}
        <span className="ml-2 text-xs text-[var(--muted)]">On the table: {formatINR(total)}</span>
        <Btn kind="ghost" disabled={!bets.length} onClick={() => setBets([])}>
          Clear
        </Btn>
        <Btn disabled={busy || spinning || !bets.length || total > cash} onClick={spin}>
          Spin
        </Btn>
      </div>
    </Card>
  );
}

function short(n: number) {
  if (n >= 10000000) return `${Math.round(n / 10000000)}Cr`;
  if (n >= 100000) return `${Math.round(n / 100000)}L`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/* ------------------------------------------------------------ slots */

function Slots({ c, act, busy, cash }: { c: CasinoState; act: Act; busy: boolean; cash: number }) {
  const [stake, setStake] = useState(2000);
  const [rolling, setRolling] = useState(false);
  const [face, setFace] = useState<number[]>(c.lastSlots ?? [5, 5, 5]);
  const [stopped, setStopped] = useState(3);
  const sessions = useRef(c.sessions);
  const stoppedRef = useRef(3);
  useEffect(() => {
    if (!rolling) return;
    if (c.sessions === sessions.current || !c.lastSlots) {
      const t = setTimeout(() => setRolling(false), 400);
      return () => clearTimeout(t);
    }
    sessions.current = c.sessions;
    const final = c.lastSlots;
    stoppedRef.current = 0;
    setStopped(0);
    const spinT = setInterval(() => setFace((f) => f.map((x, i) => (i < stoppedRef.current ? final[i]! : (x + 1) % SLOT_SYMBOLS.length))), 70);
    const timers = [700, 1100, 1500].map((ms, k) =>
      setTimeout(() => {
        stoppedRef.current = k + 1;
        setStopped(k + 1);
        setFace((f) => f.map((x, i) => (i <= k ? final[i]! : x)));
        if (k === 2) {
          clearInterval(spinT);
          setRolling(false);
        }
      }, ms),
    );
    return () => {
      clearInterval(spinT);
      timers.forEach(clearTimeout);
    };
  }, [c.sessions, c.lastSlots, rolling]);
  const lastWin = c.history[0]?.game === "Slots" && !rolling ? c.history[0] : null;
  return (
    <Card className="bg-gradient-to-b from-fuchsia-950/30 to-transparent">
      <Label>Slots · three reels · RTP shown on the right</Label>
      <div className="mx-auto mt-5 flex max-w-sm justify-center gap-3 rounded-3xl border-4 border-amber-300/40 bg-black/50 p-5">
        {face.map((i, k) => (
          <div key={k} className={`grid h-24 w-20 place-items-center rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/0 text-5xl ${k >= stopped ? "blur-[1px]" : ""}`}>
            {SLOT_SYMBOLS[i]?.s}
          </div>
        ))}
      </div>
      {lastWin ? (
        <p className={`mt-3 text-center font-serif text-lg ${lastWin.payout > 0 ? "text-teal-300" : "text-[var(--muted)]"}`}>
          {lastWin.payout > 0 ? `WIN ${formatINR(lastWin.payout)}` : "No line"}
        </p>
      ) : (
        <p className="mt-3 text-center text-sm text-[var(--muted)]">&nbsp;</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Stake value={stake} set={setStake} cash={cash} />
        <Btn
          disabled={busy || rolling || stake <= 0 || stake > cash}
          onClick={() => {
            setRolling(true);
            act({ type: "slotSpin", stake });
          }}
        >
          Spin
        </Btn>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs md:grid-cols-7">
        {SLOT_SYMBOLS.map((x) => (
          <div key={x.s} className="rounded-xl border border-white/10 p-2 text-center">
            {x.s}
            {x.s}
            {x.s}
            <div className="text-amber-200">{x.pay3}×</div>
          </div>
        ))}
        <div className="rounded-xl border border-white/10 p-2 text-center">
          🍒🍒 any
          <div className="text-amber-200">{SLOT_TWO_CHERRY}×</div>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ crash */

function Crash({ c, act, busy, cash, xray }: { c: CasinoState; act: Act; busy: boolean; cash: number; xray: boolean }) {
  const [stake, setStake] = useState(5000);
  const [auto, setAuto] = useState<number>(2);
  const [useAuto, setUseAuto] = useState(false);
  const [mult, setMult] = useState(1);
  const s = c.crash;
  const live = s?.status === "live";
  const started = useRef<{ id: string; t: number } | null>(null);
  const sent = useRef<string | null>(null);
  const [trail, setTrail] = useState<number[]>([]);

  useEffect(() => {
    if (!s || !live) return;
    if (started.current?.id !== s.id) {
      started.current = { id: s.id, t: performance.now() };
      setTrail([]);
    }
    let raf = 0;
    const loop = () => {
      const ms = performance.now() - started.current!.t;
      const m = crashAt(ms);
      setMult(m);
      setTrail((tr) => (tr.length && tr[tr.length - 1] === m ? tr : [...tr.slice(-200), m]));
      if (sent.current !== s.id) {
        if (s.auto && m >= s.auto && s.auto < s.crash) {
          sent.current = s.id;
          act({ type: "crashCashout", at: s.auto });
          return;
        }
        if (m >= s.crash) {
          sent.current = s.id;
          act({ type: "crashCashout", at: s.crash });
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [s, live, act]);

  const shown = live ? mult : s?.status === "cashed" ? s.cashedAt ?? 1 : s?.status === "bust" ? s.crash : 1;
  const maxM = Math.max(2, ...trail);
  const pts = trail.map((m, i) => `${(i / Math.max(1, trail.length - 1)) * 300},${150 - ((m - 1) / (maxM - 1)) * 140}`).join(" ");
  return (
    <Card className="bg-gradient-to-b from-sky-950/30 to-transparent">
      <div className="flex items-center justify-between">
        <Label>Crash · multiplier grows until it doesn&apos;t · 3% edge</Label>
        {xray && live ? <span className="text-[10px] text-rose-300/70">crash @ {s!.crash.toFixed(2)}×</span> : null}
      </div>
      <div className="relative mt-4 h-48 overflow-hidden rounded-2xl border border-white/10 bg-black/40">
        <svg viewBox="0 0 300 150" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {pts ? <polyline points={pts} fill="none" stroke={s?.status === "bust" ? "#f0a0a0" : "#7ee0c6"} strokeWidth="2.5" /> : null}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <p className={`font-serif text-5xl ${s?.status === "bust" ? "text-rose-300" : s?.status === "cashed" ? "text-teal-300" : "text-white"}`}>{shown.toFixed(2)}×</p>
        </div>
        {s && !live ? (
          <p className="absolute bottom-2 left-0 right-0 text-center text-sm">
            {s.status === "cashed" ? `Cashed at ${s.cashedAt?.toFixed(2)}× · +${formatINR((s.payout ?? 0) - s.stake)} · crashed at ${s.crash.toFixed(2)}×` : `Crashed at ${s.crash.toFixed(2)}× · lost ${formatINR(s.stake)}`}
          </p>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {c.crashHistory.slice(0, 16).map((m, i) => (
          <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] ${m >= 2 ? "bg-teal-400/15 text-teal-200" : "bg-rose-400/10 text-rose-200"}`}>
            {m.toFixed(2)}×
          </span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {live ? (
          <Btn
            kind="teal"
            disabled={busy}
            onClick={() => {
              sent.current = s!.id;
              act({ type: "crashCashout", at: mult });
            }}
          >
            Cash out {formatINR(s!.stake * mult)}
          </Btn>
        ) : (
          <>
            <Stake value={stake} set={setStake} cash={cash} />
            <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
              <input type="checkbox" checked={useAuto} onChange={(e) => setUseAuto(e.target.checked)} /> auto at
            </label>
            <div className="w-20">
              <Input type="number" step={0.1} min={1.01} value={auto} onChange={(e) => setAuto(Number(e.target.value))} />
            </div>
            <Btn disabled={busy || stake <= 0 || stake > cash} onClick={() => act({ type: "crashStart", stake, auto: useAuto ? auto : null })}>
              Launch
            </Btn>
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Chance of reaching 2× is {(97 / 2).toFixed(1)}%, 10× is 9.7%. The curve doubles roughly every {(Math.log(2) / CRASH_RATE).toFixed(1)} seconds.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------ hi-lo */

function HiLo({ c, act, busy, cash, xray }: { c: CasinoState; act: Act; busy: boolean; cash: number; xray: boolean }) {
  const [stake, setStake] = useState(5000);
  const s = c.hilo;
  const live = s?.status === "live";
  const cur = s ? s.cards[s.cards.length - 1]! : null;
  const o = cur != null ? hiloOdds(cur) : null;
  return (
    <Card>
      <div className="flex items-center justify-between">
        <Label>Hi-Lo · same counts as a win · 3% edge per call</Label>
        {xray && s && live ? <span className="text-[10px] text-rose-300/70">next: {cardLabel(hiloPeek(s))}</span> : null}
      </div>
      <div className="mt-4 flex items-end gap-2 overflow-x-auto pb-2">
        {s ? s.cards.slice(-9).map((card, i, arr) => <PlayingCard key={i} c={card} small={i < arr.length - 1} />) : <PlayingCard hidden />}
      </div>
      {s ? (
        <p className="mt-2 text-sm">
          Multiplier <span className="font-serif text-lg text-amber-200">{s.mult.toFixed(2)}×</span> ·{" "}
          {live ? `worth ${formatINR(s.stake * s.mult)}` : s.status === "cashed" ? `cashed ${formatINR(s.payout ?? 0)}` : `bust — lost ${formatINR(s.stake)}`}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {live && o ? (
          <>
            <Btn disabled={busy} onClick={() => act({ type: "hiloGuess", guess: "hi" })}>
              ▲ Higher or same · {(o.hi * 100).toFixed(0)}% · {o.hiMult.toFixed(2)}×
            </Btn>
            <Btn disabled={busy} onClick={() => act({ type: "hiloGuess", guess: "lo" })}>
              ▼ Lower or same · {(o.lo * 100).toFixed(0)}% · {o.loMult.toFixed(2)}×
            </Btn>
            <Btn kind="ghost" disabled={busy} onClick={() => act({ type: "hiloGuess", guess: "skip" })}>
              Skip card
            </Btn>
            <Btn kind="teal" disabled={busy || s!.mult <= 1} onClick={() => act({ type: "hiloCashout" })}>
              Cash out {formatINR(s!.stake * s!.mult)}
            </Btn>
          </>
        ) : (
          <>
            <Stake value={stake} set={setStake} cash={cash} />
            <Btn disabled={busy || stake <= 0 || stake > cash} onClick={() => act({ type: "hiloStart", stake })}>
              Deal first card
            </Btn>
          </>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ dice */

function Dice({ c, act, busy, cash }: { c: CasinoState; act: Act; busy: boolean; cash: number }) {
  const [stake, setStake] = useState(5000);
  const [target, setTarget] = useState(50);
  const [over, setOver] = useState(true);
  const o = diceOdds(target, over);
  const d = c.lastDice;
  return (
    <Card>
      <Label>Dice · roll 0.00–99.99 · 1% edge</Label>
      <div className="relative mt-6 h-3 rounded-full" style={{ background: over ? `linear-gradient(90deg,#b91c1c ${target}%,#0f9b6c ${target}%)` : `linear-gradient(90deg,#0f9b6c ${target}%,#b91c1c ${target}%)` }}>
        {d ? (
          <div className="absolute -top-7 -translate-x-1/2 text-center transition-all duration-500" style={{ left: `${d.roll}%` }}>
            <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${d.win ? "bg-teal-300 text-black" : "bg-rose-400 text-black"}`}>{d.roll.toFixed(2)}</span>
          </div>
        ) : null}
      </div>
      <input type="range" min={2} max={97} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="mt-3 w-full" />
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl border border-white/10 p-2">
          <p className="tick">Roll {over ? "over" : "under"}</p>
          <p className="font-serif text-lg">{target}</p>
        </div>
        <div className="rounded-xl border border-white/10 p-2">
          <p className="tick">Win chance</p>
          <p className="font-serif text-lg">{(o.chance * 100).toFixed(2)}%</p>
        </div>
        <div className="rounded-xl border border-white/10 p-2">
          <p className="tick">Payout</p>
          <p className="font-serif text-lg text-amber-200">{o.mult.toFixed(2)}×</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Btn kind="ghost" onClick={() => setOver(!over)}>
          ⇄ {over ? "Over" : "Under"}
        </Btn>
        <Stake value={stake} set={setStake} cash={cash} />
        <Btn disabled={busy || stake <= 0 || stake > cash} onClick={() => act({ type: "diceRoll", stake, target, over })}>
          Roll
        </Btn>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ plinko */

function Plinko({ c, act, busy, cash }: { c: CasinoState; act: Act; busy: boolean; cash: number }) {
  const [stake, setStake] = useState(2000);
  const [risk, setRisk] = useState<"low" | "medium" | "high">("medium");
  const table = plinkoTable(risk);
  const last = c.lastPlinko;
  const [step, setStep] = useState(PLINKO_ROWS);
  const seen = useRef(last?.id);
  useEffect(() => {
    if (!last || last.id === seen.current) return;
    seen.current = last.id;
    setStep(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setStep(i);
      if (i >= PLINKO_ROWS) clearInterval(t);
    }, 90);
    return () => clearInterval(t);
  }, [last]);
  // ball position after `step` rows
  const ballX = last ? last.path.slice(0, step).reduce((s, x) => s + x, 0) : 0;
  const W = 320;
  const rowH = 18;
  const xOf = (row: number, k: number) => W / 2 + (k - row / 2) * 22;
  return (
    <Card>
      <Label>Plinko · 12 rows · 3% edge on every risk level</Label>
      <svg viewBox={`0 0 ${W} ${PLINKO_ROWS * rowH + 40}`} className="mx-auto mt-3 w-full max-w-md">
        {Array.from({ length: PLINKO_ROWS }, (_, row) =>
          Array.from({ length: row + 3 }, (_, k) => <circle key={`${row}-${k}`} cx={W / 2 + (k - (row + 2) / 2) * 22} cy={row * rowH + 12} r={2.2} fill="#8f98ab" opacity={0.6} />),
        )}
        {last ? <circle cx={xOf(step, ballX)} cy={step * rowH + 4} r={6} fill="#e4c37a" style={{ transition: "all 80ms linear" }} /> : null}
      </svg>
      <div className="mx-auto grid max-w-md gap-0.5" style={{ gridTemplateColumns: `repeat(${table.length}, minmax(0,1fr))` }}>
        {table.map((m, i) => (
          <div
            key={i}
            className={`rounded py-1 text-center text-[9px] font-semibold ${m >= 3 ? "bg-rose-500/60" : m >= 1 ? "bg-amber-400/50" : "bg-slate-700"} ${last && step >= PLINKO_ROWS && last.bucket === i && last.risk === risk ? "ring-2 ring-white" : ""}`}
          >
            {m}×
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["low", "medium", "high"] as const).map((r) => (
          <button key={r} onClick={() => setRisk(r)} className={`rounded-full border px-3 py-1 text-xs capitalize ${risk === r ? "border-amber-200/60 text-amber-200" : "border-white/10 text-[var(--muted)]"}`}>
            {r}
          </button>
        ))}
        <Stake value={stake} set={setStake} cash={cash} />
        <Btn disabled={busy || stake <= 0 || stake > cash || step < PLINKO_ROWS} onClick={() => act({ type: "plinkoDrop", stake, risk })}>
          Drop ball
        </Btn>
      </div>
    </Card>
  );
}
