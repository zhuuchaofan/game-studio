import { describe, expect, it } from 'vitest';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import itemsJson from '../../src/data/items.json';
import type { CardDef, DemonDef } from '../../src/game/effects';
import type { PawnItem } from '../../src/game/pawnshop';
import {
  assertValidGameData,
  validateAllGameData,
  validateCards,
  validateDemons,
  validateItems,
} from '../../src/game/validate';

const REAL_CARDS = cardsJson as CardDef[];
const REAL_ITEMS = itemsJson as PawnItem[];
const REAL_DEMONS = demonsJson as DemonDef[];

describe('Game data validator (src/game/validate.ts)', () => {
  it('passes on the real cards.json, items.json, and demons.json datasets', () => {
    const result = validateAllGameData(REAL_CARDS, REAL_ITEMS, REAL_DEMONS);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(() => assertValidGameData()).not.toThrow();
  });

  it('catches duplicate card id/name and negative or invalid effect parameters', () => {
    const brokenCards: CardDef[] = [
      ...REAL_CARDS.map((c) => ({ ...c, effects: c.effects.map((e) => ({ ...e })) })),
      {
        ...REAL_CARDS[0],
        effects: [{ type: 'damage', value: -3 }],
      },
    ];

    const res = validateCards(brokenCards);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('duplicate card id'))).toBe(true);
    expect(res.errors.some((e) => e.includes('duplicate card name'))).toBe(true);
    expect(res.errors.some((e) => e.includes('requires non-negative value'))).toBe(true);
  });

  it('catches missing cardName reference and off-palette colors in items.json', () => {
    const brokenItems: PawnItem[] = [
      ...REAL_ITEMS.map((i) => ({ ...i })),
      {
        id: 'fake_item',
        name: '假物件',
        trueValue: 50,
        story: '测试',
        cardName: '不存在的牌',
        cardCost: 1,
        color: '#FF00FF',
      },
    ];

    const res = validateItems(brokenItems, REAL_CARDS);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('does not exist in cards.json'))).toBe(true);
    expect(res.errors.some((e) => e.includes('not in the 16-color palette'))).toBe(true);
  });

  it('catches non-positive demon hp and discontinuous/missing round actions in demons.json', () => {
    const brokenDemons: DemonDef[] = [
      {
        id: 'bad_hp',
        name: '零血心魔',
        hp: 0,
        actions: [
          { round: 1, damage: 2 },
          { round: 3, damage: 5 },
        ],
      },
      {
        id: 'bad_rounds',
        name: '跳回合心魔',
        hp: 20,
        actions: [
          { round: 1, damage: 2 },
          { round: 3, damage: 4 },
          { round: 4, damage: 6 },
        ],
      },
    ];

    const res = validateDemons(brokenDemons);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('hp must be > 0'))).toBe(true);
    expect(res.errors.some((e) => e.includes('at least rounds 1/2/3'))).toBe(true);
    expect(res.errors.some((e) => e.includes('expected continuous round 2'))).toBe(true);
    expect(() => assertValidGameData(REAL_CARDS, REAL_ITEMS, brokenDemons)).toThrow();
  });
});
