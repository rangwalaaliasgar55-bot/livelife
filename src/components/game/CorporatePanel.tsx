"use client";

// Stakes & takeovers. Launch a tender offer for any company in the world —
// personally or through a company you control — then watch holders decide.
import { useState } from "react";
import { acceptance, controlOf, quoteTender, sharePrice } from "@/lib/sim/corporate";
import { liquidCash } from "@/lib/sim/finance";
import type { GameState, PlayerAction } from "@/lib/sim/types";
import { formatINR } from "@/lib/sim/util";
import { Btn, Card, Input, Label, Select } from "./ui";

type Act = (a: PlayerAction) => void;

export function CorporatePanel({ state, act, busy }: { state: GameState; act: Act; busy: boolean }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [sort, setSort] = useState<"valuation" | "cheap" | "stake">("valuation");
  const owned = new Set(state.player.ownedCompanyIds);
  // (state is mutated in place by the engine, so no memo — recompute each render)
  const companies = (() => {
    const list = state.world.companies.filter((c) => c.stage !== "bankrupt" && c.shares > 0 && (!q || `${c.name} ${c.ticker} ${c.industry}`.toLowerCase().includes(q.toLowerCase())));
    const withCtl = list.map((c) => ({ c, ctl: controlOf(state, c) }));
    withCtl.sort((a, b) => (sort === "stake" ? b.ctl.pct - a.ctl.pct : sort === "cheap" ? a.c.valuation - b.c.valuation : b.c.valuation - a.c.valuation));
    return withCtl;
  })();
  const stakes = companies.filter((x) => x.ctl.total > 0);
  const selected = companies.find((x) => x.c.id === sel) ?? null;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="space-y-4">
        <Card>
          <Label>Your stakes & group holdings</Label>
          {!stakes.length ? (
            <p className="mt-2 text-sm text-[var(--muted)]">
              You hold no strategic stakes yet. Buy 10% of a company to get a board seat; more than 50% (personally plus through companies you control) gives
              you control — it joins your group and you can run it from Companies.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="tick text-left">
                  <tr>
                    <th className="py-1">Company</th>
                    <th>Stake</th>
                    <th>Value</th>
                    <th>Cost basis</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stakes.map(({ c, ctl }) => {
                    const basis = (state.life?.stakes ?? []).filter((s) => s.companyId === c.id).reduce((s, x) => s + x.cost, 0);
                    const value = (ctl.total / c.shares) * Math.max(0, c.valuation);
                    return (
                      <tr key={c.id} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => setSel(c.id)}>
                        <td className="py-1.5">
                          {c.name} <span className="text-xs text-[var(--muted)]">{c.ticker}</span>
                        </td>
                        <td>{ctl.pct.toFixed(1)}%</td>
                        <td>{formatINR(value)}</td>
                        <td className="text-[var(--muted)]">{basis ? formatINR(basis) : "—"}</td>
                        <td className={ctl.controlled ? "text-teal-300" : ctl.boardSeat ? "text-amber-200" : "text-[var(--muted)]"}>
                          {owned.has(c.id) && c.playerRole === "founder" ? "Founder" : ctl.controlled ? "Controlled" : ctl.boardSeat ? "Board seat" : "Minority"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Targets · {companies.length} companies</Label>
            <div className="flex gap-2">
              <div className="w-48">
                <Input placeholder="search name, ticker, sector" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <div className="w-36">
                <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="valuation">Largest</option>
                  <option value="cheap">Smallest</option>
                  <option value="stake">My stake</option>
                </Select>
              </div>
            </div>
          </div>
          <div className="mt-3 max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="tick sticky top-0 bg-[#10141d] text-left">
                <tr>
                  <th className="py-1">Company</th>
                  <th>Sector</th>
                  <th>Valuation</th>
                  <th>Price</th>
                  <th>Profit/yr</th>
                  <th>Mine</th>
                </tr>
              </thead>
              <tbody>
                {companies.map(({ c, ctl }) => (
                  <tr key={c.id} onClick={() => setSel(c.id)} className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${sel === c.id ? "bg-amber-200/5" : ""}`}>
                    <td className="py-1.5">
                      {c.name} <span className="text-xs text-[var(--muted)]">{c.listed ? c.ticker : "private"}</span>
                    </td>
                    <td className="text-xs text-[var(--muted)]">{c.industry}</td>
                    <td>{formatINR(c.valuation)}</td>
                    <td>{formatINR(sharePrice(c))}</td>
                    <td className={c.profit >= 0 ? "text-teal-300" : "text-rose-300"}>{formatINR(c.profit)}</td>
                    <td>{ctl.pct > 0 ? `${ctl.pct.toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <div>{selected ? <Deal key={selected.c.id} state={state} companyId={selected.c.id} act={act} busy={busy} /> : <Card>Select a company to see its register and build a stake.</Card>}</div>
    </div>
  );
}

function Deal({ state, companyId, act, busy }: { state: GameState; companyId: string; act: Act; busy: boolean }) {
  const co = state.world.companies.find((c) => c.id === companyId)!;
  const ctl = controlOf(state, co);
  const [pct, setPct] = useState(Math.min(51, Math.max(5, Math.ceil(51 - ctl.pct))));
  const [premium, setPremium] = useState(30);
  const [buyer, setBuyer] = useState("me");
  const [sellPct, setSellPct] = useState(50);
  const buyers = state.world.companies.filter((c) => state.player.ownedCompanyIds.includes(c.id) && c.id !== co.id);
  const quote = quoteTender(state, co.id, pct, premium);
  const acc = acceptance(state, co, premium);
  const funds = buyer === "me" ? liquidCash(state.player) : buyers.find((b) => b.id === buyer)?.cash ?? 0;
  const holders = [...co.shareholders].filter((s) => s.shares > 0).sort((a, b) => b.shares - a.shares);
  const myEntries = co.shareholders.filter((s) => s.shares > 0 && (s.type === "player" || state.player.ownedCompanyIds.includes(s.id)) && s.id !== co.id);
  return (
    <div className="space-y-4">
      <Card>
        <p className="font-serif text-2xl">{co.name}</p>
        <p className="text-xs text-[var(--muted)]">
          {co.industry} · {state.world.countries.find((c) => c.id === co.countryId)?.name} · {co.stage} · CEO {co.playerCeo ? "you" : co.ceo} · sentiment {Math.round(co.sentiment)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl border border-white/10 p-2">
            <p className="tick">Valuation</p>
            <p>{formatINR(co.valuation)}</p>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <p className="tick">Revenue / profit</p>
            <p>
              {formatINR(co.revenue)} / <span className={co.profit >= 0 ? "text-teal-300" : "text-rose-300"}>{formatINR(co.profit)}</span>
            </p>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <p className="tick">Cash / debt</p>
            <p>
              {formatINR(co.cash)} / {formatINR(co.debt)}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 p-2">
            <p className="tick">You control</p>
            <p className={ctl.controlled ? "text-teal-300" : ctl.boardSeat ? "text-amber-200" : ""}>{ctl.pct.toFixed(2)}%</p>
          </div>
        </div>
        <div className="mt-3">
          <p className="tick">Share register</p>
          <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-white/5">
            {holders.map((h, i) => (
              <span
                key={h.id + i}
                title={`${h.name}: ${((h.shares / co.shares) * 100).toFixed(1)}%`}
                style={{ width: `${(h.shares / co.shares) * 100}%` }}
                className={h.type === "player" || state.player.ownedCompanyIds.includes(h.id) ? "bg-teal-300" : h.type === "public" ? "bg-slate-500" : i % 2 ? "bg-amber-300/70" : "bg-amber-500/60"}
              />
            ))}
          </div>
          <div className="mt-1 space-y-0.5 text-xs">
            {holders.slice(0, 6).map((h, i) => (
              <div key={h.id + i} className="flex justify-between">
                <span className="text-[var(--muted)]">
                  {h.type === "player" ? "You" : h.name} <span className="opacity-60">({h.type})</span>
                </span>
                <span>{((h.shares / co.shares) * 100).toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
      {co.playerRole !== "founder" || !state.player.ownedCompanyIds.includes(co.id) ? (
        <Card>
          <Label>Tender offer</Label>
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <div className="flex justify-between">
                <span className="tick">Shares sought</span>
                <span>{pct}% of the company</span>
              </div>
              <input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full" />
            </div>
            <div>
              <div className="flex justify-between">
                <span className="tick">Premium over market</span>
                <span>+{premium}%</span>
              </div>
              <input type="range" min={0} max={100} value={premium} onChange={(e) => setPremium(Number(e.target.value))} className="w-full" />
              <p className="text-[11px] text-[var(--muted)]">
                Expected acceptance ≈ {(acc * 100).toFixed(0)}% of holders. Below +20% on a big stake, the board may adopt a poison pill and dilute you.
              </p>
            </div>
            <div>
              <p className="tick mb-1">Buy as</p>
              <Select value={buyer} onChange={(e) => setBuyer(e.target.value)}>
                <option value="me">Myself — {formatINR(liquidCash(state.player))} liquid</option>
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {formatINR(b.cash)} company cash
                  </option>
                ))}
              </Select>
            </div>
            {quote ? (
              <div className="rounded-2xl border border-white/10 p-3 text-xs">
                <div className="flex justify-between">
                  <span>Offer price</span>
                  <span>{formatINR(quote.price)} / share</span>
                </div>
                <div className="flex justify-between">
                  <span>Available from holders</span>
                  <span>{((quote.available / co.shares) * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Expected fill</span>
                  <span>{((quote.expected / co.shares) * 100).toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Expected cost + 1.5% fees</span>
                  <span className="text-amber-200">{formatINR(quote.cost + quote.fees)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Your control afterwards</span>
                  <span className={quote.controlAfter ? "text-teal-300" : ""}>
                    {quote.pctAfter.toFixed(1)}%{quote.controlAfter ? " — CONTROL" : quote.pctAfter >= 10 ? " — board seat" : ""}
                  </span>
                </div>
                {quote.cost + quote.fees > funds ? <p className="mt-1 text-rose-300">The buyer can fund only part of this; the offer will be scaled back.</p> : null}
              </div>
            ) : null}
            <Btn className="w-full" disabled={busy || !quote || quote.requested <= 0} onClick={() => act({ type: "tenderOffer", companyId: co.id, pct, premium, buyer })}>
              Launch tender offer
            </Btn>
          </div>
        </Card>
      ) : null}
      {myEntries.length ? (
        <Card>
          <Label>Sell down</Label>
          <div className="mt-2">
            <div className="flex justify-between text-sm">
              <span className="tick">Portion to sell</span>
              <span>{sellPct}%</span>
            </div>
            <input type="range" min={5} max={100} step={5} value={sellPct} onChange={(e) => setSellPct(Number(e.target.value))} className="w-full" />
          </div>
          <div className="mt-2 space-y-2">
            {myEntries.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {h.type === "player" ? "Your personal stake" : `Held by ${h.name}`} · {((h.shares / co.shares) * 100).toFixed(2)}%
                </span>
                <Btn kind="ghost" disabled={busy} onClick={() => act({ type: "sellStake", companyId: co.id, holderId: h.type === "player" ? "player" : h.id, pct: sellPct })}>
                  Sell {sellPct}%
                </Btn>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">Block sales go at a discount that grows with size. Dropping to 50% or below hands control back.</p>
        </Card>
      ) : null}
    </div>
  );
}
