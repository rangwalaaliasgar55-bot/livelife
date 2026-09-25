"use client";

import { useState } from "react";
import { devOpsList } from "@/lib/sim/debug";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { Btn, Field, Input, Label, Modal } from "./ui";

export type Speed = 0 | 0.25 | 0.5 | 1 | 2 | 5 | 12;

/** Milliseconds of real time per simulated tick, and how much game time a tick
 *  covers. Time belongs to the player: the default is paused, the slowest
 *  setting is one month every 16 seconds, and the fastest jumps a year at once. */
export const SPEEDS: { s: Speed; label: string; title: string; ms: number; months: number }[] = [
  { s: 0, label: "⏸", title: "Paused — advance time by hand", ms: 0, months: 1 },
  { s: 0.25, label: "¼×", title: "1 month every 16s (a year in ~3 minutes)", ms: 16000, months: 1 },
  { s: 0.5, label: "½×", title: "1 month every 8s (a year in ~1.5 minutes)", ms: 8000, months: 1 },
  { s: 1, label: "1×", title: "1 month every 5s (a year in a minute)", ms: 5000, months: 1 },
  { s: 2, label: "2×", title: "1 month every 2.5s", ms: 2500, months: 1 },
  { s: 5, label: "5×", title: "1 month every second", ms: 1000, months: 1 },
  { s: 12, label: "1y", title: "Jump a whole year every 9s", ms: 9000, months: 12 },
];

export const speedMs = (s: Speed) => SPEEDS.find((x) => x.s === s)?.ms ?? 0;
export const speedMonths = (s: Speed) => SPEEDS.find((x) => x.s === s)?.months ?? 1;

export function SpeedControls({
  speed,
  setSpeed,
  onStep,
}: {
  speed: Speed;
  setSpeed: (s: Speed) => void;
  onStep?: (months: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {onStep ? (
        <div className="flex overflow-hidden rounded-full border border-[var(--line)]" title="Advance time by hand">
          <button
            onClick={() => onStep(1)}
            title="Live the next month"
            className="px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-amber-200"
          >
            +1mo
          </button>
          <button
            onClick={() => onStep(12)}
            title="Live the next year"
            className="px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-white/5 hover:text-amber-200"
          >
            +1y
          </button>
        </div>
      ) : null}
      <div className="flex overflow-hidden rounded-full border border-[var(--line)]" title="Simulation speed. Important events still pause the game.">
        {SPEEDS.map((o) => (
          <button
            key={o.s}
            title={o.title}
            onClick={() => setSpeed(o.s)}
            className={`px-2.5 py-1.5 text-xs ${speed === o.s ? "bg-amber-200/20 text-amber-200" : "text-[var(--muted)] hover:bg-white/5"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LineListModal({ title, lines, onClose }: { title: string; lines: string[]; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <p key={i} className="text-sm leading-6">
            {l}
          </p>
        ))}
      </div>
    </Modal>
  );
}

export function HowItWorks({ view, help, onClose }: { view: string; help: string; onClose: () => void }) {
  void view;
  return (
    <Modal title="How this works" onClose={onClose}>
      <p className="text-sm leading-7 text-[var(--muted)]">{help}</p>
      <p className="mt-4 text-xs text-[var(--muted)]">
        Everything on this screen reads from the live simulation state. Actions change state; state changes the world; the world changes
        your options. No number is decorative.
      </p>
    </Modal>
  );
}

export function NotifBell({ state }: { state: GameState }) {
  const [open, setOpen] = useState(false);
  const recent = state.notifications.slice(0, 14);
  const hot = recent.filter((n) => n.tone === "bad" || n.tone === "warn").length;
  return (
    <button onClick={() => setOpen(true)} className="relative rounded-full border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-amber-200" title="Notifications">
      alerts
      {hot ? <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-[9px] text-white">{hot}</span> : null}
      {open ? (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="panel absolute right-4 top-16 max-h-[70vh] w-80 overflow-auto rounded-3xl p-4" onClick={(e) => e.stopPropagation()}>
            <p className="tick">Notices</p>
            {recent.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">Quiet for now.</p> : null}
            {recent.map((n) => (
              <p
                key={n.id}
                className={`mt-2 border-b border-white/5 pb-2 text-xs leading-5 ${
                  n.tone === "bad" ? "text-rose-300" : n.tone === "warn" ? "text-amber-200/90" : n.tone === "good" ? "text-teal-300" : "text-[var(--muted)]"
                }`}
              >
                {n.text} <span className="opacity-60">· {n.year}-{String(n.month).padStart(2, "0")}</span>
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------- secret treasury */

/** The hidden owner-only pocket. Reached from an unmarked spot in the shell
 *  (triple-click the save stamp / the seed line) or from the developer tools. */
export function TreasuryModal({ state, act, onClose }: { state: GameState; act: (a: PlayerAction) => void; onClose: () => void }) {
  const admin = state.adv?.admin ?? { unlocked: false, draws: 0, totalDrawn: 0 };
  const [key, setKey] = useState("");
  const [amount, setAmount] = useState(1_000_000);
  const presets = [100_000, 1_000_000, 10_000_000, 100_000_000];
  return (
    <Modal title="The treasury" onClose={onClose}>
      {admin.unlocked ? (
        <div>
          <p className="text-sm text-[var(--muted)]">
            Admin access is on. A draw credits the wallet immediately and is written to the ledger, the timeline and lifetime statistics as
            an admin draw — nothing here is silent.
          </p>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {admin.draws} draw{admin.draws === 1 ? "" : "s"} so far · ₹{(admin.totalDrawn ?? 0).toLocaleString("en-IN")} total
            {admin.lastDraw ? ` · last in ${admin.lastDraw}` : ""}
          </p>
          <div className="mt-4">
            <p className="tick">Amount</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {presets.map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(v)}
                  className={`rounded-full border px-3 py-1 text-xs ${amount === v ? "border-amber-200/60 bg-amber-200/10 text-amber-200" : "border-white/10 text-[var(--muted)]"}`}
                >
                  {v.toLocaleString("en-IN")}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              <Btn onClick={() => act({ type: "admin", op: "draw", amount })}>Draw</Btn>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-500/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="tick">Casino x-ray · owner only</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Secretly see where the mines are on the Mines board, the crash point, the dealer&apos;s hole card and the next card in
                  Blackjack and Hi-Lo. Players never see this. Shortcut: triple-tap the Mines title.
                </p>
              </div>
              <Btn kind={admin.xray ? "danger" : "ghost"} onClick={() => act({ type: "admin", op: "xray" })}>
                {admin.xray ? "X-ray ON" : "X-ray off"}
              </Btn>
            </div>
          </div>
          <div className="mt-4">
            <Btn kind="ghost" onClick={() => act({ type: "admin", op: "lock" })}>
              Lock the treasury
            </Btn>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-[var(--muted)]">
            This spot belongs to the owner of the world. Enter the admin key to unlock draws. Dev mode — switched on from the hidden
            developer tools — unlocks it too.
          </p>
          <div className="mt-4 flex gap-2">
            <Input type="password" value={key} placeholder="admin key" onChange={(e) => setKey(e.target.value)} />
            <Btn onClick={() => act({ type: "admin", op: "unlock", key })}>Unlock</Btn>
          </div>
        </div>
      )}
      <p className="mt-4 text-[10px] text-[var(--muted)]">
        Money drawn here enters the same authoritative state as everything else: it counts toward net worth and shows in the ledger. The
        world does not react to it. It is an owner tool, not a game mechanic.
      </p>
    </Modal>
  );
}

export function DebugModal({
  state,
  act,
  onClose,
  onTreasury,
}: {
  state: GameState;
  act: (a: PlayerAction) => void;
  onClose: () => void;
  onTreasury?: () => void;
}) {
  const [amount, setAmount] = useState(1_000_000);
  const [months, setMonths] = useState(12);
  const [rate, setRate] = useState(5);
  const [skill, setSkill] = useState("programming");
  const [level, setLevel] = useState(90);
  const enabled = state.adv?.debug;
  return (
    <Modal title="Developer tools (hidden)" onClose={onClose}>
      <p className="text-xs text-[var(--muted)]">
        Gated behind dev mode. These mutate the same authoritative state as normal gameplay — they are for testing the simulation, not for
        winning at it.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn kind={enabled ? "danger" : "teal"} onClick={() => act({ type: "dev", op: "toggle" })}>
          {enabled ? "Disable dev mode" : "Enable dev mode"}
        </Btn>
        {onTreasury ? (
          <Btn kind="ghost" onClick={onTreasury}>
            The treasury
          </Btn>
        ) : null}
      </div>
      {enabled ? (
        <div className="mt-4 space-y-2">
          <Field label={`Add money (₹ ${amount.toLocaleString("en-IN")})`}>
            <div className="flex gap-2">
              <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              <Btn onClick={() => act({ type: "dev", op: "add_money", args: { amount } })}>Run</Btn>
            </div>
          </Field>
          <Field label={`Advance months (${months})`}>
            <div className="flex gap-2">
              <Input type="number" value={months} onChange={(e) => setMonths(Number(e.target.value))} />
              <Btn onClick={() => act({ type: "dev", op: "advance", args: { months } })}>Run</Btn>
            </div>
          </Field>
          <Field label={`Set policy rate (${rate}%)`}>
            <div className="flex gap-2">
              <Input type="number" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
              <Btn onClick={() => act({ type: "dev", op: "set_rate", args: { rate } })}>Run</Btn>
            </div>
          </Field>
          <Field label={`Set skill (${skill} → ${level})`}>
            <div className="flex gap-2">
              <Input value={skill} onChange={(e) => setSkill(e.target.value)} />
              <Input type="number" value={level} onChange={(e) => setLevel(Number(e.target.value))} />
              <Btn onClick={() => act({ type: "dev", op: "give_skill", args: { skill, level } })}>Run</Btn>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2 pt-2">
            {devOpsList()
              .filter((o) => !["toggle", "add_money", "advance", "set_rate", "give_skill"].includes(o.op))
              .map((o) => (
                <Btn key={o.op} kind="ghost" onClick={() => act({ type: "dev", op: o.op })}>
                  {o.label}
                </Btn>
              ))}
          </div>
        </div>
      ) : null}
      <p className="mt-4 text-[10px] text-[var(--muted)]">
        <Label>Tip</Label> — the simulation stays consistent: recession → rates → mortgages → property → jobs → tax revenue → approval.
      </p>
    </Modal>
  );
}
