"use client";

// The Mines round, played properly: a real 5×5 board you open tile by tile,
// with the odds of the next tile and the cash-out value shown before you click.
// Mine positions come from a seed generated when the round starts, so the board
// is fixed before your first click and cannot be re-rolled to save you.
import { useRef, useState } from "react";
import { xrayOn } from "@/lib/sim/debug";
import { getAdv } from "@/lib/sim/advanced";
import { liquidCash } from "@/lib/sim/finance";
import { MINES_HOUSE_EDGE, MINES_PRESETS, MINES_TILES, minesLayout, minesView } from "@/lib/sim/mines";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { formatINR } from "@/lib/sim/util";
import { Btn, Label } from "./ui";

const TILES = Array.from({ length: MINES_TILES }, (_, i) => i);

export function MinesGame({ state, act, busy }: { state: GameState; act: (a: PlayerAction) => void; busy: boolean }) {
  const sess = getAdv(state).mines;
  const [stake, setStake] = useState(5000);
  const [mines, setMines] = useState<number>(5);
  const live = Boolean(sess && sess.status === "live");
  const over = Boolean(sess && sess.status !== "live");
  const v = sess ? minesView(sess) : null;
  const layout = sess ? minesLayout(sess.seed, sess.tiles, sess.mines) : [];
  const cash = liquidCash(state.player);
  // Owner-only x-ray: mine positions shown as a faint mark only the admin sees.
  const xray = xrayOn(state);
  const admin = Boolean(state.adv?.admin?.unlocked);
  const taps = useRef<number[]>([]);
  const secretTap = () => {
    if (!admin) return;
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 1200), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      act({ type: "admin", op: "xray" });
    }
  };

  const tileFace = (t: number) => {
    if (!sess || !v) return "?";
    const opened = sess.revealed.includes(t);
    const isBomb = layout.includes(t);
    if (sess.status === "live") return opened ? "◆" : xray && isBomb ? <span className="text-base leading-none text-rose-400/90 drop-shadow">✕</span> : "";
    if (opened) return "◆";
    if (isBomb) return t === sess.bustTile ? "✸" : "✱";
    return "";
  };

  const tileClass = (t: number) => {
    if (!sess || !v) return "border-white/10 bg-white/5 hover:bg-white/10";
    const opened = sess.revealed.includes(t);
    const isBomb = layout.includes(t);
    if (sess.status === "live") {
      if (!opened && xray && isBomb) return "border-rose-400/60 bg-rose-500/15 hover:border-rose-300/80 hover:bg-rose-500/25";
      return opened
        ? "border-teal-300/50 bg-teal-300/15 text-teal-200"
        : "border-white/10 bg-white/5 hover:border-amber-200/40 hover:bg-amber-200/10";
    }
    if (opened) return "border-teal-300/40 bg-teal-300/10 text-teal-200";
    if (isBomb) return t === sess.bustTile ? "border-rose-400/70 bg-rose-500/25 text-rose-200" : "border-rose-400/30 bg-rose-500/10 text-rose-300/80";
    return "border-white/10 bg-white/5 text-[var(--muted)]";
  };

  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <button onClick={secretTap} className="cursor-default select-none text-left">
          <Label>Mines · 5×5 · played tile by tile{xray ? " ·" : ""}</Label>
        </button>
        <span className="flex items-center gap-2">
        {v && sess ? (
          <span className="text-xs text-[var(--muted)]">
            {sess.mines} mines · stake {formatINR(sess.stake)}
          </span>
        ) : null}
          {admin ? (
            <button
              onClick={() => act({ type: "admin", op: "xray" })}
              title={xray ? "Admin x-ray on — mines marked ✕ (only you see this)" : "Admin x-ray off"}
              aria-label="Toggle admin x-ray"
              className={`rounded-full border px-2 py-0.5 text-xs ${xray ? "border-rose-400/60 bg-rose-500/15 text-rose-200" : "border-white/15 text-[var(--muted)]"}`}
            >
              {xray ? "👁 x-ray" : "👁"}
            </button>
          ) : null}
        </span>
      </div>

      {!sess ? (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Set a stake and a mine count, then start. The board is generated once, before your first click — opening a gem raises the
          multiplier, opening a mine ends the round and the stake is gone. Cash out whenever you like.
        </p>
      ) : null}

      {live && v ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div className="rounded-xl border border-white/10 p-2">
            <p className="tick">Gems</p>
            <p className="font-serif text-lg">{v.safePicked}</p>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <p className="tick">Multiplier</p>
            <p className="font-serif text-lg text-amber-200">{v.multiplier.toFixed(2)}×</p>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <p className="tick">Cash out now</p>
            <p className="font-serif text-lg text-teal-300">{formatINR(v.cashoutNow)}</p>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <p className="tick">Next tile</p>
            <p className="font-serif text-lg">{(v.safeProb * 100).toFixed(1)}% safe</p>
            <p className="text-[10px] text-[var(--muted)]">
              → {v.nextMultiplier.toFixed(2)}× ({formatINR(v.cashoutNext)})
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-5 gap-1.5">
        {TILES.map((t) => (
          <button
            key={t}
            disabled={busy || !live}
            onClick={() => void act({ type: "minesReveal", tile: t })}
            className={`grid aspect-square place-items-center rounded-lg border text-lg transition disabled:cursor-default ${tileClass(t)}`}
            title={live ? `Tile ${t + 1}` : ""}
          >
            {tileFace(t)}
          </button>
        ))}
      </div>

      {live ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn kind="teal" disabled={busy} onClick={() => void act({ type: "minesCashout" })}>
            Cash out {v ? formatINR(v.cashoutNow) : ""} ({v ? `${v.multiplier.toFixed(2)}×` : "1×"})
          </Btn>
          {v && !v.maxed ? (
            <span className="text-xs text-[var(--muted)]">
              Pushing on: {(v.safeProb * 100).toFixed(1)}% to reach {v.nextMultiplier.toFixed(2)}×, {(v.hitProb * 100).toFixed(1)}% to lose
              everything. Expected value of one more tile ≈ {v.evNext.toFixed(2)}× vs banking {v.multiplier.toFixed(2)}×.
            </span>
          ) : (
            <span className="text-xs text-teal-300">Board cleared — every safe tile is open.</span>
          )}
        </div>
      ) : null}

      {over && sess && v ? (
        <div className="mt-4 rounded-xl border border-white/10 p-3 text-sm">
          <p className={sess.status === "bust" ? "text-rose-300" : "text-teal-300"}>
            {sess.status === "bust"
              ? `Mine on tile ${(sess.bustTile ?? 0) + 1}. Stake ${formatINR(sess.stake)} lost after ${v.safePicked} gems.`
              : `Cashed out ${formatINR(sess.payout ?? 0)} at ${v.multiplier.toFixed(2)}× on ${v.safePicked} gems.`}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            House edge {Math.round(MINES_HOUSE_EDGE * 100)}% — the multiplier is the fair price of surviving that many picks, less the
            edge. Start another round below.
          </p>
        </div>
      ) : null}

      {!live ? (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="tick">Stake ₹</p>
              <input
                type="number"
                min={1}
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
                className="mt-1 w-32 rounded-xl border border-[var(--line)] bg-[#0b0e14] px-3 py-2 text-sm text-white outline-none"
              />
            </div>
            <div className="flex gap-1">
              {[0.5, 2, 10].map((m, i) => (
                <button
                  key={m}
                  onClick={() => setStake(Math.max(1, Math.round((i === 2 ? cash : stake) * m)))}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-[var(--muted)] hover:text-amber-200"
                >
                  {i === 2 ? "max" : `${m}×`}
                </button>
              ))}
            </div>
            <div>
              <p className="tick">Mines</p>
              <div className="mt-1 flex gap-1">
                {MINES_PRESETS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMines(m)}
                    className={`rounded-full border px-2.5 py-1 text-xs ${mines === m ? "border-amber-200/60 bg-amber-200/10 text-amber-200" : "border-white/10 text-[var(--muted)]"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Btn disabled={busy || stake <= 0 || stake > cash} onClick={() => void act({ type: "minesStart", stake, mines })}>
              Start round
            </Btn>
            <span className="text-xs text-[var(--muted)]">
              Liquid cash {formatINR(cash)}
              {stake > cash ? " — stake is larger than your cash, so nothing will be taken." : ""}
            </span>
            {over ? (
              <Btn kind="ghost" disabled={busy} onClick={() => void act({ type: "minesClear" })}>
                Clear board
              </Btn>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            First-tile odds with {mines} mines: {(((MINES_TILES - mines) / MINES_TILES) * 100).toFixed(1)}% safe, cashing immediately
            returns your stake.
          </p>
        </div>
      ) : null}
    </div>
  );
}
