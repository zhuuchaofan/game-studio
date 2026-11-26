import heirloomsJson from '../data/heirlooms.json';
import { hashSeed, type RngFn } from '../utils/rng';
import {
  cloneBattleState,
  drawCardsWithEvents,
  type BattleEvent,
  type CardDef,
} from './effects';
import {
  createHookRegistry,
  type BattleHookName,
  type HookRegistry,
} from './hooks';

export interface HeirloomDef {
  id: string;
  name: string;
  shortLabel: string;
  hook: BattleHookName;
  value: number;
  effectText: string;
  story: string;
}

export const HEIRLOOMS: readonly HeirloomDef[] = heirloomsJson as HeirloomDef[];
export const HEIRLOOM_CAP = 3;
export const HEIRLOOM_REP_MILESTONES: readonly number[] = [3, 5] as const;

export function getHeirloomById(
  id: string,
  heirlooms: readonly HeirloomDef[] = HEIRLOOMS,
): HeirloomDef | undefined {
  return heirlooms.find((h) => h.id === id);
}

/**
 * 「人情牌」指效果含 renqing / renqing_next / discard_for_renqing 的牌
 * （算盘、余音、集邮、手电、当票）。
 */
export function isRenqingCard(card: CardDef | undefined): boolean {
  if (!card) {
    return false;
  }
  return card.effects.some(
    (e) => e.type === 'renqing' || e.type === 'renqing_next' || e.type === 'discard_for_renqing',
  );
}

/**
 * 「旧物牌」指 set 为 "旧物" 的 12 张牌。
 */
export function isItemSetCard(card: CardDef | undefined): boolean {
  return Boolean(card && card.set === '旧物');
}

export function getUnownedHeirlooms(
  ownedIds: readonly string[],
  heirlooms: readonly HeirloomDef[] = HEIRLOOMS,
): HeirloomDef[] {
  const owned = new Set(ownedIds);
  return heirlooms.filter((h) => !owned.has(h.id));
}

/**
 * Draws 1 random unowned heirloom uniformly from all unowned heirlooms.
 */
export function pickRandomUnownedHeirloom(
  ownedIds: readonly string[],
  rng: RngFn,
  heirlooms: readonly HeirloomDef[] = HEIRLOOMS,
): HeirloomDef | null {
  const unowned = getUnownedHeirlooms(ownedIds, heirlooms);
  if (unowned.length === 0) {
    return null;
  }
  const idx = Math.floor(rng() * unowned.length);
  return unowned[Math.min(idx, unowned.length - 1)];
}

export function deriveHeirloomSeed(baseSeed: number, sourceTag: string): number {
  return hashSeed(`${baseSeed >>> 0}:heirloom:${sourceTag}`);
}

export function getNewlyReachedMilestones(
  reputation: number,
  claimedMilestones: readonly number[] = [],
): number[] {
  const claimed = new Set(claimedMilestones);
  return HEIRLOOM_REP_MILESTONES.filter((m) => reputation >= m && !claimed.has(m));
}

export function addHeirloom(
  ownedIds: readonly string[],
  newId: string,
  cap: number = HEIRLOOM_CAP,
): { heirlooms: string[]; added: boolean; needsReplace: boolean } {
  if (ownedIds.includes(newId)) {
    return { heirlooms: [...ownedIds], added: false, needsReplace: false };
  }
  if (ownedIds.length >= cap) {
    return { heirlooms: [...ownedIds], added: false, needsReplace: true };
  }
  return { heirlooms: [...ownedIds, newId], added: true, needsReplace: false };
}

export function replaceHeirloomAtIndex(
  ownedIds: readonly string[],
  replaceIndex: number,
  newId: string,
): string[] {
  if (replaceIndex < 0 || replaceIndex >= ownedIds.length || ownedIds.includes(newId)) {
    return [...ownedIds];
  }
  const next = [...ownedIds];
  next[replaceIndex] = newId;
  return next;
}

/**
 * Builds a fresh per-battle HookRegistry for the player's owned heirlooms.
 * Per-battle / per-round counters live inside this closure so state never leaks across battles.
 * Handlers never call ctx.emit to guarantee non-recursion across heirlooms.
 */
export function createHeirloomHookRegistry(
  ownedIds: readonly string[],
  heirlooms: readonly HeirloomDef[] = HEIRLOOMS,
): HookRegistry {
  const registry = createHookRegistry();
  const uniqueIds = new Set(ownedIds);

  let abacusTriggeredThisBattle = false;
  let scaleTriggeredThisBattle = false;
  let lanternTriggeredRound = -1;

  for (const id of uniqueIds) {
    const def = getHeirloomById(id, heirlooms);
    if (!def) {
      continue;
    }

    switch (def.id) {
      case 'old_abacus':
        registry.register(
          def.hook,
          (state, ctx) => {
            if (abacusTriggeredThisBattle || !isRenqingCard(ctx.payload.card)) {
              return;
            }
            abacusTriggeredThisBattle = true;
            const next = cloneBattleState(state);
            next.renqing += def.value;
            next.log.push(`R${next.round}:老物件[老算盘]人情+${def.value}`);
            const events: BattleEvent[] = [
              {
                type: 'RENQING_GAINED',
                amount: def.value,
                renqingAfter: next.renqing,
                source: def.name,
              },
            ];
            return { state: next, events };
          },
          `heirloom:${def.id}`,
        );
        break;

      case 'gold_signboard':
        registry.register(
          def.hook,
          (state, ctx) => {
            if (!isItemSetCard(ctx.payload.card)) {
              return;
            }
            const next = cloneBattleState(state);
            next.shield += def.value;
            next.log.push(`R${next.round}:老物件[金招牌]护盾+${def.value}`);
            const events: BattleEvent[] = [
              {
                type: 'SHIELD_GAINED',
                amount: def.value,
                shieldAfter: next.shield,
                source: def.name,
              },
            ];
            return { state: next, events };
          },
          `heirloom:${def.id}`,
        );
        break;

      case 'old_scale':
        registry.register(
          def.hook,
          (state, ctx) => {
            if (scaleTriggeredThisBattle || !isItemSetCard(ctx.payload.card)) {
              return;
            }
            scaleTriggeredThisBattle = true;
            const drawRes = drawCardsWithEvents(state, def.value, {
              cardsByName: state.cardsByName,
              rng: state.rng,
            });
            const drawnCount = drawRes.events.reduce(
              (sum, ev) => sum + (ev.type === 'CARDS_DRAWN' ? ev.cards.length : 0),
              0,
            );
            drawRes.state.log.push(`R${drawRes.state.round}:老物件[老秤]抽${drawnCount}张牌`);
            return drawRes;
          },
          `heirloom:${def.id}`,
        );
        break;

      case 'quilt':
        registry.register(
          def.hook,
          (state) => {
            const next = cloneBattleState(state);
            const before = next.playerHp;
            next.playerHp = Math.min(next.maxPlayerHp, next.playerHp + def.value);
            const healed = next.playerHp - before;
            next.log.push(`R${next.round}:老物件[棉被]回血+${healed}`);
            const events: BattleEvent[] =
              healed > 0
                ? [{ type: 'HEAL_APPLIED', amount: healed, playerHpAfter: next.playerHp }]
                : [];
            return { state: next, events };
          },
          `heirloom:${def.id}`,
        );
        break;

      case 'copper_tray':
        registry.register(
          def.hook,
          (state) => {
            if (state.renqing <= 0) {
              return;
            }
            const unspent = state.renqing;
            const shieldGain = unspent * def.value;
            const next = cloneBattleState(state);
            next.shield += shieldGain;
            next.renqing = 0;
            next.log.push(`R${next.round}:老物件[铜盘]${unspent}人情换${shieldGain}盾`);
            const events: BattleEvent[] = [
              {
                type: 'SHIELD_GAINED',
                amount: shieldGain,
                shieldAfter: next.shield,
                source: def.name,
              },
            ];
            return { state: next, events };
          },
          `heirloom:${def.id}`,
        );
        break;

      case 'paper_lantern':
        registry.register(
          def.hook,
          (state) => {
            if (lanternTriggeredRound === state.round) {
              return;
            }
            lanternTriggeredRound = state.round;
            const drawRes = drawCardsWithEvents(state, def.value, {
              cardsByName: state.cardsByName,
              rng: state.rng,
            });
            const drawnCount = drawRes.events.reduce(
              (sum, ev) => sum + (ev.type === 'CARDS_DRAWN' ? ev.cards.length : 0),
              0,
            );
            drawRes.state.log.push(`R${drawRes.state.round}:老物件[纸灯]抽${drawnCount}张牌`);
            return drawRes;
          },
          `heirloom:${def.id}`,
        );
        break;

      case 'old_newspaper':
        registry.register(
          def.hook,
          (state) => {
            const next = cloneBattleState(state);
            next.shield += def.value;
            next.log.push(`R${next.round}:老物件[旧报纸]弃牌护盾+${def.value}`);
            const events: BattleEvent[] = [
              {
                type: 'SHIELD_GAINED',
                amount: def.value,
                shieldAfter: next.shield,
                source: def.name,
              },
            ];
            return { state: next, events };
          },
          `heirloom:${def.id}`,
        );
        break;

      default:
        break;
    }
  }

  return registry;
}
