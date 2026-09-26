// Life events: the BitLife heartbeat. Every year (and now and then in
// between) something happens and you choose. Each choice applies visible,
// immediate consequences — and many schedule delayed ones: the exam you
// cheated on, the affair, the books you cooked, the hit-and-run. Those come
// back months or years later through the consequence queue.
import type { Decision, GameState } from "./types";
import {
  addChild,
  addIllness,
  applyEffects,
  divorce,
  getLife,
  inPrison,
  killPlayer,
  newPerson,
  partnerOf,
  pay,
  schedule,
  sentence,
  type Effects,
  type LifeState,
  type Person,
} from "./life";
import { computeNetWorth, credit, liquidCash, money } from "./finance";
import { ledger } from "./advanced";
import { note, timeline, news } from "./feed";
import { rng } from "./engine";
import { clamp, formatDate, formatINR, pick, round, uid } from "./util";

type Ctx = Record<string, string | number>;
interface Opt {
  id: string;
  label: string;
  hint?: string;
}
interface EventDef {
  id: string;
  title: string | ((s: GameState, c: Ctx) => string);
  /** 0 = cannot happen now. */
  weight: (s: GameState, L: LifeState) => number;
  ctx?: (s: GameState, L: LifeState) => Ctx | null;
  body: (s: GameState, c: Ctx) => string;
  options: (s: GameState, c: Ctx) => Opt[];
  resolve: (s: GameState, opt: string, c: Ctx, log: string[]) => void;
  cooldown?: number;
}

const r = (s: GameState) => rng(s);
const roll = (s: GameState, p: number) => r(s) < p;
const wage = (s: GameState) => s.world.cities.find((c) => c.id === s.player.cityId)?.avgWage ?? 700000;
const job = (s: GameState) => s.player.career.job;
const rich = (s: GameState) => computeNetWorth(s);
const person = (s: GameState, id: string | number) => getLife(s).people.find((x) => x.id === String(id));
const say = (s: GameState, log: string[], text: string, e: Effects = {}, reason?: string) => {
  const fx = applyEffects(s, e, reason ?? text.slice(0, 60));
  const line = `${text}${fx ? ` (${fx})` : ""}`;
  log.push(line);
  timeline(s, text, "life");
};
const luck = (s: GameState) => (getLife(s).karma - 50) / 250; // karma quietly bends the odds

const EVENTS: EventDef[] = [
  /* ---------------------------------------------------------- teens & school */
  {
    id: "exam_cheat",
    title: "Final exam",
    weight: (s) => (s.player.currentStudy || s.player.age < 19 ? 3 : 0),
    body: () => "Your final exam is tomorrow and you're not ready. A classmate is selling the answer sheet.",
    options: () => [
      { id: "study", label: "Pull an all-nighter", hint: "Smarts +, stress +" },
      { id: "cheat", label: "Buy the answers (₹5,000)", hint: "Great grade… if nobody finds out" },
      { id: "wing", label: "Wing it" },
    ],
    resolve: (s, o, _c, log) => {
      if (o === "study") say(s, log, "You studied all night and passed the exam.", { smarts: 4, stress: 6, energy: -8 });
      else if (o === "cheat") {
        if (!pay(s, 5000, "Exam answers")) return void log.push("You couldn't afford the answers.");
        if (s.player.currentStudy) s.player.currentStudy.gpa = Math.min(4, s.player.currentStudy.gpa + 0.4);
        schedule(s, 3 + Math.floor(r(s) * 12), "cheat_caught", {});
        say(s, log, "You aced the exam with the stolen answers.", { karma: -6, happy: 3 });
      } else {
        const ok = roll(s, 0.3 + getLife(s).smarts / 200);
        if (s.player.currentStudy) s.player.currentStudy.gpa = clamp(s.player.currentStudy.gpa + (ok ? 0.1 : -0.3), 0, 4);
        say(s, log, ok ? "You winged it and scraped a pass." : "You winged it and failed.", { happy: ok ? 2 : -5 });
      }
    },
  },
  {
    id: "bully",
    title: "Trouble at school",
    weight: (s) => (s.player.age < 20 ? 3 : 0),
    body: () => "An older student has been shoving you around in the corridor and taking your lunch money.",
    options: () => [
      { id: "fight", label: "Fight back" },
      { id: "report", label: "Report to the principal" },
      { id: "ignore", label: "Ignore it" },
    ],
    resolve: (s, o, _c, log) => {
      if (o === "fight") {
        const win = roll(s, 0.4 + (s.player.health - 50) / 200);
        say(s, log, win ? "You fought back and won. They never bothered you again." : "You fought back and lost badly.", win ? { happy: 6, health: -2, fame: 0.5 } : { health: -10, happy: -6 });
      } else if (o === "report") say(s, log, "You reported it. The bully was suspended.", { happy: 3, karma: 1 });
      else say(s, log, "You kept your head down. It kept happening.", { happy: -6, stress: 6 });
    },
  },
  {
    id: "teen_party",
    title: "House party",
    weight: (s) => (s.player.age >= 15 && s.player.age <= 24 ? 3 : 0),
    body: () => "You're at a house party. Someone hands you a drink and there's a car full of friends heading to a second party.",
    options: () => [
      { id: "drink", label: "Drink and dance all night" },
      { id: "car", label: "Get in the car (driver's been drinking)" },
      { id: "home", label: "Go home early" },
    ],
    resolve: (s, o, _c, log) => {
      if (o === "drink") say(s, log, "Best night of the year. Worst morning.", { happy: 7, alcohol: 8, health: -2 });
      else if (o === "car") {
        if (roll(s, 0.12)) {
          say(s, log, "The car crashed on the highway. You were hospitalised.", { health: -30, happy: -10 });
          if (roll(s, 0.1)) killPlayer(s, "a drunk-driving crash (as a passenger)");
        } else say(s, log, "You made it to the second party. Lucky.", { happy: 5, karma: -1 });
      } else say(s, log, "You went home early. Boring — but safe.", { stress: -2 });
    },
  },

  /* ---------------------------------------------------------- everyday morals */
  {
    id: "wallet",
    title: "A lost wallet",
    weight: () => 3,
    ctx: (s) => ({ amt: round(8000 + r(s) * 45000, -2) }),
    body: (_s, c) => `You found a wallet on the pavement with ${formatINR(Number(c.amt))} inside and an ID card.`,
    options: (_s, c) => [
      { id: "return", label: "Return it", hint: "Karma +" },
      { id: "keep", label: `Keep the ${formatINR(Number(c.amt))}` },
      { id: "police", label: "Hand it to the police" },
    ],
    resolve: (s, o, c, log) => {
      const amt = Number(c.amt);
      if (o === "return") {
        const reward = roll(s, 0.35 + luck(s)) ? round(amt * 0.5, -2) : 0;
        say(s, log, reward ? `You returned the wallet. The owner insisted you take a reward.` : "You returned the wallet. The owner was grateful.", { karma: 6, happy: 3, cash: reward });
      } else if (o === "keep") {
        const caught = roll(s, 0.1);
        say(s, log, caught ? "You kept the cash — but a CCTV camera caught you. Fined for theft." : "You kept the cash. Nobody saw.", caught ? { karma: -8, cash: -amt, rep: -3 } : { karma: -8, cash: amt });
        if (caught) getLife(s).record.push(`Petty theft (${s.time.year})`);
      } else say(s, log, "You handed the wallet to the police.", { karma: 4 });
    },
  },
  {
    id: "friend_loan",
    title: "A friend in need",
    weight: (s, L) => (L.people.some((x) => x.alive && x.rel === "friend") && s.player.age >= 18 ? 3 : 0),
    ctx: (s, L) => {
      const f = pick(() => r(s), L.people.filter((x) => x.alive && x.rel === "friend"));
      if (!f) return null;
      return { id: f.id, name: f.name, amt: round(Math.max(20000, wage(s) * (0.05 + r(s) * 0.25)), -3) };
    },
    body: (_s, c) => `${c.name} is behind on rent and asks to borrow ${formatINR(Number(c.amt))}. They swear they'll pay you back within a year.`,
    options: (_s, c) => [
      { id: "lend", label: `Lend ${formatINR(Number(c.amt))}` },
      { id: "half", label: "Lend half" },
      { id: "no", label: "Say no" },
    ],
    resolve: (s, o, c, log) => {
      const f = person(s, c.id);
      const amt = o === "half" ? Number(c.amt) / 2 : Number(c.amt);
      if (o === "no") {
        if (f) f.bond = clamp(f.bond - 15, 0, 100);
        return say(s, log, `You told ${c.name} no. Things are frosty.`, { karma: -1 });
      }
      if (!pay(s, amt, `Loan to ${c.name}`)) return void log.push("You don't have that much liquid.");
      if (f) f.bond = clamp(f.bond + 12, 0, 100);
      schedule(s, 4 + Math.floor(r(s) * 12), "friend_repay", { id: String(c.id), name: String(c.name), amt });
      say(s, log, `You lent ${c.name} ${formatINR(amt)}.`, { karma: 3 });
    },
  },
  {
    id: "scheme",
    title: "A can't-lose investment",
    weight: (s) => (s.player.age >= 20 && liquidCash(s.player) > 50000 ? 2 : 0),
    ctx: (s) => ({ amt: round(Math.max(50000, liquidCash(s.player) * 0.15), -3), name: pick(() => r(s), ["Rajan", "Victor", "Selma", "Dario"]) }),
    body: (_s, c) => `${c.name}, a smooth talker from your gym, promises 8% a MONTH on a "crypto-arbitrage club". Minimum ticket ${formatINR(Number(c.amt))}. Early members are driving new cars.`,
    options: () => [
      { id: "in", label: "Invest", hint: "Returns look incredible…" },
      { id: "report", label: "Report it to the regulator" },
      { id: "no", label: "Walk away" },
    ],
    resolve: (s, o, c, log) => {
      if (o === "in") {
        const amt = Number(c.amt);
        if (!pay(s, amt, "Investment club ticket")) return void log.push("Not enough cash.");
        schedule(s, 2, "scheme_payout", { amt });
        schedule(s, 6 + Math.floor(r(s) * 8), "scheme_collapse", { amt, name: String(c.name) });
        say(s, log, `You bought into ${c.name}'s club for ${formatINR(amt)}.`, { happy: 4 });
      } else if (o === "report") say(s, log, `You reported ${c.name}'s club. Months later it was shut down.`, { karma: 5, rep: 2 });
      else say(s, log, "You walked away. If it sounds too good to be true…", { smarts: 1 });
    },
  },
  {
    id: "parked_car",
    title: "Crunch",
    weight: (_s, L) => (L.vehicles.some((v) => v.kind === "car") ? 2 : 0),
    body: () => "Reversing out of a tight spot, you scrape a parked luxury car. Nobody seems to be around.",
    options: () => [
      { id: "note", label: "Leave a note with your number", hint: "~₹60k repair" },
      { id: "drive", label: "Drive off" },
    ],
    resolve: (s, o, _c, log) => {
      if (o === "note") say(s, log, "You left a note. The owner called — you paid for the repair.", { cash: -60000, karma: 5 });
      else {
        schedule(s, 1 + Math.floor(r(s) * 5), "hitrun_caught", {});
        say(s, log, "You drove off. Your heart was pounding.", { karma: -7, stress: 5 });
      }
    },
  },
  {
    id: "charity_ask",
    title: "Street appeal",
    weight: () => 2,
    body: () => "A children's hospital is fundraising outside the metro station.",
    options: (s) => [
      { id: "big", label: `Donate ${formatINR(Math.max(5000, Math.round(liquidCash(s.player) * 0.01)))}` },
      { id: "small", label: "Donate ₹500" },
      { id: "no", label: "Walk past" },
    ],
    resolve: (s, o, _c, log) => {
      if (o === "big") say(s, log, "You made a generous donation.", { cash: -Math.max(5000, Math.round(liquidCash(s.player) * 0.01)), karma: 7, happy: 3 });
      else if (o === "small") say(s, log, "You dropped ₹500 in the bucket.", { cash: -500, karma: 2 });
      else say(s, log, "You walked past.", { karma: -1 });
    },
  },
  {
    id: "mugging",
    title: "Mugged",
    weight: (s) => (s.player.age >= 16 ? 1.5 : 0),
    body: () => "A man with a knife blocks your path in an alley and demands your wallet and phone.",
    options: () => [
      { id: "give", label: "Hand everything over" },
      { id: "fight", label: "Fight him" },
      { id: "run", label: "Run" },
    ],
    resolve: (s, o, _c, log) => {
      const wallet = Math.min(money(s.player.finances.cash), 15000 + r(s) * 20000);
      if (o === "give") say(s, log, "You handed it over. Shaken, but safe.", { cash: -Math.round(wallet), stress: 8, happy: -4 });
      else if (o === "fight") {
        const win = roll(s, 0.3 + (s.player.health - 50) / 150 + (getLife(s).uses.martial ? 0.2 : 0));
        if (win) say(s, log, "You disarmed him and held him for the police. Local news called you a hero.", { fame: 3, happy: 8, karma: 3 });
        else {
          say(s, log, "He stabbed you and ran with your wallet.", { health: -35, cash: -Math.round(wallet), happy: -10 });
          if (roll(s, 0.06)) killPlayer(s, "a stabbing during a mugging");
        }
      } else {
        const ok = roll(s, 0.6 + (s.player.health - 50) / 200);
        say(s, log, ok ? "You outran him." : "He caught you and took everything, plus a black eye.", ok ? { stress: 5 } : { health: -8, cash: -Math.round(wallet) });
      }
    },
  },
  {
    id: "lottery_ticket",
    title: "Scratch card",
    weight: () => 1,
    body: () => "Your colleague gives you a spare scratch card from a birthday card.",
    options: () => [{ id: "scratch", label: "Scratch it" }],
    resolve: (s, _o, _c, log) => {
      const x = r(s);
      const win = x < 0.0005 ? 5_000_000 : x < 0.02 ? 100_000 : x < 0.15 ? 2000 : 0;
      say(s, log, win ? `You won ${formatINR(win)} on a free scratch card!` : "Nothing. Of course.", { cash: win, happy: win ? 6 : 0 });
    },
  },

  /* ---------------------------------------------------------- work */
  {
    id: "credit_thief",
    title: "Someone took the credit",
    weight: (s) => (job(s) ? 3 : 0),
    body: (s) => `A coworker at ${job(s)?.employer ?? "work"} presented your project to the leadership team as their own.`,
    options: () => [
      { id: "confront", label: "Confront them publicly" },
      { id: "hr", label: "Take it to your manager with evidence" },
      { id: "let", label: "Let it go" },
    ],
    resolve: (s, o, _c, log) => {
      const p = s.player;
      if (o === "confront") {
        const good = roll(s, 0.45);
        p.career.performance = clamp(p.career.performance + (good ? 6 : -8), 0, 100);
        say(s, log, good ? "You called it out in the meeting — and leadership noticed who really did the work." : "The confrontation made you look petty.", { stress: 5, happy: good ? 4 : -4 });
      } else if (o === "hr") {
        p.career.performance = clamp(p.career.performance + 5, 0, 100);
        say(s, log, "Your manager saw the commit history. Credit restored.", { happy: 3 });
      } else {
        p.career.performance = clamp(p.career.performance - 3, 0, 100);
        say(s, log, "You let it go. It stung.", { happy: -4, karma: 1 });
      }
    },
  },
  {
    id: "cook_books",
    title: "An uncomfortable request",
    weight: (s) => (job(s) && job(s)!.rank >= 2 ? 2 : 0),
    ctx: (s) => ({ bonus: round((job(s)?.salary ?? 600000) * 0.25, -3) }),
    body: (s, c) => `Your boss at ${job(s)?.employer} wants you to "reclassify" some losses before the quarterly report. There's a ${formatINR(Number(c.bonus))} bonus if the numbers look right.`,
    options: () => [
      { id: "comply", label: "Do it", hint: "Bonus now…" },
      { id: "refuse", label: "Refuse" },
      { id: "whistle", label: "Blow the whistle" },
    ],
    resolve: (s, o, c, log) => {
      const p = s.player;
      if (o === "comply") {
        schedule(s, 6 + Math.floor(r(s) * 18), "fraud_exposed", {});
        say(s, log, "You adjusted the numbers. The bonus hit your account.", { cash: Number(c.bonus), karma: -10, stress: 6 });
      } else if (o === "refuse") {
        p.career.performance = clamp(p.career.performance - 6, 0, 100);
        say(s, log, "You refused. Your boss has been cold ever since.", { karma: 3, stress: 4 });
      } else {
        const fired = roll(s, 0.4);
        if (fired && p.career.job) {
          say(s, log, `You blew the whistle. The regulator investigated — and ${p.career.job.employer} fired you for "performance".`, { karma: 10, rep: 6, fame: 3, happy: -6 });
          p.career.job = null;
          p.career.employed = false;
        } else say(s, log, "You blew the whistle. Your boss was removed and you were praised publicly.", { karma: 10, rep: 8, fame: 4, happy: 6 });
      }
    },
  },
  {
    id: "abroad_offer",
    title: "Job offer abroad",
    weight: (s) => (s.player.age >= 22 && s.player.age < 55 ? 1 : 0),
    ctx: (s) => {
      const c = pick(() => r(s), s.world.cities.filter((x) => x.countryId !== s.player.countryId));
      if (!c) return null;
      return { city: c.id, cityName: c.name, country: c.countryId, salary: round(c.avgWage * (1.2 + r(s)), -3) };
    },
    body: (s, c) => `A recruiter offers you a role in ${c.cityName} (${s.world.countries.find((x) => x.id === c.country)?.name}) at ${formatINR(Number(c.salary))} a year, with a work visa and relocation paid.`,
    options: () => [
      { id: "go", label: "Pack your bags" },
      { id: "no", label: "Stay home" },
    ],
    resolve: (s, o, c, log) => {
      if (o !== "go") return say(s, log, "You turned down the job abroad.", {});
      const p = s.player;
      const city = s.world.cities.find((x) => x.id === c.city);
      if (!city) return;
      p.countryId = city.countryId;
      p.cityId = city.id;
      p.visa = p.citizenship.includes(city.countryId) ? "citizen" : "work";
      p.career.job = {
        id: uid("job"),
        title: "Senior Specialist",
        industry: p.career.job?.industry ?? "technology",
        rank: Math.max(2, p.career.job?.rank ?? 2),
        countryId: city.countryId,
        cityId: city.id,
        employer: pick(() => r(s), ["Meridian Global", "Northwind Partners", "Helix Group", "Atlas Dynamics"]),
        salary: Number(c.salary),
        hours: 45,
        educationMin: 0,
        experienceMin: 0,
        skills: {},
        security: 60,
        bonusPct: 8,
        benefits: 5,
        demand: 60,
        type: "full",
      };
      p.career.employed = true;
      const L = getLife(s);
      if (!L.visited.includes(city.countryId)) L.visited.push(city.countryId);
      for (const x of L.people) if (x.alive && x.rel !== "spouse" && x.rel !== "child") x.bond = clamp(x.bond - 8, 0, 100);
      say(s, log, `Moved to ${c.cityName} for a new job.`, { happy: 6, stress: 8 });
    },
  },
  {
    id: "insider",
    title: "A hot tip",
    weight: (s) => (liquidCash(s.player) > 200000 ? 1.5 : 0),
    ctx: (s) => {
      const co = pick(() => r(s), s.world.companies.filter((c) => c.listed && c.stage !== "bankrupt"));
      if (!co) return null;
      return { ticker: co.ticker, name: co.name, amt: round(Math.max(100000, liquidCash(s.player) * 0.2), -3) };
    },
    body: (_s, c) => `A friend on the board of ${c.name} (${c.ticker}) whispers that a takeover will be announced next week. "Buy now. Trust me."`,
    options: (_s, c) => [
      { id: "trade", label: `Put ${formatINR(Number(c.amt))} into ${c.ticker}`, hint: "Insider trading is a crime" },
      { id: "no", label: "Pretend you never heard it" },
    ],
    resolve: (s, o, c, log) => {
      if (o !== "trade") return say(s, log, "You didn't trade on the tip.", { karma: 2 });
      const amt = Number(c.amt);
      const profit = round(amt * (0.25 + r(s) * 0.35), 0);
      schedule(s, 3 + Math.floor(r(s) * 12), "insider_probe", { profit });
      say(s, log, `You traded on inside information and made ${formatINR(profit)} in a week.`, { cash: profit, karma: -8 }, `Trading gains · ${c.ticker}`);
    },
  },

  /* ---------------------------------------------------------- love & family */
  {
    id: "flirt",
    title: "Someone's flirting",
    weight: (s) => (s.player.age >= 17 && s.player.age < 70 ? 2 : 0),
    ctx: (s) => {
      const c = newPerson(s, "partner", clamp(s.player.age + Math.round((r(s) - 0.5) * 10), 17, 80));
      getLife(s).candidates = [c];
      return { id: c.id, name: c.name, age: c.age, looks: c.looks, job: c.job };
    },
    body: (s, c) => {
      const ptn = partnerOf(getLife(s));
      return `${c.name} (${c.age}, ${c.job}, looks ${c.looks}/100) has been flirting with you all evening.${ptn ? ` You're with ${ptn.name}.` : ""}`;
    },
    options: (s) => {
      const ptn = partnerOf(getLife(s));
      return [
        { id: "date", label: ptn ? "Start an affair" : "Ask them out", hint: ptn ? "Karma −, discovery risk" : undefined },
        { id: "friend", label: "Just be friends" },
        { id: "no", label: "Politely decline" },
      ];
    },
    resolve: (s, o, c, log) => {
      const L = getLife(s);
      const cand = L.candidates.find((x) => x.id === c.id);
      L.candidates = [];
      if (!cand) return;
      if (o === "date") {
        const ptn = partnerOf(L);
        cand.rel = "partner";
        cand.bond = 55;
        L.people.push(cand);
        if (ptn) {
          schedule(s, 2 + Math.floor(r(s) * 10), "affair_found", { partnerId: ptn.id, loverId: cand.id });
          say(s, log, `You started an affair with ${cand.name}.`, { karma: -10, happy: 5 });
        } else say(s, log, `You started dating ${cand.name}.`, { happy: 8 });
      } else if (o === "friend") {
        cand.rel = "friend";
        cand.bond = 45;
        L.people.push(cand);
        say(s, log, `You and ${cand.name} became friends.`, { happy: 2 });
      } else say(s, log, `You declined ${cand.name}'s advances.`, { karma: 1 });
    },
  },
  {
    id: "move_in",
    title: "Next step?",
    weight: (s, L) => {
      const p = partnerOf(L);
      return p && p.rel === "partner" && s.time.year - p.since >= 1 ? 2 : 0;
    },
    ctx: (s, L) => ({ id: partnerOf(L)!.id, name: partnerOf(L)!.name }),
    body: (_s, c) => `${c.name} asks where this relationship is going. They want to get engaged.`,
    options: () => [
      { id: "yes", label: "Get engaged" },
      { id: "wait", label: "Not yet" },
      { id: "end", label: "End it" },
    ],
    resolve: (s, o, c, log) => {
      const t = person(s, c.id);
      if (!t) return;
      if (o === "yes") {
        t.rel = "fiance";
        t.bond = clamp(t.bond + 12, 0, 100);
        say(s, log, `Engaged to ${t.name}!`, { happy: 12 });
      } else if (o === "wait") {
        t.bond = clamp(t.bond - 10, 0, 100);
        say(s, log, `You told ${t.name} you need more time.`, { stress: 3 });
      } else {
        t.rel = "ex";
        say(s, log, `You ended things with ${t.name}.`, { happy: -6 });
      }
    },
  },
  {
    id: "baby_talk",
    title: "The baby question",
    weight: (s, L) => {
      const p = partnerOf(L);
      return p && p.rel === "spouse" && s.player.age < 48 ? 2 : 0;
    },
    ctx: (_s, L) => ({ id: partnerOf(L)!.id, name: partnerOf(L)!.name }),
    body: (_s, c) => `${c.name} wants to start a family — or grow it.`,
    options: () => [
      { id: "yes", label: "Let's try" },
      { id: "adopt", label: "Let's adopt" },
      { id: "no", label: "Not now" },
    ],
    resolve: (s, o, c, log) => {
      const t = person(s, c.id);
      if (!t) return;
      if (o === "yes") {
        if (roll(s, 0.6)) {
          const kid = addChild(s, t);
          t.bond = clamp(t.bond + 10, 0, 100);
          say(s, log, `${kid.name} was born!`, { happy: 14, stress: 6 });
        } else say(s, log, "You tried for a baby. Not this year.", { stress: 3 });
      } else if (o === "adopt") {
        if (!pay(s, 350000, "Adoption fees")) return void log.push("Adoption costs ₹3.5 L.");
        const kid = addChild(s, t, true);
        kid.age = Math.floor(r(s) * 5);
        say(s, log, `You adopted ${kid.name}.`, { happy: 12, karma: 4 });
      } else {
        t.bond = clamp(t.bond - 12, 0, 100);
        say(s, log, `You told ${t.name} not now. They're hurt.`, { stress: 4 });
      }
    },
  },
  {
    id: "partner_cheats",
    title: "Lipstick on the collar",
    weight: (_s, L) => (partnerOf(L) && partnerOf(L)!.bond < 55 ? 1.5 : 0),
    ctx: (_s, L) => ({ id: partnerOf(L)!.id, name: partnerOf(L)!.name, rel: partnerOf(L)!.rel }),
    body: (_s, c) => `You found messages on ${c.name}'s phone. They've been seeing someone else.`,
    options: (_s, c) => [
      { id: "forgive", label: "Forgive them" },
      { id: "confront", label: "Confront them" },
      { id: "leave", label: c.rel === "spouse" ? "File for divorce" : "Dump them" },
    ],
    resolve: (s, o, c, log) => {
      const t = person(s, c.id);
      if (!t) return;
      if (o === "forgive") {
        t.bond = clamp(t.bond + 5, 0, 100);
        say(s, log, `You forgave ${t.name}.`, { happy: -8, karma: 3 });
      } else if (o === "confront") {
        t.bond = clamp(t.bond - 10, 0, 100);
        say(s, log, `You confronted ${t.name}. They promised it's over.`, { happy: -6, stress: 8 });
      } else if (t.rel === "spouse") {
        // their affair → a court is kinder to you
        t.prenup = true;
        divorce(s, t, log, false);
      } else {
        t.rel = "ex";
        say(s, log, `You dumped ${t.name} for cheating.`, { happy: -8 });
      }
    },
  },
  {
    id: "parent_sick",
    title: "Hospital call",
    weight: (_s, L) => (L.people.some((x) => x.alive && (x.rel === "mother" || x.rel === "father") && x.age > 55) ? 2 : 0),
    ctx: (s, L) => {
      const par = pick(() => r(s), L.people.filter((x) => x.alive && (x.rel === "mother" || x.rel === "father") && x.age > 55));
      if (!par) return null;
      return { id: par.id, name: par.name, bill: round(300000 + r(s) * 1_200_000, -4) };
    },
    body: (_s, c) => `Your parent ${c.name} needs heart surgery. The best hospital wants ${formatINR(Number(c.bill))}; the public hospital has a nine-month waiting list.`,
    options: (_s, c) => [
      { id: "pay", label: `Pay ${formatINR(Number(c.bill))}` },
      { id: "public", label: "Public hospital" },
    ],
    resolve: (s, o, c, log) => {
      const t = person(s, c.id);
      if (!t) return;
      if (o === "pay") {
        if (!pay(s, Number(c.bill), `Surgery for ${t.name}`)) return void log.push("You couldn't cover the bill.");
        t.bond = clamp(t.bond + 20, 0, 100);
        const lived = roll(s, 0.92);
        if (!lived) t.alive = false;
        say(s, log, lived ? `${t.name}'s surgery was a success.` : `Despite the best care, ${t.name} died on the table.`, lived ? { happy: 6, karma: 5 } : { happy: -18 });
      } else {
        const lived = roll(s, 0.6);
        if (!lived) t.alive = false;
        say(s, log, lived ? `${t.name} survived the wait and the surgery.` : `${t.name} died waiting for surgery.`, lived ? { stress: 4 } : { happy: -20, stress: 10 });
      }
    },
  },
  {
    id: "sibling_bail",
    title: "Your sibling calls from jail",
    weight: (_s, L) => (L.people.some((x) => x.alive && x.rel === "sibling" && x.age >= 18) ? 1 : 0),
    ctx: (s, L) => {
      const sib = pick(() => r(s), L.people.filter((x) => x.alive && x.rel === "sibling" && x.age >= 18));
      if (!sib) return null;
      return { id: sib.id, name: sib.name, bail: round(50000 + r(s) * 200000, -3) };
    },
    body: (_s, c) => `${c.name} was arrested after a bar fight. Bail is ${formatINR(Number(c.bail))}.`,
    options: (_s, c) => [
      { id: "bail", label: `Pay ${formatINR(Number(c.bail))} bail` },
      { id: "no", label: "Let them sit" },
    ],
    resolve: (s, o, c, log) => {
      const t = person(s, c.id);
      if (!t) return;
      if (o === "bail") {
        if (!pay(s, Number(c.bail), `Bail for ${t.name}`)) return void log.push("You couldn't raise the bail.");
        t.bond = clamp(t.bond + 20, 0, 100);
        say(s, log, `You bailed ${t.name} out.`, { karma: 3 });
      } else {
        t.bond = clamp(t.bond - 25, 0, 100);
        say(s, log, `You left ${t.name} in a cell. They won't forget.`, { karma: -2 });
      }
    },
  },
  {
    id: "child_money",
    title: "Your kid needs help",
    weight: (_s, L) => (L.people.some((x) => x.alive && x.rel === "child" && x.age >= 18) ? 1.5 : 0),
    ctx: (s, L) => {
      const k = pick(() => r(s), L.people.filter((x) => x.alive && x.rel === "child" && x.age >= 18));
      if (!k) return null;
      return { id: k.id, name: k.name, amt: round(Math.max(100000, wage(s) * 0.8), -3), why: pick(() => r(s), ["a startup idea", "a master's degree", "a down payment on a flat", "paying off credit cards"]) };
    },
    body: (_s, c) => `${c.name} asks for ${formatINR(Number(c.amt))} for ${c.why}.`,
    options: () => [
      { id: "give", label: "Give it" },
      { id: "loan", label: "Lend it (with terms)" },
      { id: "no", label: "Tough love: no" },
    ],
    resolve: (s, o, c, log) => {
      const t = person(s, c.id);
      if (!t) return;
      const amt = Number(c.amt);
      if (o === "no") {
        t.bond = clamp(t.bond - 10, 0, 100);
        return say(s, log, `You told ${t.name} to stand on their own feet.`, {});
      }
      if (!pay(s, amt, `Help for ${t.name}`)) return void log.push("You can't spare it.");
      t.wealth += amt;
      t.bond = clamp(t.bond + (o === "give" ? 15 : 6), 0, 100);
      if (o === "loan") schedule(s, 12 + Math.floor(r(s) * 12), "friend_repay", { id: t.id, name: t.name, amt });
      say(s, log, `You ${o === "give" ? "gave" : "lent"} ${t.name} ${formatINR(amt)} for ${c.why}.`, { happy: 3 });
    },
  },
  {
    id: "stray",
    title: "A stray",
    weight: (_s, L) => (L.pets.filter((x) => x.alive).length < 3 ? 1.5 : 0),
    ctx: (s) => ({ species: pick(() => r(s), ["dog", "cat"]) }),
    body: (_s, c) => `A skinny stray ${c.species} has followed you home three nights in a row.`,
    options: () => [
      { id: "adopt", label: "Take it in" },
      { id: "shelter", label: "Drive it to a shelter" },
      { id: "shoo", label: "Shoo it away" },
    ],
    resolve: (s, o, c, log) => {
      if (o === "adopt") {
        const L = getLife(s);
        const name = pick(() => r(s), ["Lucky", "Scraps", "Rusty", "Button", "Ghost"]);
        L.pets.push({ id: uid("pet"), name, species: c.species as "dog" | "cat", age: 2, bond: 75, alive: true });
        say(s, log, `You adopted the stray ${c.species} and named it ${name}.`, { happy: 8, karma: 5, cash: -4000 });
      } else if (o === "shelter") say(s, log, `You took the ${c.species} to a shelter.`, { karma: 2 });
      else say(s, log, `You shooed the ${c.species} away.`, { karma: -3 });
    },
  },

  /* ---------------------------------------------------------- health */
  {
    id: "illness",
    title: "Feeling off",
    weight: (s) => 1 + (s.player.age > 45 ? 1.5 : 0) + (s.player.health < 50 ? 1.5 : 0),
    ctx: (s) => {
      const list = [
        { n: "Flu", sev: 3, fatal: 0 },
        { n: "Depression", sev: 5, fatal: 0 },
        { n: "Diabetes", sev: 6, fatal: 0 },
        { n: "High blood pressure", sev: 4, fatal: 0 },
        { n: "Pneumonia", sev: 7, fatal: 1 },
        { n: "Kidney stones", sev: 5, fatal: 0 },
        { n: "Cancer", sev: 10, fatal: 1 },
      ];
      const pickN = s.player.age > 50 ? list : list.filter((x) => x.n !== "Cancer");
      const it = pick(() => r(s), pickN)!;
      return { n: it.n, sev: it.sev, fatal: it.fatal };
    },
    body: (_s, c) => `You've been unwell for weeks. Tests show ${String(c.n).toLowerCase()}.`,
    options: (s, c) => [
      { id: "treat", label: "Start treatment now", hint: `≈${formatINR(Number(c.sev) * Number(c.sev) * 3500 * (s.player.insurance.health ? 0.2 : 1))}${s.player.insurance.health ? " after insurance" : ""}` },
      { id: "ignore", label: "Ignore it", hint: Number(c.fatal) ? "Can be fatal untreated" : "Health drains every month" },
      { id: "alt", label: "Try alternative medicine" },
    ],
    resolve: (s, o, c, log) => {
      const sev = Number(c.sev);
      const name = String(c.n);
      if (o === "treat") {
        const bill = Math.round(sev * sev * 3500 * (s.player.insurance.health ? 0.2 : 1));
        if (!pay(s, bill, `Treatment: ${name}`)) {
          addIllness(s, name, sev, Boolean(Number(c.fatal)));
          return void log.push(`Treatment costs ${formatINR(bill)} and you couldn't pay. The illness is untreated — visit a doctor from Activities when you can.`);
        }
        const cured = roll(s, clamp(0.92 - sev * 0.04 + luck(s), 0.3, 0.97));
        if (!cured) addIllness(s, name, Math.max(1, sev - 3), Boolean(Number(c.fatal)));
        say(s, log, cured ? `Treated for ${name.toLowerCase()} and fully recovered.` : `Treatment helped, but ${name.toLowerCase()} lingers. Keep seeing the doctor.`, { health: cured ? 2 : -3 });
      } else if (o === "ignore") {
        addIllness(s, name, sev, Boolean(Number(c.fatal)));
        say(s, log, `You ignored your ${name.toLowerCase()}.`, { health: -4 });
      } else {
        addIllness(s, name, sev + 1, Boolean(Number(c.fatal)));
        say(s, log, "Crystals and herbal tea did nothing. You're worse.", { cash: -15000, health: -5, smarts: -1 });
      }
    },
  },
  {
    id: "gamble_urge",
    title: "The itch",
    weight: (_s, L) => (L.addiction.gambling > 35 ? 3 : 0),
    body: () => "You can't stop thinking about the tables. Your hands itch. One more session and you'll win it all back.",
    options: (s) => [
      { id: "go", label: `Go to the casino (bet ${formatINR(Math.max(10000, Math.round(liquidCash(s.player) * 0.1)))})` },
      { id: "resist", label: "Resist" },
      { id: "help", label: "Call a helpline" },
    ],
    resolve: (s, o, _c, log) => {
      const stake = Math.max(10000, Math.round(liquidCash(s.player) * 0.1));
      if (o === "go") {
        const win = roll(s, 0.42);
        say(s, log, win ? "You won — and the itch got worse." : "You lost it all. Again.", { cash: win ? stake : -stake, gambling: 10, happy: win ? 4 : -8 });
      } else if (o === "resist") say(s, log, "You resisted the urge.", { gambling: -8, stress: 4 });
      else say(s, log, "You called a helpline and joined a support group.", { gambling: -20, karma: 2, happy: 2 });
    },
  },

  /* ---------------------------------------------------------- wealth & fame */
  {
    id: "gala",
    title: "Charity gala",
    weight: (s) => (rich(s) > 5e7 ? 2 : 0),
    ctx: (s) => ({ ticket: round(Math.max(500000, rich(s) * 0.002), -4) }),
    body: (_s, c) => `You're invited to the Aurelion Foundation gala. Table: ${formatINR(Number(c.ticket))}. Ministers, founders and cameras will be there.`,
    options: () => [
      { id: "go", label: "Buy a table" },
      { id: "auction", label: "Go and bid big in the charity auction" },
      { id: "no", label: "Decline" },
    ],
    resolve: (s, o, c, log) => {
      const t = Number(c.ticket);
      if (o === "go") {
        if (!pay(s, t, "Gala table")) return void log.push("Out of budget.");
        s.player.network.push({ id: uid("npc"), name: pick(() => r(s), ["Minister Holt", "Sera Lindholm", "Anton Reznik"]), role: "power broker", closeness: 30 });
        say(s, log, "You worked the gala room. Useful people now know your name.", { fame: 3, rep: 3, karma: 2 });
      } else if (o === "auction") {
        if (!pay(s, t * 4, "Gala + auction lot")) return void log.push("Out of budget.");
        say(s, log, "Your auction bid made the evening news.", { fame: 7, rep: 5, karma: 6 });
      } else say(s, log, "You skipped the gala.", {});
    },
  },
  {
    id: "kidnap",
    title: "A threat",
    weight: (s) => (rich(s) > 5e8 ? 1 : 0),
    body: () => "Your security consultant intercepted chatter: a crew is planning to kidnap you for ransom.",
    options: (s) => [
      { id: "guards", label: `Hire bodyguards (${formatINR(Math.max(2_000_000, Math.round(rich(s) * 0.001)))})` },
      { id: "ignore", label: "It's probably nothing" },
    ],
    resolve: (s, o, _c, log) => {
      if (o === "guards") {
        say(s, log, "You hired a protection detail. Nothing happened — which was the point.", { cash: -Math.max(2_000_000, Math.round(rich(s) * 0.001)), stress: -3 });
      } else if (roll(s, 0.35)) {
        const ransom = round(Math.min(liquidCash(s.player) * 0.3, rich(s) * 0.05), -4);
        say(s, log, `You were kidnapped and held for nine days. Ransom paid: ${formatINR(ransom)}.`, { cash: -ransom, health: -15, happy: -20, stress: 25, fame: 8 });
      } else say(s, log, "It really was nothing. This time.", {});
    },
  },
  {
    id: "viral",
    title: "You went viral",
    weight: (s) => (s.player.social.followers > 1000 || getLife(s).fame > 10 ? 1.5 : 0),
    body: () => "A clip of you went viral overnight. Brands are emailing. So are trolls.",
    options: () => [
      { id: "cash", label: "Take a sponsorship deal" },
      { id: "lean", label: "Lean into it — post more" },
      { id: "hide", label: "Go dark for a while" },
    ],
    resolve: (s, o, _c, log) => {
      const p = s.player;
      if (o === "cash") say(s, log, "You signed a sponsorship.", { cash: round(20000 + p.social.followers * 2, -3), fame: 3 });
      else if (o === "lean") {
        for (const pl of p.social.platforms) pl.followers = Math.round(pl.followers * 1.4 + 2000);
        say(s, log, "Followers surged.", { fame: 6, stress: 4 });
      } else say(s, log, "You went quiet until it blew over.", { stress: -3, fame: -2 });
    },
  },
  {
    id: "midlife",
    title: "Midlife crisis",
    weight: (s) => (s.player.age >= 40 && s.player.age <= 55 ? 1.5 : 0),
    cooldown: 15,
    body: () => "You wake up at 3 a.m. wondering what it's all been for.",
    options: () => [
      { id: "car", label: "Buy a red sports car (₹90 L)" },
      { id: "trip", label: "Solo motorbike trip across three countries (₹6 L)" },
      { id: "therapy", label: "Talk to someone" },
      { id: "quit", label: "Quit your job to 'find yourself'" },
    ],
    resolve: (s, o, _c, log) => {
      const L = getLife(s);
      if (o === "car") {
        if (!pay(s, 9_000_000, "Red sports car")) return void log.push("The bank said no. Crisis deepens.");
        L.vehicles.push({ id: uid("veh"), modelId: "roadster", name: "Rosso Veloce roadster", kind: "car", price: 9_000_000, value: 9_000_000, condition: 100, yearBought: s.time.year, charter: false, lastIncome: 0 });
        say(s, log, "You bought a red sports car. You felt 25 again, briefly.", { happy: 10, looks: 1 });
      } else if (o === "trip") say(s, log, "Three countries, one motorbike, zero regrets.", { cash: -600000, happy: 14, stress: -12, health: 2 });
      else if (o === "therapy") say(s, log, "Therapy helped you see what matters.", { cash: -24000, happy: 8, stress: -10 });
      else if (s.player.career.job) {
        s.player.career.job = null;
        s.player.career.employed = false;
        say(s, log, "You quit your job to find yourself. No salary from here on.", { happy: 6, stress: -15 });
      } else say(s, log, "You spent the year wandering. It helped a little.", { happy: 4, stress: -6 });
    },
  },
  {
    id: "inheritance",
    title: "A letter from a lawyer",
    weight: () => 0.5,
    cooldown: 50,
    ctx: (s) => ({ amt: round(wage(s) * (0.5 + r(s) * r(s) * 20), -4), who: pick(() => r(s), ["a great-aunt", "a godfather", "a former teacher", "an old neighbour"]) }),
    body: (_s, c) => `${String(c.who).replace(/^./, (x) => x.toUpperCase())} you barely remember left you ${formatINR(Number(c.amt))} in their will. A cousin is contesting it.`,
    options: () => [
      { id: "fight", label: "Fight for all of it", hint: "Legal fees, win or lose" },
      { id: "split", label: "Split it with the cousin" },
    ],
    resolve: (s, o, c, log) => {
      const amt = Number(c.amt);
      if (o === "split") return say(s, log, `You split the inheritance with your cousin.`, { cash: round(amt / 2, 0), karma: 4 });
      const win = roll(s, 0.6 + luck(s));
      say(s, log, win ? "You won the contest and kept the inheritance." : "You lost in court and paid the legal bills.", win ? { cash: amt - 80000 } : { cash: -80000, happy: -4 });
    },
  },
  {
    id: "neighbour",
    title: "Neighbour dispute",
    weight: (s) => (s.player.properties.length ? 1.5 : 0.6),
    body: () => "Your neighbour's tree has cracked your boundary wall. They refuse to pay and are threatening to sue YOU for noise.",
    options: () => [
      { id: "sue", label: "Sue them (₹1.2 L legal costs)" },
      { id: "talk", label: "Talk it out over tea" },
      { id: "pay", label: "Fix it yourself (₹45,000)" },
    ],
    resolve: (s, o, _c, log) => {
      if (o === "sue") {
        const win = roll(s, 0.55 + getLife(s).smarts / 400);
        say(s, log, win ? "You won in small-claims court. They paid your costs and the repair." : "You lost the suit and paid both sides' costs.", win ? { cash: 45000, happy: 3 } : { cash: -240000, happy: -5 });
        getLife(s).people.push({ ...newPerson(s, "enemy", s.player.age + 5), bond: 5 });
      } else if (o === "talk") {
        const ok = roll(s, 0.5 + (getLife(s).karma - 50) / 200);
        say(s, log, ok ? "Over tea you agreed to split the cost. Nice neighbour, actually." : "Tea turned into shouting.", ok ? { cash: -22500, karma: 2 } : { stress: 6 });
      } else say(s, log, "You paid to fix it and moved on.", { cash: -45000 });
    },
  },
  {
    id: "tax_audit",
    title: "Tax audit",
    weight: (s) => (s.player.finances.monthlyIncome * 12 > 3_000_000 ? 1.2 : 0),
    body: () => "The Revenue Service has selected your returns for audit.",
    options: () => [
      { id: "acct", label: "Hire a top accountant (₹3 L)" },
      { id: "self", label: "Handle it yourself" },
    ],
    resolve: (s, o, _c, log) => {
      const annual = s.player.finances.monthlyIncome * 12;
      const hole = round(annual * (0.02 + r(s) * 0.05), -3);
      if (o === "acct") say(s, log, "Your accountant closed the audit with no adjustments.", { cash: -300000, stress: -2 });
      else {
        const clean = roll(s, 0.45 + getLife(s).smarts / 250);
        say(s, log, clean ? "You defended every line. Audit closed." : `The audit found errors: back taxes and penalties of ${formatINR(hole)}.`, clean ? { smarts: 2 } : { cash: -hole, stress: 8 });
      }
    },
  },

  /* ---------------------------------------------------------- aircraft, yachts, cars */
  {
    id: "engine_warning",
    title: "Engine warning light",
    weight: (_s, L) => (L.aircraft.some((a) => a.grounded <= 0) ? 1.5 : 0),
    ctx: (s, L) => {
      const a = pick(() => r(s), L.aircraft.filter((x) => x.grounded <= 0));
      if (!a) return null;
      return { id: a.id, name: a.name, cond: Math.round(a.condition), fix: round(a.value * 0.015 + 200000, -4) };
    },
    body: (_s, c) => `Pre-flight on your ${c.name} (condition ${c.cond}%): an engine chip-detector light is on. A client flight is booked in an hour.`,
    options: (_s, c) => [
      { id: "ground", label: `Ground it and inspect (${formatINR(Number(c.fix))})` },
      { id: "fly", label: "Fly anyway", hint: "Lower condition = higher risk" },
    ],
    resolve: (s, o, c, log) => {
      const a = getLife(s).aircraft.find((x) => x.id === c.id);
      if (!a) return;
      if (o === "ground") {
        if (!pay(s, Number(c.fix), `Inspection · ${a.name}`, "aviation")) {
          a.grounded = 2;
          return say(s, log, `You couldn't pay for the inspection, so the ${a.name} sits grounded.`, { stress: 4 });
        }
        a.condition = clamp(a.condition + 8, 0, 100);
        a.grounded = 1;
        say(s, log, `Inspection found a failing bearing on the ${a.name}. Caught in time.`, { karma: 2 });
      } else {
        const risk = clamp((100 - a.condition) / 250, 0.02, 0.4);
        if (roll(s, risk)) {
          const loss = round(a.value * 0.35, -4);
          a.condition = clamp(a.condition - 40, 0, 100);
          a.grounded = 4;
          a.value = round(a.value * 0.7, 0);
          say(s, log, `The engine failed on climb-out. The crew made an emergency landing; the ${a.name} is badly damaged and the passengers are suing.`, { cash: -round(loss * 0.3, 0), rep: -8, fame: 3, stress: 15 });
          news(s, `Emergency landing for private jet ${a.tail}`, "Investigators are examining maintenance records after an engine failure on climb-out.", "aviation", s.player.countryId, "Operator faces lawsuits and grounding.");
        } else say(s, log, `You flew anyway. The ${a.name} held together — this time.`, { karma: -3, stress: 4 });
      }
    },
  },
  {
    id: "yacht_storm",
    title: "Storm warning",
    weight: (_s, L) => (L.vehicles.some((v) => v.kind === "yacht") ? 1.2 : 0),
    ctx: (s, L) => {
      const y = pick(() => r(s), L.vehicles.filter((v) => v.kind === "yacht"));
      return y ? { id: y.id, name: y.name } : null;
    },
    body: (_s, c) => `A storm is rolling in while your ${c.name} is anchored off the coast with guests aboard.`,
    options: () => [
      { id: "port", label: "Run for port now" },
      { id: "ride", label: "Ride it out at anchor" },
    ],
    resolve: (s, o, c, log) => {
      const y = getLife(s).vehicles.find((v) => v.id === c.id);
      if (!y) return;
      const skill = getLife(s).licenses.includes("boat") ? 0.1 : 0;
      if (o === "port") say(s, log, `You made port before the storm hit.`, { stress: 3 });
      else if (roll(s, 0.35 - skill)) {
        y.condition = clamp(y.condition - 35, 0, 100);
        y.value = round(y.value * 0.8, 0);
        say(s, log, `The anchor dragged and the ${y.name} was holed on the rocks.`, { stress: 12, happy: -6 });
      } else say(s, log, `The ${y.name} rode out the storm. Guests will talk about it for years.`, { fame: 1, happy: 3 });
    },
  },
  {
    id: "no_licence_stop",
    title: "Blue lights",
    weight: (_s, L) => (L.vehicles.some((v) => v.kind === "car" || v.kind === "bike") && !L.licenses.includes("driver") ? 2 : 0),
    body: () => "Police pull you over for a broken tail-light and ask for your driver's licence. You don't have one.",
    options: () => [
      { id: "truth", label: "Tell the truth" },
      { id: "bribe", label: "Offer ₹10,000 to 'sort it out'", hint: "Bribery is a crime" },
      { id: "flee", label: "Floor it" },
    ],
    resolve: (s, o, _c, log) => {
      const L = getLife(s);
      if (o === "truth") say(s, log, "Fined for driving without a licence.", { cash: -25000, rep: -1 });
      else if (o === "bribe") {
        if (roll(s, 0.5)) say(s, log, "The officer pocketed the cash and waved you on.", { cash: -10000, karma: -5 });
        else {
          L.record.push(`Attempted bribery of an officer (${s.time.year})`);
          say(s, log, "The officer arrested you for attempted bribery.", { cash: -150000, heat: 15, rep: -6 });
        }
      } else if (roll(s, 0.7)) {
        L.record.push(`Evading police (${s.time.year})`);
        sentence(s, 6, "evading police");
        log.push("You were caught after a chase and jailed for six months.");
      } else say(s, log, "You lost them in traffic. Heart racing.", { heat: 20, karma: -5 });
    },
  },

  /* ---------------------------------------------------------- prison */
  {
    id: "prison_yard",
    title: "The yard",
    weight: (s) => (inPrison(s) ? 6 : 0),
    body: () => "A gang leader in the yard tells you to hand over your commissary — or else.",
    options: () => [
      { id: "fight", label: "Fight" },
      { id: "pay", label: "Pay him off" },
      { id: "guard", label: "Tell a guard" },
    ],
    resolve: (s, o, _c, log) => {
      const pr = getLife(s).prison;
      if (o === "fight") {
        const win = roll(s, 0.35 + (s.player.health - 50) / 150);
        if (pr) pr.monthsLeft += win ? 0 : 3;
        say(s, log, win ? "You won. Nobody tries you now." : "You lost the fight and got three months added for brawling.", win ? { happy: 4, health: -5 } : { health: -15, happy: -6 });
      } else if (o === "pay") say(s, log, "You paid him off.", { cash: -5000, happy: -3 });
      else {
        if (pr) pr.behavior = clamp(pr.behavior + 10, 0, 100);
        say(s, log, "The guard moved you to another block. Some call you a snitch.", { stress: 6 });
      }
    },
  },
  {
    id: "parole",
    title: "Parole hearing",
    weight: (s, L) => (inPrison(s) && L.prison!.monthsLeft > 6 && L.prison!.monthsLeft < L.prison!.totalMonths * 0.6 ? 4 : 0),
    body: (s) => `Your parole hearing is today. Behaviour score: ${Math.round(getLife(s).prison?.behavior ?? 50)}/100.`,
    options: () => [
      { id: "remorse", label: "Express genuine remorse" },
      { id: "innocent", label: "Maintain your innocence" },
    ],
    resolve: (s, o, _c, log) => {
      const L = getLife(s);
      const pr = L.prison;
      if (!pr) return;
      const pChance = clamp(pr.behavior / 100 + (o === "remorse" ? 0.15 : -0.1) + luck(s), 0.05, 0.9);
      if (roll(s, pChance)) {
        L.prison = null;
        say(s, log, "Parole granted. You walked out into the sunlight.", { happy: 15 });
      } else say(s, log, "Parole denied.", { happy: -6 });
    },
  },
];

const DEFS = new Map(EVENTS.map((e) => [e.id, e]));

/** Maybe raise a life event. Birthdays almost always bring one; months in
 *  between occasionally do. */
export function maybeLifeEvent(state: GameState, birthday: boolean) {
  const p = state.player;
  if (!p.alive || state.pending.length) return;
  const L = getLife(state);
  const chanceNow = birthday ? 0.85 : 0.035;
  if (r(state) > chanceNow) return;
  const jailed = inPrison(state);
  const year = state.time.year;
  const pool = EVENTS.map((e) => {
    const isPrison = e.id.startsWith("prison") || e.id === "parole";
    if (jailed !== isPrison && !(jailed && e.id === "illness")) return { e, w: 0 };
    const seen = L.eventsSeen[e.id];
    if (seen !== undefined && year - seen < (e.cooldown ?? 3)) return { e, w: 0 };
    return { e, w: Math.max(0, e.weight(state, L)) };
  }).filter((x) => x.w > 0);
  const total = pool.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return;
  let pickV = r(state) * total;
  let def = pool[0]!.e;
  for (const x of pool) {
    pickV -= x.w;
    if (pickV <= 0) {
      def = x.e;
      break;
    }
  }
  const ctx = def.ctx ? def.ctx(state, L) : {};
  if (ctx === null) return;
  L.eventsSeen[def.id] = year;
  L.lastEventTick = state.ticks;
  const d: Decision = {
    id: uid("dec"),
    kind: "life",
    title: typeof def.title === "function" ? def.title(state, ctx) : def.title,
    body: def.body(state, ctx),
    year,
    month: state.time.month,
    options: def.options(state, ctx),
    context: { eventId: def.id, ...ctx },
  };
  state.pending.push(d);
}

export function resolveLifeEvent(state: GameState, d: Decision, optionId: string, log: string[]) {
  const def = DEFS.get(String(d.context.eventId));
  if (!def) return;
  def.resolve(state, optionId, d.context as Ctx, log);
}

/* ---------------------------------------------------------- delayed consequences */

export function tickConsequences(state: GameState) {
  const L = getLife(state);
  if (!L.consequences.length || !state.player.alive) return;
  const due = L.consequences.filter((c) => c.dueTick <= state.ticks);
  if (!due.length) return;
  L.consequences = L.consequences.filter((c) => c.dueTick > state.ticks);
  for (const c of due) runConsequence(state, c.kind, c.data);
}

function consequenceNote(state: GameState, text: string, e: Effects, tone: "good" | "bad" | "warn" = "bad") {
  const fx = applyEffects(state, e, text.slice(0, 60));
  timeline(state, text, "consequence");
  note(state, `${text}${fx ? ` (${fx})` : ""}`, tone);
}

function runConsequence(state: GameState, kind: string, data: Record<string, number | string>) {
  const p = state.player;
  const L = getLife(state);
  const date = formatDate(state.time.year, state.time.month);
  switch (kind) {
    case "cheat_caught": {
      if (r(state) > 0.35) return;
      if (p.currentStudy) {
        consequenceNote(state, `The exam-cheating ring was exposed. You were expelled from ${p.currentStudy.institution}.`, { happy: -12, rep: -6, karma: -3 });
        p.currentStudy.inProgress = false;
        p.currentStudy = null;
      } else consequenceNote(state, "Your old exam-cheating was exposed. Your degree is under review and employers have heard.", { rep: -8, happy: -6 });
      L.record.push(`Academic fraud (${state.time.year})`);
      break;
    }
    case "friend_repay": {
      const amt = money(data.amt);
      const f = L.people.find((x) => x.id === String(data.id));
      if (r(state) < 0.6 + (f ? f.bond / 400 : 0)) {
        consequenceNote(state, `${data.name} paid back the ${formatINR(amt)} you lent them.`, { cash: amt, happy: 3 }, "good");
        if (f) f.bond = clamp(f.bond + 8, 0, 100);
      } else {
        consequenceNote(state, `${data.name} stopped answering your calls. The ${formatINR(amt)} is gone.`, { happy: -5 });
        if (f) f.bond = clamp(f.bond - 25, 0, 100);
      }
      break;
    }
    case "scheme_payout": {
      const amt = money(data.amt);
      consequenceNote(state, `The investment club paid a "return" of ${formatINR(round(amt * 0.08, 0))}. Everyone's excited.`, { cash: round(amt * 0.08, 0), happy: 3 }, "good");
      break;
    }
    case "scheme_collapse": {
      const amt = money(data.amt);
      const back = round(amt * (r(state) * 0.15), 0);
      consequenceNote(state, `${data.name}'s investment club collapsed — it was a Ponzi scheme. You recovered ${formatINR(back)} of ${formatINR(amt)}.`, { cash: back, happy: -12, stress: 10 });
      ledger(state, "Ponzi scheme loss", back - amt);
      break;
    }
    case "hitrun_caught": {
      if (r(state) > 0.3) return;
      L.record.push(`Hit and run — property damage (${state.time.year})`);
      consequenceNote(state, "Traffic cameras identified your car in the hit-and-run. Fined and your licence points went up.", { cash: -180000, rep: -4, heat: 5 });
      break;
    }
    case "fraud_exposed": {
      if (r(state) > 0.45) return;
      const fine = round(Math.max(500000, liquidCash(p) * 0.15), -3);
      if (p.career.job) {
        p.career.job = null;
        p.career.employed = false;
      }
      L.record.push(`Securities fraud (${state.time.year})`);
      consequenceNote(state, `Auditors unravelled the doctored accounts. You were fired and fined ${formatINR(fine)}.`, { cash: -fine, rep: -15, happy: -15, fame: 4 });
      if (r(state) < 0.35) sentence(state, 18 + Math.floor(r(state) * 30), "securities fraud");
      news(state, `Accounting scandal: ${p.name} named in fraud probe`, "Regulators allege losses were deliberately reclassified to hit targets.", "business", p.countryId, "Executives face fines and possible prison.");
      break;
    }
    case "insider_probe": {
      if (r(state) > 0.4) return;
      const profit = money(data.profit);
      const fine = round(profit * 3, -3);
      L.record.push(`Insider trading (${state.time.year})`);
      consequenceNote(state, `The Securities Board traced your trade. Insider trading: fined ${formatINR(fine)} (3× the gain).`, { cash: -fine, rep: -12, heat: 10 });
      if (r(state) < 0.25) sentence(state, 12 + Math.floor(r(state) * 24), "insider trading");
      break;
    }
    case "affair_found": {
      const ptn = L.people.find((x) => x.id === String(data.partnerId));
      const lover = L.people.find((x) => x.id === String(data.loverId));
      if (!ptn || !ptn.alive || (ptn.rel !== "partner" && ptn.rel !== "fiance" && ptn.rel !== "spouse")) return;
      if (!lover || lover.rel === "ex") return;
      if (r(state) > 0.55) {
        schedule(state, 6 + Math.floor(r(state) * 12), "affair_found", data);
        return;
      }
      if (ptn.rel === "spouse") {
        timeline(state, `${ptn.name} found out about your affair with ${lover.name}.`, "love");
        const log: string[] = [];
        divorce(state, ptn, log, true);
      } else {
        ptn.rel = "ex";
        consequenceNote(state, `${ptn.name} found out about ${lover.name} and dumped you.`, { happy: -12 });
      }
      applyEffects(state, { karma: -5, rep: -3 });
      break;
    }
    default:
      void date;
      void credit;
  }
}

export function lifeEventCount(): number {
  return EVENTS.length;
}

export type { Person };
