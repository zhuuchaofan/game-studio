import cardsJson from '../data/cards.json';
import chaptersJson from '../data/chapters.json';
import demonsJson from '../data/demons.json';
import itemsJson from '../data/items.json';
import {
  CHAPTER_DAYS,
  isValidPactId,
  type ChapterConfig,
  type ChapterDayConfig,
  type ChaptersDataFile,
  type PactDef,
} from './chapters';
import type { CardDef, CardEffectType, DemonDef } from './effects';
import {
  DAILY_CUSTOMER_COUNT,
  REDEMPTION_COOLDOWN_DAYS,
  type CustomerTemperament,
  type PawnItem,
} from './pawnshop';
import { PIXEL_PALETTE } from './pixelart';

export interface DataValidationResult {
  valid: boolean;
  errors: string[];
}

const VALID_EFFECT_TYPES: ReadonlySet<CardEffectType> = new Set<CardEffectType>([
  'damage',
  'shield',
  'draw',
  'heal',
  'renqing',
  'renqing_next',
  'rewind',
  'illuminate',
  'reflect',
  'reveal',
  'damage_conditional',
  'discard_for_renqing',
]);

const VALUE_REQUIRED_EFFECTS: ReadonlySet<CardEffectType> = new Set<CardEffectType>([
  'damage',
  'shield',
  'draw',
  'heal',
  'renqing',
  'renqing_next',
  'damage_conditional',
  'discard_for_renqing',
]);

const VALID_TEMPERAMENTS: ReadonlySet<CustomerTemperament> = new Set<CustomerTemperament>([
  'urgent',
  'proud',
  'sentimental',
]);

const PALETTE_SET: ReadonlySet<string> = new Set(PIXEL_PALETTE.map((hex) => hex.toUpperCase()));

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function validateCards(cards: readonly CardDef[]): DataValidationResult {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  if (!Array.isArray(cards) || cards.length === 0) {
    return { valid: false, errors: ['cards.json must be a non-empty array'] };
  }

  cards.forEach((card, index) => {
    const label = `cards[${index}] (${card?.id ?? card?.name ?? 'unknown'})`;

    if (!isNonEmptyString(card.id)) {
      errors.push(`${label}: id must be a non-empty string`);
    } else if (seenIds.has(card.id)) {
      errors.push(`${label}: duplicate card id "${card.id}"`);
    } else {
      seenIds.add(card.id);
    }

    if (!isNonEmptyString(card.name)) {
      errors.push(`${label}: name must be a non-empty string`);
    } else if (seenNames.has(card.name)) {
      errors.push(`${label}: duplicate card name "${card.name}"`);
    } else {
      seenNames.add(card.name);
    }

    if (!isNonNegativeFinite(card.cost) || !Number.isInteger(card.cost)) {
      errors.push(`${label}: cost must be a non-negative integer, got ${String(card.cost)}`);
    }

    if (!Array.isArray(card.effects) || card.effects.length === 0) {
      errors.push(`${label}: effects must be a non-empty array`);
    } else {
      card.effects.forEach((effect: CardDef['effects'][number], effIdx: number) => {
        const effLabel = `${label}.effects[${effIdx}]`;
        if (!VALID_EFFECT_TYPES.has(effect.type)) {
          errors.push(`${effLabel}: unknown effect type "${String(effect.type)}"`);
          return;
        }
        if (VALUE_REQUIRED_EFFECTS.has(effect.type) && !isNonNegativeFinite(effect.value)) {
          errors.push(`${effLabel}: effect "${effect.type}" requires non-negative value, got ${String(effect.value)}`);
        } else if (effect.value !== undefined && !isNonNegativeFinite(effect.value)) {
          errors.push(`${effLabel}: value must be non-negative, got ${String(effect.value)}`);
        }
        if (effect.type === 'damage_conditional' && !isNonNegativeFinite(effect.bonus)) {
          errors.push(`${effLabel}: effect "damage_conditional" requires non-negative bonus, got ${String(effect.bonus)}`);
        } else if (effect.bonus !== undefined && !isNonNegativeFinite(effect.bonus)) {
          errors.push(`${effLabel}: bonus must be non-negative, got ${String(effect.bonus)}`);
        }
      });
    }

    if (card.color !== undefined && !PALETTE_SET.has(card.color.toUpperCase())) {
      errors.push(`${label}: color "${card.color}" is not in the 16-color palette`);
    }
  });

  return { valid: errors.length === 0, errors };
}

export function validateItems(
  items: readonly PawnItem[],
  cards: readonly CardDef[],
): DataValidationResult {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const cardByName = new Map<string, CardDef>();
  for (const card of cards) {
    cardByName.set(card.name, card);
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, errors: ['items.json must be a non-empty array'] };
  }

  items.forEach((item, index) => {
    const label = `items[${index}] (${item?.id ?? item?.name ?? 'unknown'})`;

    if (!isNonEmptyString(item.id)) {
      errors.push(`${label}: id must be a non-empty string`);
    } else if (seenIds.has(item.id)) {
      errors.push(`${label}: duplicate item id "${item.id}"`);
    } else {
      seenIds.add(item.id);
    }

    if (!isNonEmptyString(item.name)) {
      errors.push(`${label}: name must be a non-empty string`);
    }

    if (!isPositiveFinite(item.trueValue)) {
      errors.push(`${label}: trueValue must be > 0, got ${String(item.trueValue)}`);
    }

    if (!isNonNegativeFinite(item.cardCost) || !Number.isInteger(item.cardCost)) {
      errors.push(`${label}: cardCost must be a non-negative integer, got ${String(item.cardCost)}`);
    }

    const linkedCard = cardByName.get(item.cardName);
    if (!linkedCard) {
      errors.push(`${label}: cardName "${item.cardName}" does not exist in cards.json`);
    } else if (linkedCard.cost !== item.cardCost) {
      errors.push(
        `${label}: cardCost (${item.cardCost}) does not match card "${linkedCard.name}" cost (${linkedCard.cost})`,
      );
    }

    if (!isNonEmptyString(item.color) || !PALETTE_SET.has(item.color.toUpperCase())) {
      errors.push(`${label}: color "${String(item.color)}" is not in the 16-color palette`);
    }

    if (item.temperament !== undefined && !VALID_TEMPERAMENTS.has(item.temperament)) {
      errors.push(`${label}: invalid temperament "${String(item.temperament)}"`);
    }
  });

  return { valid: errors.length === 0, errors };
}

export function validateDemons(demons: readonly DemonDef[]): DataValidationResult {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  if (!Array.isArray(demons) || demons.length === 0) {
    return { valid: false, errors: ['demons.json must be a non-empty array'] };
  }

  demons.forEach((demon, index) => {
    const label = `demons[${index}] (${demon?.id ?? demon?.name ?? 'unknown'})`;

    if (!isNonEmptyString(demon.id)) {
      errors.push(`${label}: id must be a non-empty string`);
    } else if (seenIds.has(demon.id)) {
      errors.push(`${label}: duplicate demon id "${demon.id}"`);
    } else {
      seenIds.add(demon.id);
    }

    if (!isNonEmptyString(demon.name)) {
      errors.push(`${label}: name must be a non-empty string`);
    }

    if (!isPositiveFinite(demon.hp)) {
      errors.push(`${label}: hp must be > 0, got ${String(demon.hp)}`);
    }

    if (!Array.isArray(demon.actions) || demon.actions.length < 3) {
      errors.push(`${label}: actions must cover at least rounds 1/2/3, got ${demon.actions?.length ?? 0}`);
    } else {
      demon.actions.forEach((action: DemonDef['actions'][number], actionIdx: number) => {
        const expectedRound = actionIdx + 1;
        if (action.round !== expectedRound) {
          errors.push(
            `${label}.actions[${actionIdx}]: expected continuous round ${expectedRound}, got ${String(action.round)}`,
          );
        }
        if (!isNonNegativeFinite(action.damage)) {
          errors.push(
            `${label}.actions[${actionIdx}]: damage must be non-negative, got ${String(action.damage)}`,
          );
        }
      });
    }
  });

  return { valid: errors.length === 0, errors };
}

export function validateChapters(
  chaptersFile: ChaptersDataFile | readonly ChapterConfig[],
  demons: readonly DemonDef[],
  items: readonly PawnItem[],
): DataValidationResult {
  const errors: string[] = [];
  const chapters = Array.isArray(chaptersFile)
    ? chaptersFile
    : (chaptersFile as ChaptersDataFile)?.chapters;

  if (!Array.isArray(chapters) || chapters.length === 0) {
    return { valid: false, errors: ['chapters.json must contain a non-empty chapters array'] };
  }

  const demonById = new Map<string, DemonDef>();
  for (const d of demons) {
    demonById.set(d.id, d);
  }
  const itemById = new Map<string, PawnItem>();
  for (const item of items) {
    itemById.set(item.id, item);
  }

  const seenChapterIds = new Set<number>();

  chapters.forEach((chapter, index) => {
    const label = `chapters[${index}] (id=${String(chapter?.id)})`;

    if (typeof chapter.id !== 'number' || !Number.isInteger(chapter.id) || chapter.id < 1) {
      errors.push(`${label}: id must be a positive integer`);
    } else if (seenChapterIds.has(chapter.id)) {
      errors.push(`${label}: duplicate chapter id ${chapter.id}`);
    } else {
      seenChapterIds.add(chapter.id);
    }

    if (!isNonEmptyString(chapter.name)) {
      errors.push(`${label}: name must be a non-empty string`);
    }

    if (chapter.days !== CHAPTER_DAYS) {
      errors.push(`${label}: days must be ${CHAPTER_DAYS}, got ${String(chapter.days)}`);
    }

    // Validate Boss reference, 4-round action length, and P11 Boss composition table
    const boss = demonById.get(chapter.bossId);
    if (!boss) {
      errors.push(`${label}: bossId "${String(chapter.bossId)}" does not exist in demons.json`);
    } else {
      if (!Array.isArray(boss.actions) || boss.actions.length !== 4) {
        errors.push(
          `${label}: boss "${boss.id}" actions length must be 4, got ${boss.actions?.length ?? 0}`,
        );
      }
      if (boss.composition) {
        const comp = boss.composition;
        if (!isPositiveFinite(comp.baseHp)) {
          errors.push(`${label}: boss "${boss.id}" composition.baseHp must be > 0`);
        }
        if (
          !isPositiveFinite(comp.maxCompositionHp) ||
          comp.maxCompositionHp < comp.baseHp
        ) {
          errors.push(
            `${label}: boss "${boss.id}" composition.maxCompositionHp must be >= baseHp`,
          );
        }
        if (
          !isPositiveFinite(comp.absoluteMaxHp) ||
          comp.absoluteMaxHp < comp.maxCompositionHp
        ) {
          errors.push(
            `${label}: boss "${boss.id}" composition.absoluteMaxHp must be >= maxCompositionHp`,
          );
        }
        if (!Array.isArray(comp.components) || comp.components.length === 0) {
          errors.push(`${label}: boss "${boss.id}" composition.components must be non-empty`);
        } else {
          const seenCompItems = new Set<string>();
          comp.components.forEach((entry, cIdx) => {
            const compLabel = `${label}: boss "${boss.id}" composition.components[${cIdx}]`;
            const refItem = itemById.get(entry.itemId);
            if (!refItem) {
              errors.push(`${compLabel}: unknown itemId "${String(entry.itemId)}"`);
            } else if (refItem.cardName !== entry.cardName) {
              errors.push(
                `${compLabel}: cardName "${String(entry.cardName)}" does not match item "${refItem.id}" cardName "${refItem.cardName}"`,
              );
            }
            if (seenCompItems.has(entry.itemId)) {
              errors.push(`${compLabel}: duplicate itemId "${entry.itemId}"`);
            } else {
              seenCompItems.add(entry.itemId);
            }
            if (!isNonNegativeFinite(entry.hpBonus)) {
              errors.push(`${compLabel}: hpBonus must be non-negative`);
            }
            if (!isNonNegativeFinite(entry.shield)) {
              errors.push(`${compLabel}: shield must be non-negative`);
            }
            if (!isNonNegativeFinite(entry.chargeThresholdDelta)) {
              errors.push(`${compLabel}: chargeThresholdDelta must be non-negative`);
            }
          });
        }
      }
    }

    // Validate itemPool references & P11 D1 post-exclusion pool non-emptiness
    if (!Array.isArray(chapter.itemPool) || chapter.itemPool.length === 0) {
      errors.push(`${label}: itemPool must be a non-empty array`);
    } else {
      chapter.itemPool.forEach((itemId: string) => {
        if (!itemById.has(itemId)) {
          errors.push(`${label}: itemPool references unknown item "${itemId}"`);
        }
      });
      const uniquePoolCount = new Set(chapter.itemPool).size;
      const maxSimultaneousRedemptions = REDEMPTION_COOLDOWN_DAYS;
      if (uniquePoolCount - maxSimultaneousRedemptions < DAILY_CUSTOMER_COUNT) {
        errors.push(
          `${label}: itemPool (${uniquePoolCount} unique items) must retain at least ${DAILY_CUSTOMER_COUNT} items after ${maxSimultaneousRedemptions}-day D1 redemption cooldown exclusion`,
        );
      }
    }

    // Validate dailyDemonPools cover days 1..7, each non-empty, all demonIds valid
    if (!Array.isArray(chapter.dailyDemonPools) || chapter.dailyDemonPools.length !== CHAPTER_DAYS) {
      errors.push(
        `${label}: dailyDemonPools must have exactly ${CHAPTER_DAYS} entries, got ${chapter.dailyDemonPools?.length ?? 0}`,
      );
    } else {
      chapter.dailyDemonPools.forEach((dayCfg: ChapterDayConfig, dayIdx: number) => {
        const expectedDay = dayIdx + 1;
        const dayLabel = `${label}.dailyDemonPools[${dayIdx}]`;
        if (dayCfg.day !== expectedDay) {
          errors.push(`${dayLabel}: expected day ${expectedDay}, got ${String(dayCfg.day)}`);
        }
        if (!Array.isArray(dayCfg.demonPool) || dayCfg.demonPool.length === 0) {
          errors.push(`${dayLabel}: demonPool must be non-empty`);
        } else {
          dayCfg.demonPool.forEach((demonId: string) => {
            if (!demonById.has(demonId)) {
              errors.push(`${dayLabel}: demonPool references unknown demon "${demonId}"`);
            }
          });
        }
      });
    }

    // Validate Day 4 pacts
    if (!Array.isArray(chapter.day4Pacts) || chapter.day4Pacts.length !== 3) {
      errors.push(`${label}: day4Pacts must contain exactly 3 pacts`);
    } else {
      const seenPacts = new Set<string>();
      chapter.day4Pacts.forEach((pact: PactDef, pIdx: number) => {
        if (!isValidPactId(pact.id)) {
          errors.push(`${label}.day4Pacts[${pIdx}]: invalid pact id "${String(pact.id)}"`);
        } else if (seenPacts.has(pact.id)) {
          errors.push(`${label}.day4Pacts[${pIdx}]: duplicate pact id "${pact.id}"`);
        } else {
          seenPacts.add(pact.id);
        }
        if (!isNonEmptyString(pact.name)) {
          errors.push(`${label}.day4Pacts[${pIdx}]: name must be non-empty`);
        }
      });
    }

    if (!isNonEmptyString(chapter.day3Rumor)) {
      errors.push(`${label}: day3Rumor must be non-empty`);
    }

    if (!chapter.diary || !isNonEmptyString(chapter.diary.body)) {
      errors.push(`${label}: diary.body must be non-empty`);
    }
  });

  return { valid: errors.length === 0, errors };
}

export function validateAllGameData(
  cards: readonly CardDef[] = cardsJson as CardDef[],
  items: readonly PawnItem[] = itemsJson as PawnItem[],
  demons: readonly DemonDef[] = demonsJson as DemonDef[],
  chaptersFile: ChaptersDataFile | readonly ChapterConfig[] = chaptersJson as ChaptersDataFile,
): DataValidationResult {
  const cardRes = validateCards(cards);
  const itemRes = validateItems(items, cards);
  const demonRes = validateDemons(demons);
  const chapterRes = validateChapters(chaptersFile, demons, items);
  const errors = [...cardRes.errors, ...itemRes.errors, ...demonRes.errors, ...chapterRes.errors];
  return { valid: errors.length === 0, errors };
}

export function assertValidGameData(
  cards: readonly CardDef[] = cardsJson as CardDef[],
  items: readonly PawnItem[] = itemsJson as PawnItem[],
  demons: readonly DemonDef[] = demonsJson as DemonDef[],
  chaptersFile: ChaptersDataFile | readonly ChapterConfig[] = chaptersJson as ChaptersDataFile,
): void {
  const res = validateAllGameData(cards, items, demons, chaptersFile);
  if (!res.valid) {
    throw new Error(`Game data validation failed:\n- ${res.errors.join('\n- ')}`);
  }
}
