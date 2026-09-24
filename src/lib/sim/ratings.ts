// Credit ratings for companies and countries (fictional rating agency model).
// Ratings are derived from balance-sheet and cycle data, not hard-coded, and
// feed loan pricing and bond expectations across the simulation.
import type { Country, GameState, ListedCompany } from "./types";
import { clamp } from "./util";

export const GRADES = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"] as const;

export interface RatingInfo {
  grade: string;
  index: number; // 0 (best) .. 6 (worst)
  score: number; // 0..100
  spread: number; // extra annual borrowing cost in pct points
}

export function gradeFromScore(score: number): RatingInfo {
  const idx = clamp(Math.floor((100 - score) / 15), 0, GRADES.length - 1);
  return {
    grade: GRADES[idx] ?? "CCC",
    index: idx,
    score: Math.round(score),
    spread: 0.2 + idx * 0.45,
  };
}

export function companyRating(co: ListedCompany, state: GameState): RatingInfo {
  const revenue = Math.max(1, co.revenue);
  const margin = co.profit / revenue;
  const leverage = co.debt / Math.max(1, co.cash + co.revenue * 0.35);
  const cashCover = co.cash / Math.max(1, co.revenue);
  let score = 50;
  score += clamp(margin * 120, -25, 25);
  score += clamp((1 - leverage) * 30, -30, 30);
  score += clamp(cashCover * 25, 0, 15);
  score += clamp(co.growth * 0.6, -12, 12);
  if (co.stage === "distressed") score -= 25;
  if (co.stage === "bankrupt") score -= 55;
  if (co.stage === "public" || co.stage === "mature") score += 5;
  void state;
  return gradeFromScore(score);
}

export function countryRating(c: Country): RatingInfo {
  const debtGdp = c.debt / Math.max(1, c.gdp); // annualised-ish ratio
  let score = 62;
  score -= clamp(debtGdp * 22, 0, 38);
  score += clamp(c.gdpGrowth * 2.4, -14, 14);
  score -= clamp((c.inflation - 4) * 2.2, -10, 22);
  score += clamp(c.approval - 50, -12, 12);
  score += clamp((c.businessFreedom - 50) / 3, -8, 8);
  return gradeFromScore(score);
}
