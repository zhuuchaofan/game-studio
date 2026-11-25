import { describe, expect, it } from 'vitest';
import {
  advanceCustomer,
  BALANCE,
  canAffordTier,
  createInitialState,
  createRedemptionOffer,
  DAY1_GUARANTEED_DAMAGE_ITEM_IDS,
  deriveDaySeed,
  formatReputationHint,
  getEffectiveAcceptRate,
  getTierAffordability,
  hasAnyAffordableTier,
  isTierAffordable,
  ITEMS,
  pickDailyItems,
  quotePrice,
  resolveOffer,
  resolveRedemption,
  settle,
  shuffleItems,
  skipCustomer,
  toDebugSnapshot,
} from '../../src/game/pawnshop';
import { mulberry32 } from '../../src/utils/rng';

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

describe('skipCustomer & hasAnyAffordableTier', () => {
  it('hasAnyAffordableTier is false if and only if money < low tier price', () => {
    // Ring trueValue 60: low 30 / fair 60 / high 90
    const ring = ITEMS[1];
    expect(hasAnyAffordableTier(30, ring.trueValue)).toBe(true);
    expect(hasAnyAffordableTier(29, ring.trueValue)).toBe(false);
    expect(hasAnyAffordableTier(20, ring.trueValue)).toBe(false);
    expect(hasAnyAffordableTier(0, ring.trueValue)).toBe(false);

    // Bicycle trueValue 80: low 40 / fair 80 / high 120
    const bicycle = ITEMS[3];
    expect(hasAnyAffordableTier(40, bicycle.trueValue)).toBe(true);
    expect(hasAnyAffordableTier(35, bicycle.trueValue)).toBe(false);
  });

  it('skipCustomer does not mutate state, preserves money/reputation/deck, and advances to next customer', () => {
    const initial = createInitialState({ money: 20, reputation: 2, deck: ['倒转', '飞驰'] });
    const snapshotBefore = structuredClone(initial);

    const next = skipCustomer(initial);

    expect(initial).toEqual(snapshotBefore);
    expect(next).not.toBe(initial);
    expect(next.phase).toBe('negotiating');
    expect(next.customerIndex).toBe(1);
    expect(next.money).toBe(20);
    expect(next.reputation).toBe(2);
    expect(next.deck).toEqual(['倒转', '飞驰']);
    expect(next.lastOutcome).toBeNull();
    expect(next.log).toEqual(['旧手表:跳过']);
  });

  it('skipCustomer on the last customer transitions directly to summary with state preserved', () => {
    // Reproduce seed=4 Day 1: watch (high 60) + bicycle (high 120) -> 20 money left on ring (low 30)
    const day1Items = shuffleItems(ITEMS, mulberry32(deriveDaySeed(4, 1))).slice(0, 3);
    expect(day1Items.map((it) => it.id)).toEqual(['watch', 'bicycle', 'ring']);

    let state = createInitialState({ day: 1, items: day1Items });
    state = advanceCustomer(settle(state, 'high', true)); // 200 -> 140
    state = advanceCustomer(settle(state, 'high', true)); // 140 -> 20

    expect(state.phase).toBe('negotiating');
    expect(state.customerIndex).toBe(2);
    expect(state.money).toBe(20);
    expect(hasAnyAffordableTier(state.money, day1Items[2].trueValue)).toBe(false);

    const afterSkip = skipCustomer(state);
    expect(afterSkip.phase).toBe('summary');
    expect(afterSkip.customerIndex).toBe(3);
    expect(afterSkip.money).toBe(20);
    expect(afterSkip.reputation).toBe(2);
    expect(afterSkip.deck).toEqual(['倒转', '飞驰']);
    expect(afterSkip.lastOutcome).toBeNull();
    expect(afterSkip.log).toHaveLength(3);
    expect(afterSkip.log[2]).toBe('婚戒:跳过');
  });

  it('skipCustomer is a safe immutable no-op outside negotiating phase', () => {
    const negotiating = createInitialState();
    const feedback = settle(negotiating, 'high', true);
    const afterFeedbackSkip = skipCustomer(feedback);
    expect(afterFeedbackSkip).toEqual(feedback);
    expect(afterFeedbackSkip).not.toBe(feedback);

    const summary = skipCustomer(skipCustomer(skipCustomer(negotiating)));
    expect(summary.phase).toBe('summary');
    const afterSummarySkip = skipCustomer(summary);
    expect(afterSummarySkip).toEqual(summary);
    expect(afterSummarySkip).not.toBe(summary);
  });
});

describe('P6 B2: Day 1 guaranteed damage item pool', () => {
  it('guarantees at least one damage-card item (bicycle or erhu) on Day 1 across 1000 seeds', () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const picked = pickDailyItems(ITEMS, 1, mulberry32(deriveDaySeed(seed, 1)), 3);
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((i) => i.id)).size).toBe(3);
      const hasDamage = picked.some((item) => DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(item.id));
      expect(hasDamage, `Seed ${seed} Day 1 missing damage item`).toBe(true);
    }
  });

  it('replaces the 3rd slot deterministically when a Day 1 shuffle has zero damage items', () => {
    // Non-damage items first, damage items at the end; rng returning 0.999 keeps order mostly intact
    const picked = pickDailyItems(ITEMS, 1, () => 0.999999, 3);
    expect(picked).toHaveLength(3);
    expect(picked.some((item) => DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(item.id))).toBe(true);
    expect(new Set(picked.map((i) => i.id)).size).toBe(3);
  });
});

describe('P6 C3: Reputation modifies acceptance rate with clamps', () => {
  it('computes exact acceptance rates for reputation 0, positive, and negative values', () => {
    // Reputation = 0 (baseline)
    expect(getEffectiveAcceptRate('low', 0)).toBe(0.3);
    expect(getEffectiveAcceptRate('fair', 0)).toBe(0.8);
    expect(getEffectiveAcceptRate('high', 0)).toBe(1.0);

    // Positive reputation: low +5%/rep, fair +2%/rep, high unchanged
    expect(getEffectiveAcceptRate('low', 2)).toBe(0.4);
    expect(getEffectiveAcceptRate('fair', 2)).toBe(0.84);
    expect(getEffectiveAcceptRate('high', 2)).toBe(1.0);

    // Negative reputation: low -5%/rep, fair -2%/rep, high unchanged
    expect(getEffectiveAcceptRate('low', -2)).toBe(0.2);
    expect(getEffectiveAcceptRate('fair', -2)).toBe(0.76);
    expect(getEffectiveAcceptRate('high', -2)).toBe(1.0);
  });

  it('enforces upper and lower clamps: low [10%, 60%], fair [50%, 95%], high 100%', () => {
    // Upper clamps
    expect(getEffectiveAcceptRate('low', 6)).toBe(0.6);
    expect(getEffectiveAcceptRate('low', 20)).toBe(0.6);
    expect(getEffectiveAcceptRate('fair', 8)).toBe(0.95);
    expect(getEffectiveAcceptRate('fair', 20)).toBe(0.95);
    expect(getEffectiveAcceptRate('high', 20)).toBe(1.0);

    // Lower clamps
    expect(getEffectiveAcceptRate('low', -4)).toBe(0.1);
    expect(getEffectiveAcceptRate('low', -20)).toBe(0.1);
    expect(getEffectiveAcceptRate('fair', -15)).toBe(0.5);
    expect(getEffectiveAcceptRate('fair', -30)).toBe(0.5);
    expect(getEffectiveAcceptRate('high', -30)).toBe(1.0);
  });

  it('formats clear UI hints for positive, zero, and negative reputation', () => {
    expect(formatReputationHint(2)).toContain('口碑2');
    expect(formatReputationHint(2)).toContain('更容易接受');
    expect(formatReputationHint(-2)).toContain('口碑-2');
    expect(formatReputationHint(-2)).toContain('更难接受');
    expect(formatReputationHint(0)).toContain('口碑0');
  });
});

describe('P6 C4: Redemption mechanism', () => {
  it('does not trigger when redeemTickets < 1 or deck has no pawnshop item cards', () => {
    expect(createRedemptionOffer(['倒转'], 0, {}, () => 0)).toBeNull();
    expect(createRedemptionOffer([], 2, {}, () => 0)).toBeNull();
    // Night-only reward card '钢笔' is not in items.json
    expect(createRedemptionOffer(['钢笔', '秤砣'], 1, {}, () => 0)).toBeNull();
  });

  it('uses recorded deal price * 1.2 when present, and falls back to item trueValue * 1.2 otherwise', () => {
    // Recorded deal price for 守诺 (婚戒): 90 -> 90 * 1.2 = 108
    const offerRecorded = createRedemptionOffer(['守诺'], 1, { 守诺: [90] }, () => 0);
    expect(offerRecorded).not.toBeNull();
    expect(offerRecorded!.cardName).toBe('守诺');
    expect(offerRecorded!.basePrice).toBe(90);
    expect(offerRecorded!.payout).toBe(108);

    // No recorded price -> fallback to 婚戒 trueValue 60 -> 60 * 1.2 = 72
    const offerFallback = createRedemptionOffer(['守诺'], 1, {}, () => 0);
    expect(offerFallback).not.toBeNull();
    expect(offerFallback!.basePrice).toBe(60);
    expect(offerFallback!.payout).toBe(72);
  });

  it('resolveRedemption accept removes card, adds payout, rep +1, tickets -1; reject changes nothing', () => {
    const offer = createRedemptionOffer(['守诺', '余音'], 2, { 守诺: [90] }, () => 0)!;
    const baseState = createInitialState({
      day: 2,
      money: 50,
      reputation: 1,
      deck: ['守诺', '余音'],
      redeemTickets: 2,
      pawnPrices: { 守诺: [90] },
      redemptionOffer: offer,
    });
    expect(baseState.phase).toBe('redemption');

    // Accept
    const accepted = resolveRedemption(baseState, true);
    expect(accepted.phase).toBe('negotiating');
    expect(accepted.money).toBe(158); // 50 + 108
    expect(accepted.reputation).toBe(2);
    expect(accepted.redeemTickets).toBe(1);
    expect(accepted.deck).toEqual(['余音']);
    expect(accepted.pawnPrices).toEqual({});
    expect(accepted.redemptionOffer).toBeNull();

    // Reject (immutable from baseState)
    const rejected = resolveRedemption(baseState, false);
    expect(rejected.phase).toBe('negotiating');
    expect(rejected.money).toBe(50);
    expect(rejected.reputation).toBe(1);
    expect(rejected.redeemTickets).toBe(2);
    expect(rejected.deck).toEqual(['守诺', '余音']);
    expect(rejected.pawnPrices).toEqual({ 守诺: [90] });
    expect(rejected.redemptionOffer).toBeNull();
  });
});
