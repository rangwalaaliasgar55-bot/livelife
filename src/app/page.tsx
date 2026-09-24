"use client";

import { useEffect, useState } from "react";
import { CreateLife } from "@/components/game/CreateLife";
import { deleteLife, listSavesMerged, type SaveMeta } from "@/lib/store";
import { formatINR } from "@/lib/sim/util";

export default function HomePage() {
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void listSavesMerged().then((s) => {
      setSaves(s);
      setLoaded(true);
    });
  }, []);

  async function remove(id: string) {
    if (!confirm("Delete this life? The world will forget it.")) return;
    await deleteLife(id);
    setSaves((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <main className="min-h-screen">
      <section className="relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/hero.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-[#07080c]/55 to-[#07080c]" />
        <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-20">
          <p className="tick">Aurelion world simulation</p>
          <h1 className="mt-4 max-w-3xl font-serif text-5xl leading-[1.05] md:text-7xl">
            One life. A living economy. A century of consequences.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-[var(--muted)]">
            Start with almost nothing in a fictional world of ten countries. Study, work, found firms, buy land, sit in parliament,
            or fail and rebuild. Interest rates move mortgages. Mortgages move housing. Housing moves jobs. Jobs move elections.
            Nothing here is a wallpaper menu.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-xs">
            {["Plays offline on Android (APK)", "Every number comes from the simulation", "10 interconnected countries", "Multi-generation dynasties"].map((t) => (
              <span key={t} className="rounded-full border border-[var(--line)] bg-white/5 px-3 py-1.5 text-[var(--muted)]">
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 md:grid-cols-3">
        {[
          { img: "/images/trading.jpg", t: "Capital", d: "Banks, credit, stocks, bonds, funds, auctions and cash that actually posts every month." },
          { img: "/images/parliament.jpg", t: "Power", d: "Parties, elections with opponents, bills, cabinets and a Concord of Nations." },
          { img: "/images/campus.jpg", t: "Becoming", d: "Skills, degrees, gigs, advisors and reputations that compound over a lifetime." },
        ].map((x) => (
          <article key={x.t} className="panel overflow-hidden rounded-3xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={x.img} alt="" className="h-40 w-full object-cover" />
            <div className="p-5">
              <h3 className="font-serif text-2xl">{x.t}</h3>
              <p className="mt-2 text-sm text-[var(--muted)]">{x.d}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <CreateLife />
        <div className="mt-10">
          <p className="tick">Continue</p>
          <h2 className="font-serif text-3xl">Saved lives</h2>
          {!loaded ? (
            <p className="mt-3 text-sm text-[var(--muted)]">Loading…</p>
          ) : saves.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted)]">No lives yet. The world is waiting.</p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {saves.map((s) => (
                <div key={s.id} className="panel rounded-2xl p-5 hover:border-amber-200/40">
                  <div className="flex justify-between gap-3">
                    <a href={`/play?life=${s.id}`} className="min-w-0 flex-1">
                      <p className="font-serif text-xl">{s.playerName}</p>
                      <p className="text-sm text-[var(--muted)]">
                        {s.age} · {s.country} · {s.monthName} {s.year}
                      </p>
                      <p className="mt-1 truncate text-xs text-[var(--muted)]">{s.summary}</p>
                    </a>
                    <div className="flex flex-col items-end gap-2">
                      <a href={`/play?life=${s.id}`}>
                        <p className="gold-text font-serif text-xl">{formatINR(s.netWorth)}</p>
                      </a>
                      <p className="tick">{s.mode}</p>
                      <button onClick={() => void remove(s.id)} className="text-xs text-[var(--muted)] hover:text-rose-300">
                        delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-[var(--line)] px-6 py-8 text-center text-xs text-[var(--muted)]">
        Aurelion is a fictional simulation. No real money, politics or people. Every path is optional; every number moves.
      </footer>
    </main>
  );
}
