"use client";

import { useState } from "react";
import { devOpsList } from "@/lib/sim/debug";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { Btn, Field, Input, Label, Modal } from "./ui";

export type Speed = 0 | 1 | 2 | 5 | 10;

export function SpeedControls({ speed, setSpeed }: { speed: Speed; setSpeed: (s: Speed) => void }) {
  const opts: { s: Speed; label: string; title: string }[] = [
    { s: 0, label: "⏸", title: "Paused (manual time)" },
    { s: 1, label: "1×", title: "1 month / 4s" },
    { s: 2, label: "2×", title: "1 month / 2s" },
    { s: 5, label: "5×", title: "1 month / 0.9s" },
    { s: 10, label: "1y", title: "1 year / 9s" },
  ];
  return (
    <div className="flex overflow-hidden rounded-full border border-[var(--line)]" title="Simulation speed. Important events still pause the game.">
      {opts.map((o) => (
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

export function DebugModal({ state, act, onClose }: { state: GameState; act: (a: PlayerAction) => void; onClose: () => void }) {
  const [result, setResult] = useState<string | null>(null);
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
      <div className="mt-4 flex gap-2">
        <Btn kind={enabled ? "danger" : "teal"} onClick={() => act({ type: "dev", op: "toggle" })}>
          {enabled ? "Disable dev mode" : "Enable dev mode"}
        </Btn>
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
      {result ? <p className="mt-3 text-sm text-amber-200">{result}</p> : null}
      <p className="mt-4 text-[10px] text-[var(--muted)]">
        <Label>Tip</Label> — the simulation stays consistent: recession → rates → mortgages → property → jobs → tax revenue → approval.
      </p>
    </Modal>
  );
}
