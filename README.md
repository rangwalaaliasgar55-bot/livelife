# AURELION — Life, Capital, Power

A living world simulation: live a full life across a fictional world of ten countries. Study, work, found firms, buy land, sit in
parliament, win (or lose) elections, play the markets, or walk the darker paths — and watch every consequence propagate through the
economy, the press, and the people.

**One authoritative, persistent world state. Every displayed number comes from the simulation. Nothing is decorative.**

---

## Quick start (web)

```bash
npm install
npm run dev        # http://localhost:3000
```

No database required. With `DATABASE_URL` set (Postgres), saves sync to the database; without it, saves live in a local `.saves/`
directory — the app is fully functional either way.

```bash
npm run build      # production web build
npm run start      # serve it
```

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production web build (server + API) |
| `npm run start` | Serve the production web build |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run sim-test` | End-to-end simulation smoke test (deterministic seeds, 10-year soak) |
| `npm run apk` | Static web build (`out/`) + Capacitor sync for Android |

---

## The Android APK

The app is packaged for Android with **Capacitor**. The APK runs the entire simulation **offline in the phone's WebView** — saves are
kept in the WebView's localStorage, no server needed.

- **Automatic:** pushing to `main` runs `.github/workflows/android-apk.yml`, which builds `app-debug.apk` and uploads it as a workflow
  artifact (GitHub → Actions → latest run → `aurelion-debug-apk`). That file installs on any Android 7+ device.
- **Manual:** see [BUILD_APK.md](BUILD_APK.md).

The web app and the APK are the same code: the app is client-first (the simulation runs in the tab), and a server, when reachable,
merely mirrors saves for multi-device sync.

---

## Systems

### Core life
- 10 game modes (normal, zero-to-empire, rich, entrepreneur, politician, investor, underground, random, country leader, sandbox)
- **Scenario generator** — 9 starting stories (poor student, failing entrepreneur, government employee, business owner, …)
- **Deterministic world seeds** — same seed ⇒ same world
- Education tracks, 28 skills, careers with promotion/layoff risk, freelancing, health/energy/stress, family, children, **multi-generation
  dynasties with heirs**
- Personality traits that measurably affect outcomes

### Capital
- Banking (accounts, interest, fees), loans & credit scores, mortgages
- Stocks, bonds, funds across all ten countries
- **Distressed auctions** for companies and property (NPC bidders, negotiation skill matters)
- **FX desk** — multi-currency accounts with conversion spread
- Real estate: buy, renovate, rent, refinance, **develop** (construction progress, budget, completion value jump)
- Companies: found, manage, hire staff, raise rounds (angel/VC/crowd/friends — dilution is real), **IPO**, sell, bankrupt

### World & power
- 10 countries with full fiscal models: GDP cycles, Taylor-rule rates, inflation, unemployment, debt, tax policy
- **Credit ratings** (AAA–CCC) for companies and countries, derived from balance sheets, feeding loan pricing
- Elections with real opponents, parties, polls, campaigns; if you win, **policy has economic consequences**
- **Concord of Nations** — UN-style body: resolutions, blocs, agencies, votes
- International travel, visas, residency, second citizenship, foreign assets

### The underground (fictional, system-level only)
- Gambling with **transparent odds and house edge shown** (roulette, dice, cards, slots, lottery, 5×5 Mines)
- Criminal path: heat, evidence, convictions, organizations — a consequence system, not a how-to

### New: the insight layer
- **Goals** — set personal targets; progress computed live from state
- **Challenges** — optional objectives with deadlines and a record (win/lose)
- **Market forecasts** — call a direction over a horizon; stake at risk, +30% on correct calls
- **Research desk** — pay for multi-month studies; findings sharpen your information, never remove uncertainty
- **Staff & advisors** — accountant, lawyer, financial advisor, economist, marketing, political, real-estate, tech advisors;
  **professional managers** for firms you don't personally run. Real monthly cost, real (small) effects
- **Analysis ("What should I do?")** — your situation, options with cost / risk / upside / opportunity cost, balance sheet,
  concentration & liquidity risk dashboard. It never picks for you
- **WHY? buttons** — explain the current net worth, any stock's move, and market drivers from actual state
- **Transaction ledger** + monthly flow breakdowns — every big move is posted and traceable
- **Economic calendar** — elections, grant deadlines, loan instalments, bond maturities, construction, auctions, forecasts
- **Year-end review** — annual accounts: what you built, what the world did, where the markets went
- **Lifetime statistics** — earned/spent/taxes, businesses, elections, peak net worth, gambling record
- **Biography export** — generated from your actual timeline
- **World atlas search** — one box for countries, cities, firms, parties, property
- **Simulation speed controls** — pause / 1× / 2× / 5× / 1-year, with hard pauses on major decisions
- **Save export/import** — full save files; bring a life to another phone
- **Hidden dev tools** — tap the AURELION logo 5× to open; gated behind a dev-mode switch (recursions, shocks, elections, grants…)

---

## Architecture

```
src/lib/sim/          # the simulation — pure TypeScript, no UI, no server
  types.ts            # the single GameState model (everything)
  util.ts             # seeded RNG, formatting
  catalog.ts          # world constants: countries, cities, parties, skills, achievements…
  create.ts           # world generation (seed-deterministic) + scenarios
  engine.ts           # monthly tick: countries, cities, firms, markets, player, politics…
  actions.ts          # applyAction(state, action) — every user decision
  finance.ts          # balance-sheet helpers
  feed.ts             # news/notes/timeline/history/achievements
  ratings.ts          # credit-rating model
  advanced.ts         # goals, forecasts, research, advisors, auctions, challenges,
                      # year reviews, stats, ledger, calendar, analysis, biographies
  debug.ts            # hidden developer tools (gated)
src/lib/store.ts      # client-first persistence: localStorage + optional server mirror
src/lib/persist.ts    # server persistence: Postgres (drizzle) or file store fallback
src/components/game/  # the UI (panels, overlays, app shell)
android/              # Capacitor Android project
scripts/              # static export build + simulation smoke test
```

**Client-first design:** `applyAction` is a pure function over `GameState`. The UI runs it locally, writes the result to
localStorage, and mirrors it to the server when one exists. The same engine therefore runs in the browser, in the server (API
actions), and in the Android WebView with zero changes.

---

## Safety & content boundaries

Aurelion is a fictional simulation. By design it contains **no** real money, real persons, real parties, real political advice,
instructions for real-world crime or corruption, real gambling, or sexual content. The darker systems (crime, lobbying, the
underground) are system-level mechanics with visible consequences — modeled, not instructional. All countries, cities, firms,
politicians and media outlets are invented.
