import demonsJson from '../data/demons.json';
import { getBossHpBonus, type ChapterSaveState, type PactId } from './chapters';
import type {
  BossComponentDef,
  BossCompositionConfig,
  DemonAction,
  DemonDef,
} from './effects';
import { ITEMS, type PawnItem } from './pawnshop';

export interface ComposedBossResult {
  /** Ready-to-fight DemonDef with composed HP, R1 shield, round damage deltas, and charge threshold. */
  bossDef: DemonDef;
  /** Deduplicated active components present in the player's deck (0..6). */
  activeComponents: BossComponentDef[];
  /** Full configured component table in canonical order. */
  allComponents: BossComponentDef[];
  /** Deduplicated component count (0..6). */
  componentCount: number;
  /** True when 0 pawnshop item cards are in deck (素体 fallback). */
  isBare: boolean;
  baseHp: number;
  componentHpBonus: number;
  pactHpBonus: number;
  rawTotalHp: number;
  finalHp: number;
  maxCompositionHp: number;
  absoluteMaxHp: number;
  /** True when rawTotalHp > absoluteMaxHp (e.g. 6 components 44 + credit_stock 6 = 50 -> capped at 48). */
  hpCapped: boolean;
  r1Shield: number;
  chargeThreshold: number;
  fragmentNames: string[];
  introSummary: string;
  /** Concise per-component effect lines for previews & battle reports. */
  contributionLines: string[];
}

export interface DemonNarrativeResolution {
  isLinked: boolean;
  linkedItemId: string | null;
  customerLink: string;
  aftermathLine: string;
}

export interface EndingLedgerSummary {
  /** Items redeemed during the chapter and no longer in cabinet at Night 7 Boss fight. */
  returnedItems: string[];
  /** Pawnshop items still kept in cabinet at the end of the chapter. */
  retainedItems: string[];
  /** Items whose执念 formed the Night 7 Boss fragments. */
  bossFragmentItems: string[];
  /** All items pawned during the chapter (deduplicated). */
  pawnedItems: string[];
  /** Ready-to-render Chinese ledger summary lines. */
  lines: string[];
}

const DEFAULT_DEMONS: readonly DemonDef[] = demonsJson as DemonDef[];

export const DEFAULT_BOSS_ID = 'boss_ch1';
export const DEFAULT_BARE_BOSS_INTRO = '柜子空了，债主只身前来';
export const DEFAULT_COMPOSED_BOSS_INTRO = '柜子里的事，今夜一起上门了';
export const DEFAULT_GENERIC_CUSTOMER_LINK = '老街上又一桩没了结的事，今夜找上门来';
export const DEFAULT_GENERIC_AFTERMATH = '今晚扛过去了，老街的账还得一笔笔算。';
export const MONTH_END_EPILOGUE_TITLE = '月末结算 · 掌柜回铺对账';

export function getBossDemonDef(
  demons: readonly DemonDef[] = DEFAULT_DEMONS,
  bossId: string = DEFAULT_BOSS_ID,
): DemonDef {
  const found = demons.find((d) => d.id === bossId) ?? demons.find((d) => d.isBoss);
  if (!found) {
    throw new Error(`Boss demon not found: ${bossId}`);
  }
  return found;
}

export function getBossCompositionConfig(
  baseBoss: DemonDef = getBossDemonDef(),
): BossCompositionConfig {
  if (!baseBoss.composition) {
    throw new Error(`Boss "${baseBoss.id}" is missing composition config in demons.json`);
  }
  return baseBoss.composition;
}

/**
 * Pure Boss composition function (P11 Sub-item 1):
 * Computes the Night 7 Boss definition from the player's current deck + pact state.
 * - Counts deduplicated pawnshop item cards (0..6); duplicate copies of the same item count once.
 * - Non-item victory reward cards do not count.
 * - Base HP 32, +2 per component (composition cap 44), +6 for credit_stock pact,
 *   absolute cap 48 (with hpCapped=true so pre-battle preview explicitly states "已到顶").
 * - 0 components falls back cleanly to bare Boss (素体) with introLine "柜子空了，债主只身前来".
 * - Does not alter R2 charge/interrupt rules; only adds JSON-driven deltas.
 */
export function composeBoss(
  deck: readonly string[],
  pactChoice?: PactId | null,
  baseBoss: DemonDef = getBossDemonDef(),
): ComposedBossResult {
  const config = getBossCompositionConfig(baseBoss);
  const ownedCards = new Set(deck);

  const allComponents = config.components.map((c) => ({
    ...c,
    roundDeltas: { ...c.roundDeltas },
  }));
  const activeComponents = allComponents.filter((c) => ownedCards.has(c.cardName));
  const componentCount = activeComponents.length;
  const isBare = componentCount === 0;

  const baseHp = config.baseHp;
  const rawComponentBonus = activeComponents.reduce((sum, c) => sum + c.hpBonus, 0);
  const compositionHp = Math.min(config.maxCompositionHp, baseHp + rawComponentBonus);
  const componentHpBonus = compositionHp - baseHp;
  const pactHpBonus = getBossHpBonus(pactChoice ?? null);
  const rawTotalHp = compositionHp + pactHpBonus;
  const finalHp = Math.min(config.absoluteMaxHp, rawTotalHp);
  const hpCapped = rawTotalHp > config.absoluteMaxHp;

  let r1Shield = 0;
  let chargeThresholdDeltaTotal = 0;
  const roundDamageDeltas = new Map<number, number>();

  for (const comp of activeComponents) {
    r1Shield += comp.shield;
    chargeThresholdDeltaTotal += comp.chargeThresholdDelta;
    for (const [roundKey, delta] of Object.entries(comp.roundDeltas)) {
      const roundNum = Number(roundKey);
      if (Number.isInteger(roundNum) && delta !== 0) {
        roundDamageDeltas.set(roundNum, (roundDamageDeltas.get(roundNum) ?? 0) + delta);
      }
    }
  }

  let chargeThreshold = 10;
  const composedActions: DemonAction[] = baseBoss.actions.map((action) => {
    const nextAction: DemonAction = {
      ...action,
      ...(action.charge ? { charge: { ...action.charge } } : {}),
    };
    const dmgDelta = roundDamageDeltas.get(action.round) ?? 0;
    if (dmgDelta !== 0) {
      nextAction.damage = Math.max(0, nextAction.damage + dmgDelta);
    }
    if (action.round === 1 && r1Shield > 0) {
      nextAction.shield = (nextAction.shield ?? 0) + r1Shield;
    }
    if (nextAction.charge) {
      nextAction.charge.threshold += chargeThresholdDeltaTotal;
      chargeThreshold = nextAction.charge.threshold;
    }
    return nextAction;
  });

  const fragmentNames = activeComponents.map((c) => c.fragmentName);
  const introSummary = isBare
    ? (config.bareIntroLine || DEFAULT_BARE_BOSS_INTRO)
    : (config.composedIntroLine || DEFAULT_COMPOSED_BOSS_INTRO);

  const contributionLines = activeComponents.map(
    (c) => `${c.fragmentName}：血+${c.hpBonus}，${c.effectText}`,
  );

  const bossDef: DemonDef = {
    ...baseBoss,
    hp: finalHp,
    introLine: introSummary,
    customerLink: isBare ? '' : fragmentNames.join(' · '),
    actions: composedActions,
  };

  return {
    bossDef,
    activeComponents,
    allComponents,
    componentCount,
    isBare,
    baseHp,
    componentHpBonus,
    pactHpBonus,
    rawTotalHp,
    finalHp,
    maxCompositionHp: config.maxCompositionHp,
    absoluteMaxHp: config.absoluteMaxHp,
    hpCapped,
    r1Shield,
    chargeThreshold,
    fragmentNames,
    introSummary,
    contributionLines,
  };
}

/**
 * Formats the Day 7 Calendar constant preview line:
 * 「第7夜，债主带着X件旧物的执念上门（Boss约Y血）」 (or with 已到顶 when capped, <=304px).
 */
export function formatCalendarBossPreviewText(composed: ComposedBossResult): string {
  if (composed.hpCapped) {
    return `第7夜，债主带${composed.componentCount}件执念上门（Boss${composed.finalHp}血·已到顶）`;
  }
  return `第7夜，债主带着${composed.componentCount}件旧物的执念上门（Boss约${composed.finalHp}血）`;
}

/**
 * Formats the Day 7 pre-opening HP breakdown line, explicitly noting "已到顶" on cap truncation.
 */
export function formatBossPreviewHpLine(composed: ComposedBossResult): string {
  if (composed.hpCapped) {
    return `血量:${composed.finalHp}[已到顶](基${composed.baseHp}+执念${composed.componentHpBonus}+赊账${composed.pactHpBonus},上限${composed.absoluteMaxHp})`;
  }
  const pactPart = composed.pactHpBonus > 0 ? `+赊账${composed.pactHpBonus}` : '';
  if (composed.isBare) {
    return `血量:${composed.finalHp}(基${composed.baseHp}${pactPart}·素体无执念,上限${composed.absoluteMaxHp})`;
  }
  return `血量:${composed.finalHp}(基${composed.baseHp}+执念${composed.componentHpBonus}${pactPart},上限${composed.absoluteMaxHp})`;
}

/**
 * P11 Sub-item 3: Conditional demon banner & victory aftermath narrative resolution.
 * Shows specific customer link / aftermath ONLY when the demon's linked item was pawned in
 * this chapter AND its card is still currently in the player's deck; otherwise returns
 * grounded generic copy. Does not alter dailyDemonPools or any numbers.
 */
export function resolveDemonNarrative(
  demon: DemonDef,
  deck: readonly string[],
  pawnedItemIds: readonly string[],
  items: readonly PawnItem[] = ITEMS,
): DemonNarrativeResolution {
  if (demon.isBoss || !demon.linkedItemId) {
    return {
      isLinked: false,
      linkedItemId: null,
      customerLink: demon.customerLink ?? '',
      aftermathLine: demon.aftermathLine ?? '',
    };
  }

  const linkedItem = items.find((item) => item.id === demon.linkedItemId);
  const isLinked = Boolean(
    linkedItem &&
      pawnedItemIds.includes(demon.linkedItemId) &&
      deck.includes(linkedItem.cardName),
  );

  return {
    isLinked,
    linkedItemId: demon.linkedItemId,
    customerLink: isLinked
      ? (demon.customerLink ?? '')
      : (demon.genericCustomerLink ?? DEFAULT_GENERIC_CUSTOMER_LINK),
    aftermathLine: isLinked
      ? (demon.aftermathLine ?? '')
      : (demon.genericAftermathLine ?? DEFAULT_GENERIC_AFTERMATH),
  };
}

/**
 * P11 Sub-item 2③: Builds the factual Ending Ledger ("结局翻账本") strictly from actual
 * redemption history, final cabinet deck, and the actual Night 7 Boss composition.
 */
export function buildEndingLedger(
  deck: readonly string[],
  chapter: Pick<
    ChapterSaveState,
    'pawnedItemIds' | 'redeemedDayByItem' | 'bossComponentItemIds'
  >,
  items: readonly PawnItem[] = ITEMS,
): EndingLedgerSummary {
  const ownedCards = new Set(deck);
  const redeemedSet = new Set(Object.keys(chapter.redeemedDayByItem ?? {}));
  const pawnedSet = new Set(chapter.pawnedItemIds ?? []);

  // Boss fragments: use recorded Night 7 Boss snapshot if present, otherwise derive from deck
  const bossIds =
    chapter.bossComponentItemIds !== undefined
      ? new Set(chapter.bossComponentItemIds)
      : new Set(items.filter((i) => ownedCards.has(i.cardName)).map((i) => i.id));

  const returnedItems: string[] = [];
  const retainedItems: string[] = [];
  const bossFragmentItems: string[] = [];
  const pawnedItems: string[] = [];

  for (const item of items) {
    const inCabinet = ownedCards.has(item.cardName);
    const wasBossFragment = bossIds.has(item.id);
    const wasRedeemed = redeemedSet.has(item.id);

    if (pawnedSet.has(item.id) || inCabinet || wasRedeemed) {
      pawnedItems.push(item.name);
    }
    if (wasBossFragment) {
      bossFragmentItems.push(item.name);
    }
    if (inCabinet) {
      retainedItems.push(item.name);
    } else if (wasRedeemed) {
      returnedItems.push(item.name);
    }
  }

  const returnedStr = returnedItems.length > 0 ? returnedItems.join('、') : '无';
  const retainedStr = retainedItems.length > 0 ? retainedItems.join('、') : '柜子空了';
  const bossStr =
    bossFragmentItems.length > 0
      ? `${bossFragmentItems.join('、')}(${bossFragmentItems.length}块)`
      : '无(债主只身前来)';

  return {
    returnedItems,
    retainedItems,
    bossFragmentItems,
    pawnedItems,
    lines: [
      `物归原主:${returnedStr}`,
      `留柜未赎:${retainedStr}`,
      `化作执念:${bossStr}`,
    ],
  };
}

/**
 * P11 Sub-item 2①: Month-end epilogue lines after Chapter 3 ending (no new playable days).
 */
export function buildMonthEndEpilogueLines(
  ledger: EndingLedgerSummary,
  chapterId: number,
): string[] {
  const scopeLabel =
    chapterId >= 3
      ? '三周二十一天看铺期满，掌柜提着包袱回铺翻账。'
      : `第${chapterId}周账目已录，月末掌柜归来一并核对。`;
  return [
    scopeLabel,
    ...ledger.lines,
    '当票与旧物一笔不差，这趟老街看铺，算交差了。',
  ];
}
