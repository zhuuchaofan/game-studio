import { describe, expect, it } from 'vitest';
import {
  advanceCustomer,
  BALANCE,
  canAffordTier,
  createInitialState,
  getTierAffordability,
  isTierAffordable,
  ITEMS,
  quotePrice,
  resolveOffer,
  settle,
  toDebugSnapshot,
} from '../../src/game/pawnshop';

describe('quotePrice', () => {
  it('computes 50% / 100% / 150% quotes from item trueValue in items.json', () => {
    const [watch, ring, book, bicycle, erhu, stampAlbum] = ITEMS;

    expect(quotePrice(watch.trueValue, 'low')).toBe(20);
    expect(quotePrice(watch.trueValue, 'fair')).toBe(40);
    expect(quotePrice(watch.trueValue, 'high')).toBe(60);

    expect(quotePrice(ring.trueValue, 'low')).toBe(30);
    expect(quotePrice(ring.trueValue, 'fair')).toBe(60);
    expect(quotePrice(ring.trueValue, 'high')).toBe(90);

    expect(quotePrice(book.trueValue, 'low')).toBe(10);
    expect(quotePrice(book.trueValue, 'fair')).toBe(20);
    expect(quotePrice(book.trueValue, 'high')).toBe(30);

    expect(quotePrice(bicycle.trueValue, 'low')).toBe(40);
    expect(quotePrice(bicycle.trueValue, 'fair')).toBe(80);
    expect(quotePrice(bicycle.trueValue, 'high')).toBe(120);

    expect(quotePrice(erhu.trueValue, 'low')).toBe(25);
    expect(quotePrice(erhu.trueValue, 'fair')).toBe(50);
    expect(quotePrice(erhu.trueValue, 'high')).toBe(75);

    expect(quotePrice(stampAlbum.trueValue, 'low')).toBe(15);
    expect(quotePrice(stampAlbum.trueValue, 'fair')).toBe(30);
    expect(quotePrice(stampAlbum.trueValue, 'high')).toBe(45);
  });

  it('keeps original 3-item max high-tier cost within starting money', () => {
    const baseThree = ITEMS.slice(0, 3);
    const totalHighCost = baseThree.reduce(
      (sum, item) => sum + quotePrice(item.trueValue, 'high'),
      0,
    );
    expect(totalHighCost).toBe(180);
    expect(totalHighCost).toBeLessThanOrEqual(BALANCE.startingMoney);
  });
});

describe('resolveOffer', () => {
  it('always rejects at 0% rate regardless of rng value', () => {
    expect(resolveOffer(0, () => 0)).toBe(false);
    expect(resolveOffer(0, () => 0.5)).toBe(false);
    expect(resolveOffer(-0.1, () => 0)).toBe(false);
  });

  it('always accepts at 100% rate regardless of rng value', () => {
    expect(resolveOffer(1, () => 0.999999)).toBe(true);
    expect(resolveOffer(1, () => 1)).toBe(true);
    expect(resolveOffer(1.2, () => 0.999999)).toBe(true);
  });

  it('accepts when rng() < rate and rejects when rng() >= rate', () => {
    expect(resolveOffer(0.3, () => 0.2999)).toBe(true);
    expect(resolveOffer(0.3, () => 0.3)).toBe(false);
    expect(resolveOffer(0.8, () => 0.7999)).toBe(true);
    expect(resolveOffer(0.8, () => 0.8)).toBe(false);
  });
});

describe('settle & advanceCustomer', () => {
  it('does not mutate the original state object', () => {
    const initial = createInitialState();
    const snapshotBefore = structuredClone(initial);

    const next = settle(initial, 'low', true);

    expect(initial).toEqual(snapshotBefore);
    expect(next).not.toBe(initial);
    expect(next.deck).not.toBe(initial.deck);
    expect(next.log).not.toBe(initial.log);
  });

  it('applies money, reputation, and card rules on accepted offers across all tiers', () => {
    // Watch: low (20, rep -1, card 倒转)
    let state = createInitialState();
    state = settle(state, 'low', true);
    expect(state.phase).toBe('feedback');
    expect(state.money).toBe(180);
    expect(state.reputation).toBe(-1);
    expect(state.deck).toEqual(['倒转']);

    // Ring: fair (60, rep +0, card 守诺)
    state = advanceCustomer(state);
    expect(state.phase).toBe('negotiating');
    expect(state.customerIndex).toBe(1);
    state = settle(state, 'fair', true);
    expect(state.money).toBe(120);
    expect(state.reputation).toBe(-1);
    expect(state.deck).toEqual(['倒转', '守诺']);

    // Old book: high (30, rep +1, card 旧书)
    state = advanceCustomer(state);
    expect(state.phase).toBe('negotiating');
    expect(state.customerIndex).toBe(2);
    state = settle(state, 'high', true);
    expect(state.money).toBe(90);
    expect(state.reputation).toBe(0);
    expect(state.deck).toEqual(['倒转', '守诺', '旧书']);

    // Finish day
    state = advanceCustomer(state);
    expect(state.phase).toBe('summary');
    expect(toDebugSnapshot(state)).toEqual({
      phase: 'summary',
      customerIndex: 3,
      money: 90,
      reputation: 0,
      deck: ['倒转', '守诺', '旧书'],
      log: state.log,
    });
  });

  it('keeps money, reputation, and deck unchanged when any tier is rejected', () => {
    const initial = createInitialState();

    for (const tier of ['low', 'fair', 'high'] as const) {
      const rejected = settle(initial, tier, false);
      expect(rejected.phase).toBe('feedback');
      expect(rejected.money).toBe(initial.money);
      expect(rejected.reputation).toBe(initial.reputation);
      expect(rejected.deck).toEqual([]);
      expect(rejected.lastOutcome?.accepted).toBe(false);
    }
  });
});

describe('affordability: money must never go negative', () => {
  it('isTierAffordable uses price <= money (equal buys, money + 1 does not)', () => {
    expect(isTierAffordable(60, 60)).toBe(true);
    expect(isTierAffordable(60, 61)).toBe(false);
    expect(isTierAffordable(60, 0)).toBe(true);
    expect(isTierAffordable(0, 0)).toBe(true);
    expect(isTierAffordable(0, 10)).toBe(false);
  });

  it('canAffordTier prices each tier via quotePrice against current money', () => {
    // Watch trueValue 40: low 20 / fair 40 / high 60
    const watch = ITEMS[0];
    expect(canAffordTier(60, watch.trueValue, 'high')).toBe(true);
    expect(canAffordTier(59, watch.trueValue, 'high')).toBe(false);
    expect(canAffordTier(59, watch.trueValue, 'fair')).toBe(true);
    expect(canAffordTier(20, watch.trueValue, 'low')).toBe(true);
    expect(canAffordTier(19, watch.trueValue, 'low')).toBe(false);

    // Bicycle trueValue 80: high 120 needs 120
    const bicycle = ITEMS[3];
    expect(canAffordTier(120, bicycle.trueValue, 'high')).toBe(true);
    expect(canAffordTier(119, bicycle.trueValue, 'high')).toBe(false);
  });

  it('getTierAffordability reports every tier for the current customer', () => {
    // Erhu trueValue 50: low 25 / fair 50 / high 75
    const erhu = ITEMS[4];
    expect(getTierAffordability(25, erhu.trueValue)).toEqual({
      low: true,
      fair: false,
      high: false,
    });
    expect(getTierAffordability(50, erhu.trueValue)).toEqual({
      low: true,
      fair: true,
      high: false,
    });
    expect(getTierAffordability(0, erhu.trueValue)).toEqual({
      low: false,
      fair: false,
      high: false,
    });
    expect(getTierAffordability(200, erhu.trueValue)).toEqual({
      low: true,
      fair: true,
      high: true,
    });
  });

  it('settle refuses an accepted offer priced above current money (no negative money)', () => {
    // Ring trueValue 60, high 90, but only 20 money on hand
    const state = createInitialState({ items: [ITEMS[1]], money: 20 });
    const next = settle(state, 'high', true);

    expect(next.phase).toBe('negotiating');
    expect(next.money).toBe(20);
    expect(next.money).toBeGreaterThanOrEqual(0);
    expect(next.deck).toEqual([]);
    expect(next.log).toEqual([]);
    expect(next.lastOutcome).toBeNull();
  });

  it('settle still accepts an offer priced exactly at current money (money hits 0, not below)', () => {
    // Ring trueValue 60, low 30, exactly 30 money on hand
    const state = createInitialState({ items: [ITEMS[1]], money: 30 });
    const next = settle(state, 'low', true);

    expect(next.phase).toBe('feedback');
    expect(next.money).toBe(0);
    expect(next.deck).toEqual(['守诺']);
  });

  it('settle leaves money untouched for a rejected offer even when the price is unaffordable', () => {
    const state = createInitialState({ items: [ITEMS[1]], money: 20 });
    const next = settle(state, 'high', false);

    expect(next.phase).toBe('feedback');
    expect(next.money).toBe(20);
    expect(next.deck).toEqual([]);
  });
});
