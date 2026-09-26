"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { COUNTRY_DEFS, MODES } from "@/lib/sim/catalog";
import { createLife } from "@/lib/store";
import type { GameMode, Personality } from "@/lib/sim/types";
import { formatINR } from "@/lib/sim/util";
import { Btn, Card, Field, Input, Label, Select } from "./ui";

const SKINS = ["#f6d7c3", "#e0ac69", "#c68642", "#8d5524", "#5c3317"];
const HAIRS = ["#1a120b", "#3b2219", "#6b3a2a", "#2c2c2c", "#d1b184"];
const PORTRAITS = ["gold", "teal", "rose", "violet", "slate"];

// Zero cash from day one: if you set Age 0 you begin with ~₹1k and parental allowance only — every rupee after must be earned via school, part-time jobs and grades into big universities.
const SCENARIOS: { id: string; name: string; desc: string }[] = [
  { id: "none", name: "No scenario", desc: "Pure mode start." },
  { id: "poor_student", name: "Poor student", desc: "₹5k, no degree, big hunger." },
  { id: "middle_class", name: "Middle-class family", desc: "₹1.5L cushion, ordinary start." },
  { id: "wealthy_inheritance", name: "Wealthy inheritance", desc: "₹5Cr handed over — keep it, or double it." },
  { id: "rural", name: "Rural background", desc: "Far from the capital, thin wallet." },
  { id: "urban", name: "Urban professional", desc: "City connections, modest savings." },
  { id: "skilled_worker", name: "Skilled worker", desc: "Strong programming, small capital." },
  { id: "failing_business", name: "Failing entrepreneur", desc: "Own a losing factory. Fix or flee." },
  { id: "gov_employee", name: "Government employee", desc: "3 years in the civil service, iron salary." },
  { id: "business_owner", name: "Existing business owner", desc: "A profitable corner store in your name." },
];

export function CreateLife() {
  const router = useRouter();
  const [name, setName] = useState("Asha Menon");
  const [mode, setMode] = useState<GameMode>("normal");
  const [countryId, setCountryId] = useState("indara");
  const [age, setAge] = useState(18);
  const [skin, setSkin] = useState(SKINS[2]!);
  const [hair, setHair] = useState(HAIRS[0]!);
  const [portrait, setPortrait] = useState("gold");
  const [seed, setSeed] = useState("");
  const [scenarioId, setScenarioId] = useState("none");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [traits, setTraits] = useState<Personality>({
    risk: 48,
    ambition: 62,
    discipline: 55,
    negotiation: 44,
    leadership: 40,
    creativity: 52,
    patience: 50,
    frugality: 46,
  });

  const modeDef = useMemo(() => MODES.find((m) => m.id === mode)!, [mode]);

  async function start() {
    setBusy(true);
    setErr(null);
    try {
      const { id } = await createLife(
        {
          mode,
          name,
          age: age !== 18 || mode === "random" ? age : modeDef.age,
          countryId,
          background: "middle",
          educationLevel: modeDef.edu,
          wealth: modeDef.wealth,
          traits,
          appearance: { skin, hair, eyes: "#3d2914", style: "sharp", portrait },
          nationality: COUNTRY_DEFS.find((c) => c.id === countryId)?.adjective,
          seed: seed.trim() || undefined,
          scenarioId: scenarioId === "none" ? undefined : scenarioId,
        },
        `${name} · ${modeDef.name}`,
      );
      router.push(`/play?life=${id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to seed the world");
      setBusy(false);
    }
  }

  return (
    <Card className="mt-8">
      <Label>Begin a life</Label>
      <h2 className="font-serif text-3xl">Character & sandbox</h2>
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Starting country">
            <Select value={countryId} onChange={(e) => setCountryId(e.target.value)}>
              {COUNTRY_DEFS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.currency.symbol}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age — 0 = born today (parents support till 18, no starting cash; jobs part-time, grades → big universities)">
              <Input type="number" min={0} max={70} value={age} onChange={(e) => setAge(Number(e.target.value))} />
            </Field>
            <Field label="World seed (optional — same seed, same world)">
              <Input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. monsoon-7" />
            </Field>
          </div>
          <Field label="Scenario (random starting story)">
            <Select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.desc}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <p className="tick">Appearance</p>
            <div className="mt-2 flex gap-2">
              {SKINS.map((s) => (
                <button key={s} onClick={() => setSkin(s)} className="h-7 w-7 rounded-full border" style={{ background: s, outline: skin === s ? "2px solid #e4c37a" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {HAIRS.map((s) => (
                <button key={s} onClick={() => setHair(s)} className="h-7 w-7 rounded-full border" style={{ background: s, outline: hair === s ? "2px solid #e4c37a" : undefined }} />
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {PORTRAITS.map((s) => (
                <button key={s} onClick={() => setPortrait(s)} className="rounded-full border border-white/10 px-3 py-1 text-xs">
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <p className="tick">Mode</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded-2xl border p-3 text-left text-sm ${mode === m.id ? "border-amber-200/50 bg-amber-200/10" : "border-white/10"}`}
              >
                <div className="font-medium">{m.name}</div>
                <div className="text-[11px] text-[var(--muted)]">{m.blurb}</div>
                <div className="mt-1 text-[11px] text-amber-200/80">
                  {formatINR(m.wealth)} · age {m.age}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-4">
        {(Object.keys(traits) as (keyof Personality)[]).map((k) => (
          <label key={k} className="text-xs text-[var(--muted)]">
            {k} · {traits[k]}
            <input
              className="mt-1 w-full"
              type="range"
              min={10}
              max={90}
              value={traits[k]}
              onChange={(e) => setTraits({ ...traits, [k]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      {err ? <p className="mt-3 text-sm text-rose-300">{err}</p> : null}
      <div className="mt-6">
        <Btn disabled={busy} onClick={() => void start()}>
          {busy ? "Seeding the world…" : "Enter the simulation"}
        </Btn>
      </div>
    </Card>
  );
}
