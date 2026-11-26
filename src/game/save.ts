import balanceJson from '../data/balance.json';
import type { WinReward } from './battle';
import {
  CHAPTER_DAYS,
  CHAPTER_ONE_ID,
  cloneChapterState,
  createInitialChapterState,
  getPactEffectDelta,
  isValidChapterStatus,
  isValidPactId,
  isValidSideQuestChoice,
  type ChapterSaveState,
  type PactId,
} from './chapters';

export const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
export const CORRUPT_SAVE_STORAGE_KEY = 'pawnshop-cards-save-corrupt-v1';
export const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
export const AUDIO_STORAGE_KEY = 'pawnshop-cards-audio-v1';
export const PAWN_PRICES_STORAGE_KEY = 'pawnshop-cards-pawn-prices-v1';
export const SAVE_VERSION = 3 as const;

export type PawnPriceLedger = Record<string, number[]>;

export interface SaveData {
  version: 3;
  day: number;
  money: number;
  reputation: number;
  deck: string[];
  shopLevel: number;
  redeemTickets: number;
  /** Optional backward-compatible tutorial completion flag (defaults to incomplete when omitted). */
  tutorialCompleted?: boolean;
  /** P9 Chapter progression block (v3). */
  chapter: ChapterSaveState;
}

export interface SaveMigration {
  from: number;
  to: number;
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
}

function buildDefaultChapterFromLegacy(raw: Record<string, unknown>): ChapterSaveState {
  const rawDay = typeof raw.day === 'number' && Number.isFinite(raw.day) ? Math.floor(raw.day) : 1;
  const clampedDay = Math.min(CHAPTER_DAYS, Math.max(1, rawDay));
  const rawDeckLen = Array.isArray(raw.deck) ? raw.deck.length : 0;
  const rawShopLevel =
    typeof raw.shopLevel === 'number' && Number.isFinite(raw.shopLevel) ? Math.floor(raw.shopLevel) : 1;
  const visited: number[] = [];
  for (let d = 1; d < clampedDay; d += 1) {
    visited.push(d);
  }
  return createInitialChapterState({
    currentChapter: CHAPTER_ONE_ID,
    dayInChapter: clampedDay,
    chapter1Completed: false,
    chapter1FailedCount: 0,
    status: 'in_progress',
    bossBattleActive: false,
    pactChoice: null,
    sideQuestChoice: null,
    daysCleared: [],
    daysVisited: visited,
    pawnsCollected: rawDeckLen,
    demonsDefeated: Math.max(0, rawShopLevel - 1),
    day4TrimDone: clampedDay > 4,
    day6SideQuestDone: clampedDay > 6,
  });
}

/**
 * Ordered sequential save schema migrations.
 * v1 -> v2: schema version bump (P7).
 * v2 -> v3: adds P9 7-day chapter block (chapter progress, pact, side quest, completion/failure flags).
 */
export const MIGRATIONS: readonly SaveMigration[] = [
  {
    from: 1,
    to: 2,
    migrate: (raw) => ({
      ...raw,
      version: 2,
    }),
  },
  {
    from: 2,
    to: 3,
    migrate: (raw) => ({
      ...raw,
      version: 3,
      chapter: buildDefaultChapterFromLegacy(raw),
    }),
  },
];

export interface SaveLoadResult {
  save: SaveData | null;
  migratedFrom: number | null;
  quarantinedCorrupt: boolean;
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
  isBossBattle?: boolean;
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

function isValidChapterSaveState(raw: unknown): raw is ChapterSaveState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return false;
  }
  const ch = raw as Record<string, unknown>;
  if (
    typeof ch.currentChapter !== 'number' ||
    !Number.isInteger(ch.currentChapter) ||
    ch.currentChapter < 1 ||
    typeof ch.dayInChapter !== 'number' ||
    !Number.isInteger(ch.dayInChapter) ||
    ch.dayInChapter < 1 ||
    ch.dayInChapter > CHAPTER_DAYS ||
    typeof ch.chapter1Completed !== 'boolean' ||
    typeof ch.chapter1FailedCount !== 'number' ||
    !Number.isInteger(ch.chapter1FailedCount) ||
    ch.chapter1FailedCount < 0 ||
    !isValidChapterStatus(ch.status) ||
    typeof ch.bossBattleActive !== 'boolean' ||
    (ch.pactChoice !== null && !isValidPactId(ch.pactChoice)) ||
    (ch.sideQuestChoice !== null && !isValidSideQuestChoice(ch.sideQuestChoice)) ||
    typeof ch.pawnsCollected !== 'number' ||
    !Number.isFinite(ch.pawnsCollected) ||
    ch.pawnsCollected < 0 ||
    typeof ch.demonsDefeated !== 'number' ||
    !Number.isFinite(ch.demonsDefeated) ||
    ch.demonsDefeated < 0 ||
    typeof ch.day4TrimDone !== 'boolean' ||
    typeof ch.day6SideQuestDone !== 'boolean'
  ) {
    return false;
  }
  if (
    !Array.isArray(ch.daysCleared) ||
    !ch.daysCleared.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= CHAPTER_DAYS)
  ) {
    return false;
  }
  if (
    !Array.isArray(ch.daysVisited) ||
    !ch.daysVisited.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= CHAPTER_DAYS)
  ) {
    return false;
  }
  if (ch.day1RingPawned !== undefined && typeof ch.day1RingPawned !== 'boolean') {
    return false;
  }
  if (ch.day2BrideRedemptionDone !== undefined && typeof ch.day2BrideRedemptionDone !== 'boolean') {
    return false;
  }
  if (
    ch.day7FatherRedemptionDone !== undefined &&
    typeof ch.day7FatherRedemptionDone !== 'boolean'
  ) {
    return false;
  }
  if (ch.redeemedDayByItem !== undefined) {
    if (
      typeof ch.redeemedDayByItem !== 'object' ||
      ch.redeemedDayByItem === null ||
      Array.isArray(ch.redeemedDayByItem)
    ) {
      return false;
    }
    for (const [key, val] of Object.entries(ch.redeemedDayByItem as Record<string, unknown>)) {
      if (
        typeof key !== 'string' ||
        key.length === 0 ||
        typeof val !== 'number' ||
        !Number.isInteger(val) ||
        val < 1
      ) {
        return false;
      }
    }
  }
  if (ch.rejectedRedemptionDayByItem !== undefined) {
    if (
      typeof ch.rejectedRedemptionDayByItem !== 'object' ||
      ch.rejectedRedemptionDayByItem === null ||
      Array.isArray(ch.rejectedRedemptionDayByItem)
    ) {
      return false;
    }
    for (const [key, val] of Object.entries(
      ch.rejectedRedemptionDayByItem as Record<string, unknown>,
    )) {
      if (
        typeof key !== 'string' ||
        key.length === 0 ||
        typeof val !== 'number' ||
        !Number.isInteger(val) ||
        val < 1
      ) {
        return false;
      }
    }
  }
  if (
    ch.pawnedItemIds !== undefined &&
    (!Array.isArray(ch.pawnedItemIds) || !ch.pawnedItemIds.every((id) => typeof id === 'string'))
  ) {
    return false;
  }
  if (
    ch.bossComponentItemIds !== undefined &&
    (!Array.isArray(ch.bossComponentItemIds) ||
      !ch.bossComponentItemIds.every((id) => typeof id === 'string'))
  ) {
    return false;
  }
  return true;
}

function isValidSaveData(raw: unknown): raw is SaveData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
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
  if (!isValidChapterSaveState(obj.chapter)) {
    return false;
  }
  return true;
}

/**
 * Runs ordered MIGRATIONS on a parsed save payload until it reaches SAVE_VERSION.
 * Returns null if the version is unsupported or no migration path exists.
 */
export function migrateSaveData(
  raw: unknown,
  migrations: readonly SaveMigration[] = MIGRATIONS,
): { data: Record<string, unknown>; migratedFrom: number | null } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  let current: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  const initialVersion = current.version;
  if (typeof initialVersion !== 'number' || !Number.isInteger(initialVersion)) {
    return null;
  }
  if (initialVersion > SAVE_VERSION) {
    return null;
  }

  let version = initialVersion;
  let steps = 0;
  const maxSteps = migrations.length + 1;

  while (version < SAVE_VERSION && steps < maxSteps) {
    const migration = migrations.find((m) => m.from === version);
    if (!migration) {
      return null;
    }
    current = migration.migrate(current);
    version = typeof current.version === 'number' ? current.version : migration.to;
    steps += 1;
  }

  if (version !== SAVE_VERSION) {
    return null;
  }

  return {
    data: current,
    migratedFrom: initialVersion < SAVE_VERSION ? initialVersion : null,
  };
}

/**
 * Copies a corrupted raw save string into the quarantine key without throwing.
 */
export function quarantineCorruptSave(raw: string, storage?: StorageLike | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }
  try {
    store.setItem(CORRUPT_SAVE_STORAGE_KEY, raw);
  } catch {
    // Ignore storage quota/access errors
  }
}

/**
 * Creates a fresh Day 1 Chapter 1 save record using balance.json starting fields.
 * Optionally preserves cross-run Chapter 1 completion/failure flags when restarting.
 */
export function createNewGame(
  balance: Pick<SaveBalanceConfig, 'startingMoney' | 'startingReputation'> = SAVE_BALANCE,
  preserveChapterMeta?: Pick<ChapterSaveState, 'chapter1Completed' | 'chapter1FailedCount'>,
): SaveData {
  return {
    version: SAVE_VERSION,
    day: 1,
    money: balance.startingMoney,
    reputation: balance.startingReputation,
    deck: [],
    shopLevel: 1,
    redeemTickets: 0,
    chapter: createInitialChapterState({
      chapter1Completed: preserveChapterMeta?.chapter1Completed ?? false,
      chapter1FailedCount: preserveChapterMeta?.chapter1FailedCount ?? 0,
    }),
  };
}

/**
 * Applies a Day 4 "掌柜契约" selection to SaveData immutably.
 */
export function applyPactToSave(save: SaveData, pactId: PactId): SaveData {
  const delta = getPactEffectDelta(pactId, save.chapter.currentChapter);
  const nextChapter = cloneChapterState(save.chapter);
  nextChapter.pactChoice = pactId;
  return {
    ...save,
    deck: [...save.deck],
    money: save.money + delta.moneyDelta,
    reputation: save.reputation + delta.reputationDelta,
    chapter: nextChapter,
  };
}

/**
 * Loads save data from storage with sequential version migration and corrupt-save quarantine.
 * On read/parse/validation failure, copies raw payload into CORRUPT_SAVE_STORAGE_KEY.
 */
export function loadSaveDetailed(storage?: StorageLike | null): SaveLoadResult {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return { save: null, migratedFrom: null, quarantinedCorrupt: false };
  }

  let raw: string | null = null;
  try {
    raw = store.getItem(SAVE_STORAGE_KEY);
  } catch {
    return { save: null, migratedFrom: null, quarantinedCorrupt: false };
  }

  if (!raw) {
    return { save: null, migratedFrom: null, quarantinedCorrupt: false };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const migrated = migrateSaveData(parsed);
    if (!migrated || !isValidSaveData(migrated.data)) {
      quarantineCorruptSave(raw, store);
      return { save: null, migratedFrom: null, quarantinedCorrupt: true };
    }

    const valid = migrated.data;
    const loaded: SaveData = {
      version: SAVE_VERSION,
      day: Math.floor(valid.day),
      money: valid.money,
      reputation: valid.reputation,
      deck: [...valid.deck],
      shopLevel: Math.floor(valid.shopLevel),
      redeemTickets: Math.floor(valid.redeemTickets),
      chapter: cloneChapterState(valid.chapter),
    };
    if (typeof valid.tutorialCompleted === 'boolean') {
      loaded.tutorialCompleted = valid.tutorialCompleted;
    }
    return {
      save: loaded,
      migratedFrom: migrated.migratedFrom,
      quarantinedCorrupt: false,
    };
  } catch {
    quarantineCorruptSave(raw, store);
    return { save: null, migratedFrom: null, quarantinedCorrupt: true };
  }
}

/**
 * Loads save data from storage. Migrates older versions automatically; quarantines corrupt saves and returns null.
 */
export function loadSave(storage?: StorageLike | null): SaveData | null {
  return loadSaveDetailed(storage).save;
}

/**
 * Persists save data into storage at current SAVE_VERSION.
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
      chapter: cloneChapterState(data.chapter),
    };
    if (typeof data.tutorialCompleted === 'boolean') {
      normalized.tutorialCompleted = data.tutorialCompleted;
    }
    store.setItem(SAVE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage quota/access failures without crashing the game
  }
}

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

export function clearTutorialDone(storage?: StorageLike | null): void {
  saveTutorialDone(false, storage);
}

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

function appendUniqueDay(list: readonly number[], day: number): number[] {
  const clamped = Math.min(CHAPTER_DAYS, Math.max(1, Math.floor(day)));
  if (list.includes(clamped)) {
    return [...list];
  }
  return [...list, clamped].sort((a, b) => a - b);
}

export function applyDayResult(save: SaveData, result: DayResultInput): SaveData {
  const baseTutorial =
    typeof save.tutorialCompleted === 'boolean'
      ? { tutorialCompleted: save.tutorialCompleted }
      : {};
  const prevChapter = cloneChapterState(save.chapter);
  const currentDayInChapter = prevChapter.dayInChapter;
  const isBoss = result.isBossBattle ?? (prevChapter.bossBattleActive || currentDayInChapter >= CHAPTER_DAYS);

  if (isBoss) {
    if (result.outcome === 'win') {
      const reward = result.reward ?? null;
      const nextDeck = reward?.cardName ? [...save.deck, reward.cardName] : [...save.deck];
      const nextChapter: ChapterSaveState = {
        ...prevChapter,
        dayInChapter: CHAPTER_DAYS,
        chapter1Completed: true,
        status: 'completed',
        bossBattleActive: false,
        daysCleared: appendUniqueDay(prevChapter.daysCleared, currentDayInChapter),
        daysVisited: appendUniqueDay(prevChapter.daysVisited, currentDayInChapter),
        demonsDefeated: prevChapter.demonsDefeated + 1,
      };
      return {
        version: SAVE_VERSION,
        day: save.day,
        money: save.money + (reward?.money ?? 0),
        reputation: save.reputation,
        deck: nextDeck,
        shopLevel: save.shopLevel + 1,
        redeemTickets: save.redeemTickets + (reward?.redeemTicket ?? 0),
        chapter: nextChapter,
        ...baseTutorial,
      };
    }

    // Chapter failure on Boss defeat: record failed attempt, never deduct money or cards
    const failedChapter: ChapterSaveState = {
      ...prevChapter,
      dayInChapter: CHAPTER_DAYS,
      chapter1FailedCount: prevChapter.chapter1FailedCount + 1,
      status: 'failed',
      bossBattleActive: false,
      daysVisited: appendUniqueDay(prevChapter.daysVisited, currentDayInChapter),
    };
    return {
      version: SAVE_VERSION,
      day: save.day,
      money: save.money,
      reputation: save.reputation,
      deck: [...save.deck],
      shopLevel: save.shopLevel,
      redeemTickets: save.redeemTickets,
      chapter: failedChapter,
      ...baseTutorial,
    };
  }

  const nextDayInChapter = Math.min(CHAPTER_DAYS, currentDayInChapter + 1);

  if (result.outcome === 'win') {
    const reward = result.reward ?? null;
    const nextDeck = reward?.cardName ? [...save.deck, reward.cardName] : [...save.deck];
    const nextChapter: ChapterSaveState = {
      ...prevChapter,
      dayInChapter: nextDayInChapter,
      bossBattleActive: false,
      daysCleared: appendUniqueDay(prevChapter.daysCleared, currentDayInChapter),
      daysVisited: appendUniqueDay(prevChapter.daysVisited, currentDayInChapter),
      demonsDefeated: prevChapter.demonsDefeated + 1,
    };
    return {
      version: SAVE_VERSION,
      day: save.day + 1,
      money: save.money + (reward?.money ?? 0),
      reputation: save.reputation,
      deck: nextDeck,
      shopLevel: save.shopLevel + 1,
      redeemTickets: save.redeemTickets + (reward?.redeemTicket ?? 0),
      chapter: nextChapter,
      ...baseTutorial,
    };
  }

  const nextChapter: ChapterSaveState = {
    ...prevChapter,
    dayInChapter: nextDayInChapter,
    bossBattleActive: false,
    daysVisited: appendUniqueDay(prevChapter.daysVisited, currentDayInChapter),
  };

  return {
    version: SAVE_VERSION,
    day: save.day + 1,
    money: save.money,
    reputation: save.reputation,
    deck: [...save.deck],
    shopLevel: save.shopLevel,
    redeemTickets: save.redeemTickets,
    chapter: nextChapter,
    ...baseTutorial,
  };
}

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

export function demonIdForDay(day: number): DemonId {
  const normalizedDay = Math.max(1, Math.floor(day));
  return DEMON_ROTATION[(normalizedDay - 1) % DEMON_ROTATION.length];
}
