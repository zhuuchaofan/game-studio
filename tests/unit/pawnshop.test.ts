import { describe, expect, it } from 'vitest';
import {
  clearSeenGlossaryTerms,
  consumeFirstGlossaryTip,
  GLOSSARY_TIPS,
  hasSeenGlossaryTerm,
  loadSeenGlossaryTerms,
} from '../../src/game/glossary';
import {
  advanceCustomer,
  applyMorningChoice,
  BALANCE,
  canAffordTier,
  createBrideRedemptionOffer,
  createInitialState,
  createRedemptionOffer,
  DAILY_CUSTOMER_COUNT,
  DAY1_GUARANTEED_DAMAGE_ITEM_IDS,
  deriveDaySeed,
  formatDay3Rumor,
  formatDeckRemainder,
  formatOfferDialogue,
  formatReputationHint,
  getEffectiveAcceptRate,
  getMorningActionAvailability,
  getReputationDelta,
  getTemperamentLabel,
  getTierAffordability,
  hasAnyAffordableTier,
  isTierAffordable,
  ITEMS,
  MORNING_MEDICINE_HEAL,
  MORNING_MEDICINE_PRICE,
  MORNING_REST_HEAL,
  pickDailyItems,
  quotePrice,
  resolveOffer,
  resolveRedemption,
  settle,
  shuffleItems,
  skipCustomer,
  TIER_ORDER,
  toDebugSnapshot,
  wrapCjkText,
} from '../../src/game/pawnshop';
import chaptersJson from '../../src/data/chapters.json';
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

  it('applies money, reputation, and card rules on accepted offers across all tiers (with P7 temperaments)', () => {
    // Watch (urgent): low (20, rep -2 under P7 urgent rule, card 倒转)
    let state = createInitialState({ money: 200 }); // 固定 200，只验证扣款算术
    state = settle(state, 'low', true);
    expect(state.phase).toBe('feedback');
    expect(state.money).toBe(180);
    expect(state.reputation).toBe(-2);
    expect(state.deck).toEqual(['倒转']);

    // Ring (sentimental): fair (60, rep +0, card 守诺)
    state = advanceCustomer(state);
    expect(state.phase).toBe('negotiating');
    expect(state.customerIndex).toBe(1);
    state = settle(state, 'fair', true);
    expect(state.money).toBe(120);
    expect(state.reputation).toBe(-2);
    expect(state.deck).toEqual(['倒转', '守诺']);

    // Old book (urgent): high (30, rep +1, card 旧书)
    state = advanceCustomer(state);
    expect(state.phase).toBe('negotiating');
    expect(state.customerIndex).toBe(2);
    state = settle(state, 'high', true);
    expect(state.money).toBe(90);
    expect(state.reputation).toBe(-1);
    expect(state.deck).toEqual(['倒转', '守诺', '旧书']);

    // Finish day
    state = advanceCustomer(state);
    expect(state.phase).toBe('summary');
    expect(toDebugSnapshot(state)).toEqual({
      phase: 'summary',
      customerIndex: 3,
      money: 90,
      reputation: -1,
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
    const day1Items = shuffleItems(ITEMS.slice(0, 6), mulberry32(deriveDaySeed(4, 1))).slice(0, 3);
    expect(day1Items.map((it) => it.id)).toEqual(['watch', 'bicycle', 'ring']);

    let state = createInitialState({ day: 1, items: day1Items, money: 200 }); // 紧手状态：原开局 200
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
    // Watch (urgent, high -> +1) + Bicycle (proud, high -> +2) = 3
    expect(afterSkip.reputation).toBe(3);
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

describe('P7: Customer temperaments, 1987 offer dialogue & economic invariants', () => {
  it('assigns exact temperaments and pixel badge labels to all 6 items', () => {
    const byId = new Map(ITEMS.map((item) => [item.id, item]));
    expect(byId.get('watch')?.temperament).toBe('urgent');
    expect(byId.get('ring')?.temperament).toBe('sentimental');
    expect(byId.get('old_book')?.temperament).toBe('urgent');
    expect(byId.get('bicycle')?.temperament).toBe('proud');
    expect(byId.get('erhu')?.temperament).toBe('sentimental');
    expect(byId.get('stamp_album')?.temperament).toBe('proud');

    expect(getTemperamentLabel('urgent')).toBe('急用钱');
    expect(getTemperamentLabel('proud')).toBe('爱面子');
    expect(getTemperamentLabel('sentimental')).toBe('念旧');
  });

  it('applies exact temperament modifiers to acceptance rates, reputation deltas, and redemption priority', () => {
    // urgent: low accept +10% (30% -> 40%), low accept rep -2
    expect(getEffectiveAcceptRate('low', 0, BALANCE, 'urgent')).toBe(0.4);
    expect(getEffectiveAcceptRate('fair', 0, BALANCE, 'urgent')).toBe(0.8);
    expect(getEffectiveAcceptRate('high', 0, BALANCE, 'urgent')).toBe(1.0);
    expect(getReputationDelta('low', true, 'urgent')).toBe(-2);
    expect(getReputationDelta('high', true, 'urgent')).toBe(1);
    expect(getReputationDelta('low', false, 'urgent')).toBe(0);

    // proud: low accept -10% (30% -> 20%), high accept rep +2
    expect(getEffectiveAcceptRate('low', 0, BALANCE, 'proud')).toBe(0.2);
    expect(getEffectiveAcceptRate('fair', 0, BALANCE, 'proud')).toBe(0.8);
    expect(getEffectiveAcceptRate('high', 0, BALANCE, 'proud')).toBe(1.0);
    expect(getReputationDelta('low', true, 'proud')).toBe(-1);
    expect(getReputationDelta('high', true, 'proud')).toBe(2);
    expect(getReputationDelta('high', false, 'proud')).toBe(0);

    // sentimental: fair accept +5% (80% -> 85%), redemption prioritizes sentimental cards
    expect(getEffectiveAcceptRate('low', 0, BALANCE, 'sentimental')).toBe(0.3);
    expect(getEffectiveAcceptRate('fair', 0, BALANCE, 'sentimental')).toBe(0.85);
    expect(getEffectiveAcceptRate('high', 0, BALANCE, 'sentimental')).toBe(1.0);
    expect(getReputationDelta('low', true, 'sentimental')).toBe(-1);
    expect(getReputationDelta('high', true, 'sentimental')).toBe(1);

    // Redemption candidate pool prioritizes sentimental items (守诺/余音) over urgent/proud (倒转/飞驰)
    for (const rngVal of [0, 0.25, 0.5, 0.75, 0.99]) {
      const offer = createRedemptionOffer(['倒转', '飞驰', '守诺', '集邮'], 1, {}, () => rngVal);
      expect(offer).not.toBeNull();
      expect(offer!.cardName).toBe('守诺');
      expect(offer!.item.temperament).toBe('sentimental');
    }

    // Falls back to non-sentimental pawnshop cards when no sentimental card is in deck
    const fallbackOffer = createRedemptionOffer(['倒转', '飞驰'], 1, {}, () => 0);
    expect(fallbackOffer?.cardName).toBe('倒转');
  });

  it('formatOfferDialogue generates distinct 1987 old-street dialogue across tiers, temperaments, and reputation', () => {
    const watch = ITEMS.find((i) => i.id === 'watch')!;
    const bicycle = ITEMS.find((i) => i.id === 'bicycle')!;
    const ring = ITEMS.find((i) => i.id === 'ring')!;

    // Exact style examples from task spec
    expect(formatOfferDialogue(watch, 'low', true, 3)).toBe('听街坊说你家公道，少点我也认了');
    expect(formatOfferDialogue(watch, 'low', false, 0)).toBe('这价连药费零头都不够');

    // Every item x tier x accepted x rep bucket returns non-empty, non-template dialogue
    for (const item of ITEMS) {
      for (const tier of TIER_ORDER) {
        for (const accepted of [true, false]) {
          for (const rep of [-3, 0, 3]) {
            const line = formatOfferDialogue(item, tier, accepted, rep);
            expect(line.length).toBeGreaterThanOrEqual(6);
            expect(line).not.toBe('当客走了，没谈成');
          }
        }
      }
    }

    // Distinct flavor by temperament
    expect(formatOfferDialogue(bicycle, 'high', true, 0)).toContain('面子');
    expect(formatOfferDialogue(ring, 'low', false, 0)).toContain('半辈子');
  });

  it('economic invariants: money is never negative, single high+redeem profit is bounded, and no infinite farm loop exists', () => {
    for (const item of ITEMS) {
      for (const tier of TIER_ORDER) {
        for (const rep of [-10, -2, 0, 2, 10]) {
          // 1. Effective accept rate always within valid probability bounds (0, 1]
          const rate = getEffectiveAcceptRate(tier, rep, BALANCE, item.temperament);
          expect(rate).toBeGreaterThan(0);
          expect(rate).toBeLessThanOrEqual(1);

          // 2. Money never goes negative across arbitrary starting balances
          for (const money of [0, 1, quotePrice(item.trueValue, tier) - 1, quotePrice(item.trueValue, tier), 200]) {
            const init = createInitialState({
              money,
              reputation: rep,
              items: [item],
              pawnPrices: {},
            });
            const afterAccept = settle(init, tier, true);
            const afterReject = settle(init, tier, false);
            const afterSkip = skipCustomer(init);

            expect(afterAccept.money).toBeGreaterThanOrEqual(0);
            expect(afterReject.money).toBeGreaterThanOrEqual(0);
            expect(afterSkip.money).toBeGreaterThanOrEqual(0);

            // 3. Rejection & skip never create money or reputation (no reject/skip farm loop)
            expect(afterReject.money).toBe(money);
            expect(afterReject.reputation).toBe(rep);
            expect(afterReject.deck).toEqual([]);
            expect(afterSkip.money).toBe(money);
            expect(afterSkip.reputation).toBe(rep);
          }
        }
      }

      // 4. Single high-tier buy + redemption has strictly bounded net profit <= 30% of trueValue
      //    and consumes both the card and 1 finite redeemTicket (no infinite money/rep loop).
      const highPrice = quotePrice(item.trueValue, 'high');
      const startMoney = highPrice + 50;
      const bought = settle(
        createInitialState({
          money: startMoney,
          reputation: 0,
          items: [item],
          redeemTickets: 1,
          pawnPrices: {},
        }),
        'high',
        true,
      );
      expect(bought.money).toBe(startMoney - highPrice);
      const offer = createRedemptionOffer(
        bought.deck,
        bought.redeemTickets ?? 0,
        bought.pawnPrices ?? {},
        () => 0,
      );
      expect(offer).not.toBeNull();
      const redeemState = createInitialState({
        money: bought.money,
        reputation: bought.reputation,
        deck: bought.deck,
        items: [item],
        redeemTickets: bought.redeemTickets,
        pawnPrices: bought.pawnPrices,
        redemptionOffer: offer,
      });
      const afterRedeem = resolveRedemption(redeemState, true);

      const netMoneyGain = afterRedeem.money - startMoney;
      expect(netMoneyGain).toBeGreaterThan(0);
      expect(netMoneyGain).toBeLessThanOrEqual(Math.round(item.trueValue * 0.3));
      expect(afterRedeem.redeemTickets).toBe(0);
      expect(afterRedeem.deck).toEqual([]);
      // Without another night win, redemption cannot repeat
      expect(
        createRedemptionOffer(afterRedeem.deck, afterRedeem.redeemTickets ?? 0, afterRedeem.pawnPrices ?? {}, () => 0),
      ).toBeNull();
    }
  });
});

describe('P8 feedback story wrapping (all 12 items)', () => {
  it('wraps every item feedback story within <=2 lines and panel right margin without altering copy', () => {
    expect(ITEMS).toHaveLength(12);
    const panelRight = 310;
    const textStartX = 60;
    const maxChars = 20;

    for (const item of ITEMS) {
      const fullText = `你收下了：${item.story}`;
      const wrapped = wrapCjkText(fullText, maxChars);
      const lines = wrapped.split('\n');

      // Exact original copy preserved (zero characters altered or truncated)
      expect(lines.join('')).toBe(fullText);
      // Fits inside y=63..86 (<= 2 lines of 12px height inside y=24..88 panel)
      expect(lines.length).toBeLessThanOrEqual(2);
      // Every line fits well inside panel x=10..310 (each CJK glyph is 12px wide)
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(maxChars);
        expect(textStartX + line.length * 12).toBeLessThanOrEqual(panelRight - 10);
      }
    }
  });
});

describe('P10: Day 2 loss recovery, Bride scripted redemption, and Day 3 rumor wrapping', () => {
  it('Day 2 loss recovery guarantees an affordable damage item (low <= money), covering both erhu unowned and erhu owned', () => {
    // 1. Erhu UNOWNED, money = 30 (can afford erhu low=25, cannot afford bicycle low=40)
    for (let seed = 1; seed <= 200; seed += 1) {
      const picked = pickDailyItems(ITEMS, 2, mulberry32(deriveDaySeed(seed, 2)), 3, {
        recoverDamageAfterDay1Loss: { money: 30, deck: ['倒转', '守诺', '旧书'] },
      });
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((i) => i.id)).size).toBe(3);
      expect(picked.some((i) => i.id === 'erhu')).toBe(true);
      expect(
        picked.some(
          (i) =>
            DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(i.id) &&
            canAffordTier(30, i.trueValue, 'low'),
        ),
      ).toBe(true);
    }

    // 2. Erhu OWNED, money = 45 (both erhu low=25 and bicycle low=40 affordable -> prefers UNOWNED bicycle!)
    for (let seed = 1; seed <= 200; seed += 1) {
      const picked = pickDailyItems(ITEMS, 2, mulberry32(deriveDaySeed(seed, 2)), 3, {
        recoverDamageAfterDay1Loss: { money: 45, deck: ['余音', '倒转', '旧书'] },
      });
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((i) => i.id)).size).toBe(3);
      expect(picked.some((i) => i.id === 'bicycle')).toBe(true);
    }

    // 3. Erhu OWNED, money = 30 (bicycle low=40 unaffordable -> falls back to affordable erhu low=25)
    for (let seed = 1; seed <= 200; seed += 1) {
      const picked = pickDailyItems(ITEMS, 2, mulberry32(deriveDaySeed(seed, 2)), 3, {
        recoverDamageAfterDay1Loss: { money: 30, deck: ['余音', '倒转', '旧书'] },
      });
      expect(picked).toHaveLength(3);
      expect(new Set(picked.map((i) => i.id)).size).toBe(3);
      expect(picked.some((i) => i.id === 'erhu')).toBe(true);
    }
  });

  it('Bride scripted redemption triggers only on Day 2 when ring was pawned on Day 1, does not consume tickets, and settles accept (+1.2x, rep+1, card leaves) vs reject (card stays, rep-1)', () => {
    // Does not trigger on Day 1 or Day 3, or if ring not pawned on Day 1, or if already triggered, or if 守诺 missing
    expect(createBrideRedemptionOffer(1, ['守诺'], { 守诺: [60] }, true, false)).toBeNull();
    expect(createBrideRedemptionOffer(3, ['守诺'], { 守诺: [60] }, true, false)).toBeNull();
    expect(createBrideRedemptionOffer(2, ['守诺'], { 守诺: [60] }, false, false)).toBeNull();
    expect(createBrideRedemptionOffer(2, ['守诺'], { 守诺: [60] }, true, true)).toBeNull();
    expect(createBrideRedemptionOffer(2, ['倒转'], {}, true, false)).toBeNull();

    // Triggers on Day 2 with 0 redeemTickets and uses recorded deal price * 1.2 (60 * 1.2 = 72)
    const offer = createBrideRedemptionOffer(2, ['倒转', '守诺'], { 守诺: [60] }, true, false);
    expect(offer).not.toBeNull();
    expect(offer!.isBrideScripted).toBe(true);
    expect(offer!.item.id).toBe('ring');
    expect(offer!.cardName).toBe('守诺');
    expect(offer!.basePrice).toBe(60);
    expect(offer!.payout).toBe(72);

    const baseState = createInitialState({
      day: 2,
      money: 40,
      reputation: 1,
      deck: ['倒转', '守诺'],
      redeemTickets: 0, // Zero tickets! Bride event must still resolve cleanly
      pawnPrices: { 守诺: [60], 倒转: [40] },
      redemptionOffer: offer,
    });
    expect(baseState.phase).toBe('redemption');

    // Accept: 守诺 removed, money +72 (40 -> 112), rep +1 (1 -> 2), redeemTickets unchanged (0)
    const accepted = resolveRedemption(baseState, true);
    expect(accepted.phase).toBe('negotiating');
    expect(accepted.deck).toEqual(['倒转']);
    expect(accepted.money).toBe(112);
    expect(accepted.reputation).toBe(2);
    expect(accepted.redeemTickets).toBe(0);
    expect(accepted.pawnPrices).toEqual({ 倒转: [40] });
    expect(accepted.redemptionOffer).toBeNull();

    // Reject: 守诺 kept, money unchanged (40), rep -1 (1 -> 0), redeemTickets unchanged (0)
    const rejected = resolveRedemption(baseState, false);
    expect(rejected.phase).toBe('negotiating');
    expect(rejected.deck).toEqual(['倒转', '守诺']);
    expect(rejected.money).toBe(40);
    expect(rejected.reputation).toBe(0);
    expect(rejected.redeemTickets).toBe(0);
    expect(rejected.pawnPrices).toEqual({ 守诺: [60], 倒转: [40] });
    expect(rejected.redemptionOffer).toBeNull();

    // With 1 redeemTicket, accepting Bride event MUST NOT consume the ticket
    const withTicket = createInitialState({
      day: 2,
      money: 40,
      reputation: 1,
      deck: ['倒转', '守诺'],
      redeemTickets: 1,
      pawnPrices: { 守诺: [60], 倒转: [40] },
      redemptionOffer: offer,
    });
    const acceptedWithTicket = resolveRedemption(withTicket, true);
    expect(acceptedWithTicket.redeemTickets).toBe(1);
    expect(acceptedWithTicket.deck).toEqual(['倒转']);
  });

  it('wraps day3Rumor cleanly into <=2 lines inside the 276px summary banner without altering a single character', () => {
    const rumor = chaptersJson.chapters[0].day3Rumor;
    const wrapped = formatDay3Rumor(rumor);
    const lines = wrapped.split('\n');

    expect(lines.join('')).toBe(rumor);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines) {
      expect(line.length * 12).toBeLessThanOrEqual(264); // 276px banner with 6px padding each side
    }
  });
});

describe('Playtest fix round: redemption rejection tracking (Semantic A) & first-encounter glossary', () => {
  it('skips item rejected today (Semantic A) while allowing it again the next day or allowing other items today', () => {
    // Deck has only 余音 (erhu, sentimental). Rejected on Day 5 -> skipped on Day 5, offered again on Day 6.
    const rejectedToday = { erhu: 5 };
    expect(
      createRedemptionOffer(['余音'], 1, { 余音: [50] }, () => 0, ITEMS, 1.2, {
        rejectedDayByItem: rejectedToday,
        day: 5,
      }),
    ).toBeNull();

    // Another item in deck is still offered on Day 5
    const fallbackOffer = createRedemptionOffer(
      ['余音', '倒转'],
      1,
      { 余音: [50], 倒转: [60] },
      () => 0,
      ITEMS,
      1.2,
      { rejectedDayByItem: rejectedToday, day: 5 },
    );
    expect(fallbackOffer?.item.id).toBe('watch');

    // Day 6 -> erhu can be offered again (Semantic A: only suppresses the item on the same day)
    const nextDayOffer = createRedemptionOffer(
      ['余音'],
      1,
      { 余音: [50] },
      () => 0,
      ITEMS,
      1.2,
      { rejectedDayByItem: rejectedToday, day: 6 },
    );
    expect(nextDayOffer?.item.id).toBe('erhu');
  });

  it('shows each glossary term plain-language tip only once on first encounter', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };

    clearSeenGlossaryTerms(storage);
    expect(hasSeenGlossaryTerm('reputation', storage)).toBe(false);
    expect(consumeFirstGlossaryTip('reputation', storage)).toBe(GLOSSARY_TIPS.reputation);
    expect(hasSeenGlossaryTerm('reputation', storage)).toBe(true);
    expect(consumeFirstGlossaryTip('reputation', storage)).toBeNull();

    expect(consumeFirstGlossaryTip('renqing', storage)).toBe(GLOSSARY_TIPS.renqing);
    expect(consumeFirstGlossaryTip('obsession', storage)).toBe(GLOSSARY_TIPS.obsession);
    expect(consumeFirstGlossaryTip('charge_threshold', storage)).toBe(GLOSSARY_TIPS.charge_threshold);
    expect(consumeFirstGlossaryTip('charge_threshold', storage)).toBeNull();
  });
});

describe('Deck list remainder label (Task 18 §5)', () => {
  it('shows the hidden remainder, not the total (7 -> 等2张, 8 -> 等3张, 12 -> 等7张)', () => {
    expect(formatDeckRemainder(7)).toBe('等2张');
    expect(formatDeckRemainder(8)).toBe('等3张');
    expect(formatDeckRemainder(12)).toBe('等7张');
  });
});

describe('Task 19 §4/§6: morning 3-way choice & debt_note glossary', () => {
  it('disables rest/medicine at full HP, disables medicine when money < 20, and applies heal/cost/customer counts accurately', () => {
    const fullHpAvail = getMorningActionAvailability(30, 100);
    expect(fullHpAvail.rest).toEqual({ enabled: false, reason: 'full_hp' });
    expect(fullHpAvail.medicine).toEqual({ enabled: false, reason: 'full_hp' });
    expect(fullHpAvail.work).toEqual({ enabled: true, reason: null });

    const poorAvail = getMorningActionAvailability(18, MORNING_MEDICINE_PRICE - 1);
    expect(poorAvail.rest).toEqual({ enabled: true, reason: null });
    expect(poorAvail.medicine).toEqual({ enabled: false, reason: 'insufficient_funds' });
    expect(poorAvail.work).toEqual({ enabled: true, reason: null });

    const richAvail = getMorningActionAvailability(18, MORNING_MEDICINE_PRICE);
    expect(richAvail.rest.enabled).toBe(true);
    expect(richAvail.medicine.enabled).toBe(true);

    const restRes = applyMorningChoice({ action: 'rest', currentHp: 18, money: 50 });
    expect(restRes).toEqual({
      applied: true,
      currentHp: Math.min(30, 18 + MORNING_REST_HEAL),
      money: 50,
      customerCount: DAILY_CUSTOMER_COUNT - 1,
    });

    const medRes = applyMorningChoice({ action: 'medicine', currentHp: 24, money: 20 });
    expect(medRes).toEqual({
      applied: true,
      currentHp: Math.min(30, 24 + MORNING_MEDICINE_HEAL),
      money: 0,
      customerCount: DAILY_CUSTOMER_COUNT,
    });

    const workRes = applyMorningChoice({ action: 'work', currentHp: 18, money: 50 });
    expect(workRes).toEqual({
      applied: true,
      currentHp: 18,
      money: 50,
      customerCount: DAILY_CUSTOMER_COUNT,
    });

    const rejectedRest = applyMorningChoice({ action: 'rest', currentHp: 30, money: 50 });
    expect(rejectedRest.applied).toBe(false);
    expect(rejectedRest.currentHp).toBe(30);
  });

  it('persists debt_note glossary tip on first encounter only', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
    };
    expect(consumeFirstGlossaryTip('debt_note', storage)).toBe(GLOSSARY_TIPS.debt_note);
    expect(consumeFirstGlossaryTip('debt_note', storage)).toBeNull();
    expect(loadSeenGlossaryTerms(storage).has('debt_note')).toBe(true);
  });
});
