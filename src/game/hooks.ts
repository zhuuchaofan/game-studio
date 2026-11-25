import type { BattleEvent, BattleState, CardDef } from './effects';

export type BattleHookName =
  | 'battleStart'
  | 'cardPlayed'
  | 'turnStart'
  | 'turnEnd'
  | 'onDiscard'
  | 'onReflect'
  | 'battleWon';

export const BATTLE_HOOK_NAMES: readonly BattleHookName[] = [
  'battleStart',
  'cardPlayed',
  'turnStart',
  'turnEnd',
  'onDiscard',
  'onReflect',
  'battleWon',
] as const;

export const MAX_HOOK_DEPTH = 32;

export interface BattleHookPayload {
  card?: CardDef;
  cardName?: string;
  discardedCard?: string;
  reflectedDamage?: number;
  round?: number;
  result?: BattleState['result'];
}

export interface BattleHookContext {
  readonly event: BattleHookName;
  readonly depth: number;
  readonly registry: HookRegistry;
  readonly payload: BattleHookPayload;
  emit: (event: BattleHookName, state: BattleState, payload?: BattleHookPayload) => HookRunResult;
}

export interface HookHandlerOutput {
  state?: BattleState;
  events?: BattleEvent[];
}

export type BattleHookHandler = (
  state: BattleState,
  ctx: BattleHookContext,
) => HookHandlerOutput | BattleState | void;

export interface HookOverflowRecord {
  event: BattleHookName;
  depth: number;
  maxDepth: number;
  message: string;
}

export interface HookRunResult {
  state: BattleState;
  events: BattleEvent[];
  circuitBroken: boolean;
}

interface RegisteredHook {
  id: string;
  handler: BattleHookHandler;
}

/**
 * Lightweight battle lifecycle hook registry with recursion depth circuit breaker.
 * Designed for future expansion (relics / shelf heirlooms / persistent shop upgrades)
 * without cluttering core battle transitions.
 */
export class HookRegistry {
  private readonly handlers = new Map<BattleHookName, RegisteredHook[]>();
  private readonly overflowLogs: HookOverflowRecord[] = [];
  private readonly maxDepth: number;
  private currentDepth = 0;
  private nextId = 1;

  constructor(maxDepth: number = MAX_HOOK_DEPTH) {
    this.maxDepth = maxDepth;
    for (const name of BATTLE_HOOK_NAMES) {
      this.handlers.set(name, []);
    }
  }

  register(event: BattleHookName, handler: BattleHookHandler, id?: string): () => void {
    const list = this.handlers.get(event);
    if (!list) {
      throw new Error(`Unknown battle hook: ${String(event)}`);
    }
    const hookId = id ?? `hook-${this.nextId++}`;
    list.push({ id: hookId, handler });
    return () => {
      this.unregister(event, hookId);
    };
  }

  unregister(event: BattleHookName, idOrHandler: string | BattleHookHandler): boolean {
    const list = this.handlers.get(event);
    if (!list) {
      return false;
    }
    const before = list.length;
    const filtered = list.filter((entry) =>
      typeof idOrHandler === 'string' ? entry.id !== idOrHandler : entry.handler !== idOrHandler,
    );
    this.handlers.set(event, filtered);
    return filtered.length !== before;
  }

  clear(event?: BattleHookName): void {
    if (event) {
      this.handlers.set(event, []);
      return;
    }
    for (const name of BATTLE_HOOK_NAMES) {
      this.handlers.set(name, []);
    }
  }

  getHandlerCount(event?: BattleHookName): number {
    if (event) {
      return this.handlers.get(event)?.length ?? 0;
    }
    let total = 0;
    for (const list of this.handlers.values()) {
      total += list.length;
    }
    return total;
  }

  getOverflowLogs(): readonly HookOverflowRecord[] {
    return [...this.overflowLogs];
  }

  clearOverflowLogs(): void {
    this.overflowLogs.length = 0;
  }

  emit(
    event: BattleHookName,
    initialState: BattleState,
    payload: BattleHookPayload = {},
  ): HookRunResult {
    if (this.currentDepth >= this.maxDepth) {
      const message = `Hook depth limit (${this.maxDepth}) exceeded on "${event}"`;
      this.overflowLogs.push({
        event,
        depth: this.currentDepth,
        maxDepth: this.maxDepth,
        message,
      });
      const loggedState: BattleState = {
        ...initialState,
        log: [...initialState.log, `[HOOK_CIRCUIT_BREAK] ${message}`],
      };
      return { state: loggedState, events: [], circuitBroken: true };
    }

    const list = this.handlers.get(event);
    if (!list || list.length === 0) {
      return { state: initialState, events: [], circuitBroken: false };
    }

    this.currentDepth += 1;
    let currentState = initialState;
    const collectedEvents: BattleEvent[] = [];
    let circuitBroken = false;

    try {
      const snapshot = [...list];
      for (const entry of snapshot) {
        const ctx: BattleHookContext = {
          event,
          depth: this.currentDepth,
          registry: this,
          payload,
          emit: (nestedEvent, nestedState, nestedPayload) => {
            const nestedResult = this.emit(nestedEvent, nestedState, nestedPayload);
            if (nestedResult.circuitBroken) {
              circuitBroken = true;
            }
            if (nestedResult.events.length > 0) {
              collectedEvents.push(...nestedResult.events);
            }
            return nestedResult;
          },
        };

        const output = entry.handler(currentState, ctx);
        if (!output) {
          continue;
        }
        if ('phase' in output && 'hand' in output) {
          currentState = output;
        } else {
          if (output.state) {
            currentState = output.state;
          }
          if (output.events && output.events.length > 0) {
            collectedEvents.push(...output.events);
          }
        }
      }
    } finally {
      this.currentDepth -= 1;
    }

    return {
      state: currentState,
      events: collectedEvents,
      circuitBroken,
    };
  }
}

export function createHookRegistry(maxDepth: number = MAX_HOOK_DEPTH): HookRegistry {
  return new HookRegistry(maxDepth);
}
