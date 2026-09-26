import { getLife } from "./life";
import {
  CITY_DEFS,
  COMPANY_PREFIX,
  COMPANY_SUFFIX,
  COUNTRY_DEFS,
  FIRST_NAMES,
  INDUSTRIES,
  LAST_NAMES,
  MODES,
  PARTY_DEFS,
  SKILLS,
  SOCIAL_PLATFORMS,
  emptySkills,
  makeJobsForCity,
} from "./catalog";
import { initAdv } from "./advanced";
import { monthlyLoanPayment } from "./finance";
import type {
  Appearance,
  BankInst,
  BondIssue,
  City,
  Country,
  FundIssue,
  GameMode,
  GameState,
  Grant,
  ListedCompany,
  NewGameInput,
  Personality,
  Player,
  PolicyVector,
  PropertyListing,
  RelationLevel,
  WorldNpc,
} from "./types";
import { clamp, hashSeed, jitter, mulberry32, pick, round, uid } from "./util";

const REL: RelationLevel[] = ["friendly", "cordial", "neutral", "tense", "hostile"];

function defaultTraits(): Personality {
  return { risk: 50, ambition: 55, discipline: 50, negotiation: 45, leadership: 45, creativity: 50, patience: 50, frugality: 50 };
}

function defaultAppearance(): Appearance {
  return { skin: "#c68642", hair: "#2c1b12", eyes: "#3d2914", style: "sharp", portrait: "gold" };
}

function centrist(): PolicyVector {
  return {
    tax: 50, welfare: 50, business: 50, education: 55, healthcare: 55, housing: 50,
    technology: 55, infrastructure: 55, environment: 50, crime: 50, immigration: 50, trade: 55, spending: 50,
  };
}

export function createGame(input: NewGameInput): GameState {
  const seed = input.seed ? hashSeed(input.seed) : hashSeed(`${input.name}:${input.mode}:${Date.now()}:${Math.random()}`);
  const seedLabel = input.seed ? String(input.seed) : `w${seed.toString(36)}`;
  const rng = mulberry32(seed);
  const mode = input.mode;
  const modeDef = MODES.find((m) => m.id === mode)!;

  const countries: Country[] = COUNTRY_DEFS.map((d) => {
    const relations: Record<string, RelationLevel> = {};
    for (const o of COUNTRY_DEFS) {
      if (o.id === d.id) continue;
      relations[o.id] = REL[Math.floor(rng() * 3) + (d.blocs.some((b) => o.blocs.includes(b)) ? 0 : 1)] ?? "neutral";
    }
    return {
      ...d,
      gdp: d.gdp,
      cycle: rng() * Math.PI * 2,
      revenue: d.gdp * 0.28 / 12,
      spending: d.gdp * 0.30 / 12,
      approval: 48 + rng() * 16,
      relations,
    };
  });

  const cities: City[] = CITY_DEFS.map((c) => ({
    ...c,
    jobs: Math.round(c.population * 0.42),
    demand: 50 + c.businessActivity * 0.3 + c.tech * 0.1,
  }));

  const companies = buildCompanies(countries, cities, rng);
  const banks = buildBanks(countries, rng);
  const insurers = countries.map((c) => ({
    id: `ins_${c.id}`,
    name: `${c.adjective} Shield`,
    countryId: c.id,
    premiums: c.gdp * 0.004,
    claims: c.gdp * 0.0032,
    reserves: c.gdp * 0.01,
    playerOwned: false,
  }));

  const parties = PARTY_DEFS.map((p) => ({
    ...p,
    funds: 2e7 + rng() * 8e7,
    members: Math.round(80000 + rng() * 400000),
    playerCreated: false,
  }));

  const politicians = parties.map((p) => ({
    id: `pol_${p.id}`,
    name: p.leader,
    countryId: p.countryId,
    partyId: p.id,
    office: countries.find((c) => c.rulingPartyId === p.id) ? "Head of Government" : "Opposition",
    popularity: p.popularity,
    funds: p.funds * 0.2,
    scandal: rng() * 8,
    experience: 8 + rng() * 20,
    player: false,
  }));

  const grants = buildGrants(countries, rng);
  const bonds = buildBonds(countries, companies, rng);
  const funds = buildFunds(companies);
  const jobs = cities.flatMap((city) => {
    const country = countries.find((c) => c.id === city.countryId)!;
    return makeJobsForCity(city, country, 22);
  });
  const properties = buildProperties(cities, countries, rng);
  const npcs = buildNpcs(countries, rng);

  let countryId = input.countryId || "indara";
  if (!countries.some((c) => c.id === countryId)) countryId = "indara";
  const homeCities = cities.filter((c) => c.countryId === countryId);
  const cityId = input.cityId && homeCities.some((c) => c.id === input.cityId) ? input.cityId : homeCities[0]!.id;

  const player = buildPlayer(input, modeDef, countryId, cityId, countries, cities, jobs, companies, rng);

  if (mode === "leader") {
    const c = countries.find((x) => x.id === countryId)!;
    c.headOfGov = player.name;
    player.politics.role = "head";
    player.politics.office = "Head of Government";
    player.politics.countryId = countryId;
    player.politics.popularity = 52;
    const party = parties.find((p) => p.id === c.rulingPartyId);
    if (party) {
      player.politics.partyId = party.id;
      player.politics.partyName = party.name;
      party.leader = player.name;
    }
  }

  if (mode === "rich") {
    const listing = properties.find((p) => p.cityId === cityId && p.kind === "house") ?? properties.find((p) => p.cityId === cityId);
    if (listing) {
      player.properties.push({
        id: listing.id,
        name: listing.name,
        kind: listing.kind,
        countryId: listing.countryId,
        cityId: listing.cityId,
        district: listing.district,
        size: listing.size,
        condition: listing.condition,
        purchasePrice: listing.price,
        value: listing.price,
        rent: 0,
        occupancy: 0,
        maintenance: listing.price * 0.004,
        tax: listing.price * 0.001,
        mortgaged: false,
        yearBought: 2026,
      });
      const idx = properties.findIndex((p) => p.id === listing.id);
      if (idx >= 0) properties.splice(idx, 1);
    }
  }

  if (mode === "investor") {
    const picks = companies.filter((c) => c.listed).slice(0, 6);
    for (const c of picks) {
      const shares = Math.round(20000 / Math.max(10, c.price));
      player.holdings.push({ ticker: c.ticker, shares, avgCost: c.price });
      player.finances.cash -= shares * c.price;
    }
    player.finances.cash = Math.max(200000, player.finances.cash);
  }

  const state: GameState = {
    version: 1,
    seed,
    rng: seed,
    mode,
    time: { year: 2026, month: 1 },
    ticks: 0,
    player,
    world: {
      countries,
      cities,
      companies,
      banks,
      insurers,
      parties,
      politicians,
      grants,
      opportunities: [],
      bonds,
      funds,
      jobs,
      properties,
      casinos: [],
      con: {
        session: 81,
        resolutions: [
          { id: "res_open", title: "Open research sharing on frontier models", status: "proposed", yes: 4, no: 3, abstain: 2 },
          { id: "res_trade", title: "Reduce industrial tariffs among Concord members", status: "proposed", yes: 5, no: 4, abstain: 0 },
        ],
        agencies: [
          { name: "Concord Development Bank", budget: 4.2e10, focus: "infrastructure" },
          { name: "World Health Compact", budget: 1.8e10, focus: "healthcare" },
          { name: "Frontier Science Office", budget: 9e9, focus: "technology" },
          { name: "Humanitarian Relief Desk", budget: 7e9, focus: "aid" },
        ],
        blocs: [
          { name: "Tech Accord", members: ["aurelia", "zhenhua", "kairos"] },
          { name: "Green Compact", members: ["nordmark", "meridia"] },
          { name: "Energy Forum", members: ["solara", "palmyra"] },
          { name: "Monsoon Compact", members: ["indara"] },
          { name: "Atlantic Ring", members: ["aurelia"] },
          { name: "Heartland Pact", members: ["vardania", "ostara"] },
        ],
      },
      tech: { internet: 92, smartphones: 88, cloud: 70, ai: 38, robotics: 28, automation: 32, renewables: 41, manufacturing: 55 },
      npcs,
      indexHistory: [{ t: "January 2026", v: 10000 }],
      fxHistory: countries.map((c) => ({ t: "January 2026", code: c.currency.code, v: c.fx })),
    },
    news: [
      {
        id: uid("news"),
        year: 2026,
        month: 1,
        headline: "A new year opens across ten capitals",
        body: "Markets, ministries and households begin 2026 under mixed growth, cooling inflation in Aurelia, and a restless startup boom in Indara's Techpur.",
        tag: "world",
        countryId: countryId,
        impact: "The simulation is live. Every number will now move.",
      },
    ],
    pending: [],
    timeline: [
      {
        id: uid("tl"),
        year: 2026,
        month: 1,
        age: player.age,
        text: `${player.name} begins a life in ${cities.find((c) => c.id === cityId)?.name}, ${countries.find((c) => c.id === countryId)?.name}.`,
        kind: "life",
      },
    ],
    notifications: [
      { id: uid("n"), text: "The world is running. Live a month when you are ready.", tone: "info", year: 2026, month: 1 },
    ],
    history: [],
    achievements: [],
    autoSave: true,
    lastSave: new Date().toISOString(),
    successorUsed: false,
  };

  state.seedLabel = seedLabel;
  applyScenario(state, input.scenarioId);
  state.adv = initAdv(state, seedLabel);
  getLife(state);
  return state;
}

function grantStarterCompany(state: GameState, opts: { name: string; ticker: string; industry: ListedCompany["industry"]; product: string; revenue: number; profit: number; cash: number; debt: number; distressed?: boolean }): ListedCompany {
  const p = state.player;
  const c = state.world.countries.find((x) => x.id === p.countryId)!;
  const city = state.world.cities.find((x) => x.id === p.cityId)!;
  const co: ListedCompany = {
    id: uid("co"),
    name: opts.name,
    ticker: opts.ticker,
    industry: opts.industry,
    countryId: c.id,
    cityId: city.id,
    npc: false,
    public: false,
    foundedYear: state.time.year,
    revenue: opts.revenue,
    costs: opts.revenue - opts.profit,
    profit: opts.profit,
    cash: opts.cash,
    assets: Math.max(opts.cash, opts.revenue * 0.4),
    debt: opts.debt,
    employees: Math.max(3, Math.round(opts.revenue / 300000)),
    customers: Math.round(opts.revenue / 800),
    churn: 0.1,
    quality: 45,
    priceLevel: 55,
    marketing: 20,
    rd: 10,
    marketShare: 1.2,
    valuation: Math.max(2e6, opts.revenue * 8),
    shares: 1_000_000,
    price: Math.max(1, Math.round((Math.max(2e6, opts.revenue * 8) / 1_000_000) * 100) / 100),
    prevPrice: 0,
    pe: 25,
    growth: opts.profit > 0 ? 4 : -8,
    dividend: 0,
    sentiment: 48,
    stage: opts.distressed ? "distressed" : "startup",
    product: opts.product,
    model: "Services",
    shareholders: [{ id: uid("sh"), name: p.name, type: "player", shares: 1_000_000 }],
    departments: {},
    ceo: p.name,
    playerCeo: true,
    playerRole: "founder",
    history: [],
    listed: false,
    forSale: false,
    askingPrice: 0,
    distressed: !!opts.distressed,
  };
  state.world.companies.push(co);
  p.ownedCompanyIds.push(co.id);
  return co;
}

function applyScenario(state: GameState, id?: string) {
  if (!id) return;
  const p = state.player;
  switch (id) {
    case "poor_student":
      p.finances.cash = 5000;
      p.educationLevel = 1;
      break;
    case "middle_class":
      p.finances.cash = 150000;
      p.educationLevel = 2;
      break;
    case "wealthy_inheritance":
      p.finances.cash = 5e7;
      p.educationLevel = 3;
      break;
    case "rural":
      p.finances.cash = 15000;
      p.educationLevel = 1;
      break;
    case "urban":
      p.finances.cash = 90000;
      p.educationLevel = 2;
      break;
    case "skilled_worker":
      p.finances.cash = 60000;
      p.skills.programming = Math.max(p.skills.programming ?? 0, 55);
      break;
    case "failing_business":
      p.finances.cash = 80000;
      grantStarterCompany(state, { name: "Old Mill Works", ticker: "OMW", industry: "manufacturing", product: "Legacy parts", revenue: 900000, profit: -260000, cash: 250000, debt: 600000, distressed: true });
      p.career.employed = false;
      p.career.job = null;
      break;
    case "gov_employee": {
      p.finances.cash = 120000;
      p.educationLevel = 3;
      const c = state.world.countries.find((x) => x.id === p.countryId)!;
      const city = state.world.cities.find((x) => x.id === p.cityId)!;
      const job = {
        id: uid("job"),
        title: "Government officer",
        industry: "legal" as const,
        rank: 2,
        countryId: c.id,
        cityId: city.id,
        employer: "Civil Service",
        salary: 900000,
        hours: 42,
        educationMin: 3,
        experienceMin: 0,
        skills: { politics: 30, writing: 30 } as Partial<Record<string, number>>,
        security: 90,
        bonusPct: 6,
        benefits: 70,
        demand: 50,
        type: "full" as const,
      };
      p.career.job = job;
      p.career.employed = true;
      p.career.yearsInRole = 3;
      p.career.experience = 3;
      break;
    }
    case "business_owner":
      p.finances.cash = 300000;
      grantStarterCompany(state, { name: "Corner & Co Stores", ticker: "CNC", industry: "retail", product: "General retail", revenue: 1400000, profit: 180000, cash: 700000, debt: 200000 });
      break;
    default:
      break;
  }
}

function buildPlayer(
  input: NewGameInput,
  modeDef: (typeof MODES)[number],
  countryId: string,
  cityId: string,
  countries: Country[],
  cities: City[],
  jobs: GameState["world"]["jobs"],
  companies: ListedCompany[],
  rng: () => number,
): Player {
  let age = input.age || modeDef.age;
  let wealth = input.wealth || modeDef.wealth;
  let edu = input.educationLevel || modeDef.edu;
  const traits = { ...defaultTraits(), ...input.traits };
  if (input.mode === "random") {
    age = 16 + Math.floor(rng() * 28);
    wealth = Math.round(rng() * rng() * 8e6);
    edu = 1 + Math.floor(rng() * 4);
    for (const k of Object.keys(traits) as (keyof Personality)[]) traits[k] = Math.round(20 + rng() * 70);
  }
  const birthYear = 2026 - age;
  const skills = emptySkills();
  const trackBoost = edu >= 3 ? 18 : edu >= 2 ? 8 : 2;
  for (const s of SKILLS) skills[s.id] = Math.round(4 + rng() * 10 + (traits.discipline / 25) + (edu >= 3 ? 6 : 0));
  if (input.mode === "entrepreneur") {
    skills.entrepreneurship = 42; skills.sales = 35; skills.programming = 28; skills.finance = 30;
  }
  if (input.mode === "politician") {
    skills.politics = 48; skills.speaking = 44; skills.leadership = 40; skills.writing = 36; edu = 4;
  }
  if (input.mode === "investor") {
    skills.finance = 55; skills.accounting = 40; skills.data = 38; skills.negotiation = 40;
  }
  if (input.mode === "crime") {
    skills.negotiation = 30; skills.operations = 22;
  }
  const country = countries.find((c) => c.id === countryId)!;
  const bankName = `${country.adjective} National Bank`;
  const cash = Math.round(wealth * 0.65);
  const savings = Math.round(wealth * 0.35);
  const player: Player = {
    id: uid("pl"),
    name: input.name.trim() || "Alex Rivera",
    appearance: { ...defaultAppearance(), ...input.appearance },
    nationality: input.nationality || country.adjective,
    countryId,
    cityId,
    residency: countryId,
    citizenship: [countryId],
    visa: "citizen",
    age,
    birthYear,
    birthMonth: 1 + Math.floor(rng() * 12),
    health: 78 + rng() * 16,
    energy: 80,
    stress: 20,
    happiness: 60,
    alive: true,
    causeOfDeath: null,
    educationLevel: edu,
    education: edu >= 2 ? [{
      id: uid("edu"),
      level: "secondary",
      name: "Secondary certificate",
      track: "general",
      institution: `${cities.find((c) => c.id === cityId)?.name} Higher Secondary`,
      countryId,
      startYear: birthYear + 14,
      endYear: birthYear + 18,
      tuition: 0,
      scholarship: 0,
      loan: 0,
      gpa: 3.1 + rng() * 0.7,
      completed: true,
      inProgress: false,
    }] : [],
    currentStudy: null,
    skills,
    traits,
    career: {
      employed: false,
      job: null,
      yearsInRole: 0,
      experience: Math.max(0, age - 18) * (edu >= 3 ? 1.1 : 0.7),
      performance: 50,
      freelance: { active: false, rate: 0, hours: 0, industry: null },
      internships: [],
      history: [],
    },
    finances: {
      cash,
      accounts: [{
        id: uid("acct"),
        bankId: `bank_${countryId}`,
        bankName,
        countryId,
        type: "savings",
        currency: country.currency.code,
        balance: savings,
        interestRate: country.interestRate * 0.35,
        fee: 0,
        transactions: [{
          id: uid("tx"),
          date: "January 2026",
          desc: "Opening deposit",
          amount: savings,
          bal: savings,
          cat: "transfer",
        }],
      }],
      loans: [],
      creditScore: 640 + Math.round(edu * 20) + (wealth > 1e6 ? 80 : 0),
      paymentHistory: 80,
      defaults: 0,
      monthlyIncome: 0,
      monthlyExpenses: 0,
      livingCost: 16000,
      taxPaidYtd: 0,
      arrears: 0,
      netWorthHistory: [{ t: "January 2026", v: wealth }],
      incomeHistory: [{ t: "January 2026", v: 0 }],
    },
    properties: [],
    ownedCompanyIds: [],
    holdings: [],
    bonds: [],
    funds: [],
    politics: {
      partyId: null,
      partyName: null,
      role: input.mode === "politician" ? "member" : "none",
      office: null,
      countryId: input.mode === "politician" ? countryId : null,
      popularity: input.mode === "politician" ? 18 : 5,
      campaignCash: input.mode === "politician" ? 250000 : 0,
      platform: centrist(),
      elections: [],
      billsProposed: 0,
    },
    crime: {
      path: input.mode === "crime",
      heat: input.mode === "crime" ? 12 : 0,
      evidence: 0,
      organizationId: null,
      role: input.mode === "crime" ? "solo" : "none",
      moneyFromCrime: 0,
      arrests: 0,
      convictions: 0,
      wanted: false,
    },
    social: {
      platforms: SOCIAL_PLATFORMS.map((p) => ({ platform: p.id, handle: `@${input.name.split(" ")[0]?.toLowerCase() || "player"}`, followers: Math.round(rng() * 80), posts: 0, engagement: 2 })),
      followers: 40,
      brand: 5,
    },
    media: { outlets: [] },
    family: {
      members: [
        { id: uid("fam"), name: `${pick(rng, LAST_NAMES) === input.name.split(" ")[1] ? "Ravi" : pick(rng, FIRST_NAMES)} ${input.name.split(" ")[1] || pick(rng, LAST_NAMES)}`, relation: "parent", age: age + 26 + Math.floor(rng() * 8), alive: true, wealth: wealth * 0.4, countryId },
        { id: uid("fam"), name: `${pick(rng, FIRST_NAMES)} ${input.name.split(" ")[1] || pick(rng, LAST_NAMES)}`, relation: "parent", age: age + 24 + Math.floor(rng() * 8), alive: true, wealth: wealth * 0.3, countryId },
      ],
      generation: 1,
      willHeirId: null,
      estatePlan: "chosen",
    },
    orgs: [],
    network: [
      { id: uid("npc"), name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`, role: "mentor", closeness: 40 },
      { id: uid("npc"), name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`, role: "friend", closeness: 55 },
    ],
    reputation: {
      personal: 50,
      business: 20,
      professional: 25,
      political: input.mode === "politician" || input.mode === "leader" ? 40 : 5,
      social: 10,
      media: 5,
      criminal: input.mode === "crime" ? 15 : 0,
    },
    influence: {
      financial: Math.min(40, wealth / 5e5),
      business: 5,
      political: input.mode === "leader" ? 70 : input.mode === "politician" ? 25 : 2,
      media: 2,
      social: 4,
      international: 1,
    },
    gambling: { lifetimeWagered: 0, lifetimeWon: 0, lifetimeLost: 0, bankrollSessions: 0, lastGame: null },
    insurance: { life: false, property: false, health: edu >= 3, premium: edu >= 3 ? 2200 : 0 },
    contracts: [],
  };

  if (edu >= 3) {
    player.education.push({
      id: uid("edu"),
      level: "university",
      name: edu >= 4 ? "Graduate studies" : "Bachelor's programme",
      track: input.mode === "politician" ? "law" : input.mode === "investor" ? "finance" : input.mode === "entrepreneur" ? "business" : "general",
      institution: `${country.capital} University`,
      countryId,
      startYear: birthYear + 18,
      endYear: input.mode === "entrepreneur" || age < 22 ? null : birthYear + 22,
      tuition: 180000,
      scholarship: 40000,
      loan: 0,
      gpa: 3.2,
      completed: age >= 22 && input.mode !== "entrepreneur",
      inProgress: age < 22,
    });
    if (age < 22) player.currentStudy = player.education[player.education.length - 1]!;
    skills.math += trackBoost;
  }

  if (input.mode === "entrepreneur" && player.finances.cash > 80000) {
    // leave cash for founding
  }

  void jobs;
  void companies;
  void monthlyLoanPayment;
  void jitter;
  void clamp;
  void round;
  return player;
}

function buildCompanies(countries: Country[], cities: City[], rng: () => number): ListedCompany[] {
  const list: ListedCompany[] = [];
  let n = 0;
  for (const city of cities) {
    const country = countries.find((c) => c.id === city.countryId)!;
    const count = city.population > 8e6 ? 5 : city.population > 2e6 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const ind = INDUSTRIES[(n * 5 + i) % INDUSTRIES.length]!;
      const name = `${COMPANY_PREFIX[(n + i) % COMPANY_PREFIX.length]} ${COMPANY_SUFFIX[(n * 3 + i) % COMPANY_SUFFIX.length]}`;
      const ticker = `${name.replace(/[^A-Z]/gi, "").slice(0, 2).toUpperCase()}${ind.id.slice(0, 2).toUpperCase()}${n % 9}`;
      const revenue = jitter(rng, city.avgWage * 800 * ind.wage * (1 + city.businessActivity / 80), 0.4);
      const margin = 0.06 + rng() * 0.18;
      const profit = revenue * margin;
      const employees = Math.max(40, Math.round(revenue / (city.avgWage * 1.8)));
      const shares = 1e7 + Math.round(rng() * 5e7);
      const pe = ind.pe * (0.8 + rng() * 0.5);
      const price = Math.max(12, (profit * pe) / shares * 12);
      const valuation = price * shares;
      list.push({
        id: uid("co"),
        name,
        ticker,
        industry: ind.id,
        countryId: country.id,
        cityId: city.id,
        npc: true,
        public: true,
        foundedYear: 1988 + Math.floor(rng() * 35),
        revenue,
        costs: revenue - profit,
        profit,
        cash: revenue * 0.12,
        assets: revenue * 1.4,
        debt: revenue * 0.4,
        employees,
        customers: Math.round(employees * (40 + rng() * 80)),
        churn: 0.02 + rng() * 0.04,
        quality: 45 + rng() * 40,
        priceLevel: 90 + rng() * 30,
        marketing: 8 + rng() * 10,
        rd: 4 + rng() * 12,
        marketShare: 2 + rng() * 12,
        valuation,
        shares,
        price: round(price, 2),
        prevPrice: round(price, 2),
        pe,
        growth: country.gdpGrowth * 0.6 + rng() * 4,
        dividend: margin > 0.12 ? round(price * 0.018, 2) : 0,
        sentiment: 50 + rng() * 10,
        stage: "public",
        product: `${ind.name} platform`,
        model: "b2b",
        shareholders: [{ id: "pub", name: "Public float", type: "public", shares }],
        departments: { engineering: 30, sales: 20, ops: 25, finance: 10, legal: 5, hr: 10 },
        ceo: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
        playerCeo: false,
        playerRole: "none",
        listed: true,
        forSale: rng() < 0.08,
        askingPrice: valuation * (0.7 + rng() * 0.4),
        distressed: false,
        history: [{ t: "January 2026", price: round(price, 2), revenue, profit }],
        ai: ind.id === "ai" ? { compute: 40 + rng() * 40, modelQuality: 50 + rng() * 30, apiUsage: 20, infraCost: revenue * 0.08 } : undefined,
        supply: ["manufacturing", "logistics", "retail", "energy"].includes(ind.id)
          ? { inventory: 50 + rng() * 40, utilization: 70 + rng() * 20, shortage: rng() * 10 }
          : undefined,
      });
      n++;
    }
  }
  return list;
}

function buildBanks(countries: Country[], rng: () => number): BankInst[] {
  return countries.flatMap((c) => [
    {
      id: `bank_${c.id}`,
      name: `${c.adjective} National Bank`,
      countryId: c.id,
      deposits: c.gdp * 0.18,
      loans: c.gdp * 0.14,
      capital: c.gdp * 0.02,
      npl: 1.5 + rng() * 3,
      savingsRate: c.interestRate * 0.35,
      lendingRate: c.interestRate + 3.2,
      playerOwned: false,
      branches: 40 + Math.floor(rng() * 200),
      profit: c.gdp * 0.001,
    },
    {
      id: `bank_${c.id}_civic`,
      name: `${c.capital} Civic Credit`,
      countryId: c.id,
      deposits: c.gdp * 0.06,
      loans: c.gdp * 0.05,
      capital: c.gdp * 0.007,
      npl: 2 + rng() * 4,
      savingsRate: c.interestRate * 0.4,
      lendingRate: c.interestRate + 4.1,
      playerOwned: false,
      branches: 12 + Math.floor(rng() * 40),
      profit: c.gdp * 0.0003,
    },
  ]);
}

function buildGrants(countries: Country[], rng: () => number): Grant[] {
  const kinds: Grant["kind"][] = ["startup", "innovation", "youth", "green", "research", "housing", "export", "regional", "education", "ai"];
  const grants: Grant[] = [];
  for (const c of countries) {
    for (const kind of kinds) {
      if (rng() > 0.72 && kind !== "startup" && kind !== "ai") continue;
      const amount = Math.round(jitter(rng, 400000 + (kind === "ai" ? 1200000 : 0) + c.gdp / 1e10, 0.5));
      grants.push({
        id: uid("grant"),
        name: `${c.adjective} ${kind.replace("_", " ")} ${kind === "ai" ? "frontier" : "programme"}`,
        kind,
        countryId: c.id,
        amount: Math.max(80000, amount),
        equity: kind === "startup" ? 0 : 0,
        eligibility: kind === "youth" ? "Age under 30, registered venture" : kind === "ai" ? "AI product, technical team" : "Registered firm or eligible individual",
        prob: 0.12 + rng() * 0.25,
        deadlineYear: 2026,
        deadlineMonth: 2 + Math.floor(rng() * 10),
        competition: 40 + rng() * 50,
        milestones: "Quarterly reporting, job creation, eligible spend",
        open: true,
      });
    }
  }
  return grants;
}

function buildBonds(countries: Country[], companies: ListedCompany[], rng: () => number): BondIssue[] {
  const bonds: BondIssue[] = countries.map((c) => ({
    id: uid("bd"),
    name: `${c.name} 10Y`,
    kind: "gov" as const,
    issuer: c.name,
    countryId: c.id,
    face: 1000,
    coupon: round(c.interestRate * 0.85, 2),
    yield: round(c.interestRate, 2),
    maturityYear: 2036,
    price: round(1000 * (1 - (c.interestRate - 4) * 0.02), 2),
    risk: clamp(c.debt / c.gdp * 40, 5, 70),
  }));
  for (const co of companies.slice(0, 18)) {
    bonds.push({
      id: uid("bd"),
      name: `${co.ticker} 7Y`,
      kind: "corp",
      issuer: co.name,
      countryId: co.countryId,
      face: 1000,
      coupon: round(6 + rng() * 4, 2),
      yield: round(6.5 + rng() * 4, 2),
      maturityYear: 2033,
      price: round(980 + rng() * 40, 2),
      risk: 20 + rng() * 40,
    });
  }
  for (const c of countries) {
    bonds.push({
      id: uid("bd"),
      name: `${c.capital} Metro 8Y`,
      kind: "muni",
      issuer: c.capital,
      countryId: c.id,
      face: 1000,
      coupon: round(c.interestRate * 0.7, 2),
      yield: round(c.interestRate * 0.9, 2),
      maturityYear: 2034,
      price: 1000,
      risk: 18,
    });
  }
  return bonds;
}

function buildFunds(companies: ListedCompany[]): FundIssue[] {
  return [
    { id: "fund_world", name: "Concord World Index", kind: "index", nav: 100, prev: 100, holdings: companies.slice(0, 40).map((c) => c.ticker), expense: 0.15 },
    { id: "fund_tech", name: "Frontier Tech Basket", kind: "tech", nav: 100, prev: 100, holdings: companies.filter((c) => ["ai", "technology", "software", "cybersecurity"].includes(c.industry)).map((c) => c.ticker), expense: 0.45 },
    { id: "fund_re", name: "Stone & Sky REIT", kind: "realestate", nav: 100, prev: 100, holdings: companies.filter((c) => c.industry === "realestate").map((c) => c.ticker), expense: 0.55 },
    { id: "fund_sec", name: "Industrial Sector Fund", kind: "sector", nav: 100, prev: 100, holdings: companies.filter((c) => ["manufacturing", "energy", "logistics"].includes(c.industry)).map((c) => c.ticker), expense: 0.4 },
    { id: "fund_gl", name: "Three Oceans Global", kind: "global", nav: 100, prev: 100, holdings: companies.filter((_, i) => i % 3 === 0).map((c) => c.ticker), expense: 0.35 },
  ];
}

function buildProperties(cities: City[], countries: Country[], rng: () => number): PropertyListing[] {
  const kinds: PropertyListing["kind"][] = ["house", "apartment", "land", "office", "shop", "warehouse", "factory", "hotel", "commercial"];
  const districts = ["Old Quarter", "Riverside", "Tech Park", "Lakeview", "Docklands", "Hillcrest", "Central", "North Gate"];
  const list: PropertyListing[] = [];
  for (const city of cities) {
    const country = countries.find((c) => c.id === city.countryId)!;
    for (let i = 0; i < 7; i++) {
      const kind = kinds[i % kinds.length]!;
      const size = kind === "land" ? 800 + rng() * 4000 : kind === "factory" ? 2000 : kind === "apartment" ? 70 + rng() * 80 : 120 + rng() * 220;
      const base = city.avgWage * 8 * (city.propertyIndex / 100) * (kind === "land" ? 0.6 : kind === "apartment" ? 0.7 : kind === "factory" ? 2.4 : 1);
      const price = Math.round(jitter(rng, base * (size / 100), 0.25));
      list.push({
        id: uid("pr"),
        name: `${pick(rng, districts)} ${kind}`,
        kind,
        countryId: country.id,
        cityId: city.id,
        district: pick(rng, districts),
        size: Math.round(size),
        condition: 50 + rng() * 45,
        price,
        rent: Math.round(price * (0.004 + rng() * 0.003)),
        occupancy: 50 + rng() * 45,
        distressed: rng() < 0.08,
      });
    }
  }
  return list;
}

function buildNpcs(countries: Country[], rng: () => number): WorldNpc[] {
  const roles = ["investor", "entrepreneur", "journalist", "banker", "lawyer", "academic", "official", "ceo"];
  const npcs: WorldNpc[] = [];
  for (const c of countries) {
    for (let i = 0; i < 6; i++) {
      npcs.push({
        id: uid("wn"),
        name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
        role: roles[i % roles.length]!,
        countryId: c.id,
        wealth: jitter(rng, 2e7, 0.8),
        ambition: 30 + rng() * 60,
      });
    }
  }
  return npcs;
}

export function randomPortrait(rng: () => number): Appearance {
  const skins = ["#f6d7c3", "#e0ac69", "#c68642", "#8d5524", "#5c3317"];
  const hairs = ["#1a120b", "#3b2219", "#6b3a2a", "#2c2c2c", "#d1b184"];
  const eyes = ["#3d2914", "#245b4a", "#2b4c7e", "#4a3728"];
  const styles = ["sharp", "soft", "classic", "modern"];
  const portraits = ["gold", "teal", "rose", "violet", "slate"];
  return {
    skin: pick(rng, skins),
    hair: pick(rng, hairs),
    eyes: pick(rng, eyes),
    style: pick(rng, styles),
    portrait: pick(rng, portraits),
  };
}

export type { GameMode };
