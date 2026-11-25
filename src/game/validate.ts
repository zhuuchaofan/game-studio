import cardsJson from '../data/cards.json';
import demonsJson from '../data/demons.json';
import itemsJson from '../data/items.json';
import type { CardDef, CardEffectType, DemonDef } from './effects';
import type { CustomerTemperament, PawnItem } from './pawnshop';
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

export function validateAllGameData(
  cards: readonly CardDef[] = cardsJson as CardDef[],
  items: readonly PawnItem[] = itemsJson as PawnItem[],
  demons: readonly DemonDef[] = demonsJson as DemonDef[],
): DataValidationResult {
  const cardRes = validateCards(cards);
  const itemRes = validateItems(items, cards);
  const demonRes = validateDemons(demons);
  const errors = [...cardRes.errors, ...itemRes.errors, ...demonRes.errors];
  return { valid: errors.length === 0, errors };
}

export function assertValidGameData(
  cards: readonly CardDef[] = cardsJson as CardDef[],
  items: readonly PawnItem[] = itemsJson as PawnItem[],
  demons: readonly DemonDef[] = demonsJson as DemonDef[],
): void {
  const res = validateAllGameData(cards, items, demons);
  if (!res.valid) {
    throw new Error(`Game data validation failed:\n- ${res.errors.join('\n- ')}`);
  }
}
