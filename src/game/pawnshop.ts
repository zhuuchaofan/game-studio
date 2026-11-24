import balanceJson from '../data/balance.json';
import itemsJson from '../data/items.json';
import { hashSeed, type RngFn } from '../utils/rng';

export type OfferTier = 'low' | 'fair' | 'high';

export type PawnshopPhase = 'negotiating' | 'feedback' | 'summary';

export type DebugPhase = 'title' | PawnshopPhase;

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
}

export interface OfferOutcome {
  item: PawnItem;
  tier: OfferTier;
  price: number;
  accepted: boolean;
  reputationDelta: number;
  message: string;
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
}

export interface PawnshopInitialOptions {
  day?: number;
  money?: number;
  reputation?: number;
  deck?: readonly string[];
  items?: readonly PawnItem[];
  balance?: BalanceConfig;
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
  /** 当前当客每档报价是否买得起（仅 negotiating 阶段由场景钩子提供）。 */
  tierAffordability?: Record<OfferTier, boolean>;
  /** 当前当客是否允许跳过（仅 negotiating 阶段为 true）。 */
  canSkip?: boolean;
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

export const ITEMS: readonly PawnItem[] = itemsJson.map((item) => ({ ...item }));

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

function isBalanceConfig(value: unknown): value is BalanceConfig {
  return typeof value === 'object' && value !== null && 'tiers' in value;
}

/**
 * Creates a fresh daytime pawnshop state from balance and item data,
 * optionally overriding day/money/reputation/deck/items from SaveData.
 */
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

  return {
    day: opts.day ?? 1,
    phase: 'negotiating',
    customerIndex: 0,
    money: opts.money ?? balance.startingMoney,
    reputation: opts.reputation ?? balance.startingReputation,
    deck: opts.deck ? [...opts.deck] : [],
    log: [],
    items: items.map((item) => ({ ...item })),
    lastOutcome: null,
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

  // 钱不能变负数：成交价高于当前钱数时不成交、不扣钱、不改状态
  //（界面层已置灰禁用，此处为纯逻辑层兜底；被拒报价不受影响）。
  if (accepted && price > state.money) {
    return {
      ...state,
      deck: [...state.deck],
      log: [...state.log],
      items: state.items.map((item) => ({ ...item })),
      lastOutcome: state.lastOutcome ? { ...state.lastOutcome } : null,
    };
  }

  const reputationDelta = accepted
    ? tierConfig.reputationOnAccept
    : tierConfig.reputationOnReject;

  const nextMoney = accepted ? state.money - price : state.money;
  const nextReputation = state.reputation + reputationDelta;
  const nextDeck = accepted ? [...state.deck, currentItem.cardName] : [...state.deck];
  const message = accepted ? `成交！收下${currentItem.name}` : '当客走了，没谈成';

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
  };
}

/**
 * Skips the current customer during negotiating: no deal, money/reputation/deck unchanged,
 * records a skip log entry, and advances to the next customer (or end-of-day summary).
 */
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
  };
}

/**
 * Advances from feedback to the next customer, or to the end-of-day summary after the last customer.
 */
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
  };
}

/**
 * Builds the read-only snapshot returned by window.__PAWNSHOP_DEBUG__.getState().
 */
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

/**
 * Wraps CJK strings cleanly at punctuation or maxCharsPerLine without relying on spaces.
 */
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
