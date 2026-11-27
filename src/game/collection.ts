import cardsJson from '../data/cards.json';
import collectionJson from '../data/collection.json';
import heirloomsJson from '../data/heirlooms.json';
import itemsJson from '../data/items.json';
import {
  CHAPTER_ONE_ID,
  CHAPTERS,
  getChapterConfig,
  type ChapterConfig,
  type ChapterSaveState,
} from './chapters';
import type { CardDef } from './effects';
import type { HeirloomDef } from './heirlooms';
import type { PawnItem } from './pawnshop';

export const DIARY_FRAGMENT_IDS = ['first_clear', 'redeem_5_items', 'own_10_cards'] as const;
export type DiaryFragmentId = (typeof DIARY_FRAGMENT_IDS)[number];

export const DIARY_REDEEM_THRESHOLD = 5;
export const DIARY_DECK_THRESHOLD = 10;

export interface DiaryFragmentDef {
  id: DiaryFragmentId;
  text: string;
}

export interface CollectionDataFile {
  aftermaths: Record<string, string>;
  diaryFragments: DiaryFragmentDef[];
}

export interface CollectionCounts {
  seenItemsCount: number;
  totalItems: number;
  seenCardsCount: number;
  totalCards: number;
  ownedHeirloomsCount: number;
  totalHeirlooms: number;
}

const COLLECTION_DATA = collectionJson as CollectionDataFile;

export const COLLECTION_AFTERMATHS: Readonly<Record<string, string>> = COLLECTION_DATA.aftermaths;

const ALL_CARDS = cardsJson as CardDef[];
const ALL_ITEMS = itemsJson as PawnItem[];
const ALL_HEIRLOOMS = heirloomsJson as HeirloomDef[];

/**
 * Extracts the first sentence (without trailing period) from chapter diary body.
 */
export function getFirstSentence(body: string): string {
  const trimmed = body.trim();
  const idx = trimmed.indexOf('。');
  if (idx >= 0) {
    return trimmed.slice(0, idx);
  }
  return trimmed;
}

/**
 * Returns the 3 diary fragment definitions; fragment (i) always matches chapters.json diary.body first sentence.
 */
export function getDiaryFragments(
  chapters: readonly ChapterConfig[] = CHAPTERS,
): readonly DiaryFragmentDef[] {
  const firstSentence = getFirstSentence(getChapterConfig(CHAPTER_ONE_ID, chapters).diary.body);
  return COLLECTION_DATA.diaryFragments.map((frag) =>
    frag.id === 'first_clear' ? { ...frag, text: firstSentence } : { ...frag },
  );
}

/**
 * Returns the post-redemption aftermath line for an item id, or null if not defined.
 */
export function getAftermathLine(itemId: string): string | null {
  return COLLECTION_AFTERMATHS[itemId] ?? null;
}

/**
 * Returns collectible cards (excludes unplayable penalty cards such as debt_note).
 */
export function getCollectibleCards(cards: readonly CardDef[] = ALL_CARDS): CardDef[] {
  return cards.filter((c) => !c.unplayable);
}

/**
 * Resolves a deck card name to its collectible card id, returning null for unplayable or unknown cards.
 */
export function getCardIdByName(
  cardName: string,
  cards: readonly CardDef[] = ALL_CARDS,
): string | null {
  const found = cards.find((c) => c.name === cardName && !c.unplayable);
  return found ? found.id : null;
}

/**
 * Appends `value` to `list` if non-empty and not already present.
 */
export function appendUniqueString(
  list: readonly string[] | undefined,
  value: string,
): string[] {
  const base = list ? [...list] : [];
  if (!value || base.includes(value)) {
    return base;
  }
  base.push(value);
  return base;
}

export interface DiaryUnlockInput {
  chapter1Completed: boolean;
  redeemedItems: readonly string[];
  deckLength: number;
  existingFragments?: readonly string[];
}

/**
 * Evaluates and returns the updated unique list of unlocked diary fragment ids.
 */
export function evaluateDiaryFragmentUnlocks(input: DiaryUnlockInput): string[] {
  let result = input.existingFragments ? [...new Set(input.existingFragments)] : [];
  if (input.chapter1Completed) {
    result = appendUniqueString(result, 'first_clear');
  }
  if (new Set(input.redeemedItems).size >= DIARY_REDEEM_THRESHOLD) {
    result = appendUniqueString(result, 'redeem_5_items');
  }
  if (input.deckLength >= DIARY_DECK_THRESHOLD) {
    result = appendUniqueString(result, 'own_10_cards');
  }
  return result;
}

/**
 * Records seen item & card and evaluates diary fragment unlocks upon a pawnshop deal.
 */
export function recordDealCollection(
  chapter: ChapterSaveState,
  itemId: string,
  cardName: string,
  deckLength: number,
  cards: readonly CardDef[] = ALL_CARDS,
): ChapterSaveState {
  const seenItems = appendUniqueString(chapter.seenItems, itemId);
  const cardId = getCardIdByName(cardName, cards);
  const seenCards = cardId
    ? appendUniqueString(chapter.seenCards, cardId)
    : [...(chapter.seenCards ?? [])];
  const redeemedItems = [...(chapter.redeemedItems ?? [])];
  const diaryFragments = evaluateDiaryFragmentUnlocks({
    chapter1Completed: chapter.chapter1Completed,
    redeemedItems,
    deckLength,
    existingFragments: chapter.diaryFragments,
  });
  return {
    ...chapter,
    seenItems,
    seenCards,
    redeemedItems,
    diaryFragments,
  };
}

/**
 * Records redeemed & seen item and evaluates diary fragment unlocks upon accepting redemption.
 */
export function recordRedemptionCollection(
  chapter: ChapterSaveState,
  itemId: string,
  deckLength: number,
): ChapterSaveState {
  const redeemedItems = appendUniqueString(chapter.redeemedItems, itemId);
  const seenItems = appendUniqueString(chapter.seenItems, itemId);
  const seenCards = [...(chapter.seenCards ?? [])];
  const diaryFragments = evaluateDiaryFragmentUnlocks({
    chapter1Completed: chapter.chapter1Completed,
    redeemedItems,
    deckLength,
    existingFragments: chapter.diaryFragments,
  });
  return {
    ...chapter,
    seenItems,
    seenCards,
    redeemedItems,
    diaryFragments,
  };
}

/**
 * Records a collectible card by card name into `seenCards` (ignores unplayable cards).
 */
export function recordCardSeen(
  chapter: ChapterSaveState,
  cardName: string,
  cards: readonly CardDef[] = ALL_CARDS,
): ChapterSaveState {
  const cardId = getCardIdByName(cardName, cards);
  if (!cardId) {
    return chapter;
  }
  return {
    ...chapter,
    seenCards: appendUniqueString(chapter.seenCards, cardId),
  };
}

/**
 * Computes collection progress counts against current item/card/heirloom pools.
 */
export function computeCollectionCounts(
  chapter: Pick<ChapterSaveState, 'seenItems' | 'seenCards' | 'heirlooms'>,
  items: readonly PawnItem[] = ALL_ITEMS,
  cards: readonly CardDef[] = ALL_CARDS,
  heirlooms: readonly HeirloomDef[] = ALL_HEIRLOOMS,
): CollectionCounts {
  const validItemIds = new Set(items.map((i) => i.id));
  const collectibleCards = getCollectibleCards(cards);
  const validCardIds = new Set(collectibleCards.map((c) => c.id));
  const validHeirloomIds = new Set(heirlooms.map((h) => h.id));

  const seenItemsSet = new Set((chapter.seenItems ?? []).filter((id) => validItemIds.has(id)));
  const seenCardsSet = new Set((chapter.seenCards ?? []).filter((id) => validCardIds.has(id)));
  const ownedHeirloomsSet = new Set(
    (chapter.heirlooms ?? []).filter((id) => validHeirloomIds.has(id)),
  );

  return {
    seenItemsCount: seenItemsSet.size,
    totalItems: items.length,
    seenCardsCount: seenCardsSet.size,
    totalCards: collectibleCards.length,
    ownedHeirloomsCount: ownedHeirloomsSet.size,
    totalHeirlooms: heirlooms.length,
  };
}
