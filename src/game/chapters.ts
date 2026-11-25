import chaptersJson from '../data/chapters.json';
import { hashSeed, mulberry32, type RngFn } from '../utils/rng';
import type { PawnItem } from './pawnshop';

export type PactId = 'high_margin' | 'credit_stock' | 'steady_shop';

export type SideQuestChoice = 'accepted' | 'rejected';

export type ChapterStatus = 'in_progress' | 'completed' | 'failed';

export interface ChapterDayConfig {
  day: number;
  demonPool: string[];
  isBossDay?: boolean;
  tag?: string;
  label?: string;
}

export interface PactDef {
  id: PactId;
  name: string;
  benefit: string;
  cost: string;
  redemptionMultiplier?: number;
  skipReputationDelta?: number;
  immediateMoney?: number;
  bossHpBonus?: number;
  immediateReputation?: number;
}

export interface SideQuestConfig {
  name: string;
  extraItemCount: number;
  nightDemonHpBonus: number;
  benefitText: string;
  costText: string;
}

export interface ChapterDiaryConfig {
  title: string;
  subtitle: string;
  body: string;
}

export interface ChapterConfig {
  id: number;
  name: string;
  days: number;
  bossId: string;
  itemPool: string[];
  day3Rumor: string;
  dailyDemonPools: ChapterDayConfig[];
  day4Pacts: PactDef[];
  day6SideQuest: SideQuestConfig;
  diary: ChapterDiaryConfig;
}

export interface ReservedChapterConfig {
  id: number;
  name: string;
  days: number;
  implemented: boolean;
  bossId: string | null;
}

export interface ChaptersDataFile {
  chapters: ChapterConfig[];
  reservedChapters?: ReservedChapterConfig[];
}

export interface ChapterSaveState {
  currentChapter: number;
  dayInChapter: number;
  chapter1Completed: boolean;
  chapter1FailedCount: number;
  status: ChapterStatus;
  bossBattleActive: boolean;
  pactChoice: PactId | null;
  sideQuestChoice: SideQuestChoice | null;
  daysCleared: number[];
  daysVisited: number[];
  pawnsCollected: number;
  demonsDefeated: number;
  day4TrimDone: boolean;
  day6SideQuestDone: boolean;
  /** P10 子项 4：第 1 天是否收下婚戒（仅收下时写入 true，向后兼容既有 v3 存档）。 */
  day1RingPawned?: boolean;
  /** P10 子项 4：第 2 天新娘剧本化赎当是否已触发结算（仅触发后写入 true，防止重复触发）。 */
  day2BrideRedemptionDone?: boolean;
  /** P11 子项 2②：第 7 天父亲过赎期回来事件是否已触发结算（唯一新增剧情持久字段，向后兼容 v3）。 */
  day7FatherRedemptionDone?: boolean;
  /** P11 子项 4 D1：旧物最近一次被赎回的天数映射（itemId -> day），供冷却与结局翻账本复用。 */
  redeemedDayByItem?: Record<string, number>;
  /** P11 子项 3 & 2③：本章已成交收下的旧物 ID 列表（供横幅条件文案与结局翻账本使用）。 */
  pawnedItemIds?: string[];
  /** P11 子项 2③：第 7 夜开战时实际构成 Boss 的旧物 ID 快照（供结局翻账本点名）。 */
  bossComponentItemIds?: string[];
}

export const CHAPTERS_DATA: ChaptersDataFile = chaptersJson as ChaptersDataFile;
export const CHAPTERS: readonly ChapterConfig[] = CHAPTERS_DATA.chapters;
export const CHAPTER_ONE_ID = 1;
export const CHAPTER_DAYS = 7;

export const DEFAULT_REDEMPTION_MULTIPLIER = 1.2;
export const HIGH_MARGIN_REDEMPTION_MULTIPLIER = 1.5;
export const HIGH_MARGIN_SKIP_REP_DELTA = -1;
export const CREDIT_STOCK_IMMEDIATE_MONEY = 80;
export const CREDIT_STOCK_BOSS_HP_BONUS = 6;
export const STEADY_SHOP_IMMEDIATE_REP = 1;
export const SIDE_QUEST_NIGHT_DEMON_HP_BONUS = 4;

export const VALID_PACT_IDS: readonly PactId[] = ['high_margin', 'credit_stock', 'steady_shop'];

export function isValidPactId(value: unknown): value is PactId {
  return value === 'high_margin' || value === 'credit_stock' || value === 'steady_shop';
}

export function isValidSideQuestChoice(value: unknown): value is SideQuestChoice {
  return value === 'accepted' || value === 'rejected';
}

export function isValidChapterStatus(value: unknown): value is ChapterStatus {
  return value === 'in_progress' || value === 'completed' || value === 'failed';
}

export function getChapterConfig(
  chapterId: number = CHAPTER_ONE_ID,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): ChapterConfig {
  const found = chapters.find((c) => c.id === chapterId);
  if (found) {
    return found;
  }
  return chapters[0];
}

export function getChapterDayConfig(
  chapterId: number,
  dayInChapter: number,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): ChapterDayConfig {
  const chapter = getChapterConfig(chapterId, chapters);
  const clamped = Math.min(chapter.days, Math.max(1, Math.floor(dayInChapter)));
  return chapter.dailyDemonPools.find((d) => d.day === clamped) ?? chapter.dailyDemonPools[0];
}

export function isBossDay(
  chapterId: number,
  dayInChapter: number,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): boolean {
  const dayCfg = getChapterDayConfig(chapterId, dayInChapter, chapters);
  return Boolean(dayCfg.isBossDay);
}

/**
 * Selects the night demon ID deterministically from chapters.json for (chapterId, dayInChapter, seed).
 * Replaces the fixed `(day - 1) % 4` rotation for chapter runs.
 */
export function selectDemonForChapterDay(
  chapterId: number,
  dayInChapter: number,
  seed: number = 1,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): string {
  const dayCfg = getChapterDayConfig(chapterId, dayInChapter, chapters);
  const pool = dayCfg.demonPool;
  if (pool.length === 0) {
    return 'a';
  }
  if (pool.length === 1) {
    return pool[0];
  }
  const rng = mulberry32(hashSeed(`${seed >>> 0}:ch${chapterId}:day${dayInChapter}:demon`));
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.min(idx, pool.length - 1)];
}

export function createInitialChapterState(
  overrides: Partial<ChapterSaveState> = {},
): ChapterSaveState {
  return {
    currentChapter: overrides.currentChapter ?? CHAPTER_ONE_ID,
    dayInChapter: overrides.dayInChapter ?? 1,
    chapter1Completed: overrides.chapter1Completed ?? false,
    chapter1FailedCount: overrides.chapter1FailedCount ?? 0,
    status: overrides.status ?? 'in_progress',
    bossBattleActive: overrides.bossBattleActive ?? false,
    pactChoice: overrides.pactChoice ?? null,
    sideQuestChoice: overrides.sideQuestChoice ?? null,
    daysCleared: overrides.daysCleared ? [...overrides.daysCleared] : [],
    daysVisited: overrides.daysVisited ? [...overrides.daysVisited] : [],
    pawnsCollected: overrides.pawnsCollected ?? 0,
    demonsDefeated: overrides.demonsDefeated ?? 0,
    day4TrimDone: overrides.day4TrimDone ?? false,
    day6SideQuestDone: overrides.day6SideQuestDone ?? false,
    ...(overrides.day1RingPawned !== undefined
      ? { day1RingPawned: overrides.day1RingPawned }
      : {}),
    ...(overrides.day2BrideRedemptionDone !== undefined
      ? { day2BrideRedemptionDone: overrides.day2BrideRedemptionDone }
      : {}),
    ...(overrides.day7FatherRedemptionDone !== undefined
      ? { day7FatherRedemptionDone: overrides.day7FatherRedemptionDone }
      : {}),
    ...(overrides.redeemedDayByItem !== undefined
      ? { redeemedDayByItem: { ...overrides.redeemedDayByItem } }
      : {}),
    ...(overrides.pawnedItemIds !== undefined
      ? { pawnedItemIds: [...overrides.pawnedItemIds] }
      : {}),
    ...(overrides.bossComponentItemIds !== undefined
      ? { bossComponentItemIds: [...overrides.bossComponentItemIds] }
      : {}),
  };
}

export function cloneChapterState(chapter: ChapterSaveState): ChapterSaveState {
  return {
    ...chapter,
    daysCleared: [...chapter.daysCleared],
    daysVisited: [...chapter.daysVisited],
    ...(chapter.redeemedDayByItem !== undefined
      ? { redeemedDayByItem: { ...chapter.redeemedDayByItem } }
      : {}),
    ...(chapter.pawnedItemIds !== undefined
      ? { pawnedItemIds: [...chapter.pawnedItemIds] }
      : {}),
    ...(chapter.bossComponentItemIds !== undefined
      ? { bossComponentItemIds: [...chapter.bossComponentItemIds] }
      : {}),
  };
}

export function getPactDef(
  pactId: PactId,
  chapterId: number = CHAPTER_ONE_ID,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): PactDef | null {
  const chapter = getChapterConfig(chapterId, chapters);
  return chapter.day4Pacts.find((p) => p.id === pactId) ?? null;
}

export function getRedemptionMultiplier(
  pactChoice: PactId | null | undefined,
  chapterId: number = CHAPTER_ONE_ID,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): number {
  if (!pactChoice) {
    return DEFAULT_REDEMPTION_MULTIPLIER;
  }
  const pact = getPactDef(pactChoice, chapterId, chapters);
  return pact?.redemptionMultiplier ?? DEFAULT_REDEMPTION_MULTIPLIER;
}

export function getSkipCustomerReputationDelta(
  pactChoice: PactId | null | undefined,
  chapterId: number = CHAPTER_ONE_ID,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): number {
  if (!pactChoice) {
    return 0;
  }
  const pact = getPactDef(pactChoice, chapterId, chapters);
  return pact?.skipReputationDelta ?? 0;
}

export function getBossHpBonus(
  pactChoice: PactId | null | undefined,
  chapterId: number = CHAPTER_ONE_ID,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): number {
  if (!pactChoice) {
    return 0;
  }
  const pact = getPactDef(pactChoice, chapterId, chapters);
  return pact?.bossHpBonus ?? 0;
}

export function getNightDemonHpBonus(
  chapterState: Pick<ChapterSaveState, 'currentChapter' | 'dayInChapter' | 'pactChoice' | 'sideQuestChoice'>,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): number {
  const chapter = getChapterConfig(chapterState.currentChapter, chapters);
  if (chapterState.dayInChapter === 6 && chapterState.sideQuestChoice === 'accepted') {
    return chapter.day6SideQuest.nightDemonHpBonus;
  }
  if (isBossDay(chapterState.currentChapter, chapterState.dayInChapter, chapters)) {
    return getBossHpBonus(chapterState.pactChoice, chapterState.currentChapter, chapters);
  }
  return 0;
}

export interface PactEffectDelta {
  moneyDelta: number;
  reputationDelta: number;
  bossHpBonus: number;
  redemptionMultiplier: number;
  skipReputationDelta: number;
}

export function getPactEffectDelta(
  pactId: PactId,
  chapterId: number = CHAPTER_ONE_ID,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): PactEffectDelta {
  const pact = getPactDef(pactId, chapterId, chapters);
  return {
    moneyDelta: pact?.immediateMoney ?? 0,
    reputationDelta: pact?.immediateReputation ?? 0,
    bossHpBonus: pact?.bossHpBonus ?? 0,
    redemptionMultiplier: pact?.redemptionMultiplier ?? DEFAULT_REDEMPTION_MULTIPLIER,
    skipReputationDelta: pact?.skipReputationDelta ?? 0,
  };
}

/**
 * Picks 1 item from `allItems` whose cardName is NOT currently in `deck` for Day 6 "偏巷暗当".
 * Falls back to drawing from `allItems` if the player already owns all 6 item cards.
 */
export function pickSideQuestItem(
  deck: readonly string[],
  allItems: readonly PawnItem[],
  rng: RngFn,
): PawnItem | null {
  if (allItems.length === 0) {
    return null;
  }
  const ownedCards = new Set(deck);
  const unowned = allItems.filter((item) => !ownedCards.has(item.cardName));
  const pool = unowned.length > 0 ? unowned : allItems;
  const idx = Math.floor(rng() * pool.length);
  return { ...pool[Math.min(idx, pool.length - 1)] };
}

export function deriveSideQuestSeed(baseSeed: number, chapterId: number, day: number): number {
  return hashSeed(`${baseSeed >>> 0}:ch${chapterId}:sidequest:${day}`);
}

/**
 * Pure helper to remove a single card at `deckIndex` for Day 4 "整理柜台".
 */
export function removeCardAtIndex(deck: readonly string[], deckIndex: number): string[] {
  if (deckIndex < 0 || deckIndex >= deck.length) {
    return [...deck];
  }
  return [...deck.slice(0, deckIndex), ...deck.slice(deckIndex + 1)];
}

export type CalendarDayStatus = 'cleared' | 'visited' | 'current' | 'upcoming';

export interface CalendarDayEntry {
  day: number;
  status: CalendarDayStatus;
  demonId: string;
  isBossDay: boolean;
  tag: string | null;
  label: string;
}

export function buildCalendarEntries(
  chapterState: ChapterSaveState,
  seed: number = 1,
  chapters: readonly ChapterConfig[] = CHAPTERS,
): CalendarDayEntry[] {
  const chapter = getChapterConfig(chapterState.currentChapter, chapters);
  const clearedSet = new Set(chapterState.daysCleared);
  const visitedSet = new Set(chapterState.daysVisited);

  return chapter.dailyDemonPools.map((dayCfg) => {
    const d = dayCfg.day;
    let status: CalendarDayStatus;
    if (clearedSet.has(d)) {
      status = 'cleared';
    } else if (
      chapterState.status === 'in_progress' &&
      d === chapterState.dayInChapter
    ) {
      status = 'current';
    } else if (visitedSet.has(d) || d < chapterState.dayInChapter) {
      status = 'visited';
    } else {
      status = 'upcoming';
    }

    return {
      day: d,
      status,
      demonId: selectDemonForChapterDay(chapter.id, d, seed, chapters),
      isBossDay: Boolean(dayCfg.isBossDay),
      tag: dayCfg.tag ?? null,
      label: dayCfg.label ?? '',
    };
  });
}
