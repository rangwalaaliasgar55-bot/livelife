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

**Where server saves go.** The store picks the first directory it can actually write to: `SAVE_DIR` → `<project>/.saves` →
`$TMPDIR/aurelion-saves` → in-process memory. Read-only serverless filesystems (Vercel's `/var/task`, Lambda) therefore degrade instead of
throwing: the API answers, and `GET /api/health` reports `{"ok":true,"persist":false,...}` so the client knows the mirror is ephemeral and
keeps localStorage authoritative. Set `DATABASE_URL` (or a writable `SAVE_DIR`) for real multi-device sync. Under `next dev` saves are kept
outside the project tree so the bundler's watcher is not churned on every action.

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
| `npm run money-test` | Money audit: every known way a balance used to be destroyed, asserted fixed |
| `npm run ui-test` | Renders every panel and the new game surfaces to markup (no blank screens) |
| `npm run life-test` | Life layer: whole lives aged up, events & consequences, prison, death → heir, casino house edges, aircraft economy, takeovers, admin x-ray |
| `npm test` | typecheck + lint + all four suites |
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

### My Life — the BitLife layer (`life.ts`, `lifeevents.ts`)
- **+ Age** lives until your next birthday (header button and the My Life screen). Life events interrupt the year and make you choose;
  the story screen is your timeline grouped by age.
- **New stats**: Smarts, Looks, Karma, Fame alongside Health, Happiness and Stress. Health heals toward an age-dependent baseline;
  untreated illness, drinking and poverty drag it down. Mortality is real and rises steeply with age and poor health.
- **Relationships**: parents, siblings, partner/fiancé(e)/spouse, children, friends, exes and enemies — each with a bond bar that decays
  when neglected. Spend time, talk, gift, date, ask for money, argue, insult, propose (ring cost), marry (simple/grand/elope, optional
  prenup), try for a baby, break up, divorce (prenup protects you; no prenup costs up to half your liquid wealth). Dating app, going out,
  office romance; pets and adoption. Parents die and leave inheritances.
- **36 life events with real consequences** — a lost wallet, a friend who needs a loan, a boss asking you to "reclassify" losses, a
  can't-lose investment, the baby question, a flirtation at work, a midlife crisis, a tax audit, being pulled over without a licence…
  Many choices schedule **delayed consequences** that land months or years later: the loan is repaid — or not; the scheme pays out, then
  collapses; the cooked books are exposed; an affair is discovered; an insider tip draws a regulator's probe.
- **Activities** with diminishing returns within a year: gym, library, meditation, martial arts, spa, volunteering, night club, parties,
  charity, doctor, therapy, rehab, plastic surgery, driver's/boating/pilot licences, skydiving, street racing.
- **Prison**: convictions (from the underground and from life events) can mean a sentence. You lose your job; travel, business moves and
  the casino are closed; prison activities include the library, workouts, an appeal, a riot or an escape attempt. Good behaviour means
  early parole. Your record follows you.
- **Death & heirs**: when a life ends, a successor continues with the relationship web rebuilt from their point of view.

### Casino floor (`casino.ts`)
Eight games, all played move by move from the save's own RNG stream (nothing re-rolls on refresh), with odds and house edge on screen:
**Blackjack** (6-deck shoe, S17, 3:2, double, basic-strategy hint) · **Roulette** (single zero, full chip table, animated wheel) ·
**Slots** (3 reels, 95.7% RTP) · **Crash** (live multiplier curve, manual or auto cash-out, 3% edge) · **Hi-Lo** (chain calls, skip,
cash out) · **Dice** (pick your odds, 1% edge) · **Plinko** (12 rows, low/medium/high risk, 97% RTP) · **Mines**. Gambling builds a
habit that costs stress and relationships; rehab clears it.

### Jets, cars & travel (`lifestyle.ts`)
- **Aircraft** from a Skylark trainer to a wide-body airliner. Fly it yourself (pilot licence, single-pilot types) or retain a crew. Put
  it on the **charter** market (income per flight hour, driven by the economy, tourism and condition, minus crew/fuel/maintenance) or
  **dry-lease** it to an airline for fixed monthly rent (lessees can default in downturns). Depreciation, maintenance checks and
  groundings are real. **Fly to any city** on the map — it relocates you.
- **Cars, bikes and yachts**: happiness, looks and fame boosts, depreciation (hypercars appreciate), upkeep; charter yachts out.
- **Vacations**: pick a destination on the map, a style (backpacker → ultra) and a length; fly commercial or take your own jet. Trips
  lower stress, can bring a holiday romance, food poisoning, a pickpocket or a useful contact. Countries visited are tracked.

### Stakes & takeovers (`corporate.ts`)
Launch a **tender offer** for any company — personally or through a company you control. Pick the stake and premium; acceptance depends
on premium, sentiment, the company's condition and your negotiation skill. 10% buys a board seat, >50% buys **control** (the firm joins
your group). Low-ball hostile bids for big stakes can trigger a **poison pill** that dilutes you. Stakes pay dividends; block sales go at
a discount; stakes held by your companies count in net worth.

### Owner x-ray (secret)
With the treasury unlocked, the **Casino x-ray** toggle (in the treasury, or triple-tap the Mines title) faintly marks every mine on the
Mines board and shows the crash point, the dealer's hole card and the next card in Blackjack/Hi-Lo. It is invisible to normal players and
switches off when the treasury is locked.

### The money rules (invariants, all asserted by `npm run money-test`)
- **A payment you cannot cover moves nothing.** An unaffordable bet, tuition, instalment or retainer is refused — the old behaviour drained
  the wallet *and every bank account* and then reported failure, which is how balances "vanished" on their own.
- **Shortfalls become arrears, not confiscation.** Unpaid living costs carry forward, cost you stress/health/credit, and clear the moment
  money arrives.
- **Nothing is charged twice.** Advisors debit the liquid pool once per month (they used to hit the wallet *and* the bank account, and to
  empty the account outright when the wallet was short).
- **No NaN can reach a balance.** Every money entry point is guarded, and a loaded save is repaired (`repairFinances`) so a poisoned save
  heals instead of zeroing out.
- **Newer save wins.** When a device and the server disagree, the copy with the later timestamp is kept — a stale local copy can no longer
  roll a life (and its wallet) backwards.
- **Loans amortise for real.** Each instalment pays accrued interest first, then principal; late interest capitalises with a fee, and a
  prepayment re-amortises the schedule.

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
- Gambling with **transparent odds and house edge shown** (roulette, dice, cards, slots, lottery)
- **Mines is now actually played**: a real 5×5 board, tiles opened one at a time, multiplier and next-tile odds shown before every click,
  cash out whenever you want. The board is generated from a seed when the round starts, so it is fixed before your first click; the payout
  is the fair multiplier for surviving that many picks less a visible 3% house edge (measured RTP ≈ 97% over 600 blind rounds)
- **Casinos and media outlets run real P&Ls** — revenue follows the economy and your reach, costs follow inflation, and both can lose money
  (a casino used to cost ₹80 L and then never simulate again; an outlet was a free ₹40k/month faucet)
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
- **Cash Flow panel** — every month broken into named flows (salary, rent, tax, living costs, instalments with interest vs principal split,
  advisors, newsroom costs, casino floor, fees), a 12-month history, fixed burn, **runway in months**, arrears and short-month count
- **Transaction ledger** + monthly flow breakdowns — every big move is posted and traceable
- **Two new studies** — a *personal cash-flow audit* and a *debt & credit review*, both reporting your actual numbers (leaks, runway,
  refinance savings) rather than generic advice
- **Time is yours to control** — pause by default, ¼× (a month every 16s), ½×, 1×, 2×, 5×, jump-a-year, plus manual `+1mo` / `+1y` steps;
  the chosen speed survives a reload
- **Economic calendar** — elections, grant deadlines, loan instalments, bond maturities, construction, auctions, forecasts
- **Year-end review** — annual accounts: what you built, what the world did, where the markets went
- **Lifetime statistics** — earned/spent/taxes, businesses, elections, peak net worth, gambling record
- **Biography export** — generated from your actual timeline
- **World atlas search** — one box for countries, cities, firms, parties, property
- **Simulation speed controls** — pause / 1× / 2× / 5× / 1-year, with hard pauses on major decisions
- **Save export/import** — full save files; bring a life to another phone
- **Hidden dev tools** — tap the AURELION logo 5× to open; gated behind a dev-mode switch (recursions, shocks, elections, grants…)
- **The treasury (owner-only)** — an unmarked spot: click the *Net worth* caption (or the sidebar save stamp) three times. It asks for
  the admin key — `NEXT_PUBLIC_ADMIN_KEY` at build time, default `aurelion-admin` — and dev mode also unlocks it. A draw credits the wallet
  and is written to the ledger, the timeline and lifetime stats as an admin draw, so owner money is always traceable inside the save

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
                      # year reviews, stats, ledger, calendar, analysis, biographies,
                      # cash-flow report
  mines.ts            # the Mines round: seeded board, fair multipliers, odds
  life.ts             # BitLife layer: stats, people, activities, prison, mortality, heirs
  lifeevents.ts       # life events with choices + delayed consequences
  casino.ts           # blackjack, roulette, slots, crash, hi-lo, dice, plinko
  lifestyle.ts        # cars, yachts, aircraft (charter/lease/fly), vacations
  corporate.ts        # stakes, tender offers, control, poison pills
  debug.ts            # hidden developer tools + the owner treasury (gated)
src/lib/store.ts      # client-first persistence: localStorage + optional server mirror
                      # (newer-copy-wins, save repair, sync status)
src/lib/persist.ts    # server persistence: Postgres (drizzle) or file store fallback
src/lib/filestore.ts  # write-aware file store: SAVE_DIR → .saves → tmp → memory
src/components/game/  # the UI (panels, overlays, Mines board, My Life, Casino floor,
                      # Jets/Cars/Travel, Stakes & Takeovers, app shell)
scripts/              # static export build + the four test suites
android/              # Capacitor Android project
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
