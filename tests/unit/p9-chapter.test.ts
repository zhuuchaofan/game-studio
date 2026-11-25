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
  buildCalendarEntries,
  CHAPTER_ONE_ID,
  createInitialChapterState,
  getBossHpBonus,
  getNightDemonHpBonus,
  getRedemptionMultiplier,
  getSkipCustomerReputationDelta,
  pickSideQuestItem,
  removeCardAtIndex,
  selectDemonForChapterDay,
  type ChaptersDataFile,
} from '../../src/game/chapters';
import {
  createInitialState,
  createRedemptionOffer,
  ITEMS,
  skipCustomer,
  type PawnItem,
} from '../../src/game/pawnshop';
import {
  applyDayResult,
  applyPactToSave,
  createNewGame,
  loadSaveDetailed,
  SAVE_STORAGE_KEY,
  SAVE_VERSION,
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
  drawFirst: 5,
  drawPerRound: 2,
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

describe('P9 Chapter 1 configuration & validation', () => {
  it('validates real chapters.json cleanly and rejects broken demon/item/boss/empty-pool configs', () => {
    const ok = validateChapters(REAL_CHAPTERS, DEMONS, REAL_ITEMS);
    expect(ok.errors).toEqual([]);
    expect(ok.valid).toBe(true);

    // Broken chapter: unknown demon, unknown item, empty pool, Boss with actions.length != 4
    const brokenBossDemons: DemonDef[] = DEMONS.map((d) =>
      d.id === 'boss_ch1' ? { ...d, actions: d.actions.slice(0, 3) } : d,
    );
    const brokenChapters: ChaptersDataFile = {
      chapters: [
        {
          ...REAL_CHAPTERS.chapters[0],
          itemPool: ['watch', 'nonexistent_item'],
          dailyDemonPools: REAL_CHAPTERS.chapters[0].dailyDemonPools.map((entry) =>
            entry.day === 5
              ? { ...entry, demonPool: [] }
              : entry.day === 6
                ? { ...entry, demonPool: ['ghost_demon'] }
                : entry,
          ),
        },
      ],
    };

    const res = validateChapters(brokenChapters, brokenBossDemons, REAL_ITEMS);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('actions length must be 4'))).toBe(true);
    expect(res.errors.some((e) => e.includes('unknown item "nonexistent_item"'))).toBe(true);
    expect(res.errors.some((e) => e.includes('demonPool must be non-empty'))).toBe(true);
    expect(res.errors.some((e) => e.includes('unknown demon "ghost_demon"'))).toBe(true);
  });

  it('selects chapter demons deterministically for Days 1..7 and builds calendar entries', () => {
    expect(selectDemonForChapterDay(CHAPTER_ONE_ID, 1, 7)).toBe('a');
    expect(selectDemonForChapterDay(CHAPTER_ONE_ID, 2, 7)).toBe('b');
    expect(selectDemonForChapterDay(CHAPTER_ONE_ID, 3, 7)).toBe('c');
    expect(selectDemonForChapterDay(CHAPTER_ONE_ID, 4, 7)).toBe('d');
    expect(['b', 'c', 'd']).toContain(selectDemonForChapterDay(CHAPTER_ONE_ID, 5, 7));
    expect(['b', 'c', 'd']).toContain(selectDemonForChapterDay(CHAPTER_ONE_ID, 6, 7));
    expect(selectDemonForChapterDay(CHAPTER_ONE_ID, 7, 7)).toBe('boss_ch1');

    const chState = createInitialChapterState({
      dayInChapter: 4,
      daysCleared: [1, 2],
      daysVisited: [1, 2, 3],
    });
    const entries = buildCalendarEntries(chState, 7);
    expect(entries).toHaveLength(7);
    expect(entries[0].status).toBe('cleared');
    expect(entries[1].status).toBe('cleared');
    expect(entries[2].status).toBe('visited');
    expect(entries[3].status).toBe('current');
    expect(entries[3].tag).toBe('集市日');
    expect(entries[4].status).toBe('upcoming');
    expect(entries[6].isBossDay).toBe(true);
    expect(entries[6].tag).toBe('大心魔');
  });
});

describe('P9 Day 7 Boss "老债主·催账单" charge & interrupt logic', () => {
  it('INTERRUPT path: R2 starts with 4 shield & charging; >=10 cumulative dmg emits BOSS_CHARGE_INTERRUPTED, refunds +1 renqing, and drops R3 damage from 11 to 3', () => {
    // 5-card deterministic deck of 秤砣 (5 dmg, 1 cost) so R2 deals 5 + 5 = 10 exact dmg
    const deck = ['秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'];
    let state = createBattle(deck, 'boss_ch1', mulberry32(1), CARDS, DEMONS, BATTLE_BALANCE);

    expect(state.isBoss).toBe(true);
    expect(state.maxRounds).toBe(4);
    expect(state.demonHp).toBe(38);
    expect(state.demonShield).toBe(0);
    expect(state.bossCharging).toBe(false);

    // End R1 -> Boss deals 3 dmg (30 -> 27), R2 starts charging with 4 shield
    const r1End = endTurn(state);
    state = r1End.state;
    expect(state.round).toBe(2);
    expect(state.playerHp).toBe(27);
    expect(state.demonShield).toBe(4);
    expect(state.bossCharging).toBe(true);
    expect(state.bossChargeThreshold).toBe(10);
    expect(r1End.events.some((e) => e.type === 'BOSS_CHARGE_STARTED' && e.shieldGained === 4)).toBe(
      true,
    );

    const renqingStartR2 = state.renqing; // 5

    // First 秤砣 (5 dmg): 4 absorbed by shield + 1 HP dmg (38 -> 37), bossChargeDamage = 5 < 10
    const play1 = playCard(state, 0);
    state = play1.state;
    expect(state.demonShield).toBe(0);
    expect(state.demonHp).toBe(37);
    expect(state.bossChargeDamage).toBe(5);
    expect(state.bossChargeInterrupted).toBe(false);
    expect(state.renqing).toBe(renqingStartR2 - 1);
    expect(play1.events.some((e) => e.type === 'BOSS_CHARGE_INTERRUPTED')).toBe(false);

    // Second 秤砣 (5 dmg): cumulative 10 >= 10 -> INTERRUPT! +1 renqing refunded (net 0 cost on 2nd card)
    const play2 = playCard(state, 0);
    state = play2.state;
    expect(state.demonHp).toBe(32);
    expect(state.bossChargeDamage).toBe(10);
    expect(state.bossChargeInterrupted).toBe(true);
    expect(state.bossCharging).toBe(false);
    expect(state.renqing).toBe(renqingStartR2 - 2 + 1); // -1 cost, +1 refund = 4
    const intEvent = play2.events.find((e) => e.type === 'BOSS_CHARGE_INTERRUPTED');
    expect(intEvent).toBeDefined();
    if (intEvent && intEvent.type === 'BOSS_CHARGE_INTERRUPTED') {
      expect(intEvent.refundRenqing).toBe(1);
      expect(intEvent.reducedNextDamage).toBe(3);
      expect(intEvent.damageDealt).toBe(10);
    }

    // End R2 -> Boss R2 deals 0 dmg; R3 action damage is now 3 (reduced from 11)
    const r2End = endTurn(state);
    state = r2End.state;
    expect(state.round).toBe(3);
    expect(state.playerHp).toBe(27);

    // End R3 -> Boss deals ONLY 3 dmg (27 -> 24)
    const r3End = endTurn(state);
    state = r3End.state;
    expect(state.round).toBe(4);
    expect(state.playerHp).toBe(24);

    // End R4 -> Boss deals 6 dmg (24 -> 18) and battle times out on R4
    const r4End = endTurn(state);
    state = r4End.state;
    expect(state.result).toBe('lose_timeout');
    expect(state.playerHp).toBe(18);
  });

  it('NON-INTERRUPT path: dealing <10 dmg in R2 keeps R3 「封门」 at full 11 damage with no renqing refund', () => {
    // 钢笔 deals 4 dmg (1 cost), 守诺 deals 0 dmg -> deal only 4 dmg in R2 (<10)
    const deck = ['钢笔', '守诺', '守诺', '守诺', '守诺', '守诺', '守诺'];
    let state = createBattle(deck, 'boss_ch1', mulberry32(2), CARDS, DEMONS, BATTLE_BALANCE);

    // Advance R1 -> R2 (Boss deals 3 dmg: 30 -> 27, gains 4 shield)
    state = endTurn(state).state;
    expect(state.round).toBe(2);
    expect(state.playerHp).toBe(27);
    expect(state.demonShield).toBe(4);

    // Play 钢笔 if in hand (4 dmg absorbed by 4 shield, still < 10)
    const penIdx = state.hand.indexOf('钢笔');
    if (penIdx >= 0) {
      const renqingBefore = state.renqing;
      const playRes = playCard(state, penIdx);
      state = playRes.state;
      expect(state.bossChargeInterrupted).toBe(false);
      expect(state.renqing).toBe(renqingBefore - 1); // No refund
      expect(playRes.events.some((e) => e.type === 'BOSS_CHARGE_INTERRUPTED')).toBe(false);
    }

    // End R2 -> R3 (0 dmg in R2, demonShield resets to 0)
    state = endTurn(state).state;
    expect(state.round).toBe(3);
    expect(state.demonShield).toBe(0);
    expect(state.playerHp).toBe(27);

    // End R3 without shielding -> Boss unleashes full 11 dmg (27 -> 16)
    state = endTurn(state).state;
    expect(state.round).toBe(4);
    expect(state.playerHp).toBe(16);
  });

  it('supports demonHpBonus for Day 4 credit_stock (+6 -> 44 HP) and Day 6 side quest (+4 HP)', () => {
    const boss44 = createBattle(['钢笔'], 'boss_ch1', mulberry32(1), CARDS, DEMONS, BATTLE_BALANCE, undefined, {
      demonHpBonus: 6,
    });
    expect(boss44.demonHp).toBe(44);
    expect(boss44.demonMaxHp).toBe(44);

    const sideQuestDemon = createBattle(['钢笔'], 'c', mulberry32(1), CARDS, DEMONS, BATTLE_BALANCE, undefined, {
      demonHpBonus: 4,
    });
    expect(sideQuestDemon.demonHp).toBe(30); // 26 + 4
  });
});

describe('P9 Day 4 Pact 3 options, free trim & Day 6 Side Quest', () => {
  it('applies all 3 Day 4 Pact effects accurately', () => {
    const base = createNewGame();
    base.day = 4;
    base.chapter.dayInChapter = 4;

    // 1. 厚利当单: redemption 1.2 -> 1.5, skip customer rep -1
    const highMargin = applyPactToSave(base, 'high_margin');
    expect(highMargin.chapter.pactChoice).toBe('high_margin');
    expect(highMargin.money).toBe(base.money);
    expect(getRedemptionMultiplier(highMargin.chapter.pactChoice)).toBe(1.5);
    expect(getSkipCustomerReputationDelta(highMargin.chapter.pactChoice)).toBe(-1);

    const offer = createRedemptionOffer(
      ['守诺'],
      1,
      { 守诺: [60] },
      mulberry32(1),
      ITEMS,
      getRedemptionMultiplier('high_margin'),
    );
    expect(offer?.payout).toBe(90); // 60 * 1.5 = 90 (vs 72 at 1.2)

    const shopState = createInitialState({ money: 100, reputation: 2, items: ITEMS.slice(0, 3) });
    const afterSkip = skipCustomer(shopState, {
      reputationDelta: getSkipCustomerReputationDelta('high_margin'),
    });
    expect(afterSkip.reputation).toBe(1); // 2 - 1

    // 2. 赊账进货: immediately +80 money, Day 7 Boss HP +6
    const creditStock = applyPactToSave(base, 'credit_stock');
    expect(creditStock.chapter.pactChoice).toBe('credit_stock');
    expect(creditStock.money).toBe(base.money + 80);
    expect(getBossHpBonus(creditStock.chapter.pactChoice)).toBe(6);
    expect(
      getNightDemonHpBonus({
        currentChapter: 1,
        dayInChapter: 7,
        pactChoice: 'credit_stock',
        sideQuestChoice: null,
      }),
    ).toBe(6);

    // 3. 稳扎稳打: immediately +1 reputation, no extra cost
    const steady = applyPactToSave(base, 'steady_shop');
    expect(steady.chapter.pactChoice).toBe('steady_shop');
    expect(steady.reputation).toBe(base.reputation + 1);
    expect(steady.money).toBe(base.money);
    expect(getBossHpBonus(steady.chapter.pactChoice)).toBe(0);
    expect(getSkipCustomerReputationDelta(steady.chapter.pactChoice)).toBe(0);
  });

  it('Day 4 free trim removes exact index and Day 6 side quest draws an unowned item with +4 night demon HP', () => {
    const trimmed = removeCardAtIndex(['倒转', '守诺', '飞驰'], 1);
    expect(trimmed).toEqual(['倒转', '飞驰']);

    const ownedDeck = ['倒转', '守诺', '旧书', '飞驰', '余音']; // missing only 集邮 (stamp_album)
    const picked = pickSideQuestItem(ownedDeck, ITEMS, mulberry32(42));
    expect(picked?.id).toBe('stamp_album');
    expect(picked?.cardName).toBe('集邮');

    expect(
      getNightDemonHpBonus({
        currentChapter: 1,
        dayInChapter: 6,
        pactChoice: null,
        sideQuestChoice: 'accepted',
      }),
    ).toBe(4);
    expect(
      getNightDemonHpBonus({
        currentChapter: 1,
        dayInChapter: 6,
        pactChoice: null,
        sideQuestChoice: 'rejected',
      }),
    ).toBe(0);
  });
});

describe('P9 Save v2->v3 migration & Chapter completion/failure states', () => {
  it('migrates v2 save cleanly to v3 and preserves fields without corruption', () => {
    const storage = createMemoryStorage();
    const v2 = {
      version: 2,
      day: 5,
      money: 145,
      reputation: 3,
      deck: ['飞驰', '余音', '守诺', '钢笔'],
      shopLevel: 4,
      redeemTickets: 2,
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(v2));

    const res = loadSaveDetailed(storage);
    expect(res.quarantinedCorrupt).toBe(false);
    expect(res.migratedFrom).toBe(2);
    expect(res.save?.version).toBe(SAVE_VERSION);
    expect(res.save?.day).toBe(5);
    expect(res.save?.money).toBe(145);
    expect(res.save?.chapter.currentChapter).toBe(1);
    expect(res.save?.chapter.dayInChapter).toBe(5);
    expect(res.save?.chapter.chapter1Completed).toBe(false);
    expect(res.save?.chapter.bossBattleActive).toBe(false);
    expect(res.save?.chapter.pactChoice).toBeNull();
    expect(res.save?.chapter.sideQuestChoice).toBeNull();
  });

  it('records chapter completion on Boss win and chapter failure (without losing money/cards) on Boss loss', () => {
    const day7Save = createNewGame();
    day7Save.day = 7;
    day7Save.money = 135;
    day7Save.reputation = 4;
    day7Save.deck = ['飞驰', '余音', '秤砣', '钢笔', '守诺'];
    day7Save.shopLevel = 4;
    day7Save.chapter = createInitialChapterState({
      dayInChapter: 7,
      bossBattleActive: true,
      daysCleared: [1, 2, 3, 4, 5, 6],
      daysVisited: [1, 2, 3, 4, 5, 6],
      pawnsCollected: 12,
      demonsDefeated: 6,
    });

    const won = applyDayResult(day7Save, {
      outcome: 'win',
      isBossBattle: true,
      reward: { money: 40, cardName: '相机', redeemTicket: 1, allOwnedBonus: false },
    });
    expect(won.chapter.chapter1Completed).toBe(true);
    expect(won.chapter.status).toBe('completed');
    expect(won.chapter.bossBattleActive).toBe(false);
    expect(won.chapter.daysCleared).toContain(7);
    expect(won.chapter.demonsDefeated).toBe(7);
    expect(won.money).toBe(175);

    const failed = applyDayResult(day7Save, {
      outcome: 'lose',
      isBossBattle: true,
    });
    expect(failed.chapter.chapter1Completed).toBe(false);
    expect(failed.chapter.chapter1FailedCount).toBe(1);
    expect(failed.chapter.status).toBe('failed');
    expect(failed.chapter.bossBattleActive).toBe(false);
    // Must NOT deduct money or remove cards on Boss defeat
    expect(failed.money).toBe(135);
    expect(failed.reputation).toBe(4);
    expect(failed.deck).toEqual(['飞驰', '余音', '秤砣', '钢笔', '守诺']);
  });
});
