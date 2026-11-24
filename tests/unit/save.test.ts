import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
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
  createNewGame,
  demonIdForDay,
  loadSave,
  maxRenqingForLevel,
  SAVE_STORAGE_KEY,
  saveGame,
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

describe('SaveData & localStorage persistence', () => {
  it('createNewGame initializes Day 1 defaults from balance.json', () => {
    const save = createNewGame();
    expect(save).toEqual({
      version: 1,
      day: 1,
      money: balanceJson.startingMoney,
      reputation: balanceJson.startingReputation,
      deck: [],
      shopLevel: 1,
      redeemTickets: 0,
    });
  });

  it('round-trips SaveData cleanly through saveGame / loadSave / clearSave', () => {
    const storage = createMemoryStorage();
    expect(loadSave(storage)).toBeNull();

    const sample: SaveData = {
      version: 1,
      day: 2,
      money: 150,
      reputation: 1,
      deck: ['倒转', '守诺', '钢笔'],
      shopLevel: 2,
      redeemTickets: 1,
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

  it('returns null without throwing on mismatched version or corrupted JSON', () => {
    const storage = createMemoryStorage();

    // Corrupted JSON
    storage.setItem(SAVE_STORAGE_KEY, '{not-valid-json');
    expect(loadSave(storage)).toBeNull();

    // Wrong version
    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        day: 1,
        money: 200,
        reputation: 0,
        deck: [],
        shopLevel: 1,
        redeemTickets: 0,
      }),
    );
    expect(loadSave(storage)).toBeNull();

    // Missing / invalid fields
    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        day: 0,
        money: '200',
        reputation: 0,
        deck: [123],
        shopLevel: 1,
        redeemTickets: 0,
      }),
    );
    expect(loadSave(storage)).toBeNull();
  });

  it('applyDayResult updates money, deck, redeemTickets, shopLevel, and day on win (immutably)', () => {
    const initial: SaveData = {
      version: 1,
      day: 1,
      money: 120,
      reputation: 1,
      deck: ['倒转', '守诺'],
      shopLevel: 1,
      redeemTickets: 0,
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
      version: 1,
      day: 2,
      money: 140,
      reputation: 1,
      deck: ['倒转', '守诺', '钢笔'],
      shopLevel: 2,
      redeemTickets: 1,
    });

    // When all cards owned (cardName === null, money already +40 from resolveWinReward)
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
  });

  it('applyDayResult increments only day on lose while keeping money, deck, level, tickets unchanged', () => {
    const initial: SaveData = {
      version: 1,
      day: 1,
      money: 90,
      reputation: -1,
      deck: ['倒转', '旧书'],
      shopLevel: 2,
      redeemTickets: 1,
    };

    const afterLose = applyDayResult(initial, { outcome: 'lose' });
    expect(afterLose).toEqual({
      version: 1,
      day: 2,
      money: 90,
      reputation: -1,
      deck: ['倒转', '旧书'],
      shopLevel: 2,
      redeemTickets: 1,
    });
    expect(afterLose.deck).not.toBe(initial.deck);
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

    // Different days can produce different 3-item daily lineups and surface all 6 items across days
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
});
