export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function round(n: number, d = 0): number {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

export function chance(rng: () => number, p: number): boolean {
  return rng() < p;
}

export function jitter(rng: () => number, n: number, amt: number): number {
  return n * (1 + (rng() * 2 - 1) * amt);
}

export function weightedPick<T>(rng: () => number, items: { item: T; w: number }[]): T {
  const total = items.reduce((s, i) => s + i.w, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it.item;
  }
  return items[items.length - 1]!.item;
}

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthName(m: number): string {
  return MONTHS[(m - 1 + 12) % 12] ?? "January";
}

export function formatDate(year: number, month: number): string {
  return `${monthName(month)} ${year}`;
}

export function formatINR(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "₹—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${sign}₹${(abs / 1e12).toFixed(digits)} Lakh Cr`;
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(digits)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(digits)} L`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function formatCompact(n: number): string {
  return formatINR(n, 1);
}

export function formatPct(n: number, d = 1): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}%`;
}

export function formatNum(n: number, d = 0): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: d });
}

export function indianGroup(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

export function ageFrom(birthYear: number, year: number, birthMonth = 1, month = 1): number {
  let age = year - birthYear;
  if (month < birthMonth) age -= 1;
  return age;
}

export function deepClone<T>(v: T): T {
  return structuredClone(v);
}

export function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

export function pushCap<T>(arr: T[], item: T, cap: number): T[] {
  arr.unshift(item);
  if (arr.length > cap) arr.length = cap;
  return arr;
}

export function normal(rng: () => number, meanV = 0, std = 1): number {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return meanV + z * std;
}

export function poissonLike(rng: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  let L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 20);
  return k - 1;
}
