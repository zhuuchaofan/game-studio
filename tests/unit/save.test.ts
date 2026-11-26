import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import { cloneChapterState, createInitialChapterState } from '../../src/game/chapters';
import {
  createInitialState,
  DAILY_CUSTOMER_COUNT,
  deriveDaySeed,
  ITEMS,
  shuffleItems,
} from '../../src/game/pawnshop';
import {
  applyDayResult,
  clearSave,
  clearTutorialDone,
  CORRUPT_SAVE_STORAGE_KEY,
  createNewGame,
  demonIdForDay,
  loadSave,
  loadSaveDetailed,
  loadTutorialDone,
  maxRenqingForLevel,
  MIGRATIONS,
  migrateSaveData,
  SAVE_STORAGE_KEY,
  SAVE_VERSION,
  saveGame,
  saveTutorialDone,
  TUTORIAL_STORAGE_KEY,
  type SaveData,
  type StorageLike,
} from '../../src/game/save';
import { mulberry32 } from '../../src/utils/rng';

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };
}

describe('SaveData, MIGRATIONS & corrupt-save quarantine', () => {
  it('createNewGame initializes Day 1 defaults at SAVE_VERSION = 3 from balance.json', () => {
    expect(SAVE_VERSION).toBe(3);
    const save = createNewGame();
    expect(save).toEqual({
      version: 3,
      day: 1,
      money: balanceJson.startingMoney,
      reputation: balanceJson.startingReputation,
      deck: [],
      shopLevel: 1,
      redeemTickets: 0,
      chapter: createInitialChapterState(),
    });
  });

  it('round-trips SaveData cleanly through saveGame / loadSave / clearSave', () => {
    const storage = createMemoryStorage();
    expect(loadSave(storage)).toBeNull();

    const sample: SaveData = {
      version: 3,
      day: 2,
      money: 150,
      reputation: 1,
      deck: ['倒转', '守诺', '钢笔'],
      shopLevel: 2,
      redeemTickets: 1,
      chapter: createInitialChapterState({
        dayInChapter: 2,
        daysCleared: [1],
        daysVisited: [1],
        pawnsCollected: 2,
        demonsDefeated: 1,
      }),
    };

    saveGame(sample, storage);
    expect(storage.store.has(SAVE_STORAGE_KEY)).toBe(true);

    const loaded = loadSave(storage);
    expect(loaded).toEqual(sample);
    expect(loaded).not.toBe(sample);
    expect(loaded?.deck).not.toBe(sample.deck);

    clearSave(storage);
    expect(loadSave(storage)).toBeNull();
  });

  it('migrates legacy v1 and v2 SaveData sequentially to v3 via MIGRATIONS without data loss', () => {
    expect(MIGRATIONS.some((m) => m.from === 1 && m.to === 2)).toBe(true);
    expect(MIGRATIONS.some((m) => m.from === 2 && m.to === 3)).toBe(true);

    const storage = createMemoryStorage();
    const v1Save = {
      version: 1,
      day: 3,
      money: 120,
      reputation: 2,
      deck: ['倒转', '守诺', '余音'],
      shopLevel: 2,
      redeemTickets: 1,
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(v1Save));

    const migratedRaw = migrateSaveData(v1Save);
    expect(migratedRaw?.migratedFrom).toBe(1);
    expect(migratedRaw?.data.version).toBe(3);

    const detailed = loadSaveDetailed(storage);
    expect(detailed.quarantinedCorrupt).toBe(false);
    expect(detailed.migratedFrom).toBe(1);
    expect(detailed.save?.version).toBe(3);
    expect(detailed.save?.day).toBe(3);
    expect(detailed.save?.money).toBe(120);
    expect(detailed.save?.deck).toEqual(['倒转', '守诺', '余音']);
    expect(detailed.save?.chapter.currentChapter).toBe(1);
    expect(detailed.save?.chapter.dayInChapter).toBe(3);
    expect(detailed.save?.chapter.daysVisited).toEqual([1, 2]);
    expect(storage.store.has(CORRUPT_SAVE_STORAGE_KEY)).toBe(false);

    // Also test v2 -> v3 direct migration
    const v2Save = {
      version: 2,
      day: 4,
      money: 180,
      reputation: 3,
      deck: ['倒转', '守诺', '飞驰', '钢笔'],
      shopLevel: 3,
      redeemTickets: 2,
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(v2Save));
    const v2Loaded = loadSaveDetailed(storage);
    expect(v2Loaded.quarantinedCorrupt).toBe(false);
    expect(v2Loaded.migratedFrom).toBe(2);
    expect(v2Loaded.save?.version).toBe(3);
    expect(v2Loaded.save?.money).toBe(180);
    expect(v2Loaded.save?.chapter.currentChapter).toBe(1);
    expect(v2Loaded.save?.chapter.dayInChapter).toBe(4);
    expect(v2Loaded.save?.chapter.pactChoice).toBeNull();
    expect(v2Loaded.save?.chapter.chapter1Completed).toBe(false);
  });

  it('quarantines corrupted JSON, unsupported future versions, or invalid fields to pawnshop-cards-save-corrupt-v1 without throwing', () => {
    const storage = createMemoryStorage();

    // 1. Corrupted JSON
    const brokenJson = '{not-valid-json';
    storage.setItem(SAVE_STORAGE_KEY, brokenJson);
    const res1 = loadSaveDetailed(storage);
    expect(res1.save).toBeNull();
    expect(res1.quarantinedCorrupt).toBe(true);
    expect(storage.store.get(CORRUPT_SAVE_STORAGE_KEY)).toBe(brokenJson);

    // 2. Unsupported future version
    const futureSave = JSON.stringify({
      version: 99,
      day: 1,
      money: 200,
      reputation: 0,
      deck: [],
      shopLevel: 1,
      redeemTickets: 0,
    });
    storage.setItem(SAVE_STORAGE_KEY, futureSave);
    const res2 = loadSaveDetailed(storage);
    expect(res2.save).toBeNull();
    expect(res2.quarantinedCorrupt).toBe(true);
    expect(storage.store.get(CORRUPT_SAVE_STORAGE_KEY)).toBe(futureSave);

    // 3. Invalid field types
    const invalidFields = JSON.stringify({
      version: 2,
      day: 0,
      money: '200',
      reputation: 0,
      deck: [123],
      shopLevel: 1,
      redeemTickets: 0,
    });
    storage.setItem(SAVE_STORAGE_KEY, invalidFields);
    expect(loadSave(storage)).toBeNull();
    expect(storage.store.get(CORRUPT_SAVE_STORAGE_KEY)).toBe(invalidFields);
  });

  it('applyDayResult updates money, deck, redeemTickets, shopLevel, and day on win (immutably)', () => {
    const initial: SaveData = {
      version: 3,
      day: 1,
      money: 120,
      reputation: 1,
      deck: ['倒转', '守诺'],
      shopLevel: 1,
      redeemTickets: 0,
      chapter: createInitialChapterState(),
    };
    const snapshot = structuredClone(initial);

    const afterWin = applyDayResult(initial, {
      outcome: 'win',
      reward: {
        money: 20,
        cardName: '钢笔',
        redeemTicket: 1,
        allOwnedBonus: false,
      },
    });

    expect(initial).toEqual(snapshot);
    expect(afterWin).toEqual({
      version: 3,
      day: 2,
      money: 140,
      reputation: 1,
      deck: ['倒转', '守诺', '钢笔'],
      shopLevel: 2,
      redeemTickets: 1,
      chapter: createInitialChapterState({
        dayInChapter: 2,
        daysCleared: [1],
        daysVisited: [1],
        demonsDefeated: 1,
      }),
    });

    const afterFullWin = applyDayResult(afterWin, {
      outcome: 'win',
      reward: {
        money: 40,
        cardName: null,
        redeemTicket: 1,
        allOwnedBonus: true,
      },
    });
    expect(afterFullWin.money).toBe(180);
    expect(afterFullWin.deck).toEqual(['倒转', '守诺', '钢笔']);
    expect(afterFullWin.shopLevel).toBe(3);
    expect(afterFullWin.redeemTickets).toBe(2);
    expect(afterFullWin.day).toBe(3);
    expect(afterFullWin.chapter.dayInChapter).toBe(3);
    expect(afterFullWin.chapter.daysCleared).toEqual([1, 2]);
  });

  it('applyDayResult increments only day on lose while keeping money, deck, level, tickets unchanged', () => {
    const initial: SaveData = {
      version: 3,
      day: 1,
      money: 90,
      reputation: -1,
      deck: ['倒转', '旧书'],
      shopLevel: 2,
      redeemTickets: 1,
      chapter: createInitialChapterState(),
    };

    const afterLose = applyDayResult(initial, { outcome: 'lose' });
    expect(afterLose).toEqual({
      version: 3,
      day: 2,
      money: 90,
      reputation: -1,
      deck: ['倒转', '旧书'],
      shopLevel: 2,
      redeemTickets: 1,
      chapter: createInitialChapterState({
        dayInChapter: 2,
        daysCleared: [],
        daysVisited: [1],
        demonsDefeated: 0,
      }),
    });
    expect(afterLose.deck).not.toBe(initial.deck);
  });

  it('persists tutorial completion backward-compatibly across v1->v2->v3 migration', () => {
    const storage = createMemoryStorage();
    expect(loadTutorialDone(storage)).toBe(false);

    const legacySave = {
      version: 1,
      day: 1,
      money: 200,
      reputation: 0,
      deck: [],
      shopLevel: 1,
      redeemTickets: 0,
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(legacySave));
    expect(loadSave(storage)?.version).toBe(3);
    expect(loadSave(storage)?.day).toBe(1);
    expect(loadTutorialDone(storage)).toBe(false);

    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({ ...legacySave, tutorialCompleted: true }),
    );
    expect(loadSave(storage)?.tutorialCompleted).toBe(true);
    expect(loadTutorialDone(storage)).toBe(true);

    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({ ...legacySave, tutorialCompleted: 'yes' }),
    );
    expect(loadSave(storage)).toBeNull();
    expect(loadTutorialDone(storage)).toBe(false);

    saveTutorialDone(true, storage);
    expect(storage.store.get(TUTORIAL_STORAGE_KEY)).toBe('1');
    expect(loadTutorialDone(storage)).toBe(true);

    clearSave(storage);
    expect(loadSave(storage)).toBeNull();
    expect(loadTutorialDone(storage)).toBe(true);

    clearTutorialDone(storage);
    expect(loadTutorialDone(storage)).toBe(false);
  });
});

describe('Renqing scaling, demon rotation & day customer shuffle', () => {
  it('maxRenqingForLevel scales 3 -> 4 -> 5 -> 6 (capped at 6)', () => {
    expect(maxRenqingForLevel(1)).toBe(3);
    expect(maxRenqingForLevel(2)).toBe(4);
    expect(maxRenqingForLevel(3)).toBe(5);
    expect(maxRenqingForLevel(4)).toBe(6);
    expect(maxRenqingForLevel(5)).toBe(6);
    expect(maxRenqingForLevel(99)).toBe(6);
  });

  it('demonIdForDay cycles A -> B -> C -> D across days 1..8 and onward', () => {
    expect(demonIdForDay(1)).toBe('a');
    expect(demonIdForDay(2)).toBe('b');
    expect(demonIdForDay(3)).toBe('c');
    expect(demonIdForDay(4)).toBe('d');
    expect(demonIdForDay(5)).toBe('a');
    expect(demonIdForDay(6)).toBe('b');
    expect(demonIdForDay(7)).toBe('c');
    expect(demonIdForDay(8)).toBe('d');
  });

  it('shuffleItems is deterministic for a fixed seed + day, preserves all 6 items, and slices to 3 daily customers', () => {
    expect(ITEMS).toHaveLength(6);
    expect(DAILY_CUSTOMER_COUNT).toBe(3);

    const order1 = shuffleItems(ITEMS, mulberry32(deriveDaySeed(7, 1)));
    const order2 = shuffleItems(ITEMS, mulberry32(deriveDaySeed(7, 1)));
    expect(order1).toEqual(order2);
    expect(order1.map((i) => i.id).sort()).toEqual(ITEMS.map((i) => i.id).sort());
    expect(order1).not.toBe(ITEMS);

    const daily1 = order1.slice(0, DAILY_CUSTOMER_COUNT);
    expect(daily1).toHaveLength(3);
    expect(new Set(daily1.map((i) => i.id)).size).toBe(3);

    const seenOrders = new Set<string>();
    const seenIds = new Set<string>();
    for (let day = 1; day <= 10; day += 1) {
      const dayDaily = shuffleItems(ITEMS, mulberry32(deriveDaySeed(7, day))).slice(
        0,
        DAILY_CUSTOMER_COUNT,
      );
      seenOrders.add(dayDaily.map((i) => i.id).join(','));
      for (const item of dayDaily) {
        seenIds.add(item.id);
      }
    }
    expect(seenOrders.size).toBeGreaterThan(1);
    expect(seenIds.has('bicycle')).toBe(true);
    expect(seenIds.has('erhu')).toBe(true);
    expect(seenIds.has('stamp_album')).toBe(true);
  });

  it('createInitialState initializes PawnshopState from optional SaveData fields', () => {
    const state = createInitialState({
      day: 3,
      money: 160,
      reputation: 2,
      deck: ['倒转', '钢笔'],
    });
    expect(state.day).toBe(3);
    expect(state.money).toBe(160);
    expect(state.reputation).toBe(2);
    expect(state.deck).toEqual(['倒转', '钢笔']);
    expect(state.phase).toBe('negotiating');
    expect(state.customerIndex).toBe(0);
  });

  it('persists, deep-clones, and validates optional rejectedRedemptionDayByItem without bumping v3', () => {
    const storage = createMemoryStorage();
    const save = createNewGame();
    save.chapter.rejectedRedemptionDayByItem = { erhu: 5 };

    const cloned = cloneChapterState(save.chapter);
    expect(cloned.rejectedRedemptionDayByItem).toEqual({ erhu: 5 });
    expect(cloned.rejectedRedemptionDayByItem).not.toBe(save.chapter.rejectedRedemptionDayByItem);

    saveGame(save, storage);
    const loaded = loadSaveDetailed(storage);
    expect(loaded.quarantinedCorrupt).toBe(false);
    expect(loaded.save?.version).toBe(SAVE_VERSION);
    expect(loaded.save?.chapter.rejectedRedemptionDayByItem).toEqual({ erhu: 5 });

    // Invalid value (day <= 0 or non-integer) must quarantine as corrupt
    const corrupt = {
      ...save,
      chapter: { ...save.chapter, rejectedRedemptionDayByItem: { erhu: 0 } },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(corrupt));
    const bad = loadSaveDetailed(storage);
    expect(bad.save).toBeNull();
    expect(bad.quarantinedCorrupt).toBe(true);
  });
});
