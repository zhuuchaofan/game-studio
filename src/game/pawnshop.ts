import balanceJson from '../data/balance.json';
import itemsJson from '../data/items.json';
import type { RngFn } from '../utils/rng';

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
  phase: PawnshopPhase;
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  log: string[];
  items: PawnItem[];
  lastOutcome: OfferOutcome | null;
}

export interface PawnshopDebugSnapshot {
  phase: DebugPhase;
  customerIndex: number;
  money: number;
  reputation: number;
  deck: string[];
  log: string[];
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
 * Creates a fresh daytime pawnshop state from balance and item data.
 */
export function createInitialState(
  balance: BalanceConfig = BALANCE,
  items: readonly PawnItem[] = ITEMS,
): PawnshopState {
  return {
    phase: 'negotiating',
    customerIndex: 0,
    money: balance.startingMoney,
    reputation: balance.startingReputation,
    deck: [],
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
