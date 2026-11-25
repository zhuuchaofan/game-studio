import balanceJson from '../data/balance.json';
import type { WinReward } from './battle';

export const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
export const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
export const AUDIO_STORAGE_KEY = 'pawnshop-cards-audio-v1';
export const PAWN_PRICES_STORAGE_KEY = 'pawnshop-cards-pawn-prices-v1';
export const SAVE_VERSION = 1 as const;

export type PawnPriceLedger = Record<string, number[]>;

export interface SaveData {
  version: 1;
  day: number;
  money: number;
  reputation: number;
  deck: string[];
  shopLevel: number;
  redeemTickets: number;
  /** Optional backward-compatible tutorial completion flag (defaults to incomplete when omitted). */
  tutorialCompleted?: boolean;
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
  if (obj.tutorialCompleted !== undefined && typeof obj.tutorialCompleted !== 'boolean') {
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
    const loaded: SaveData = {
      version: SAVE_VERSION,
      day: Math.floor(parsed.day),
      money: parsed.money,
      reputation: parsed.reputation,
      deck: [...parsed.deck],
      shopLevel: Math.floor(parsed.shopLevel),
      redeemTickets: Math.floor(parsed.redeemTickets),
    };
    if (typeof parsed.tutorialCompleted === 'boolean') {
      loaded.tutorialCompleted = parsed.tutorialCompleted;
    }
    return loaded;
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
    if (typeof data.tutorialCompleted === 'boolean') {
      normalized.tutorialCompleted = data.tutorialCompleted;
    }
    store.setItem(SAVE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota/access failures without crashing the game
  }
}

/**
 * Reads whether the Day 1 tutorial has been completed or skipped.
 * Checks the dedicated tutorial key first and falls back to optional SaveData.tutorialCompleted.
 * Defaults to false when absent or unreadable.
 */
export function loadTutorialDone(storage?: StorageLike | null): boolean {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return false;
  }

  try {
    const raw = store.getItem(TUTORIAL_STORAGE_KEY);
    if (raw === '1' || raw === 'true') {
      return true;
    }
    if (raw === '0' || raw === 'false') {
      return false;
    }
  } catch {
    return false;
  }

  const existing = loadSave(store);
  return existing?.tutorialCompleted === true;
}

/**
 * Persists the tutorial completion flag in storage without altering existing SaveData shape.
 */
export function saveTutorialDone(done: boolean, storage?: StorageLike | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }

  try {
    if (done) {
      store.setItem(TUTORIAL_STORAGE_KEY, '1');
    } else {
      store.removeItem(TUTORIAL_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota/access failures
  }
}

/**
 * Clears the persisted tutorial completion mark.
 */
export function clearTutorialDone(storage?: StorageLike | null): void {
  saveTutorialDone(false, storage);
}

/**
 * Reads persisted audio mute state from storage. Defaults to false (sound ON).
 */
export function loadAudioMuted(storage?: StorageLike | null): boolean {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return false;
  }

  try {
    const raw = store.getItem(AUDIO_STORAGE_KEY);
    if (raw === '1' || raw === 'true' || raw === 'muted') {
      return true;
    }
    if (raw === '0' || raw === 'false' || raw === 'on') {
      return false;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Persists audio mute state into storage without altering SaveData shape.
 */
export function saveAudioMuted(muted: boolean, storage?: StorageLike | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }

  try {
    store.setItem(AUDIO_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Ignore storage quota/access failures
  }
}

/**
 * Loads historical pawn deal prices keyed by cardName (used by C4 redemption).
 * Stored in a dedicated key to preserve strict SaveData v1 backward compatibility.
 */
export function loadPawnPrices(storage?: StorageLike | null): PawnPriceLedger {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return {};
  }

  try {
    const raw = store.getItem(PAWN_PRICES_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const ledger: PawnPriceLedger = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        Array.isArray(val) &&
        val.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)
      ) {
        ledger[key] = [...val];
      }
    }
    return ledger;
  } catch {
    return {};
  }
}

export function savePawnPrices(ledger: PawnPriceLedger, storage?: StorageLike | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }

  try {
    const normalized: PawnPriceLedger = {};
    for (const [key, list] of Object.entries(ledger)) {
      if (list.length > 0) {
        normalized[key] = [...list];
      }
    }
    store.setItem(PAWN_PRICES_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota/access failures
  }
}

export function clearPawnPrices(storage?: StorageLike | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }

  try {
    store.removeItem(PAWN_PRICES_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
}

export function clonePawnPrices(ledger?: PawnPriceLedger): PawnPriceLedger {
  const out: PawnPriceLedger = {};
  if (!ledger) {
    return out;
  }
  for (const [key, list] of Object.entries(ledger)) {
    if (list.length > 0) {
      out[key] = [...list];
    }
  }
  return out;
}

export function recordPawnPrice(
  ledger: PawnPriceLedger,
  cardName: string,
  price: number,
): PawnPriceLedger {
  const next = clonePawnPrices(ledger);
  const list = next[cardName] ? [...next[cardName]] : [];
  list.push(price);
  next[cardName] = list;
  return next;
}

export function peekPawnPrice(ledger: PawnPriceLedger, cardName: string): number | null {
  const list = ledger[cardName];
  if (!list || list.length === 0) {
    return null;
  }
  return list[0];
}

export function consumePawnPrice(ledger: PawnPriceLedger, cardName: string): PawnPriceLedger {
  const next = clonePawnPrices(ledger);
  const list = next[cardName];
  if (!list || list.length === 0) {
    return next;
  }
  const rest = list.slice(1);
  if (rest.length > 0) {
    next[cardName] = rest;
  } else {
    delete next[cardName];
  }
  return next;
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
  const baseTutorial =
    typeof save.tutorialCompleted === 'boolean'
      ? { tutorialCompleted: save.tutorialCompleted }
      : {};

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
      ...baseTutorial,
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
    ...baseTutorial,
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
