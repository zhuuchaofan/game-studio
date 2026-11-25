import balanceJson from '../data/balance.json';
import itemsJson from '../data/items.json';
import { hashSeed, type RngFn } from '../utils/rng';
import {
  clonePawnPrices,
  consumePawnPrice,
  peekPawnPrice,
  recordPawnPrice,
  type PawnPriceLedger,
} from './save';

export type OfferTier = 'low' | 'fair' | 'high';

export type CustomerTemperament = 'urgent' | 'proud' | 'sentimental';

export type PawnshopPhase = 'redemption' | 'negotiating' | 'feedback' | 'summary';

export type DebugPhase = 'title' | PawnshopPhase;

export const TEMPERAMENT_LABELS: Record<CustomerTemperament, string> = {
  urgent: '急用钱',
  proud: '爱面子',
  sentimental: '念旧',
};

export interface TierConfig {
  label: string;
  priceMultiplier: number;
  acceptRate: number;
  reputationOnAccept: number;
  reputationOnReject: number;
}

export interface BalanceConfig {
  startingMoney: number;
  startingReputation: number;
  startingHp: number;
  startingRenqing: number;
  maxRenqing: number;
  tiers: Record<OfferTier, TierConfig>;
}

export interface PawnItem {
  id: string;
  name: string;
  trueValue: number;
  story: string;
  cardName: string;
  cardCost: number;
  color: string;
  temperament?: CustomerTemperament;
}

export interface OfferOutcome {
  item: PawnItem;
  tier: OfferTier;
  price: number;
  accepted: boolean;
  reputationDelta: number;
  message: string;
}

export interface RedemptionOffer {
  item: PawnItem;
  deckIndex: number;
  cardName: string;
  basePrice: number;
  payout: number;
}

export interface PawnshopState {
  day: number;
  phase: PawnshopPhase;
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  log: string[];
  items: PawnItem[];
  lastOutcome: OfferOutcome | null;
  redeemTickets?: number;
  pawnPrices?: PawnPriceLedger;
  redemptionOffer?: RedemptionOffer | null;
}

export interface PawnshopInitialOptions {
  day?: number;
  money?: number;
  reputation?: number;
  deck?: readonly string[];
  items?: readonly PawnItem[];
  balance?: BalanceConfig;
  redeemTickets?: number;
  pawnPrices?: PawnPriceLedger;
  redemptionOffer?: RedemptionOffer | null;
}

export interface PawnshopDebugSnapshot {
  phase: DebugPhase;
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  log: string[];
  day?: number;
  shopLevel?: number;
  redeemTickets?: number;
  maxRenqing?: number;
  itemsOrder?: string[];
  hasSave?: boolean;
  corruptSaveQuarantined?: boolean;
  /** 当前当客性格与像素徽章文案（仅 negotiating 阶段提供）。 */
  currentTemperament?: CustomerTemperament | null;
  currentTemperamentLabel?: string | null;
  /** 最近一次结算台词（供测试与验收）。 */
  lastMessage?: string | null;
  /** 当前当客每档报价是否买得起（仅 negotiating 阶段由场景钩子提供）。 */
  tierAffordability?: Record<OfferTier, boolean>;
  /** 当前口碑与性格修正后的三档接受率（仅 negotiating 阶段由场景钩子提供）。 */
  effectiveAcceptRates?: Record<OfferTier, number>;
  /** 当前当客是否允许跳过（仅 negotiating 阶段为 true）。 */
  canSkip?: boolean;
  /** 最近一次界面轻提示文案（如钱不够，供 E2E 断言用）。 */
  lastToast?: string | null;
  /** 当前赎当事件信息（仅 redemption 阶段由场景钩子提供）。 */
  redemptionOffer?: {
    itemId: string;
    itemName: string;
    cardName: string;
    basePrice: number;
    payout: number;
  } | null;
  /** 新手教程状态（供 E2E 测试断言用）。 */
  tutorialActive?: boolean;
  currentStep?: string | null;
  tutorialDone?: boolean;
  tutorialCopy?: string | null;
}

/**
 * 测试钩子接口（仅供 E2E 自动化测试断言使用，非正式游戏功能）。
 */
export interface PawnshopDebugHook {
  getState: () => PawnshopDebugSnapshot;
}

declare global {
  interface Window {
    // 测试钩子（仅供测试断言用，非正式功能）
    __PAWNSHOP_DEBUG__?: PawnshopDebugHook;
  }
}

export const TIER_ORDER: readonly OfferTier[] = ['low', 'fair', 'high'];

/**
 * 16 色主调色板（见 docs/ART_STYLE.md 定稿 v1.0）。
 */
export const PALETTE = {
  ink: { hex: '#17120C', num: 0x17120c },
  deepWood: { hex: '#2E2118', num: 0x2e2118 },
  woodBrown: { hex: '#5A3A22', num: 0x5a3a22 },
  copperBrown: { hex: '#8A5A33', num: 0x8a5a33 },
  brass: { hex: '#C9973F', num: 0xc9973f },
  lampYellow: { hex: '#E8B34B', num: 0xe8b34b },
  candle: { hex: '#F2E3C6', num: 0xf2e3c6 },
  paperWhite: { hex: '#FBF6E9', num: 0xfbf6e9 },
  nightBlack: { hex: '#10182B', num: 0x10182b },
  deepBlue: { hex: '#1B2A4A', num: 0x1b2a4a },
  nightBlue: { hex: '#2E4A73', num: 0x2e4a73 },
  mistBlue: { hex: '#4E739E', num: 0x4e739e },
  silverBlue: { hex: '#8FA8C8', num: 0x8fa8c8 },
  vermilion: { hex: '#B03A2E', num: 0xb03a2e },
  jade: { hex: '#4E7A5A', num: 0x4e7a5a },
  oldPaper: { hex: '#D9A066', num: 0xd9a066 },
} as const;

export function parseHexColor(hex: string): number {
  return Number.parseInt(hex.replace('#', ''), 16);
}

export const BALANCE: BalanceConfig = {
  startingMoney: balanceJson.startingMoney,
  startingReputation: balanceJson.startingReputation,
  startingHp: balanceJson.startingHp,
  startingRenqing: balanceJson.startingRenqing,
  maxRenqing: balanceJson.maxRenqing,
  tiers: balanceJson.tiers,
};

export const DAILY_CUSTOMER_COUNT = 3;

/** 第 1 天当客池保底：至少 1 件出伤害牌的旧物（永久自行车→飞驰 / 二胡→余音，P6 B2）。 */
export const DAY1_GUARANTEED_DAMAGE_ITEM_IDS: readonly string[] = ['bicycle', 'erhu'];

/** P6 C4 赎当倍率：当价 × 1.2 */
export const REDEMPTION_PRICE_MULTIPLIER = 1.2;

export const ITEMS: readonly PawnItem[] = (itemsJson as PawnItem[]).map((item) => ({ ...item }));

export function getTemperamentLabel(temperament?: CustomerTemperament): string | null {
  return temperament ? TEMPERAMENT_LABELS[temperament] : null;
}

/**
 * Computes the offered price from an item's true value and the chosen tier multiplier.
 */
export function quotePrice(
  trueValue: number,
  tier: OfferTier,
  balance: BalanceConfig = BALANCE,
): number {
  return Math.round(trueValue * balance.tiers[tier].priceMultiplier);
}

/**
 * 钱不能变负数规则（2026-11-24，制作人定）：报价 ≤ 当前钱数才可买，
 * 边界为价格刚好等于钱数时可买、价格 = 钱数 + 1 时不可买。
 */
export function isTierAffordable(money: number, price: number): boolean {
  return price <= money;
}

export function canAffordTier(
  money: number,
  trueValue: number,
  tier: OfferTier,
  balance: BalanceConfig = BALANCE,
): boolean {
  return isTierAffordable(money, quotePrice(trueValue, tier, balance));
}

export function getTierAffordability(
  money: number,
  trueValue: number,
  balance: BalanceConfig = BALANCE,
): Record<OfferTier, boolean> {
  return {
    low: canAffordTier(money, trueValue, 'low', balance),
    fair: canAffordTier(money, trueValue, 'fair', balance),
    high: canAffordTier(money, trueValue, 'high', balance),
  };
}

export function hasAnyAffordableTier(
  money: number,
  trueValue: number,
  balance: BalanceConfig = BALANCE,
): boolean {
  return TIER_ORDER.some((tier) => canAffordTier(money, trueValue, tier, balance));
}

/**
 * Computes effective customer acceptance rate taking reputation (P6 C3) and
 * customer temperament (P7) into account:
 * - low:  base 30% + 5% * rep (clamped [10%, 60%]), then urgent +10% / proud -10% (clamped [5%, 70%])
 * - fair: base 80% + 2% * rep (clamped [50%, 95%]), then sentimental +5% (clamped [50%, 95%])
 * - high: 100% (unchanged)
 */
export function getEffectiveAcceptRate(
  tier: OfferTier,
  reputation: number,
  balance: BalanceConfig = BALANCE,
  temperament?: CustomerTemperament,
): number {
  const base = balance.tiers[tier].acceptRate;
  if (tier === 'high') {
    return base;
  }
  if (tier === 'low') {
    const repClamped = Math.min(0.6, Math.max(0.1, base + 0.05 * reputation));
    const tempOffset = temperament === 'urgent' ? 0.1 : temperament === 'proud' ? -0.1 : 0;
    const adjusted = Math.min(0.7, Math.max(0.05, repClamped + tempOffset));
    return Math.round(adjusted * 10000) / 10000;
  }
  const repClamped = Math.min(0.95, Math.max(0.5, base + 0.02 * reputation));
  const tempOffset = temperament === 'sentimental' ? 0.05 : 0;
  const adjusted = Math.min(0.95, Math.max(0.5, repClamped + tempOffset));
  return Math.round(adjusted * 10000) / 10000;
}

/**
 * Computes reputation delta for an offer outcome incorporating P7 customer temperament:
 * - urgent + low accepted: -2 (baseline -1)
 * - proud + high accepted: +2 (baseline +1)
 * - all rejections: 0
 */
export function getReputationDelta(
  tier: OfferTier,
  accepted: boolean,
  temperament?: CustomerTemperament,
  balance: BalanceConfig = BALANCE,
): number {
  if (!accepted) {
    return balance.tiers[tier].reputationOnReject;
  }
  if (tier === 'low' && temperament === 'urgent') {
    return -2;
  }
  if (tier === 'high' && temperament === 'proud') {
    return 2;
  }
  return balance.tiers[tier].reputationOnAccept;
}

/**
 * Formats authentic 1987 old-street pawnshop offer outcome dialogue based on
 * item temperament, offer tier, acceptance, and current shop reputation (P7).
 */
export function formatOfferDialogue(
  item: PawnItem,
  tier: OfferTier,
  accepted: boolean,
  reputation: number,
): string {
  const temp = item.temperament;
  const highRep = reputation >= 2;
  const lowRep = reputation <= -2;

  if (accepted) {
    if (tier === 'low') {
      if (highRep) {
        return '听街坊说你家公道，少点我也认了';
      }
      if (temp === 'urgent') {
        return '急等着用钱，吃点亏我也认了';
      }
      if (temp === 'proud') {
        return '今儿算我落魄，改天体面来赎';
      }
      if (temp === 'sentimental') {
        return '帮我收稳当些，这物件有念想';
      }
      return '行吧，先应应急再说';
    }

    if (tier === 'fair') {
      if (highRep) {
        return '老街坊办事敞亮，就按这价收吧';
      }
      if (lowRep) {
        return '价还算公道，别亏待这旧物';
      }
      if (temp === 'sentimental') {
        return '价钱实在，麻烦掌柜替我好生收着';
      }
      if (temp === 'proud') {
        return '这个数不丢面儿，成交';
      }
      if (temp === 'urgent') {
        return '公道价，可算解了燃眉之急';
      }
      return '价格合适，麻烦写张当票';
    }

    // high tier accepted
    if (temp === 'proud') {
      return '掌柜识货给面子，回头替你多美言';
    }
    if (temp === 'sentimental') {
      return '多谢掌柜厚道，等缓过来一定赎回';
    }
    if (temp === 'urgent') {
      return '给这么厚道，真救了我大急！';
    }
    return highRep ? '果然名不虚传，掌柜真仗义' : '这价厚道，多谢掌柜照顾';
  }

  // Rejected
  if (tier === 'low') {
    if (item.id === 'watch' || temp === 'urgent') {
      return '这价连药费零头都不够';
    }
    if (temp === 'proud') {
      return '这价太寒碜人，我还得要脸面';
    }
    if (temp === 'sentimental') {
      return '这物件跟我半辈子，不能贱卖';
    }
    return lowRep ? '怪不得街坊说你压价狠，不谈了' : '压得太狠了，我另寻别家';
  }

  if (tier === 'fair') {
    if (lowRep) {
      return '听人说你家不厚道，我再看看别家';
    }
    if (temp === 'proud') {
      return '我这好东西，心里还得再高点';
    }
    if (temp === 'sentimental') {
      return '到底还是舍不得，过几天再来';
    }
    return '还是差了点意思，先拿回去吧';
  }

  return '算了，这物件我再想想';
}

/**
 * Formats the daytime offer-area reputation modifier hint (P6 C3 + P7 temperament).
 */
export function formatReputationHint(
  reputation: number,
  balance: BalanceConfig = BALANCE,
  temperament?: CustomerTemperament,
): string {
  const lowPct = Math.round(getEffectiveAcceptRate('low', reputation, balance, temperament) * 100);
  const fairPct = Math.round(getEffectiveAcceptRate('fair', reputation, balance, temperament) * 100);
  if (reputation > 0) {
    return `口碑${reputation}：当客更容易接受(低${lowPct}%/平${fairPct}%)`;
  }
  if (reputation < 0) {
    return `口碑${reputation}：当客更难接受(低${lowPct}%/平${fairPct}%)`;
  }
  return `口碑0：正常接受率(低${lowPct}%/平${fairPct}%)`;
}

/**
 * Resolves whether a customer accepts an offer given the acceptance rate in [0, 1].
 */
export function resolveOffer(rate: number, rng: RngFn): boolean {
  if (rate <= 0) {
    return false;
  }
  if (rate >= 1) {
    return true;
  }
  return rng() < rate;
}

/**
 * Derives a deterministic seed from the base URL seed and the current day number.
 */
export function deriveDaySeed(baseSeed: number, day: number): number {
  return hashSeed(`${baseSeed >>> 0}:day:${day}`);
}

/**
 * Derives a deterministic seed for the daily redemption check (isolated from shuffle & offer RNG).
 */
export function deriveRedemptionSeed(baseSeed: number, day: number): number {
  return hashSeed(`${baseSeed >>> 0}:redeem:${day}`);
}

/**
 * Pure Fisher-Yates shuffle returning a new array of cloned PawnItems.
 */
export function shuffleItems(items: readonly PawnItem[], rng: RngFn): PawnItem[] {
  const result = items.map((item) => ({ ...item }));
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * Picks daily customers (default 3) via Fisher-Yates shuffle.
 * On Day 1 (P6 B2), guarantees at least 1 damage-card item (bicycle/erhu) appears.
 */
export function pickDailyItems(
  items: readonly PawnItem[],
  day: number,
  rng: RngFn,
  count: number = DAILY_CUSTOMER_COUNT,
): PawnItem[] {
  const shuffled = shuffleItems(items, rng);
  const picked = shuffled.slice(0, count);

  if (day === 1 && picked.length > 0) {
    const hasDamageItem = picked.some((item) =>
      DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(item.id),
    );
    if (!hasDamageItem) {
      const replacement = shuffled
        .slice(count)
        .find((item) => DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(item.id));
      if (replacement) {
        picked[picked.length - 1] = replacement;
      }
    }
  }

  return picked;
}

/**
 * Creates a redemption offer at the start of a day (P6 C4 + P7 sentimental priority):
 * - player holds >= 1 redeemTicket, AND
 * - deck contains at least 1 card originating from a pawnshop item (items.json).
 * P7: Prioritizes cards belonging to `sentimental` (念旧) customers when present.
 * Payout = round(basePrice * 1.2).
 */
export function createRedemptionOffer(
  deck: readonly string[],
  redeemTickets: number,
  pawnPrices: PawnPriceLedger,
  rng: RngFn,
  items: readonly PawnItem[] = ITEMS,
): RedemptionOffer | null {
  if (redeemTickets < 1 || deck.length === 0) {
    return null;
  }

  const itemByCard = new Map<string, PawnItem>();
  for (const item of items) {
    itemByCard.set(item.cardName, item);
  }

  const candidates: { deckIndex: number; cardName: string; item: PawnItem }[] = [];
  for (let i = 0; i < deck.length; i += 1) {
    const cardName = deck[i];
    const matched = itemByCard.get(cardName);
    if (matched) {
      candidates.push({ deckIndex: i, cardName, item: matched });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const sentimentalCandidates = candidates.filter((c) => c.item.temperament === 'sentimental');
  const pool = sentimentalCandidates.length > 0 ? sentimentalCandidates : candidates;

  const pickedIdx = Math.floor(rng() * pool.length);
  const chosen = pool[Math.min(pickedIdx, pool.length - 1)];
  const recorded = peekPawnPrice(pawnPrices, chosen.cardName);
  const basePrice = recorded !== null ? recorded : chosen.item.trueValue;
  const payout = Math.round(basePrice * REDEMPTION_PRICE_MULTIPLIER);

  return {
    item: { ...chosen.item },
    deckIndex: chosen.deckIndex,
    cardName: chosen.cardName,
    basePrice,
    payout,
  };
}

function isBalanceConfig(value: unknown): value is BalanceConfig {
  return typeof value === 'object' && value !== null && 'tiers' in value;
}

export function createInitialState(
  initialOrBalance?: PawnshopInitialOptions | BalanceConfig,
  legacyItems?: readonly PawnItem[],
): PawnshopState {
  if (isBalanceConfig(initialOrBalance)) {
    const items = legacyItems ?? ITEMS.slice(0, DAILY_CUSTOMER_COUNT);
    return {
      day: 1,
      phase: 'negotiating',
      customerIndex: 0,
      money: initialOrBalance.startingMoney,
      reputation: initialOrBalance.startingReputation,
      deck: [],
      log: [],
      items: items.map((item) => ({ ...item })),
      lastOutcome: null,
    };
  }

  const opts = initialOrBalance ?? {};
  const balance = opts.balance ?? BALANCE;
  const items = opts.items ?? legacyItems ?? ITEMS.slice(0, DAILY_CUSTOMER_COUNT);
  const redemptionOffer = opts.redemptionOffer ?? null;

  return {
    day: opts.day ?? 1,
    phase: redemptionOffer ? 'redemption' : 'negotiating',
    customerIndex: 0,
    money: opts.money ?? balance.startingMoney,
    reputation: opts.reputation ?? balance.startingReputation,
    deck: opts.deck ? [...opts.deck] : [],
    log: [],
    items: items.map((item) => ({ ...item })),
    lastOutcome: null,
    ...(opts.redeemTickets !== undefined ? { redeemTickets: opts.redeemTickets } : {}),
    ...(opts.pawnPrices !== undefined ? { pawnPrices: clonePawnPrices(opts.pawnPrices) } : {}),
    ...(redemptionOffer !== null
      ? { redemptionOffer: { ...redemptionOffer, item: { ...redemptionOffer.item } } }
      : {}),
  };
}

export function resolveRedemption(state: PawnshopState, accept: boolean): PawnshopState {
  const offer = state.redemptionOffer ?? null;
  if (state.phase !== 'redemption' || !offer) {
    return {
      ...state,
      deck: [...state.deck],
      log: [...state.log],
      items: state.items.map((item) => ({ ...item })),
      lastOutcome: state.lastOutcome ? { ...state.lastOutcome } : null,
      ...(state.pawnPrices ? { pawnPrices: clonePawnPrices(state.pawnPrices) } : {}),
    };
  }

  const currentTickets = state.redeemTickets ?? 0;
  const currentPrices = clonePawnPrices(state.pawnPrices);

  if (!accept || currentTickets < 1) {
    return {
      ...state,
      phase: 'negotiating',
      deck: [...state.deck],
      log: [...state.log, `赎当:${offer.item.name}->拒绝`],
      items: state.items.map((item) => ({ ...item })),
      lastOutcome: null,
      redeemTickets: currentTickets,
      pawnPrices: currentPrices,
      redemptionOffer: null,
    };
  }

  const nextDeck = [...state.deck];
  if (
    offer.deckIndex >= 0 &&
    offer.deckIndex < nextDeck.length &&
    nextDeck[offer.deckIndex] === offer.cardName
  ) {
    nextDeck.splice(offer.deckIndex, 1);
  } else {
    const fallbackIdx = nextDeck.indexOf(offer.cardName);
    if (fallbackIdx >= 0) {
      nextDeck.splice(fallbackIdx, 1);
    }
  }

  const nextPrices = consumePawnPrice(currentPrices, offer.cardName);

  return {
    ...state,
    phase: 'negotiating',
    money: state.money + offer.payout,
    reputation: state.reputation + 1,
    deck: nextDeck,
    log: [...state.log, `赎当:${offer.item.name}(+${offer.payout},牌-${offer.cardName},口碑+1,券-1)`],
    items: state.items.map((item) => ({ ...item })),
    lastOutcome: null,
    redeemTickets: currentTickets - 1,
    pawnPrices: nextPrices,
    redemptionOffer: null,
  };
}

/**
 * Pure settlement transition: returns a new state object without mutating the input state.
 */
export function settle(
  state: PawnshopState,
  tier: OfferTier,
  accepted: boolean,
  balance: BalanceConfig = BALANCE,
): PawnshopState {
  const currentItem = state.items[state.customerIndex];
  if (!currentItem || state.phase === 'summary') {
    return {
      ...state,
      deck: [...state.deck],
      log: [...state.log],
      items: state.items.map((item) => ({ ...item })),
      lastOutcome: state.lastOutcome ? { ...state.lastOutcome } : null,
    };
  }

  const tierConfig = balance.tiers[tier];
  const price = quotePrice(currentItem.trueValue, tier, balance);

  if (accepted && price > state.money) {
    return {
      ...state,
      deck: [...state.deck],
      log: [...state.log],
      items: state.items.map((item) => ({ ...item })),
      lastOutcome: state.lastOutcome ? { ...state.lastOutcome } : null,
    };
  }

  const reputationDelta = getReputationDelta(tier, accepted, currentItem.temperament, balance);
  const nextMoney = accepted ? state.money - price : state.money;
  const nextReputation = state.reputation + reputationDelta;
  const nextDeck = accepted ? [...state.deck, currentItem.cardName] : [...state.deck];
  const nextPawnPrices =
    state.pawnPrices !== undefined
      ? accepted
        ? recordPawnPrice(state.pawnPrices, currentItem.cardName, price)
        : clonePawnPrices(state.pawnPrices)
      : undefined;
  const message = formatOfferDialogue(currentItem, tier, accepted, state.reputation);

  const logEntry = accepted
    ? `${currentItem.name}:${tierConfig.label}(${price})->接受,牌=${currentItem.cardName},口碑${formatSignedDelta(reputationDelta)}`
    : `${currentItem.name}:${tierConfig.label}(${price})->拒绝`;

  return {
    day: state.day,
    phase: 'feedback',
    customerIndex: state.customerIndex,
    money: nextMoney,
    reputation: nextReputation,
    deck: nextDeck,
    log: [...state.log, logEntry],
    items: state.items.map((item) => ({ ...item })),
    lastOutcome: {
      item: { ...currentItem },
      tier,
      price,
      accepted,
      reputationDelta,
      message,
    },
    ...(state.redeemTickets !== undefined ? { redeemTickets: state.redeemTickets } : {}),
    ...(nextPawnPrices !== undefined ? { pawnPrices: nextPawnPrices } : {}),
  };
}

export function skipCustomer(state: PawnshopState): PawnshopState {
  const currentItem = state.items[state.customerIndex];
  if (state.phase !== 'negotiating' || !currentItem) {
    return {
      ...state,
      deck: [...state.deck],
      log: [...state.log],
      items: state.items.map((item) => ({ ...item })),
      lastOutcome: state.lastOutcome ? { ...state.lastOutcome } : null,
    };
  }

  const nextIndex = state.customerIndex + 1;
  const isFinished = nextIndex >= state.items.length;

  return {
    day: state.day,
    phase: isFinished ? 'summary' : 'negotiating',
    customerIndex: nextIndex,
    money: state.money,
    reputation: state.reputation,
    deck: [...state.deck],
    log: [...state.log, `${currentItem.name}:跳过`],
    items: state.items.map((item) => ({ ...item })),
    lastOutcome: null,
    ...(state.redeemTickets !== undefined ? { redeemTickets: state.redeemTickets } : {}),
    ...(state.pawnPrices !== undefined ? { pawnPrices: clonePawnPrices(state.pawnPrices) } : {}),
  };
}

export function advanceCustomer(state: PawnshopState): PawnshopState {
  const nextIndex = state.customerIndex + 1;
  const isFinished = nextIndex >= state.items.length;

  return {
    ...state,
    phase: isFinished ? 'summary' : 'negotiating',
    customerIndex: nextIndex,
    deck: [...state.deck],
    log: [...state.log],
    items: state.items.map((item) => ({ ...item })),
    lastOutcome: null,
    ...(state.pawnPrices !== undefined ? { pawnPrices: clonePawnPrices(state.pawnPrices) } : {}),
  };
}

export function toDebugSnapshot(state: PawnshopState): PawnshopDebugSnapshot {
  return {
    phase: state.phase,
    customerIndex: state.customerIndex,
    money: state.money,
    reputation: state.reputation,
    deck: [...state.deck],
    log: [...state.log],
  };
}

export function formatSignedDelta(delta: number): string {
  if (delta > 0) {
    return `+${delta}`;
  }
  if (delta < 0) {
    return `${delta}`;
  }
  return '+0';
}

export function wrapCjkText(text: string, maxCharsPerLine: number): string {
  const lines: string[] = [];
  let current = '';

  for (const ch of text) {
    current += ch;
    const isBreakPunct = ch === '，' || ch === '。' || ch === '；';
    if (current.length >= maxCharsPerLine || (isBreakPunct && current.length >= maxCharsPerLine - 5)) {
      lines.push(current);
      current = '';
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines.join('\n');
}
