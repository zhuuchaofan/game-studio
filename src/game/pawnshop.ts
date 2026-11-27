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

import type { ChapterSaveState, PactId, SideQuestChoice } from './chapters';
import type { LedgerOverlaySnapshot } from './ledgerOverlay';

export type OfferTier = 'low' | 'fair' | 'high';

export type CustomerTemperament = 'urgent' | 'proud' | 'sentimental';

export type PawnshopPhase =
  | 'morning'
  | 'boss_preview'
  | 'pact'
  | 'trim_deck'
  | 'replace_heirloom'
  | 'redemption'
  | 'negotiating'
  | 'feedback'
  | 'side_quest'
  | 'summary';

export type MorningAction = 'rest' | 'medicine' | 'work';

export interface MorningOptionStatus {
  enabled: boolean;
  reason: 'full_hp' | 'insufficient_funds' | null;
}

export type MorningActionAvailability = Record<MorningAction, MorningOptionStatus>;

export type DebugPhase = 'title' | 'calendar' | PawnshopPhase;

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
  /** P10 子项 4：第 2 天新娘剧本化赎当（故事事件，不耗赎当券、拒绝口碑-1、不占当日随机赎当名额）。 */
  isBrideScripted?: boolean;
  /** P11 子项 2②：第 7 天父亲过赎期回来事件（手表在库触发一次，不耗券，破例赎回钱+1.2x/碑+1，留下碑-1）。 */
  isFatherOverdueScripted?: boolean;
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
  currentHp?: number;
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
  currentHp?: number;
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
  currentHp?: number;
  dailyCustomerCount?: number;
  morningAvailability?: MorningActionAvailability | null;
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
  /** P12 §3.1：当客屏执念提前提示文案（第 2 天起且对应今夜心魔执念时显示）。 */
  obsessionHint?: string | null;
  /** 当前当客每档报价是否买得起（仅 negotiating 阶段由场景钩子提供）。 */
  tierAffordability?: Record<OfferTier, boolean>;
  /** 当前口碑与性格修正后的三档接受率（仅 negotiating 阶段由场景钩子提供）。 */
  effectiveAcceptRates?: Record<OfferTier, number>;
  /** 当前当客是否允许跳过（仅 negotiating 阶段为 true）。 */
  canSkip?: boolean;
  /** 最近一次界面轻提示文案（如钱不够，供 E2E 断言用）。 */
  lastToast?: string | null;
  lastGlossaryTip?: string | null;
  glossaryBannerVisible?: boolean;
  /** 当前赎当事件信息（仅 redemption 阶段由场景钩子提供）。 */
  redemptionOffer?: {
    itemId: string;
    itemName: string;
    cardName: string;
    basePrice: number;
    payout: number;
    isBrideScripted?: boolean;
    isFatherOverdueScripted?: boolean;
  } | null;
  /** P11 子项 1：第 7 天白天封门预告数据（仅 boss_preview 阶段由场景钩子提供）。 */
  bossPreview?: {
    componentCount: number;
    finalHp: number;
    baseHp: number;
    componentHpBonus: number;
    pactHpBonus: number;
    hpCapped: boolean;
    r1Shield: number;
    chargeThreshold: number;
    fragmentNames: string[];
    hpLine: string;
  } | null;
  /** P11 子项 2①：开场掌柜交代文案（标题页钩子提供）。 */
  shopkeeperNote?: string | null;
  /** 新手教程状态（供 E2E 测试断言用）。 */
  tutorialActive?: boolean;
  currentStep?: string | null;
  tutorialDone?: boolean;
  tutorialCopy?: string | null;
  /** P9 章节状态（供 E2E 测试断言用）。 */
  chapter?: ChapterSaveState;
  pactChoice?: PactId | null;
  sideQuestChoice?: SideQuestChoice | null;
  day3Rumor?: string | null;
  sideQuestItemId?: string | null;
  /** P12 阶段 C：老物件栏与替换面板状态（供 E2E 测试断言用）。 */
  heirlooms?: string[];
  heirloomMilestonesClaimed?: number[];
  heirloomBarVisible?: boolean;
  inspectedHeirloomId?: string | null;
  inspectedHeirloomText?: string | null;
  pendingHeirloomOffer?: {
    id: string;
    name: string;
    shortLabel: string;
    effectText: string;
  } | null;
  /** P12 阶段 D：账本覆层只读快照（供 E2E 测试断言用）。 */
  ledger?: LedgerOverlaySnapshot;
  version?: string;
  titleCompletedTeaser?: string | null;
  titleSettlementLine?: string | null;
  titleEndingLedger?: {
    returnedItems: string[];
    retainedItems: string[];
    bossFragmentItems: string[];
    pawnedItems: string[];
    lines: string[];
  } | null;
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

/** 任务书 19 §4：早上三选一（休息回血 / 买补药 / 打理当铺）数值常量。 */
export const MORNING_REST_HEAL = 10;
export const MORNING_REST_CUSTOMER_COST = 1;
export const MORNING_MEDICINE_PRICE = 20;
export const MORNING_MEDICINE_HEAL = 10;

export function getMorningActionAvailability(
  currentHp: number,
  money: number,
  maxHp: number = BALANCE.startingHp,
): MorningActionAvailability {
  const isFullHp = currentHp >= maxHp;
  const canAffordMed = money >= MORNING_MEDICINE_PRICE;
  return {
    rest: {
      enabled: !isFullHp,
      reason: isFullHp ? 'full_hp' : null,
    },
    medicine: {
      enabled: !isFullHp && canAffordMed,
      reason: isFullHp ? 'full_hp' : !canAffordMed ? 'insufficient_funds' : null,
    },
    work: {
      enabled: true,
      reason: null,
    },
  };
}

export function applyMorningChoice(input: {
  action: MorningAction;
  currentHp: number;
  money: number;
  maxHp?: number;
}): {
  currentHp: number;
  money: number;
  customerCount: number;
  applied: boolean;
} {
  const maxHp = input.maxHp ?? BALANCE.startingHp;
  const clampedHp = Math.max(0, Math.min(maxHp, Math.round(input.currentHp)));
  const availability = getMorningActionAvailability(clampedHp, input.money, maxHp);

  if (input.action === 'rest') {
    if (!availability.rest.enabled) {
      return {
        currentHp: clampedHp,
        money: input.money,
        customerCount: DAILY_CUSTOMER_COUNT,
        applied: false,
      };
    }
    return {
      currentHp: Math.min(maxHp, clampedHp + MORNING_REST_HEAL),
      money: input.money,
      customerCount: Math.max(1, DAILY_CUSTOMER_COUNT - MORNING_REST_CUSTOMER_COST),
      applied: true,
    };
  }

  if (input.action === 'medicine') {
    if (!availability.medicine.enabled) {
      return {
        currentHp: clampedHp,
        money: input.money,
        customerCount: DAILY_CUSTOMER_COUNT,
        applied: false,
      };
    }
    return {
      currentHp: Math.min(maxHp, clampedHp + MORNING_MEDICINE_HEAL),
      money: input.money - MORNING_MEDICINE_PRICE,
      customerCount: DAILY_CUSTOMER_COUNT,
      applied: true,
    };
  }

  return {
    currentHp: clampedHp,
    money: input.money,
    customerCount: DAILY_CUSTOMER_COUNT,
    applied: true,
  };
}

/** 第 1 天当客池保底：至少 1 件出伤害牌的旧物（永久自行车→飞驰 / 二胡→余音 / 口琴→口琴，P6 B2 + P12 Q12）。 */
export const DAY1_GUARANTEED_DAMAGE_ITEM_IDS: readonly string[] = ['bicycle', 'erhu', 'harmonica'];

/** P10 子项 4：第 2 天新娘剧本化赎当对应的婚戒旧物与牌名。 */
export const BRIDE_RING_ITEM_ID = 'ring';
export const BRIDE_RING_CARD_NAME = '守诺';

/** P11 子项 2②：第 7 天父亲过赎期回来事件对应的旧手表旧物与牌名。 */
export const FATHER_WATCH_ITEM_ID = 'watch';
export const FATHER_WATCH_CARD_NAME = '倒转';

/** P12 阶段 E D1-A：已赎旧物在本章内不再进入优先池，保留赎回日映射供三档兜底按赎回日升序排列。 */

/** P11 子项 2①：开场掌柜交代（1987 口吻，21 天结构不变，叙事“出门一个月，前三周 + 月末对账尾声”）。 */
export const SHOPKEEPER_OPENING_NOTE_LINES: readonly [string, string] = [
  '掌柜交代：我出门一个月，前三周你看铺，月底',
  '对账。有人回来赎东西，先找当票，别让人白跑。',
];

/** P10 子项 6：第 3 天老街风声折行宽度上限（完整居中在 276px 面板内）。 */
export const DAY3_RUMOR_WRAP_CHARS = 17;

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

export interface PickDailyItemsOptions {
  /**
   * P10 子项 3 落败恢复：玩家输掉第 1 夜时，第 2 天保底至少 1 件低价 <= money 的伤害型旧物
   * （二胡余音 / 自行车飞驰，优先未拥有）。
   */
  recoverDamageAfterDay1Loss?: {
    money: number;
    deck: readonly string[];
  };
  balance?: BalanceConfig;
  /** P12 阶段 E D2 硬版：当前牌库（用于优先抽未拥有的旧物，不足时由统一三档兜底链补满）。 */
  deck?: readonly string[];
  /** P12 阶段 E D1-A：旧物最近一次被赎回的天数映射（itemId -> day），本章内排除，第 3 档兜底按升序回流。 */
  redeemedDayByItem?: Readonly<Record<string, number>>;
}

/**
 * Counts how many items are in Tier 1 (unowned & not redeemed in chapter) for `pickDailyItems`.
 */
export function countEligibleDailyItems(
  items: readonly PawnItem[],
  _day: number,
  options?: PickDailyItemsOptions,
): number {
  const redeemedDayByItem = options?.redeemedDayByItem;
  const ownedCards = options?.deck && options.deck.length > 0 ? new Set(options.deck) : null;

  let count = 0;
  for (const item of items) {
    if (isItemRedeemedInChapter(item.id, redeemedDayByItem)) {
      continue;
    }
    if (ownedCards && ownedCards.has(item.cardName)) {
      continue;
    }
    count += 1;
  }
  return count;
}

/**
 * P12 §6.1 D1-A: Checks whether an item has already been redeemed during the current chapter.
 */
export function isItemRedeemedInChapter(
  itemId: string,
  redeemedDayByItem?: Readonly<Record<string, number>>,
): boolean {
  return Boolean(redeemedDayByItem && redeemedDayByItem[itemId] !== undefined);
}

/**
 * Picks daily customers (default 3) via Fisher-Yates shuffle with P12 §6.1 unified D1-A + D2-hard fallback chain:
 * 1. Tier 1 (priority): unowned in deck AND not redeemed in this chapter.
 * 2. Tier 2 (fallback): owned in deck AND not redeemed in this chapter.
 * 3. Tier 3 (fallback): redeemed in this chapter, sorted by redeemedDay ascending (oldest redemption returns first).
 * Always fills `count` items whenever `items.length >= count`.
 * Also preserves Day 1 damage guarantee (P6 B2) and Day 2 post-Night-1-loss recovery (P10).
 */
export function pickDailyItems(
  items: readonly PawnItem[],
  day: number,
  rng: RngFn,
  count: number = DAILY_CUSTOMER_COUNT,
  options?: PickDailyItemsOptions,
): PawnItem[] {
  const shuffled = shuffleItems(items, rng);
  const redeemedDayByItem = options?.redeemedDayByItem;
  const ownedCards = options?.deck && options.deck.length > 0 ? new Set(options.deck) : null;

  const unownedNotRedeemed: PawnItem[] = [];
  const ownedNotRedeemed: PawnItem[] = [];
  const redeemed: PawnItem[] = [];
  for (const item of shuffled) {
    if (isItemRedeemedInChapter(item.id, redeemedDayByItem)) {
      redeemed.push(item);
    } else if (ownedCards && ownedCards.has(item.cardName)) {
      ownedNotRedeemed.push(item);
    } else {
      unownedNotRedeemed.push(item);
    }
  }

  // Sort redeemed fallback oldest-redeemed first so the most recently redeemed returns last
  if (redeemed.length > 1 && redeemedDayByItem) {
    redeemed.sort((a, b) => (redeemedDayByItem[a.id] ?? 0) - (redeemedDayByItem[b.id] ?? 0));
  }

  const orderedPool = [...unownedNotRedeemed, ...ownedNotRedeemed, ...redeemed];

  const picked = orderedPool.slice(0, count);

  if (day === 1 && picked.length > 0) {
    const hasDamageItem = picked.some((item) =>
      DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(item.id),
    );
    if (!hasDamageItem) {
      const replacement = orderedPool
        .slice(count)
        .find((item) => DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(item.id));
      if (replacement) {
        picked[picked.length - 1] = replacement;
      }
    }
  }

  if (day === 2 && options?.recoverDamageAfterDay1Loss && picked.length > 0) {
    const { money, deck } = options.recoverDamageAfterDay1Loss;
    const balance = options.balance ?? BALANCE;
    const owned = new Set(deck);
    const isAffordableDamage = (item: PawnItem): boolean =>
      DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(item.id) &&
      canAffordTier(money, item.trueValue, 'low', balance);

    const hasUnownedAffordable = picked.some(
      (item) => isAffordableDamage(item) && !owned.has(item.cardName),
    );
    if (!hasUnownedAffordable) {
      const unownedReplacement = orderedPool
        .slice(count)
        .find((item) => isAffordableDamage(item) && !owned.has(item.cardName));
      if (unownedReplacement) {
        let replaceIdx = picked.length - 1;
        for (let i = picked.length - 1; i >= 0; i -= 1) {
          if (!isAffordableDamage(picked[i])) {
            replaceIdx = i;
            break;
          }
        }
        picked[replaceIdx] = unownedReplacement;
      } else {
        const hasAnyAffordable = picked.some(isAffordableDamage);
        if (!hasAnyAffordable) {
          const fallbackReplacement = orderedPool.slice(count).find(isAffordableDamage);
          if (fallbackReplacement) {
            picked[picked.length - 1] = fallbackReplacement;
          }
        }
      }
    }
  }

  return picked;
}

export interface CreateRedemptionOfferOptions {
  /** 某天拒绝某件赎当的记录（itemId -> 绝对天 save.day），仅当天跳过该件（语义 A）。 */
  rejectedDayByItem?: Readonly<Record<string, number>>;
  /** 当前绝对天（save.day）。 */
  day?: number;
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
  priceMultiplier: number = REDEMPTION_PRICE_MULTIPLIER,
  options?: CreateRedemptionOfferOptions,
): RedemptionOffer | null {
  if (redeemTickets < 1 || deck.length === 0) {
    return null;
  }

  const itemByCard = new Map<string, PawnItem>();
  for (const item of items) {
    itemByCard.set(item.cardName, item);
  }

  const rejectedDayByItem = options?.rejectedDayByItem;
  const currentDay = options?.day;

  const candidates: { deckIndex: number; cardName: string; item: PawnItem }[] = [];
  for (let i = 0; i < deck.length; i += 1) {
    const cardName = deck[i];
    const matched = itemByCard.get(cardName);
    if (matched) {
      if (currentDay !== undefined && rejectedDayByItem?.[matched.id] === currentDay) {
        continue;
      }
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
  const payout = Math.round(basePrice * priceMultiplier);

  return {
    item: { ...chosen.item },
    deckIndex: chosen.deckIndex,
    cardName: chosen.cardName,
    basePrice,
    payout,
  };
}

/**
 * P10 子项 4：第 2 天新娘剧本化赎当（独立触发分支，不改动随机赎当 createRedemptionOffer）。
 * 若玩家第 1 天收下了婚戒（牌库里有「守诺」）且本事件尚未触发，第 2 天开张前必定触发。
 * 不要求持有赎当券、不消耗赎当券、不占当日随机赎当名额；倍率固定 1.2（复用 REDEMPTION_PRICE_MULTIPLIER）。
 */
export function createBrideRedemptionOffer(
  day: number,
  deck: readonly string[],
  pawnPrices: PawnPriceLedger,
  day1RingPawned: boolean,
  alreadyTriggered: boolean,
  items: readonly PawnItem[] = ITEMS,
  priceMultiplier: number = REDEMPTION_PRICE_MULTIPLIER,
): RedemptionOffer | null {
  if (day !== 2 || !day1RingPawned || alreadyTriggered) {
    return null;
  }

  const deckIndex = deck.indexOf(BRIDE_RING_CARD_NAME);
  if (deckIndex < 0) {
    return null;
  }

  const ringItem = items.find((item) => item.id === BRIDE_RING_ITEM_ID);
  if (!ringItem) {
    return null;
  }

  const recorded = peekPawnPrice(pawnPrices, BRIDE_RING_CARD_NAME);
  const basePrice = recorded !== null ? recorded : ringItem.trueValue;
  const payout = Math.round(basePrice * priceMultiplier);

  return {
    item: { ...ringItem },
    deckIndex,
    cardName: BRIDE_RING_CARD_NAME,
    basePrice,
    payout,
    isBrideScripted: true,
  };
}

/**
 * P11 子项 2②：第 7 天父亲过赎期回来事件（复用新娘事件模式，独立分支，不改动随机赎当）。
 * 触发条件：第 7 天白天开张前、牌库里仍有「倒转」（旧手表在库）、且本事件尚未触发（只触发一次）。
 * 倍率固定 1.2（REDEMPTION_PRICE_MULTIPLIER），不要求/不消耗赎当券。
 */
export function createFatherOverdueRedemptionOffer(
  dayInChapter: number,
  deck: readonly string[],
  pawnPrices: PawnPriceLedger,
  alreadyTriggered: boolean,
  items: readonly PawnItem[] = ITEMS,
  priceMultiplier: number = REDEMPTION_PRICE_MULTIPLIER,
): RedemptionOffer | null {
  if (dayInChapter !== 7 || alreadyTriggered) {
    return null;
  }

  const deckIndex = deck.indexOf(FATHER_WATCH_CARD_NAME);
  if (deckIndex < 0) {
    return null;
  }

  const watchItem = items.find((item) => item.id === FATHER_WATCH_ITEM_ID);
  if (!watchItem) {
    return null;
  }

  const recorded = peekPawnPrice(pawnPrices, FATHER_WATCH_CARD_NAME);
  const basePrice = recorded !== null ? recorded : watchItem.trueValue;
  const payout = Math.round(basePrice * priceMultiplier);

  return {
    item: { ...watchItem },
    deckIndex,
    cardName: FATHER_WATCH_CARD_NAME,
    basePrice,
    payout,
    isFatherOverdueScripted: true,
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
    phase: redemptionOffer ? 'redemption' : items.length === 0 ? 'summary' : 'negotiating',
    customerIndex: 0,
    money: opts.money ?? balance.startingMoney,
    reputation: opts.reputation ?? balance.startingReputation,
    deck: opts.deck ? [...opts.deck] : [],
    log: [],
    items: items.map((item) => ({ ...item })),
    lastOutcome: null,
    ...(opts.currentHp !== undefined ? { currentHp: opts.currentHp } : {}),
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

  const nextPhase: PawnshopPhase = state.items.length === 0 ? 'summary' : 'negotiating';

  if (offer.isBrideScripted || offer.isFatherOverdueScripted) {
    const logPrefix = offer.isFatherOverdueScripted ? '父亲过赎期赎当' : '新娘赎当';
    if (!accept) {
      return {
        ...state,
        phase: nextPhase,
        reputation: state.reputation - 1,
        deck: [...state.deck],
        log: [...state.log, `${logPrefix}:${offer.item.name}->拒绝(口碑-1)`],
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
      phase: nextPhase,
      money: state.money + offer.payout,
      reputation: state.reputation + 1,
      deck: nextDeck,
      log: [...state.log, `${logPrefix}:${offer.item.name}(+${offer.payout},牌-${offer.cardName},口碑+1)`],
      items: state.items.map((item) => ({ ...item })),
      lastOutcome: null,
      redeemTickets: currentTickets,
      pawnPrices: nextPrices,
      redemptionOffer: null,
    };
  }

  if (!accept || currentTickets < 1) {
    return {
      ...state,
      phase: nextPhase,
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
    phase: nextPhase,
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
    ...(state.currentHp !== undefined ? { currentHp: state.currentHp } : {}),
    ...(state.redeemTickets !== undefined ? { redeemTickets: state.redeemTickets } : {}),
    ...(nextPawnPrices !== undefined ? { pawnPrices: nextPawnPrices } : {}),
  };
}

export interface SkipCustomerOptions {
  reputationDelta?: number;
}

export function skipCustomer(
  state: PawnshopState,
  options?: SkipCustomerOptions,
): PawnshopState {
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

  const repDelta = options?.reputationDelta ?? 0;
  const nextIndex = state.customerIndex + 1;
  const isFinished = nextIndex >= state.items.length;
  const logEntry =
    repDelta !== 0
      ? `${currentItem.name}:跳过(口碑${formatSignedDelta(repDelta)})`
      : `${currentItem.name}:跳过`;

  return {
    day: state.day,
    phase: isFinished ? 'summary' : 'negotiating',
    customerIndex: nextIndex,
    money: state.money,
    reputation: state.reputation + repDelta,
    deck: [...state.deck],
    log: [...state.log, logEntry],
    items: state.items.map((item) => ({ ...item })),
    lastOutcome: null,
    ...(state.currentHp !== undefined ? { currentHp: state.currentHp } : {}),
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
    ...(state.currentHp !== undefined ? { currentHp: state.currentHp } : {}),
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

/** 结算牌组列表 >6 张时只列前 5 名，第 6 格写余数（任务书 18 §5；「共」不在字库，禁用）。 */
export function formatDeckRemainder(deckLength: number): string {
  return `等${deckLength - 5}张`;
}

export function formatDay3Rumor(text: string): string {
  return wrapCjkText(text, DAY3_RUMOR_WRAP_CHARS);
}
