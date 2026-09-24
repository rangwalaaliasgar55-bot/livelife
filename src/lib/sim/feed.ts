import { ACHIEVEMENTS } from "./catalog";
import type { GameState } from "./types";
import { pushCap, uid } from "./util";

export function news(
  state: GameState,
  headline: string,
  body: string,
  tag: string,
  countryId: string,
  impact: string,
) {
  pushCap(
    state.news,
    {
      id: uid("news"),
      year: state.time.year,
      month: state.time.month,
      headline,
      body,
      tag,
      countryId,
      impact,
    },
    80,
  );
}

export function note(state: GameState, text: string, tone: "info" | "good" | "bad" | "warn" = "info") {
  pushCap(state.notifications, { id: uid("n"), text, tone, year: state.time.year, month: state.time.month }, 48);
}

export function timeline(state: GameState, text: string, kind: string) {
  pushCap(
    state.timeline,
    {
      id: uid("tl"),
      year: state.time.year,
      month: state.time.month,
      age: state.player.age,
      text,
      kind,
    },
    240,
  );
}

export function history(state: GameState, kind: string, text: string) {
  pushCap(state.history, { id: uid("h"), year: state.time.year, month: state.time.month, kind, text }, 400);
}

export function unlock(state: GameState, id: string) {
  if (state.achievements.includes(id)) return;
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return;
  state.achievements.push(id);
  note(state, `Achievement: ${a.name}`, "good");
  timeline(state, a.name, "achievement");
}
