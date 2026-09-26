// One entry point for every "run it for real" action. Each op validates its
// own arguments; nothing moves money unless the underlying system says so.
import type { GameState } from "./types";
import type { ManagerTier, PayLevel, RoleId, Strategy, BrokerTier, DevProject } from "./biz";
import {
  hqCeoBuy,
  hqCeoToggle,
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
import { casinoManage, sellCasino, type CasinoPatch } from "./casinoops";
import { cancelProject, evict, listForSale, setEstateAuto, setManager, setRentAmount, setUnitsMode, startProject } from "./estates";
import { claimBenefit, giftTo, startCert } from "./civic";

export type BizArgs = Record<string, unknown>;

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
      );
    case "estCancel":
      return cancelProject(state, id, log);
    case "estUnits":
      return setUnitsMode(state, id, (["rent", "sale", "off"].includes(str(a.mode)) ? a.mode : "rent") as "rent" | "sale" | "off", log);

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
export const BIZ_PRISON_BLOCKED = new Set(["foundBrokerage", "buyBank", "hireBroker", "estDevelop", "hqAcquire", "hqExpand", "cert"]);
