// One entry point for every "run it for real" action. Each op validates its
// own arguments; nothing moves money unless the underlying system says so.
import type { GameState } from "./types";
import type { ManagerTier, PayLevel, RoleId, Strategy, BrokerTier, DevProject } from "./biz";
import {
  hqAutoBuyToggle,
  hqAutoHireToggle,
  hqCeoBuy,
  hqCeoToggle,
  hireForEverything,
  buyAnyCompany,
  empireSpend,
  hqAcquire,
  hqBorrow,
  hqBuyback,
  hqCloseMarket,
  hqExpand,
  hqInject,
  hqIssue,
  hqLab,
  hqRepay,
  hqSetAgents,
  hqSetPay,
  hqSetRoles,
  hqSetStrategy,
  hqSpecialDividend,
} from "./company";
import {
  bankBranch,
  bankBranchMax,
  bankCapital,
  bankSet,
  breakFD,
  brokerageCash,
  brokerageSet,
  brokerFund,
  buyBank,
  fireBroker,
  foundBrokerage,
  hireBroker,
  openFD,
  sellBank,
  sellBrokerage,
} from "./finfirms";
import { casinoManage, casinoExtra, sellCasino, type CasinoPatch } from "./casinoops";
import {
  cancelProject,
  evict,
  listForSale,
  setDevFirm,
  setEstateAuto,
  setManager,
  setRentAmount,
  setUnitsMode,
  startProject,
} from "./estates";
import {
  declareWar,
  govBorrow,
  govRepay,
  injectTreasury,
  nationalise,
  passLaw,
  regimeMove,
  repayStateLoan,
  seizeAssets,
  setDefence,
  setLevy,
  setScheme,
  skimTreasury,
  startInfra,
  cancelInfra,
  stateLoan,
  warMove,
  type RegimeMove,
  type WarMove,
} from "./statecraft";
import { claimBenefit, giftTo, startCert } from "./civic";

export type BizArgs = Record<string, unknown>;

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

const num = (v: unknown, d = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
function nums<K extends string>(v: unknown, keys: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!v || typeof v !== "object") return out;
  for (const k of keys) {
    const x = (v as Record<string, unknown>)[k];
    if (x != null && Number.isFinite(Number(x))) out[k] = Number(x);
  }
  return out;
}

export function applyBiz(state: GameState, op: string, id: string, a: BizArgs, log: string[]) {
  switch (op) {
    /* --- company HQ */
    case "hqRoles":
      return hqSetRoles(state, id, nums(a.targets, ["eng", "sales", "ops", "mgmt"] as RoleId[]), log);
    case "hqPay":
      return hqSetPay(state, id, (["below", "market", "above"].includes(str(a.pay)) ? a.pay : "market") as PayLevel, log);
    case "hqAgents":
      return hqSetAgents(state, id, nums(a.agents, ["eng", "sales", "ops"] as const), log);
    case "hqStrategy":
      return hqSetStrategy(state, id, str(a.strategy, "steady") as Strategy, a.payout != null ? num(a.payout) : undefined, log);
    case "hqExpand":
      return hqExpand(state, id, str(a.cityId), log);
    case "hqCloseMarket":
      return hqCloseMarket(state, id, str(a.cityId), log);
    case "hqLab":
      return hqLab(
        state,
        id,
        {
          training: a.training != null ? num(a.training) : undefined,
          buyGpus: a.buyGpus != null ? num(a.buyGpus) : undefined,
        },
        log,
      );
    case "hqBuyback":
      return hqBuyback(state, id, num(a.amount), log);
    case "hqIssue":
      return hqIssue(state, id, num(a.pct, 5), log);
    case "hqBorrow":
      return hqBorrow(state, id, num(a.amount), log);
    case "hqRepay":
      return hqRepay(state, id, num(a.amount), log);
    case "hqInject":
      return hqInject(state, id, num(a.amount), log);
    case "hqSpecial":
      return hqSpecialDividend(state, id, num(a.amount), log);
    case "hqCeoToggle":
      return hqCeoToggle(state, id, Boolean((a as any).on), log);
    case "hqCeoBuy":
      return hqCeoBuy(state, id, log);
    case "hqAutoHire":
      return hqAutoHireToggle(state, id, Boolean((a as any).on), log);
    case "hqAutoBuy":
      return hqAutoBuyToggle(state, id, Boolean((a as any).on), log);
    case "hireAll":
      return hireForEverything(state, log);
    case "buyAnyCompany":
      return buyAnyCompany(state, str(a.companyId) || id, log);
    case "empireSpend":
      return empireSpend(state, str(a.kind) || "marketingBlitz", num(a.amount), log);
    case "hqAcquire":
      return hqAcquire(
        state,
        id,
        str(a.targetId),
        num(a.premium, 25),
        (["cash", "debt", "stock"].includes(str(a.funding)) ? a.funding : "cash") as "cash" | "debt" | "stock",
        log,
      );

    /* --- your bank */
    case "bankSet":
      return bankSet(
        state,
        id,
        {
          ...nums(a, ["depositRate", "lendingRate", "risk", "staff", "marketing", "dividendPct"] as const),
          ...(a.auto === true ? { auto: true } : {}),
          ...((a as any).marketingAuto!=null ? { marketingAuto: Boolean((a as any).marketingAuto) } : {}),
          ...((a as any).ceoAuto!=null ? { ceoAuto: Boolean((a as any).ceoAuto) } : {}),
        } as any,
        log,
      );
    case "bankBranch":
      if (str(a.delta) === "max" || str(a.delta) === "all") return bankBranchMax(state, id, log, num(a.reserve));
      return bankBranch(state, id, num(a.delta, 1), log);
    case "bankCapital":
      return bankCapital(state, id, num(a.amount), log);
    case "buyBank":
      return buyBank(state, id, log);
    case "sellBank":
      return sellBank(state, id, log);

    /* --- personal banking & broker */
    case "openFD":
      return openFD(state, id, num(a.amount), num(a.months, 12), log);
    case "breakFD":
      return breakFD(state, id, log);
    case "hireBroker":
      return hireBroker(
        state,
        (["junior", "senior", "star"].includes(str(a.tier)) ? a.tier : "junior") as BrokerTier,
        num(a.amount),
        (["careful", "balanced", "aggressive"].includes(str(a.risk)) ? a.risk : "balanced") as "careful" | "balanced" | "aggressive",
        log,
      );
    case "brokerFund":
      return brokerFund(state, num(a.amount), log);
    case "fireBroker":
      return fireBroker(state, log);

    /* --- brokerage firm */
    case "foundBrokerage":
      return foundBrokerage(state, str(a.name), log);
    case "brokerageSet":
      return brokerageSet(
        state,
        id,
        nums(a, ["junior", "senior", "star", "analysts", "compliance", "commissionBps", "mgmtFee", "marketing", "platformSpend"] as const),
        log,
      );
    case "brokerageCash":
      return brokerageCash(state, id, num(a.amount), log);
    case "sellBrokerage":
      return sellBrokerage(state, id, log);

    /* --- casino operations */
    case "casinoManage": {
      const patch: CasinoPatch = {};
      if (a.tables) patch.tables = nums(a.tables, ["blackjack", "roulette", "baccarat", "poker", "craps", "bigsix"] as const);
      if (a.staff) patch.staff = nums(a.staff, ["dealers", "security", "pit", "hosts", "cashiers", "surveillance"] as const);
      for (const k of ["slots", "minBet", "maxBet", "slotHold", "comps", "addRooms", "marketing"] as const) if (a[k] != null) patch[k] = num(a[k]);
      if (typeof a.vip === "boolean") patch.vip = a.vip;
      if (a.licence === "premium" || a.licence === "standard") patch.licence = a.licence;
      return casinoManage(state, id, patch, log);
    }
    case "casinoExtra":
      return casinoExtra(
        state,
        id,
        (["event", "junket", "training", "online", "suite", "odds", "security", "comps"].includes(str(a.what))
          ? str(a.what)
          : "event") as "event" | "junket" | "training" | "online" | "suite" | "odds" | "security" | "comps",
        num(a.level, 1),
        log,
      );
    case "sellCasino":
      return sellCasino(state, id, log);

    /* --- estates */
    case "estManager":
      return setManager(state, id, (["none", "basic", "premium"].includes(str(a.tier)) ? a.tier : "none") as ManagerTier, log);
    case "estAuto":
      return setEstateAuto(state, id, { autoRent: (a as any).autoRent!=null?Boolean((a as any).autoRent):undefined, fullAuto: (a as any).fullAuto!=null?Boolean((a as any).fullAuto):undefined } as any, log);
    case "estRent":
      return setRentAmount(state, id, num(a.amount), log);
    case "estSale":
      return listForSale(state, id, num(a.ask), log);
    case "estEvict":
      return evict(state, id, log);
    case "estDevelop":
      return startProject(
        state,
        id,
        str(a.kind, "apartments") as DevProject["kind"],
        str(a.developer, "reputable") as DevProject["developer"],
        a.units != null ? num(a.units) : undefined,
        log,
        Boolean(a.force),
      );
    case "devFirm":
      return setDevFirm(
        state,
        {
          ...(a.tier != null ? { tier: str(a.tier, "reputable") as DevProject["developer"] } : {}),
          ...(a.auto != null ? { auto: Boolean(a.auto) } : {}),
          ...(a.maximize != null ? { maximize: Boolean(a.maximize) } : {}),
          ...(a.reinvest != null ? { reinvest: Boolean(a.reinvest) } : {}),
          ...(a.redevelop != null ? { redevelop: Boolean(a.redevelop) } : {}),
          ...(a.exit != null ? { exit: (a.exit === "lease" ? "lease" : "sell") as "sell" | "lease" } : {}),
        },
        log,
      );
    case "estCancel":
      return cancelProject(state, id, log);
    case "estUnits":
      return setUnitsMode(state, id, (["rent", "sale", "off"].includes(str(a.mode)) ? a.mode : "rent") as "rent" | "sale" | "off", log);

    /* --- government: the country you run */
    case "govInject":
      return injectTreasury(state, num(a.amount), log);
    case "govBorrow":
      return govBorrow(
        state,
        (["market", "central", "concord"].includes(str(a.source)) ? a.source : "market") as "market" | "central" | "concord",
        num(a.amount),
        log,
      );
    case "govDebtRepay":
      return govRepay(state, str(a.debtId), num(a.amount), log);
    case "govLoan":
      return stateLoan(state, num(a.amount), num(a.term, 60), log);
    case "govLoanRepay":
      return repayStateLoan(state, str(a.loanId), num(a.amount), log);
    case "govSkim":
      return skimTreasury(state, num(a.amount), log);
    case "govInfra":
      return startInfra(state, str(a.kind, "highway") as never, str(a.cityId), num(a.scale, 1), log);
    case "govInfraCancel":
      return cancelInfra(state, str(a.projectId), log);
    case "govScheme":
      return setScheme(state, str(a.kind) as never, num(a.funding, 50), log);
    case "govLaw":
      return passLaw(state, str(a.kind) as never, log);
    case "govLevy":
      return setLevy(state, str(a.companyId), str(a.levy, "levy") as never, num(a.rate, 5), log);
    case "govNationalise":
      return nationalise(state, str(a.companyId), log);
    case "govSeize":
      return seizeAssets(state, str(a.companyId), log);
    case "govDefence":
      return setDefence(
        state,
        {
          ...(a.budget != null ? { budget: num(a.budget) } : {}),
          ...(a.equipment != null ? { equipment: num(a.equipment) } : {}),
          ...(a.personnel != null ? { personnel: num(a.personnel) } : {}),
        },
        log,
      );
    case "govWar":
      return declareWar(state, str(a.enemyId), str(a.objective, "reparations") as never, clampInt(num(a.intensity, 2), 1, 3) as 1 | 2 | 3, log);
    case "govWarMove":
      return warMove(state, str(a.warId), str(a.move, "hold") as WarMove, log);
    case "govRegime":
      return regimeMove(state, str(a.move, "emergency") as RegimeMove, num(a.level, 20), log);

    /* --- government, education, gifts */
    case "claimBenefit":
      return claimBenefit(state, log);
    case "cert":
      return startCert(state, id, log);
    case "gift":
      return giftTo(
        state,
        id,
        (["cash", "vehicle", "property", "shares"].includes(str(a.kind)) ? a.kind : "cash") as "cash" | "vehicle" | "property" | "shares",
        str(a.ref),
        num(a.amount),
        log,
      );
    default:
      log.push(`Unknown business action: ${op}`);
  }
}

/** Actions that make no sense from a prison cell. */
export const BIZ_PRISON_BLOCKED = new Set([
  "foundBrokerage",
  "buyBank",
  "hireBroker",
  "estDevelop",
  "hqAcquire",
  "hqExpand",
  "cert",
  "govInject",
  "govBorrow",
  "govLoan",
  "govSkim",
  "govInfra",
  "govScheme",
  "govLaw",
  "govLevy",
  "govNationalise",
  "govSeize",
  "govWar",
  "govWarMove",
  "govRegime",
]);
