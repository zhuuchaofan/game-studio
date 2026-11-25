import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import chaptersJson from '../../src/data/chapters.json';
import demonsJson from '../../src/data/demons.json';
import itemsJson from '../../src/data/items.json';
import {
  createBattle,
  endTurn,
  playCard,
  type BattleBalanceConfig,
  type CardDef,
  type DemonDef,
} from '../../src/game/battle';
import {
  buildEndingLedger,
  buildMonthEndEpilogueLines,
  composeBoss,
  DEFAULT_BARE_BOSS_INTRO,
  DEFAULT_COMPOSED_BOSS_INTRO,
  formatBossPreviewHpLine,
  formatCalendarBossPreviewText,
  getBossDemonDef,
  resolveDemonNarrative,
} from '../../src/game/bossComposition';
import { createInitialChapterState, type ChaptersDataFile } from '../../src/game/chapters';
import {
  createBrideRedemptionOffer,
  createFatherOverdueRedemptionOffer,
  createInitialState,
  createRedemptionOffer,
  isItemOnRedemptionCooldown,
  ITEMS,
  pickDailyItems,
  REDEMPTION_COOLDOWN_DAYS,
  resolveRedemption,
  SHOPKEEPER_OPENING_NOTE_LINES,
  type PawnItem,
} from '../../src/game/pawnshop';
import {
  loadSaveDetailed,
  SAVE_STORAGE_KEY,
  SAVE_VERSION,
  saveGame,
  type SaveData,
  type StorageLike,
} from '../../src/game/save';
import { validateChapters } from '../../src/game/validate';
import { mulberry32 } from '../../src/utils/rng';

const CARDS = cardsJson as CardDef[];
const DEMONS = demonsJson as DemonDef[];
const REAL_ITEMS = itemsJson as PawnItem[];
const REAL_CHAPTERS = chaptersJson as ChaptersDataFile;
const BATTLE_BALANCE: BattleBalanceConfig = {
  startingHp: balanceJson.startingHp,
  startingRenqing: 5,
  maxRenqing: 5,
  drawFirst: balanceJson.drawFirst,
  drawPerRound: balanceJson.drawPerRound,
  winRewardMoney: balanceJson.winRewardMoney,
};

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

describe('P11 Sub-item 1: Boss composition & redemption weakening', () => {
  it('composes 0 / 1 / 3 / 6 components, handles duplicate items & non-item rewards, and caps at 48 HP', () => {
    const baseBoss = getBossDemonDef(DEMONS);

    // 0 components (素体 fallback): 32 HP, bare introLine, no bonuses
    const bare = composeBoss(['钢笔', '算盘', '铜镜'], null, baseBoss);
    expect(bare.componentCount).toBe(0);
    expect(bare.isBare).toBe(true);
    expect(bare.finalHp).toBe(32);
    expect(bare.hpCapped).toBe(false);
    expect(bare.r1Shield).toBe(0);
    expect(bare.chargeThreshold).toBe(10);
    expect(bare.introSummary).toBe(DEFAULT_BARE_BOSS_INTRO);
    expect(bare.bossDef.hp).toBe(32);
    expect(bare.bossDef.introLine).toBe('柜子空了，债主只身前来');
    expect(bare.fragmentNames).toEqual([]);
    expect(formatCalendarBossPreviewText(bare)).toContain('0件');
    expect(formatCalendarBossPreviewText(bare)).toContain('32血');

    // Bare Boss is playable end-to-end in battle engine
    const bareBattle = createBattle(['钢笔', '钢笔', '算盘'], 'boss_ch1', mulberry32(1), CARDS, DEMONS, BATTLE_BALANCE, undefined, {
      demonOverride: bare.bossDef,
    });
    expect(bareBattle.demonHp).toBe(32);
    expect(bareBattle.demonMaxHp).toBe(32);
    expect(bareBattle.demonShield).toBe(0);

    // 1 component each: verify all 6 items match proposal §1.4 table
    const watchComp = composeBoss(['倒转'], null, baseBoss);
    expect(watchComp.componentCount).toBe(1);
    expect(watchComp.finalHp).toBe(34);
    expect(watchComp.bossDef.actions.find((a) => a.round === 4)?.damage).toBe(8);

    const ringComp = composeBoss(['守诺'], null, baseBoss);
    expect(ringComp.finalHp).toBe(34);
    expect(ringComp.r1Shield).toBe(5);
    const ringBattle = createBattle(['守诺', '钢笔'], 'boss_ch1', mulberry32(1), CARDS, DEMONS, BATTLE_BALANCE, undefined, {
      demonOverride: ringComp.bossDef,
    });
    expect(ringBattle.demonShield).toBe(5);

    const bookComp = composeBoss(['旧书'], null, baseBoss);
    expect(bookComp.finalHp).toBe(34);
    expect(bookComp.bossDef.actions.find((a) => a.round === 1)?.damage).toBe(4);
    expect(bookComp.bossDef.actions.find((a) => a.round === 2)?.damage).toBe(1);
    expect(bookComp.bossDef.actions.find((a) => a.round === 3)?.damage).toBe(12);

    const bikeComp = composeBoss(['飞驰'], null, baseBoss);
    expect(bikeComp.finalHp).toBe(34);
    expect(bikeComp.bossDef.actions.find((a) => a.round === 4)?.damage).toBe(9);

    const erhuComp = composeBoss(['余音'], null, baseBoss);
    expect(erhuComp.finalHp).toBe(34);
    expect(erhuComp.bossDef.actions.find((a) => a.round === 3)?.damage).toBe(13);

    const stampComp = composeBoss(['集邮'], null, baseBoss);
    expect(stampComp.finalHp).toBe(34);
    expect(stampComp.chargeThreshold).toBe(14);
    expect(stampComp.bossDef.actions.find((a) => a.round === 2)?.charge?.threshold).toBe(14);

    // 3 components (matches TEST_DECK's 3 pawnshop items): 32 + 6 = 38 HP
    const three = composeBoss(['倒转', '守诺', '旧书', '钢笔', '算盘'], null, baseBoss);
    expect(three.componentCount).toBe(3);
    expect(three.finalHp).toBe(38);
    expect(three.introSummary).toBe(DEFAULT_COMPOSED_BOSS_INTRO);
    expect(three.fragmentNames).toEqual(['手表的执念', '婚戒的执念', '旧书的执念']);

    // Duplicate purchase deduplication: buying 倒转 twice counts only 1 component
    const dup = composeBoss(['倒转', '倒转', '飞驰', '飞驰', '钢笔'], null, baseBoss);
    expect(dup.componentCount).toBe(2);
    expect(dup.finalHp).toBe(36);

    // 6 components (full composition): 32 + 12 = 44 HP, un-interrupted 4-round total dmg = 4 + 1 + 14 + 11 = 30
    const allSix = ['倒转', '守诺', '旧书', '飞驰', '余音', '集邮'];
    const full = composeBoss(allSix, null, baseBoss);
    expect(full.componentCount).toBe(6);
    expect(full.finalHp).toBe(44);
    expect(full.hpCapped).toBe(false);
    expect(full.r1Shield).toBe(5);
    expect(full.chargeThreshold).toBe(14);
    const totalUninterruptedDmg = full.bossDef.actions.reduce((sum, a) => sum + a.damage, 0);
    expect(totalUninterruptedDmg).toBe(30);

    // Credit stock (+6) stacking + cap truncation: 44 + 6 = 50 -> capped at 48 with hpCapped=true
    const fullCredit = composeBoss(allSix, 'credit_stock', baseBoss);
    expect(fullCredit.pactHpBonus).toBe(6);
    expect(fullCredit.rawTotalHp).toBe(50);
    expect(fullCredit.finalHp).toBe(48);
    expect(fullCredit.hpCapped).toBe(true);
    expect(formatBossPreviewHpLine(fullCredit)).toContain('已到顶');
    expect(formatCalendarBossPreviewText(fullCredit)).toContain('已到顶');

    // Non-max credit stock: 3 components (38) + 6 = 44 (not capped)
    const threeCredit = composeBoss(['倒转', '守诺', '旧书'], 'credit_stock', baseBoss);
    expect(threeCredit.finalHp).toBe(44);
    expect(threeCredit.hpCapped).toBe(false);
  });

  it('preserves R2 charge interrupt rule (+1 renqing, R3 reduced damage) with stamp_album threshold 14', () => {
    const baseBoss = getBossDemonDef(DEMONS);
    const composed = composeBoss(['集邮'], null, baseBoss);
    let state = createBattle(
      ['秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
      'boss_ch1',
      mulberry32(7),
      CARDS,
      DEMONS,
      BATTLE_BALANCE,
      undefined,
      { demonOverride: composed.bossDef },
    );

    // End R1 -> R2 starts charging with threshold 14
    state = endTurn(state).state;
    expect(state.round).toBe(2);
    expect(state.bossCharging).toBe(true);
    expect(state.bossChargeThreshold).toBe(14);

    // Play two 秤砣 (10 dmg) -> NOT interrupted yet because threshold is 14
    for (let i = 0; i < 2; i += 1) {
      const idx = state.hand.indexOf('秤砣');
      state = playCard(state, idx).state;
    }
    expect(state.bossChargeDamage).toBe(10);
    expect(state.bossChargeInterrupted).toBe(false);

    // Play third 秤砣 (15 >= 14) -> interrupted! Refunds +1 renqing
    const renqingBefore = state.renqing;
    const idx3 = state.hand.indexOf('秤砣');
    const res3 = playCard(state, idx3);
    state = res3.state;
    expect(state.bossChargeInterrupted).toBe(true);
    expect(res3.events.some((e) => e.type === 'BOSS_CHARGE_INTERRUPTED')).toBe(true);
    expect(state.renqing).toBe(renqingBefore - 1 + 1);
  });

  it('weakens Boss monotonically on random redemption and Day 2 Bride scripted redemption', () => {
    const baseBoss = getBossDemonDef(DEMONS);

    // Random redemption: redeeming 飞驰 removes 飞驰的执念 (-2 HP, R4 -3 dmg)
    const initialDeck = ['飞驰', '倒转', '旧书'];
    const before = composeBoss(initialDeck, null, baseBoss);
    expect(before.componentCount).toBe(3);
    expect(before.finalHp).toBe(38);

    const offer = createRedemptionOffer(initialDeck, 1, { 飞驰: [80] }, mulberry32(1), REAL_ITEMS);
    expect(offer).not.toBeNull();
    const state = createInitialState({
      day: 3,
      money: 100,
      reputation: 1,
      deck: initialDeck,
      items: REAL_ITEMS.slice(0, 3),
      redeemTickets: 1,
      redemptionOffer: offer,
    });
    const afterRedeem = resolveRedemption(state, true);
    const composedAfter = composeBoss(afterRedeem.deck, null, baseBoss);
    expect(composedAfter.componentCount).toBe(2);
    expect(composedAfter.finalHp).toBe(36);
    expect(composedAfter.activeComponents.some((c) => c.itemId === offer!.item.id)).toBe(false);

    // Bride scripted redemption on Day 2: accept removes 守诺 -> Boss loses 婚戒的执念 (R1 shield 5 -> 0)
    const brideOffer = createBrideRedemptionOffer(
      2,
      ['守诺', '余音'],
      { 守诺: [90] },
      true,
      false,
      REAL_ITEMS,
    );
    expect(brideOffer?.isBrideScripted).toBe(true);

    const brideState = createInitialState({
      day: 2,
      money: 100,
      reputation: 1,
      deck: ['守诺', '余音'],
      items: REAL_ITEMS.slice(0, 3),
      redeemTickets: 0,
      redemptionOffer: brideOffer,
    });
    const acceptedBride = resolveRedemption(brideState, true);
    expect(acceptedBride.deck).toEqual(['余音']);
    expect(acceptedBride.money).toBe(100 + Math.round(90 * 1.2));
    expect(acceptedBride.reputation).toBe(2);
    expect(acceptedBride.redeemTickets).toBe(0);
    const bossAfterBrideAccept = composeBoss(acceptedBride.deck, null, baseBoss);
    expect(bossAfterBrideAccept.r1Shield).toBe(0);
    expect(bossAfterBrideAccept.fragmentNames).toEqual(['二胡的执念']);

    const rejectedBride = resolveRedemption(brideState, false);
    expect(rejectedBride.deck).toEqual(['守诺', '余音']);
    expect(rejectedBride.reputation).toBe(0);
    const bossAfterBrideReject = composeBoss(rejectedBride.deck, null, baseBoss);
    expect(bossAfterBrideReject.r1Shield).toBe(5);
    expect(bossAfterBrideReject.fragmentNames).toEqual(['婚戒的执念', '二胡的执念']);
  });
});

describe('P11 Sub-item 2 & 3: Mainline packaging, Father event & conditional banner copy', () => {
  it('resolves conditional demon narrative only when linked item was pawned and card remains in deck', () => {
    const demonA = DEMONS.find((d) => d.id === 'a')!;
    const demonB = DEMONS.find((d) => d.id === 'b')!;

    // Linked: watch pawned in chapter AND 倒转 in deck -> specific copy
    const linked = resolveDemonNarrative(demonA, ['倒转', '余音'], ['watch', 'erhu'], REAL_ITEMS);
    expect(linked.isLinked).toBe(true);
    expect(linked.customerLink).toContain('手表');
    expect(linked.customerLink).toContain('父亲');
    expect(linked.aftermathLine).toContain('手表还在柜台');

    // Not pawned -> generic copy
    const unpawned = resolveDemonNarrative(demonA, ['飞驰', '余音'], ['bicycle', 'erhu'], REAL_ITEMS);
    expect(unpawned.isLinked).toBe(false);
    expect(unpawned.customerLink).toBe(demonA.genericCustomerLink);
    expect(unpawned.aftermathLine).toBe(demonA.genericAftermathLine);
    expect(unpawned.customerLink).not.toContain('手表');

    // Redeemed (pawned earlier, card no longer in deck) -> generic copy
    const redeemed = resolveDemonNarrative(demonB, ['余音'], ['ring', 'erhu'], REAL_ITEMS);
    expect(redeemed.isLinked).toBe(false);
    expect(redeemed.customerLink).toBe(demonB.genericCustomerLink);
    expect(redeemed.aftermathLine).toBe(demonB.genericAftermathLine);
    expect(redeemed.customerLink).not.toContain('婚戒');
  });

  it('triggers Day 7 Father overdue redemption only when 倒转 is in deck and not yet triggered, with both outcomes', () => {
    // 1. Watch in deck on Day 7 -> triggers
    const offer = createFatherOverdueRedemptionOffer(7, ['倒转', '飞驰'], { 倒转: [60] }, false, REAL_ITEMS);
    expect(offer).not.toBeNull();
    expect(offer?.isFatherOverdueScripted).toBe(true);
    expect(offer?.item.id).toBe('watch');
    expect(offer?.payout).toBe(72); // 60 * 1.2

    // 2. Watch already redeemed (not in deck) -> does NOT trigger
    expect(createFatherOverdueRedemptionOffer(7, ['飞驰'], {}, false, REAL_ITEMS)).toBeNull();

    // 3. Watch never pawned (empty or non-watch deck) -> does NOT trigger
    expect(createFatherOverdueRedemptionOffer(7, [], {}, false, REAL_ITEMS)).toBeNull();

    // 4. Non-Day 7 or already triggered -> does NOT trigger
    expect(createFatherOverdueRedemptionOffer(6, ['倒转'], {}, false, REAL_ITEMS)).toBeNull();
    expect(createFatherOverdueRedemptionOffer(7, ['倒转'], {}, true, REAL_ITEMS)).toBeNull();

    // 5. Accept ("破例赎回"): 倒转 leaves deck, money +1.2x, reputation +1, 0 tickets consumed, Boss loses watch component
    const baseState = createInitialState({
      day: 7,
      money: 50,
      reputation: 2,
      deck: ['倒转', '飞驰'],
      items: REAL_ITEMS.slice(0, 3),
      redeemTickets: 1,
      redemptionOffer: offer,
    });
    const accepted = resolveRedemption(baseState, true);
    expect(accepted.deck).toEqual(['飞驰']);
    expect(accepted.money).toBe(50 + 72);
    expect(accepted.reputation).toBe(3); // +1 reputation (NOT maxRenqing + 1)
    expect(accepted.redeemTickets).toBe(1); // 0 tickets consumed
    expect(composeBoss(accepted.deck).componentCount).toBe(1);
    expect(composeBoss(accepted.deck).fragmentNames).toEqual(['自行车的执念']);

    // 6. Reject ("留下手表"): 倒转 stays, reputation -1, money unchanged, Boss keeps watch component
    const rejected = resolveRedemption(baseState, false);
    expect(rejected.deck).toEqual(['倒转', '飞驰']);
    expect(rejected.money).toBe(50);
    expect(rejected.reputation).toBe(1);
    expect(composeBoss(rejected.deck).componentCount).toBe(2);
    expect(composeBoss(rejected.deck).fragmentNames).toEqual(['手表的执念', '自行车的执念']);
  });

  it('provides shopkeeper opening note, factual ending ledger, month-end epilogue, and v3 save compatibility', () => {
    expect(SHOPKEEPER_OPENING_NOTE_LINES.join('\n')).toContain('有人回来赎东西，先找当票，别让人白跑。');

    const ledger = buildEndingLedger(
      ['倒转', '飞驰', '钢笔'],
      {
        pawnedItemIds: ['watch', 'ring', 'bicycle'],
        redeemedDayByItem: { ring: 2 },
        bossComponentItemIds: ['watch', 'bicycle'],
      },
      REAL_ITEMS,
    );
    expect(ledger.returnedItems).toEqual(['婚戒']);
    expect(ledger.retainedItems).toEqual(['旧手表', '永久自行车']);
    expect(ledger.bossFragmentItems).toEqual(['旧手表', '永久自行车']);
    expect(ledger.lines).toEqual([
      '物归原主:婚戒',
      '留柜未赎:旧手表、永久自行车',
      '化作执念:旧手表、永久自行车(2块)',
    ]);

    const epilogueCh3 = buildMonthEndEpilogueLines(ledger, 3);
    expect(epilogueCh3[0]).toContain('三周二十一天');
    expect(epilogueCh3.join('\n')).toContain('物归原主:婚戒');

    // Backward compatibility with existing v3 saves lacking P11 fields & persistence of new fields
    const storage = createMemoryStorage();
    const legacyV3 = {
      version: SAVE_VERSION,
      day: 4,
      money: 120,
      reputation: 2,
      deck: ['飞驰'],
      shopLevel: 2,
      redeemTickets: 1,
      chapter: createInitialChapterState({ dayInChapter: 4 }),
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(legacyV3));
    const loadedLegacy = loadSaveDetailed(storage);
    expect(loadedLegacy.save?.chapter.dayInChapter).toBe(4);
    expect(loadedLegacy.quarantinedCorrupt).toBe(false);

    const p11Save: SaveData = {
      ...loadedLegacy.save!,
      chapter: {
        ...loadedLegacy.save!.chapter,
        day7FatherRedemptionDone: true,
        redeemedDayByItem: { ring: 2 },
        pawnedItemIds: ['ring', 'bicycle'],
        bossComponentItemIds: ['bicycle'],
      },
    };
    saveGame(p11Save, storage);
    const reloaded = loadSaveDetailed(storage);
    expect(reloaded.save?.chapter.day7FatherRedemptionDone).toBe(true);
    expect(reloaded.save?.chapter.redeemedDayByItem).toEqual({ ring: 2 });
    expect(reloaded.save?.chapter.pawnedItemIds).toEqual(['ring', 'bicycle']);
    expect(reloaded.save?.chapter.bossComponentItemIds).toEqual(['bicycle']);

    // Corrupt redeemedDayByItem must trigger quarantine
    const corrupt = {
      ...p11Save,
      chapter: { ...p11Save.chapter, redeemedDayByItem: { ring: -1 } },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(corrupt));
    const corruptLoad = loadSaveDetailed(storage);
    expect(corruptLoad.save).toBeNull();
    expect(corruptLoad.quarantinedCorrupt).toBe(true);
  });
});

describe('P11 Sub-item 4: Anti-repetition D1 cooldown & D2 soft unowned priority', () => {
  it('excludes redeemed item for N=2 days (D1) and allows it back after cooldown expires', () => {
    expect(REDEMPTION_COOLDOWN_DAYS).toBe(2);
    const redeemed = { ring: 2 };

    expect(isItemOnRedemptionCooldown('ring', 2, redeemed)).toBe(true);
    expect(isItemOnRedemptionCooldown('ring', 3, redeemed)).toBe(true);
    expect(isItemOnRedemptionCooldown('ring', 4, redeemed)).toBe(true);
    expect(isItemOnRedemptionCooldown('ring', 5, redeemed)).toBe(false);

    // Across many seeds, ring must NOT appear on Day 3 or Day 4, and CAN appear on Day 5
    for (let s = 1; s <= 40; s += 1) {
      const day3 = pickDailyItems(ITEMS, 3, mulberry32(s), 3, { redeemedDayByItem: redeemed });
      const day4 = pickDailyItems(ITEMS, 4, mulberry32(s), 3, { redeemedDayByItem: redeemed });
      expect(day3.some((i) => i.id === 'ring')).toBe(false);
      expect(day4.some((i) => i.id === 'ring')).toBe(false);
    }

    let seenOnDay5 = false;
    for (let s = 1; s <= 40; s += 1) {
      const day5 = pickDailyItems(ITEMS, 5, mulberry32(s), 3, { redeemedDayByItem: redeemed });
      if (day5.some((i) => i.id === 'ring')) {
        seenOnDay5 = true;
        break;
      }
    }
    expect(seenOnDay5).toBe(true);

    // validateChapters ensures pool remains non-empty after D1 exclusion
    const validation = validateChapters(REAL_CHAPTERS, DEMONS, REAL_ITEMS);
    expect(validation.valid).toBe(true);
  });

  it('prefers unowned items (D2 soft) and relaxes cleanly to owned items when unowned pool < 3', () => {
    // 3 owned items -> remaining 3 unowned items must be picked exclusively
    const deck3 = ['倒转', '守诺', '旧书'];
    const picked3 = pickDailyItems(ITEMS, 3, mulberry32(11), 3, { deck: deck3 });
    expect(picked3).toHaveLength(3);
    expect(picked3.every((i) => !deck3.includes(i.cardName))).toBe(true);

    // 5 owned items -> the 1 remaining unowned item (集邮) MUST be picked, and 2 owned items fill the rest
    const deck5 = ['倒转', '守诺', '旧书', '飞驰', '余音'];
    const picked5 = pickDailyItems(ITEMS, 4, mulberry32(22), 3, { deck: deck5 });
    expect(picked5).toHaveLength(3);
    expect(picked5.some((i) => i.id === 'stamp_album')).toBe(true);

    // All 6 owned -> relaxes cleanly to 3 items without crashing or returning empty
    const deck6 = ['倒转', '守诺', '旧书', '飞驰', '余音', '集邮'];
    const picked6 = pickDailyItems(ITEMS, 5, mulberry32(33), 3, { deck: deck6 });
    expect(picked6).toHaveLength(3);
  });
});
