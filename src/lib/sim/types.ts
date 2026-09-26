import type { AdvState, Forecast } from "./advanced";
import type { InteractKind, LifeState } from "./life";
import type { RouletteBet } from "./casino";
import type { BizState } from "./biz";

export type GameMode =
  | "normal"
  | "zero"
  | "rich"
  | "entrepreneur"
  | "politician"
  | "investor"
  | "crime"
  | "random"
  | "leader"
  | "sandbox";

export type Industry =
  | "technology"
  | "ai"
  | "software"
  | "gaming"
  | "retail"
  | "ecommerce"
  | "restaurants"
  | "hotels"
  | "construction"
  | "manufacturing"
  | "logistics"
  | "energy"
  | "agriculture"
  | "education"
  | "media"
  | "advertising"
  | "finance"
  | "insurance"
  | "banking"
  | "realestate"
  | "entertainment"
  | "healthcare"
  | "legal"
  | "cybersecurity"
  | "robotics"
  | "telecom"
  | "mining"
  | "tourism"
  | "casino"
  | "research";

export type SkillId =
  | "programming"
  | "ai"
  | "ml"
  | "cybersecurity"
  | "engineering"
  | "data"
  | "robotics"
  | "math"
  | "sales"
  | "marketing"
  | "accounting"
  | "finance"
  | "management"
  | "operations"
  | "negotiation"
  | "entrepreneurship"
  | "speaking"
  | "writing"
  | "journalism"
  | "politics"
  | "leadership"
  | "diplomacy"
  | "construction"
  | "realestate"
  | "manufacturing"
  | "logistics";

export type EducationTrack =
  | "general"
  | "computer_science"
  | "ai"
  | "engineering"
  | "finance"
  | "economics"
  | "law"
  | "medicine"
  | "business"
  | "marketing"
  | "design"
  | "government"
  | "journalism"
  | "real_estate"
  | "science"
  | "vocational"
  | "data_science"
  | "cybersecurity"
  | "nursing"
  | "aviation"
  | "hospitality"
  | "psychology"
  | "architecture"
  | "robotics";

export type RelationLevel = "friendly" | "cordial" | "neutral" | "tense" | "hostile";

export interface Personality {
  risk: number;
  ambition: number;
  discipline: number;
  negotiation: number;
  leadership: number;
  creativity: number;
  patience: number;
  frugality: number;
}

export interface Appearance {
  skin: string;
  hair: string;
  eyes: string;
  style: string;
  portrait: string;
}

export interface SkillMap {
  [k: string]: number;
}

export interface EducationRecord {
  id: string;
  level: "primary" | "secondary" | "vocational" | "college" | "university" | "masters" | "phd" | "certification" | "course" | "self";
  name: string;
  track: EducationTrack;
  institution: string;
  countryId: string;
  startYear: number;
  endYear: number | null;
  tuition: number;
  scholarship: number;
  loan: number;
  gpa: number;
  completed: boolean;
  inProgress: boolean;
  /** Professional certification id (level "certification"). */
  certId?: string;
  /** Tick the study started — progress is measured in months. */
  startTick?: number;
}

export interface JobListing {
  id: string;
  title: string;
  industry: Industry;
  rank: number;
  countryId: string;
  cityId: string;
  employer: string;
  employerId?: string;
  salary: number;
  hours: number;
  educationMin: number;
  experienceMin: number;
  skills: Partial<Record<SkillId, number>>;
  security: number;
  bonusPct: number;
  benefits: number;
  demand: number;
  type: "full" | "part" | "contract" | "freelance";
}

export interface CareerState {
  employed: boolean;
  job: JobListing | null;
  yearsInRole: number;
  experience: number;
  performance: number;
  freelance: { active: boolean; rate: number; hours: number; industry: Industry | null };
  internships: string[];
  history: { title: string; employer: string; start: string; end: string; salary: number }[];
}

export interface BankAccount {
  id: string;
  bankId: string;
  bankName: string;
  countryId: string;
  type: "checking" | "savings" | "business";
  currency: string;
  balance: number;
  interestRate: number;
  fee: number;
  transactions: Txn[];
}

export interface Txn {
  id: string;
  date: string;
  desc: string;
  amount: number;
  bal: number;
  cat: string;
}

export interface Loan {
  id: string;
  kind: "personal" | "education" | "home" | "car" | "business" | "startup" | "development";
  lender: string;
  principal: number;
  remaining: number;
  rate: number;
  termMonths: number;
  monthsLeft: number;
  monthly: number;
  collateral?: string;
  status: "current" | "late" | "default" | "paid";
  missed: number;
}

export interface Finances {
  cash: number;
  accounts: BankAccount[];
  loans: Loan[];
  creditScore: number;
  paymentHistory: number;
  defaults: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  livingCost: number;
  taxPaidYtd: number;
  /** Unpaid living costs carried forward. Never silently confiscated. */
  arrears: number;
  netWorthHistory: { t: string; v: number }[];
  incomeHistory: { t: string; v: number }[];
}

export interface PropertyHolding {
  id: string;
  name: string;
  kind: "house" | "apartment" | "land" | "office" | "shop" | "warehouse" | "factory" | "hotel" | "commercial";
  countryId: string;
  cityId: string;
  district: string;
  size: number;
  condition: number;
  purchasePrice: number;
  value: number;
  rent: number;
  occupancy: number;
  maintenance: number;
  tax: number;
  mortgaged: boolean;
  loanId?: string;
  yearBought: number;
  development?: {
    stage: "land" | "permits" | "building" | "complete";
    budget: number;
    spent: number;
    progress: number;
    units: number;
    delayRisk: number;
  };
}

export interface StockHolding {
  ticker: string;
  shares: number;
  avgCost: number;
}

export interface BondHolding {
  id: string;
  name: string;
  kind: "gov" | "corp" | "muni";
  face: number;
  coupon: number;
  yield: number;
  maturityYear: number;
  qty: number;
  price: number;
  issuer: string;
  risk: number;
}

export interface FundHolding {
  id: string;
  name: string;
  kind: "index" | "sector" | "realestate" | "tech" | "global";
  units: number;
  nav: number;
  avgCost: number;
}

export interface PoliticsState {
  partyId: string | null;
  partyName: string | null;
  role:
    | "none"
    | "volunteer"
    | "member"
    | "local_candidate"
    | "local_office"
    | "regional"
    | "representative"
    | "minister"
    | "party_leader"
    | "head";
  office: string | null;
  countryId: string | null;
  popularity: number;
  campaignCash: number;
  platform: PolicyVector;
  elections: ElectionRecord[];
  billsProposed: number;
}

export interface PolicyVector {
  tax: number;
  welfare: number;
  business: number;
  education: number;
  healthcare: number;
  housing: number;
  technology: number;
  infrastructure: number;
  environment: number;
  crime: number;
  immigration: number;
  trade: number;
  spending: number;
}

export interface ElectionRecord {
  year: number;
  office: string;
  result: "won" | "lost" | "withdrew";
  voteShare: number;
  turnout: number;
}

export interface CrimeState {
  path: boolean;
  heat: number;
  evidence: number;
  organizationId: string | null;
  role: "none" | "solo" | "crew" | "lieutenant" | "leader";
  moneyFromCrime: number;
  arrests: number;
  convictions: number;
  wanted: boolean;
}

export interface OrgState {
  id: string;
  kind: "criminal" | "community" | "ideological" | "cultish";
  name: string;
  doctrine: string;
  members: number;
  loyalty: number;
  reputation: number;
  funds: number;
  scrutiny: number;
  influence: number;
  facilities: number;
}

export interface SocialState {
  platforms: SocialAccount[];
  followers: number;
  brand: number;
}

export interface SocialAccount {
  platform: string;
  handle: string;
  followers: number;
  posts: number;
  engagement: number;
}

export interface MediaState {
  outlets: string[];
}

export interface FamilyMember {
  id: string;
  name: string;
  relation: "parent" | "sibling" | "child";
  age: number;
  alive: boolean;
  wealth: number;
  countryId: string;
}

export interface FamilyState {
  members: FamilyMember[];
  generation: number;
  willHeirId: string | null;
  estatePlan: "equal" | "eldest" | "chosen";
}

export interface Reputation {
  personal: number;
  business: number;
  professional: number;
  political: number;
  social: number;
  media: number;
  criminal: number;
}

export interface Influence {
  financial: number;
  business: number;
  political: number;
  media: number;
  social: number;
  international: number;
}

export interface GamblingState {
  lifetimeWagered: number;
  lifetimeWon: number;
  lifetimeLost: number;
  bankrollSessions: number;
  lastGame: string | null;
}

export interface Player {
  id: string;
  name: string;
  appearance: Appearance;
  nationality: string;
  countryId: string;
  cityId: string;
  residency: string;
  citizenship: string[];
  visa: "none" | "tourist" | "student" | "work" | "resident" | "citizen";
  age: number;
  birthYear: number;
  birthMonth: number;
  health: number;
  energy: number;
  stress: number;
  happiness: number;
  alive: boolean;
  causeOfDeath: string | null;
  educationLevel: number;
  education: EducationRecord[];
  currentStudy: EducationRecord | null;
  skills: SkillMap;
  traits: Personality;
  career: CareerState;
  finances: Finances;
  properties: PropertyHolding[];
  ownedCompanyIds: string[];
  holdings: StockHolding[];
  bonds: BondHolding[];
  funds: FundHolding[];
  politics: PoliticsState;
  crime: CrimeState;
  social: SocialState;
  media: MediaState;
  family: FamilyState;
  orgs: OrgState[];
  network: NpcRef[];
  reputation: Reputation;
  influence: Influence;
  gambling: GamblingState;
  insurance: { life: boolean; property: boolean; health: boolean; premium: number };
  contracts: Contract[];
}

export interface NpcRef {
  id: string;
  name: string;
  role: string;
  closeness: number;
}

export interface Contract {
  id: string;
  counterparty: string;
  kind: "supply" | "customer" | "gov" | "partner" | "employment";
  value: number;
  monthsLeft: number;
  penalty: number;
  performance: number;
}

export interface Country {
  id: string;
  name: string;
  adjective: string;
  capital: string;
  currency: { code: string; name: string; symbol: string };
  fx: number;
  government: "parliamentary" | "presidential" | "monarchy" | "guided" | "federation";
  population: number;
  gdp: number;
  gdpGrowth: number;
  inflation: number;
  interestRate: number;
  unemployment: number;
  corpTax: number;
  incomeTax: number;
  propertyTax: number;
  vat: number;
  debt: number;
  spending: number;
  revenue: number;
  approval: number;
  cycle: number;
  techLevel: number;
  aiAdoption: number;
  infrastructure: number;
  educationIndex: number;
  healthcareIndex: number;
  housingIndex: number;
  businessFreedom: number;
  crimeIndex: number;
  tariff: number;
  tradeBalance: number;
  policy: PolicyVector;
  rulingPartyId: string;
  headOfGov: string;
  electionYear: number;
  conMember: boolean;
  councilSeat: boolean;
  blocs: string[];
  relations: Record<string, RelationLevel>;
  color: string;
  map: { x: number; y: number; w: number; h: number };
}

export interface City {
  id: string;
  name: string;
  countryId: string;
  population: number;
  jobs: number;
  avgWage: number;
  propertyIndex: number;
  rentIndex: number;
  infrastructure: number;
  schools: number;
  transit: number;
  businessActivity: number;
  housingSupply: number;
  demand: number;
  industrial: number;
  tech: number;
  tourism: number;
  x: number;
  y: number;
}

export interface ListedCompany {
  id: string;
  name: string;
  ticker: string;
  industry: Industry;
  countryId: string;
  cityId: string;
  npc: boolean;
  founderId?: string;
  public: boolean;
  foundedYear: number;
  revenue: number;
  costs: number;
  profit: number;
  cash: number;
  assets: number;
  debt: number;
  employees: number;
  customers: number;
  churn: number;
  quality: number;
  priceLevel: number;
  marketing: number;
  rd: number;
  marketShare: number;
  valuation: number;
  shares: number;
  price: number;
  prevPrice: number;
  pe: number;
  growth: number;
  dividend: number;
  sentiment: number;
  stage: "idea" | "startup" | "growth" | "public" | "mature" | "distressed" | "bankrupt";
  product: string;
  model: string;
  shareholders: { id: string; name: string; type: "player" | "npc" | "vc" | "angel" | "public" | "employee"; shares: number }[];
  departments: Record<string, number>;
  ceo: string;
  playerCeo: boolean;
  playerRole: "none" | "founder" | "employee" | "ceo" | "board" | "owner";
  ai?: { compute: number; modelQuality: number; apiUsage: number; infraCost: number };
  supply?: { inventory: number; utilization: number; shortage: number };
  creditGrade?: string;
  history: { t: string; price: number; revenue: number; profit: number }[];
  listed: boolean;
  forSale: boolean;
  askingPrice: number;
  distressed: boolean;
  manager?: { name: string; salary: number; skill: number };
}

export interface BankInst {
  id: string;
  name: string;
  countryId: string;
  deposits: number;
  loans: number;
  capital: number;
  npl: number;
  savingsRate: number;
  lendingRate: number;
  playerOwned: boolean;
  branches: number;
  profit: number;
}

export interface Insurer {
  id: string;
  name: string;
  countryId: string;
  premiums: number;
  claims: number;
  reserves: number;
  playerOwned: boolean;
}

export interface Party {
  id: string;
  countryId: string;
  name: string;
  color: string;
  leader: string;
  seats: number;
  popularity: number;
  funds: number;
  members: number;
  platform: PolicyVector;
  playerCreated: boolean;
}

export interface Politician {
  id: string;
  name: string;
  countryId: string;
  partyId: string;
  office: string;
  popularity: number;
  funds: number;
  scandal: number;
  experience: number;
  player: boolean;
}

export interface Grant {
  id: string;
  name: string;
  kind: "startup" | "innovation" | "youth" | "green" | "research" | "housing" | "export" | "regional" | "education" | "ai";
  countryId: string;
  amount: number;
  equity: number;
  eligibility: string;
  prob: number;
  deadlineYear: number;
  deadlineMonth: number;
  competition: number;
  milestones: string;
  open: boolean;
}

export interface Opportunity {
  id: string;
  kind: "grant" | "loan" | "investor" | "incubator" | "contract" | "job" | "property" | "business" | "distressed" | "foreign";
  title: string;
  detail: string;
  countryId: string;
  value: number;
  risk: number;
  expiresTick: number;
  payload: Record<string, unknown>;
}

export interface NewsItem {
  id: string;
  year: number;
  month: number;
  headline: string;
  body: string;
  tag: string;
  countryId: string;
  impact: string;
}

export interface TimelineEntry {
  id: string;
  year: number;
  month: number;
  age: number;
  text: string;
  kind: string;
}

export interface HistoryEntry {
  id: string;
  year: number;
  month: number;
  kind: string;
  text: string;
}

export interface GameNotification {
  id: string;
  text: string;
  tone: "info" | "good" | "bad" | "warn";
  year: number;
  month: number;
}

export interface Decision {
  id: string;
  kind: string;
  title: string;
  body: string;
  year: number;
  month: number;
  options: { id: string; label: string; hint?: string }[];
  context: Record<string, unknown>;
}

export interface BondIssue {
  id: string;
  name: string;
  kind: "gov" | "corp" | "muni";
  issuer: string;
  countryId: string;
  face: number;
  coupon: number;
  yield: number;
  maturityYear: number;
  price: number;
  risk: number;
}

export interface FundIssue {
  id: string;
  name: string;
  kind: "index" | "sector" | "realestate" | "tech" | "global";
  nav: number;
  prev: number;
  holdings: string[];
  expense: number;
}

export interface CasinoBiz {
  id: string;
  name: string;
  cityId: string;
  countryId: string;
  games: string[];
  staff: number;
  security: number;
  marketing: number;
  volume: number;
  revenue: number;
  costs: number;
  regulation: number;
}

export interface ConState {
  session: number;
  resolutions: { id: string; title: string; status: "proposed" | "passed" | "failed"; yes: number; no: number; abstain: number }[];
  agencies: { name: string; budget: number; focus: string }[];
  blocs: { name: string; members: string[] }[];
}

export interface WorldTech {
  internet: number;
  smartphones: number;
  cloud: number;
  ai: number;
  robotics: number;
  automation: number;
  renewables: number;
  manufacturing: number;
}

export interface WorldState {
  countries: Country[];
  cities: City[];
  companies: ListedCompany[];
  banks: BankInst[];
  insurers: Insurer[];
  parties: Party[];
  politicians: Politician[];
  grants: Grant[];
  opportunities: Opportunity[];
  bonds: BondIssue[];
  funds: FundIssue[];
  jobs: JobListing[];
  properties: PropertyListing[];
  casinos: CasinoBiz[];
  con: ConState;
  tech: WorldTech;
  npcs: WorldNpc[];
  indexHistory: { t: string; v: number }[];
  fxHistory: { t: string; code: string; v: number }[];
}

export interface WorldNpc {
  id: string;
  name: string;
  role: string;
  countryId: string;
  wealth: number;
  ambition: number;
}

export interface PropertyListing {
  id: string;
  name: string;
  kind: PropertyHolding["kind"];
  countryId: string;
  cityId: string;
  district: string;
  size: number;
  condition: number;
  price: number;
  rent: number;
  occupancy: number;
  distressed: boolean;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  mode: GameMode;
  time: { year: number; month: number };
  ticks: number;
  player: Player;
  world: WorldState;
  news: NewsItem[];
  pending: Decision[];
  timeline: TimelineEntry[];
  notifications: GameNotification[];
  history: HistoryEntry[];
  achievements: string[];
  autoSave: boolean;
  lastSave: string;
  successorUsed: boolean;
  adv?: AdvState;
  seedLabel?: string;
  /** The BitLife layer: relationships, activities, assets, consequences. */
  life?: LifeState;
  /** Company HQs, finance firms, casino ops, estates, taxes, jobs market. */
  biz?: BizState;
}

export interface NewGameInput {
  mode: GameMode;
  name: string;
  age: number;
  countryId: string;
  cityId?: string;
  background: string;
  educationLevel: number;
  wealth: number;
  traits: Personality;
  appearance: Appearance;
  nationality?: string;
  seed?: string;
  scenarioId?: string;
}

export interface ActionResult {
  state: GameState;
  log: string[];
  error?: string;
}

export type PlayerAction =
  | { type: "tick"; months?: number }
  | { type: "study"; track: EducationTrack; level: EducationRecord["level"]; institution?: string }
  | { type: "dropStudy" }
  | { type: "selfLearn"; skill: SkillId }
  | { type: "course"; skill: SkillId }
  | { type: "applyJob"; jobId: string }
  | { type: "quitJob" }
  | { type: "freelance"; industry: Industry; hours: number }
  | { type: "stopFreelance" }
  | { type: "practice"; skill: SkillId }
  | { type: "openAccount"; bankId: string; kind: BankAccount["type"] }
  | { type: "deposit"; accountId: string; amount: number }
  | { type: "withdraw"; accountId: string; amount: number }
  | { type: "transfer"; fromId: string; toId: string; amount: number }
  | { type: "applyLoan"; kind: Loan["kind"]; amount: number; termMonths: number }
  | { type: "repayLoan"; loanId: string; amount: number }
  | { type: "buyStock"; ticker: string; shares: number }
  | { type: "sellStock"; ticker: string; shares: number }
  | { type: "buyBond"; bondId: string; qty: number }
  | { type: "sellBond"; bondId: string; qty: number }
  | { type: "buyFund"; fundId: string; amount: number }
  | { type: "sellFund"; fundId: string; units: number }
  | { type: "buyProperty"; listingId: string; mortgage: boolean }
  | { type: "sellProperty"; propertyId: string }
  | { type: "renovate"; propertyId: string; spend: number }
  | { type: "setRent"; propertyId: string; occupancyBias: number }
  | { type: "develop"; propertyId: string }
  | { type: "advanceBuild"; propertyId: string }
  | { type: "foundCompany"; payload: FoundPayload }
  | { type: "manageCompany"; companyId: string; patch: Partial<Pick<ListedCompany, "priceLevel" | "marketing" | "rd" | "quality">> & { hire?: number; fire?: number; strategy?: string } }
  | { type: "raiseFunding"; companyId: string; source: "angel" | "vc" | "bank" | "crowd" | "friends"; amount: number }
  | { type: "ipo"; companyId: string }
  | { type: "buyCompany"; companyId: string }
  | { type: "sellShares"; companyId: string; pct: number }
  | { type: "appointCeo"; companyId: string; self: boolean }
  | { type: "applyGrant"; grantId: string; companyId?: string }
  | { type: "pursueOpportunity"; opportunityId: string }
  | { type: "travel"; countryId: string; cityId: string; intent: "visit" | "study" | "work" | "move" }
  | { type: "applyResidency" }
  | { type: "applyCitizenship" }
  | { type: "fxConvert"; fromId: string; toId: string; amount: number }
  | { type: "setGoal"; goalId: string; target: number }
  | { type: "clearGoal"; goalId: string }
  | { type: "placeForecast"; topic: Forecast["topic"]; targetId?: string; direction: "up" | "down"; horizonMonths: number; stake: number }
  | { type: "cancelForecast"; forecastId: string }
  | { type: "startResearch"; topic: string; targetId?: string }
  | { type: "hireAdvisor"; advisorId: string }
  | { type: "fireAdvisor"; advisorId: string }
  | { type: "hireManager"; companyId: string }
  | { type: "fireManager"; companyId: string }
  | { type: "bidAuction"; lotId: string }
  | { type: "startChallenge"; challengeId: string }
  | { type: "abandonChallenge" }
  | { type: "dev"; op: string; args?: Record<string, number | string> }
  | { type: "joinParty"; partyId: string }
  | { type: "createParty"; name: string; platform: PolicyVector }
  | { type: "campaign"; spend: number }
  | { type: "runForOffice"; office: string }
  | { type: "setPolicy"; policy: Partial<PolicyVector> }
  | { type: "proposeBill"; topic: string; magnitude: number }
  | { type: "appointMinister"; name: string }
  | { type: "conVote"; resolutionId: string; vote: "yes" | "no" | "abstain" }
  | { type: "conPropose"; title: string }
  | { type: "socialPost"; platform: string; topic: string; spend: number }
  | { type: "foundMedia"; kind: string; name: string }
  | { type: "crimeAct"; kind: string; intensity: number }
  | { type: "foundOrg"; kind: OrgState["kind"]; name: string; doctrine: string }
  | { type: "orgAct"; orgId: string; act: "recruit" | "media" | "facility" | "donate" }
  | { type: "gamble"; game: "roulette" | "dice" | "cards" | "slots" | "lottery" | "mines"; stake: number; extra?: Record<string, unknown> }
  | { type: "minesStart"; stake: number; mines: number }
  | { type: "minesReveal"; tile: number }
  | { type: "minesCashout" }
  | { type: "minesClear" }
  | { type: "admin"; op: "unlock" | "lock" | "draw" | "status" | "xray"; key?: string; amount?: number }
  | { type: "foundCasino"; name: string; cityId: string }
  | { type: "foundBank"; name: string }
  | { type: "foundInsurer"; name: string }
  | { type: "buyInsurance"; kind: "life" | "property" | "health" }
  | { type: "haveChild" }
  | { type: "setHeir"; memberId: string }
  | { type: "continueAsHeir" }
  | { type: "interview"; tone: "open" | "deny" | "spin" }
  | { type: "resolve"; decisionId: string; optionId: string }
  | { type: "rest" }
  | { type: "workout" }
  | { type: "network" }
  | { type: "createFund"; name: string; kind: FundIssue["kind"] }
  // --- life (BitLife layer)
  | { type: "ageUp" }
  | { type: "activity"; id: string }
  | { type: "interact"; personId: string; kind: InteractKind; prenup?: boolean; wedding?: "small" | "big" }
  | { type: "findLove"; where: "app" | "club" | "work" }
  | { type: "askOut"; candidateId: string }
  | { type: "adoptPet"; species: "dog" | "cat" | "parrot" | "horse" | "tortoise" }
  | { type: "adoptChild" }
  // --- lifestyle
  | { type: "buyVehicle"; modelId: string }
  | { type: "sellVehicle"; id: string }
  | { type: "repairVehicle"; id: string }
  | { type: "yachtCharter"; id: string }
  | { type: "buyAircraft"; modelId: string }
  | { type: "sellAircraft"; id: string }
  | { type: "aircraftMode"; id: string; mode: "private" | "charter" | "lease" }
  | { type: "aircraftCrew"; id: string; crew: boolean }
  | { type: "maintainAircraft"; id: string }
  | { type: "flyAircraft"; id: string; cityId: string }
  | { type: "vacation"; cityId: string; tier: string; days: number; aircraftId?: string }
  // --- corporate
  | { type: "tenderOffer"; companyId: string; pct: number; premium: number; buyer: string }
  | { type: "sellStake"; companyId: string; holderId: string; pct: number }
  // --- casino floor
  | { type: "bjStart"; stake: number }
  | { type: "bjHit" }
  | { type: "bjStand" }
  | { type: "bjDouble" }
  | { type: "rouletteSpin"; bets: RouletteBet[] }
  | { type: "slotSpin"; stake: number }
  | { type: "crashStart"; stake: number; auto?: number | null }
  | { type: "crashCashout"; at: number }
  | { type: "diceRoll"; stake: number; target: number; over: boolean }
  | { type: "hiloStart"; stake: number }
  | { type: "hiloGuess"; guess: "hi" | "lo" | "skip" }
  | { type: "hiloCashout" }
  | { type: "plinkoDrop"; stake: number; risk: "low" | "medium" | "high" }
  | { type: "casinoClear"; game: "bj" | "crash" | "hilo" | "vp" | "baccarat" | "wheel" }
  | { type: "baccaratDeal"; bets: { player?: number; banker?: number; tie?: number } }
  | { type: "vpDeal"; stake: number }
  | { type: "vpDraw"; holds: boolean[] }
  | { type: "wheelSpin"; bets: Record<string, number> }
  | { type: "biz"; op: string; id?: string; args?: Record<string, unknown> };

export interface FoundPayload {
  name: string;
  industry: Industry;
  model: string;
  product: string;
  price: number;
  countryId: string;
  cityId: string;
  capital: number;
  ai?: boolean;
}
