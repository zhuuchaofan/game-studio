import type { StorageLike } from './save';

export const GLOSSARY_SEEN_STORAGE_KEY = 'pawnshop-cards-glossary-v1';

export type GlossaryTermId = 'reputation' | 'renqing' | 'obsession' | 'charge_threshold' | 'debt_note';

/**
 * 试玩修整轮 §6.2 + 任务书 19 §6：核心机制词首次出现时的白话解释。
 * 全部字符均经 pixel-font.json 字形校验（零缺字）。
 */
export const GLOSSARY_TIPS: Readonly<Record<GlossaryTermId, string>> = {
  reputation: '口碑：越高越易低价平价收当',
  renqing: '人情：出牌本钱，每回自动回满',
  obsession: '执念：留柜未赎旧物，第7夜化作大心魔力量',
  charge_threshold: '封门阈值：R2累伤打满可打断封门，返+1情',
  debt_note: '欠条：输夜留下的债，占一张手牌，打不出去',
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

export function loadSeenGlossaryTerms(storage?: StorageLike | null): Set<GlossaryTermId> {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return new Set();
  }
  try {
    const raw = store.getItem(GLOSSARY_SEEN_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    const valid = new Set<GlossaryTermId>();
    for (const entry of parsed) {
      if (
        entry === 'reputation' ||
        entry === 'renqing' ||
        entry === 'obsession' ||
        entry === 'charge_threshold' ||
        entry === 'debt_note'
      ) {
        valid.add(entry);
      }
    }
    return valid;
  } catch {
    return new Set();
  }
}

export function hasSeenGlossaryTerm(
  termId: GlossaryTermId,
  storage?: StorageLike | null,
): boolean {
  return loadSeenGlossaryTerms(storage).has(termId);
}

export function markGlossaryTermSeen(
  termId: GlossaryTermId,
  storage?: StorageLike | null,
): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }
  const seen = loadSeenGlossaryTerms(store);
  if (seen.has(termId)) {
    return;
  }
  seen.add(termId);
  try {
    store.setItem(GLOSSARY_SEEN_STORAGE_KEY, JSON.stringify([...seen]));
  } catch {
    // Ignore storage quota/access failures
  }
}

/**
 * Returns the plain-language explanation on the first encounter of `termId` and marks it seen.
 * Returns null on subsequent encounters.
 */
export function consumeFirstGlossaryTip(
  termId: GlossaryTermId,
  storage?: StorageLike | null,
): string | null {
  if (hasSeenGlossaryTerm(termId, storage)) {
    return null;
  }
  markGlossaryTermSeen(termId, storage);
  return GLOSSARY_TIPS[termId];
}

export function clearSeenGlossaryTerms(storage?: StorageLike | null): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) {
    return;
  }
  try {
    store.removeItem(GLOSSARY_SEEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
}
