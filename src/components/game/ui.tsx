import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { formatINR, formatPct } from "@/lib/sim/util";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel rounded-2xl p-5 transition duration-200 ease-out hover:border-[rgba(228,195,122,0.22)] ${className}`}>{children}</div>;
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="tick m-0">{children}</p>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "gold" }) {
  const color = tone === "good" ? "text-teal-300" : tone === "bad" ? "text-rose-300" : tone === "gold" ? "gold-text" : "text-white";
  return (
    <div className="panel rounded-2xl p-4">
      <p className="tick m-0">{label}</p>
      <p className={`mt-2 font-serif text-2xl ${color}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p> : null}
    </div>
  );
}

export function Meter({ label, value, max = 100 }: { label: string; value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[11px] text-[var(--muted)]">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  kind = "gold",
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "gold" | "ghost" | "teal" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const cls =
    kind === "gold"
      ? "bg-gradient-to-r from-amber-200 to-yellow-500 text-black"
      : kind === "teal"
        ? "bg-teal-400/90 text-black"
        : kind === "danger"
          ? "bg-rose-500/80 text-white"
          : "border border-[var(--line)] bg-white/5 text-white";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ease-out active:scale-[0.98] hover:brightness-[1.07] disabled:opacity-40 disabled:active:scale-100 ${cls} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="tick">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-[var(--line)] bg-[#0b0e14] px-3 py-2 text-sm text-white outline-none transition duration-200 focus:border-amber-200/40 focus:bg-[#0e111a] ${props.className ?? ""}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl border border-[var(--line)] bg-[#0b0e14] px-3 py-2 text-sm text-white outline-none transition duration-200 focus:border-amber-200/40 focus:bg-[#0e111a] ${props.className ?? ""}`}
    />
  );
}

export function Spark({ values, color = "#e4c37a" }: { values: number[]; color?: string }) {
  if (values.length < 2) return <div className="h-12" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 36 - ((v - min) / span) * 32;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 40" className="h-12 w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}

export function Money({ n }: { n: number }) {
  return <span>{formatINR(n)}</span>;
}

export function Delta({ n }: { n: number }) {
  return <span className={n >= 0 ? "text-teal-300" : "text-rose-300"}>{formatPct(n)}</span>;
}

export function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
          <tr>
            {headers.map((h) => (
              <th key={h} className="pb-2 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5">
              {r.map((c, j) => (
                <td key={j} className="py-2 pr-3 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="panel max-h-[90vh] w-full max-w-lg overflow-auto rounded-3xl p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-serif text-2xl">{title}</h2>
          {onClose ? (
            <button onClick={onClose} className="text-[var(--muted)]">
              Close
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ appearance, name, size = 48 }: { appearance: { skin: string; hair: string; portrait: string }; name: string; size?: number }) {
  const pal: Record<string, string> = {
    gold: "from-amber-200 to-yellow-700",
    teal: "from-teal-200 to-cyan-800",
    rose: "from-rose-200 to-rose-800",
    violet: "from-violet-200 to-indigo-800",
    slate: "from-slate-200 to-slate-700",
  };
  return (
    <div
      className={`grid place-items-center rounded-full bg-gradient-to-br ${pal[appearance.portrait] ?? pal.gold} text-black`}
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 3px ${appearance.skin}` }}
      title={name}
    >
      <span className="font-serif text-lg">{name.slice(0, 1)}</span>
    </div>
  );
}
