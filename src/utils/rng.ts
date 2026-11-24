export type RngFn = () => number;

/**
 * Deterministic 32-bit PRNG (mulberry32). Returns floats uniformly in [0, 1).
 */
export function mulberry32(seed: number): RngFn {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hashes an arbitrary string seed into an unsigned 32-bit integer (FNV-1a).
 */
export function hashSeed(raw: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Parses ?seed= from a URL search string. Falls back to Date.now() when absent.
 */
export function parseSeedFromSearch(search: string, fallback: () => number = Date.now): number {
  const params = new URLSearchParams(search);
  const raw = params.get('seed');
  if (raw === null || raw.trim() === '') {
    return fallback() >>> 0;
  }

  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) >>> 0;
  }

  return hashSeed(trimmed);
}

/**
 * Creates a seeded mulberry32 RNG using the current window URL ?seed= parameter.
 */
export function createRngFromUrl(search?: string): { seed: number; rng: RngFn } {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const seed = parseSeedFromSearch(query);
  return { seed, rng: mulberry32(seed) };
}
