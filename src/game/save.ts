import balanceJson from '../data/balance.json';
import type { WinReward } from './battle';

export const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
export const SAVE_VERSION = 1 as const;

export interface SaveData {
  version: 1;
  day: number;
  money: number;
  reputation: number;
  deck: string[];
  shopLevel: number;
  redeemTickets: number;
}

export interface SaveBalanceConfig {
  startingMoney: number;
  startingReputation: number;
  renqingBase: number;
  renqingPerLevel: number;
  renqingCap: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DayResultInput {
  outcome: 'win' | 'lose';
  reward?: WinReward | null;
}

export const SAVE_BALANCE: SaveBalanceConfig = {
  startingMoney: balanceJson.startingMoney,
  startingReputation: balanceJson.startingReputation,
  renqingBase: balanceJson.renqingBase,
  renqingPerLevel: balanceJson.renqingPerLevel,
  renqingCap: balanceJson.renqingCap,
};

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function isValidSaveData(raw: unknown): raw is SaveData {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== SAVE_VERSION) {
    return false;
  }
  if (
    typeof obj.day !== 'number' ||
    !Number.isFinite(obj.day) ||
    obj.day < 1 ||
    typeof obj.money !== 'number' ||
    !Number.isFinite(obj.money) ||
    typeof obj.reputation !== 'number' ||
    !Number.isFinite(obj.reputation) ||
    typeof obj.shopLevel !== 'number' ||
    !Number.isFinite(obj.shopLevel) ||
    obj.shopLevel < 1 ||
    typeof obj.redeemTickets !== 'number' ||
    !Number.isFinite(obj.redeemTickets) ||
    obj.redeemTickets < 0
  ) {
    return false;
  }
  if (!Array.isArray(obj.deck) || !obj.deck.every((entry) => typeof entry === 'string')) {
    return false;
  }
  return true;
}

/**
 * Creates a fresh Day 1 save record using balance.json starting fields.
 */
export function createNewGame(balance: Pick<SaveBalanceConfig, 'startingMoney' | 'startingReputation'> = SAVE_BALANCE): SaveData {
  return {
    version: SAVE_VERSION,
    day: 1,
    money: balance.startingMoney,
    reputation: balance.startingReputation,
    deck: [],
    shopLevel: 1,
    redeemTickets: 0,
  };
}

/**
 * Loads save data from storage. Returns null on missing, corrupted JSON, or version mismatch.
 */
export function loadSave(storage?: StorageLike | null): SaveData | null {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return null;
  }

  try {
    const raw = store.getItem(SAVE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSaveData(parsed)) {
      return null;
    }
    return {
      version: SAVE_VERSION,
      day: Math.floor(parsed.day),
      money: parsed.money,
      reputation: parsed.reputation,
      deck: [...parsed.deck],
      shopLevel: Math.floor(parsed.shopLevel),
      redeemTickets: Math.floor(parsed.redeemTickets),
    };
  } catch {
    return null;
  }
}

/**
 * Persists save data into storage.
 */
export function saveGame(data: SaveData, storage?: StorageLike | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }

  try {
    const normalized: SaveData = {
      version: SAVE_VERSION,
      day: data.day,
      money: data.money,
      reputation: data.reputation,
      deck: [...data.deck],
      shopLevel: data.shopLevel,
      redeemTickets: data.redeemTickets,
    };
    store.setItem(SAVE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota/access failures without crashing the game
  }
}

/**
 * Removes saved data from storage.
 */
export function clearSave(storage?: StorageLike | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }

  try {
    store.removeItem(SAVE_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
}

/**
 * Pure immutable transition applying night battle outcome to SaveData.
 * - Win: +money, +new card (if any), +redeemTickets, shopLevel +1, day +1
 * - Lose: only day +1 (deck/money/reputation/shopLevel/redeemTickets unchanged)
 */
export function applyDayResult(save: SaveData, result: DayResultInput): SaveData {
  if (result.outcome === 'win') {
    const reward = result.reward ?? null;
    const nextDeck = reward?.cardName ? [...save.deck, reward.cardName] : [...save.deck];
    return {
      version: SAVE_VERSION,
      day: save.day + 1,
      money: save.money + (reward?.money ?? 0),
      reputation: save.reputation,
      deck: nextDeck,
      shopLevel: save.shopLevel + 1,
      redeemTickets: save.redeemTickets + (reward?.redeemTicket ?? 0),
    };
  }

  return {
    version: SAVE_VERSION,
    day: save.day + 1,
    money: save.money,
    reputation: save.reputation,
    deck: [...save.deck],
    shopLevel: save.shopLevel,
    redeemTickets: save.redeemTickets,
  };
}

/**
 * Computes max renqing for a given shop level:
 * min(renqingBase + (shopLevel - 1) * renqingPerLevel, renqingCap).
 */
export function maxRenqingForLevel(
  shopLevel: number,
  balance: Pick<SaveBalanceConfig, 'renqingBase' | 'renqingPerLevel' | 'renqingCap'> = SAVE_BALANCE,
): number {
  const clampedLevel = Math.max(1, Math.floor(shopLevel));
  const raw = balance.renqingBase + (clampedLevel - 1) * balance.renqingPerLevel;
  return Math.min(raw, balance.renqingCap);
}

export type DemonId = 'a' | 'b' | 'c' | 'd';

const DEMON_ROTATION: readonly DemonId[] = ['a', 'b', 'c', 'd'];

/**
 * Night demon rotation rule: Day 1 -> 'a' (药费), Day 2 -> 'b' (车票),
 * Day 3 -> 'c' (房租), Day 4 -> 'd' (学费), cycling A -> B -> C -> D from Day 5 onward.
 */
export function demonIdForDay(day: number): DemonId {
  const normalizedDay = Math.max(1, Math.floor(day));
  return DEMON_ROTATION[(normalizedDay - 1) % DEMON_ROTATION.length];
}
