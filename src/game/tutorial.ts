import type { PawnshopPhase } from './pawnshop';

export type TutorialStepId =
  | 'pawnshop_intro'
  | 'offer_tiers'
  | 'deal_card'
  | 'night_play'
  | 'renqing'
  | 'settlement';

export const TUTORIAL_STEP_ORDER: readonly TutorialStepId[] = [
  'pawnshop_intro',
  'offer_tiers',
  'deal_card',
  'night_play',
  'renqing',
  'settlement',
] as const;

export interface TutorialBubblePointer {
  direction: 'up' | 'down';
  x: number;
}

export interface TutorialBubbleBox {
  /** Top-left X in 320x180 logical coordinates. */
  x: number;
  /** Top-left Y in 320x180 logical coordinates. */
  y: number;
  width: number;
  height: number;
  theme: 'day' | 'night';
  pointer?: TutorialBubblePointer;
}

export interface TutorialStepDef {
  id: TutorialStepId;
  index: number;
  label: string;
  lines: readonly string[];
  continueLabel: string;
  box: TutorialBubbleBox;
}

export interface TutorialBubbleLayout {
  box: TutorialBubbleBox;
  centerX: number;
  centerY: number;
  /** Safe logical point to click to advance the bubble (away from the skip button). */
  continueClickPoint: { x: number; y: number };
  skipButton: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export type TutorialSettlementOutcome = 'win' | 'lose';

export interface TutorialState {
  active: boolean;
  currentStep: TutorialStepId | null;
  completedSteps: TutorialStepId[];
  done: boolean;
  isReplay: boolean;
  /** P10 子项 3：结算步骤胜负口径区分（默认 'win' 向后兼容）。 */
  settlementOutcome?: TutorialSettlementOutcome;
}

export interface CreateTutorialOptions {
  day: number;
  tutorialDone: boolean;
  forceReplay?: boolean;
}

export const TUTORIAL_SKIP_LABEL = '跳过教程';

export const TUTORIAL_SETTLEMENT_WIN_LINES: readonly [string, string] = [
  '掌柜：头一天算过关了！赢了得钱得新牌，',
  '账已记好，往后就靠你自己看铺子啦。',
];

export const TUTORIAL_SETTLEMENT_LOSE_LINES: readonly [string, string] = [
  '掌柜：头一天没打下来，不怕——',
  '账还在，铺子还在，明天再想办法。',
];

/**
 * Day 1 guided tutorial steps in strict gameplay flow order:
 * 1. 收当 -> 2. 报价三档 -> 3. 成交得牌 -> 4. 夜里出牌 -> 5. 人情 -> 6. 结算
 *
 * All bubble rectangles are placed so they never cover the buttons the player
 * needs to click next in 320x180 logical resolution.
 */
export const TUTORIAL_STEPS: Record<TutorialStepId, TutorialStepDef> = {
  pawnshop_intro: {
    id: 'pawnshop_intro',
    index: 1,
    label: '收当',
    lines: [
      '掌柜：开张了！今晚3回合打掉心魔20血，',
      '先收张能打伤害的牌：二胡余音每回3伤，',
      '自行车飞驰每回合能打6伤！',
    ],
    continueLabel: '1/6 点击继续',
    box: {
      x: 6,
      y: 80,
      width: 230,
      height: 56,
      theme: 'day',
    },
  },
  offer_tiers: {
    id: 'offer_tiers',
    index: 2,
    label: '报价三档',
    lines: ['掌柜：低价省钱怕谈崩，高价涨口碑，', '平价稳当，挑一档出价吧。'],
    continueLabel: '2/6 点击继续',
    box: {
      x: 6,
      y: 80,
      width: 226,
      height: 44,
      theme: 'day',
      pointer: { direction: 'down', x: 160 },
    },
  },
  deal_card: {
    id: 'deal_card',
    index: 3,
    label: '成交得牌',
    lines: ['掌柜：收下的旧物都变纸牌入牌组，', '留着夜里打心魔；没谈成不扣钱。'],
    continueLabel: '3/6 点击继续',
    box: {
      x: 12,
      y: 92,
      width: 296,
      height: 44,
      theme: 'day',
    },
  },
  night_play: {
    id: 'night_play',
    index: 4,
    label: '夜里出牌',
    lines: ['掌柜：天黑拉灯，心魔上门了！', '点下方手牌出招，3回合内打掉它20血。'],
    continueLabel: '4/6 点击继续',
    box: {
      x: 6,
      y: 64,
      width: 242,
      height: 46,
      theme: 'night',
      pointer: { direction: 'down', x: 126 },
    },
  },
  renqing: {
    id: 'renqing',
    index: 5,
    label: '人情',
    lines: ['掌柜：顶上“人情”就是出牌本钱，', '每回合回满，用完点“结束回合”。'],
    continueLabel: '5/6 点击继续',
    box: {
      x: 6,
      y: 64,
      width: 242,
      height: 46,
      theme: 'night',
      pointer: { direction: 'up', x: 116 },
    },
  },
  settlement: {
    id: 'settlement',
    index: 6,
    label: '结算',
    lines: TUTORIAL_SETTLEMENT_WIN_LINES,
    continueLabel: '6/6 点击完成',
    box: {
      x: 16,
      y: 90,
      width: 288,
      height: 44,
      theme: 'night',
    },
  },
};

const SKIP_BUTTON_WIDTH = 54;
const SKIP_BUTTON_HEIGHT = 13;
const SKIP_MARGIN_RIGHT = 6;
const SKIP_MARGIN_BOTTOM = 2;

export function getTutorialStepDef(step: TutorialStepId | null): TutorialStepDef | null {
  return step ? TUTORIAL_STEPS[step] : null;
}

export function getTutorialStepLines(
  step: TutorialStepId,
  settlementOutcome: TutorialSettlementOutcome = 'win',
): readonly string[] {
  if (step === 'settlement' && settlementOutcome === 'lose') {
    return TUTORIAL_SETTLEMENT_LOSE_LINES;
  }
  return TUTORIAL_STEPS[step].lines;
}

export function getTutorialCopy(
  step: TutorialStepId | null,
  settlementOutcome: TutorialSettlementOutcome = 'win',
): string | null {
  if (!step) {
    return null;
  }
  return getTutorialStepLines(step, settlementOutcome).join('\n');
}

export function getTutorialBubbleLayout(step: TutorialStepId): TutorialBubbleLayout {
  const { box } = TUTORIAL_STEPS[step];
  const centerX = Math.floor(box.x + box.width / 2);
  const centerY = Math.floor(box.y + box.height / 2);
  const skipX = box.x + box.width - SKIP_MARGIN_RIGHT - Math.floor(SKIP_BUTTON_WIDTH / 2);
  const skipY = box.y + box.height - SKIP_MARGIN_BOTTOM - Math.floor(SKIP_BUTTON_HEIGHT / 2);

  return {
    box,
    centerX,
    centerY,
    continueClickPoint: {
      x: box.x + 36,
      y: box.y + 18,
    },
    skipButton: {
      x: skipX,
      y: skipY,
      width: SKIP_BUTTON_WIDTH,
      height: SKIP_BUTTON_HEIGHT,
    },
  };
}

function addCompleted(
  existing: readonly TutorialStepId[],
  ...steps: TutorialStepId[]
): TutorialStepId[] {
  const set = new Set<TutorialStepId>(existing);
  for (const s of steps) {
    set.add(s);
  }
  return TUTORIAL_STEP_ORDER.filter((s) => set.has(s));
}

export function cloneTutorialState(state: TutorialState): TutorialState {
  return {
    active: state.active,
    currentStep: state.currentStep,
    completedSteps: [...state.completedSteps],
    done: state.done,
    isReplay: state.isReplay,
    ...(state.settlementOutcome !== undefined ? { settlementOutcome: state.settlementOutcome } : {}),
  };
}

/**
 * Creates initial tutorial state when entering a Day run.
 * Activates only on first-time Day 1 (tutorialDone === false) or explicit replay from Title '教程'.
 */
export function createTutorialState(opts: CreateTutorialOptions): TutorialState {
  const shouldActivate = Boolean(opts.forceReplay) || (opts.day === 1 && !opts.tutorialDone);
  return {
    active: shouldActivate,
    currentStep: null,
    completedSteps: [],
    done: opts.tutorialDone,
    isReplay: Boolean(opts.forceReplay),
  };
}

/**
 * Syncs tutorial state with PawnshopScene phases (negotiating / feedback / summary).
 */
export function syncTutorialForPawnshop(
  state: TutorialState,
  phase: PawnshopPhase,
): TutorialState {
  if (!state.active) {
    return cloneTutorialState(state);
  }

  const next = cloneTutorialState(state);
  if (
    phase === 'boss_preview' ||
    phase === 'redemption' ||
    phase === 'pact' ||
    phase === 'trim_deck' ||
    phase === 'side_quest'
  ) {
    next.currentStep = null;
    return next;
  }

  if (phase === 'negotiating') {
    if (!next.completedSteps.includes('pawnshop_intro')) {
      next.currentStep = 'pawnshop_intro';
    } else if (!next.completedSteps.includes('offer_tiers')) {
      next.currentStep = 'offer_tiers';
    } else {
      next.currentStep = null;
    }
    return next;
  }

  if (phase === 'feedback') {
    next.completedSteps = addCompleted(next.completedSteps, 'pawnshop_intro', 'offer_tiers');
    next.currentStep = next.completedSteps.includes('deal_card') ? null : 'deal_card';
    return next;
  }

  // summary
  next.completedSteps = addCompleted(
    next.completedSteps,
    'pawnshop_intro',
    'offer_tiers',
    'deal_card',
  );
  next.currentStep = null;
  return next;
}

/**
 * Syncs tutorial state when entering or updating CardBattleScene.
 */
export function syncTutorialForBattle(
  state: TutorialState,
  phase: 'play' | 'empty_deck' | 'other',
): TutorialState {
  if (!state.active) {
    return cloneTutorialState(state);
  }

  const next = cloneTutorialState(state);
  next.completedSteps = addCompleted(
    next.completedSteps,
    'pawnshop_intro',
    'offer_tiers',
    'deal_card',
  );

  if (phase !== 'play') {
    next.currentStep = null;
    return next;
  }

  if (!next.completedSteps.includes('night_play')) {
    next.currentStep = 'night_play';
  } else if (!next.completedSteps.includes('renqing')) {
    next.currentStep = 'renqing';
  } else {
    next.currentStep = null;
  }
  return next;
}

/**
 * Syncs tutorial state when entering ResultScene at the end of Day 1.
 * P10 子项 3：按胜负区分 settlement 气泡文案，输夜不说“过关”。
 */
export function syncTutorialForResult(
  state: TutorialState,
  outcome: TutorialSettlementOutcome = 'win',
): TutorialState {
  if (!state.active) {
    return cloneTutorialState(state);
  }

  const next = cloneTutorialState(state);
  next.settlementOutcome = outcome;
  next.completedSteps = addCompleted(
    next.completedSteps,
    'pawnshop_intro',
    'offer_tiers',
    'deal_card',
    'night_play',
    'renqing',
  );

  if (!next.completedSteps.includes('settlement')) {
    next.currentStep = 'settlement';
  } else {
    next.active = false;
    next.currentStep = null;
    next.done = true;
  }
  return next;
}

/**
 * Advances the active tutorial bubble on a single click.
 */
export function advanceTutorialStep(state: TutorialState): TutorialState {
  if (!state.active || !state.currentStep) {
    return cloneTutorialState(state);
  }

  const next = cloneTutorialState(state);
  const current = next.currentStep!;
  next.completedSteps = addCompleted(next.completedSteps, current);

  switch (current) {
    case 'pawnshop_intro':
      next.currentStep = 'offer_tiers';
      break;
    case 'offer_tiers':
      next.currentStep = null;
      break;
    case 'deal_card':
      next.currentStep = null;
      break;
    case 'night_play':
      next.currentStep = 'renqing';
      break;
    case 'renqing':
      next.currentStep = null;
      break;
    case 'settlement':
      next.active = false;
      next.currentStep = null;
      next.done = true;
      break;
  }

  return next;
}

/**
 * Skips the entire tutorial immediately and marks it completed.
 */
export function skipTutorial(state: TutorialState): TutorialState {
  return {
    active: false,
    currentStep: null,
    completedSteps: [...TUTORIAL_STEP_ORDER],
    done: true,
    isReplay: state.isReplay,
  };
}

/**
 * Marks the tutorial finished when leaving Day 1 ResultScene (even if the player
 * clicked Next Day / Return Title directly without clicking the final bubble).
 */
export function finishTutorialOnDayEnd(state: TutorialState): TutorialState {
  if (!state.active) {
    return cloneTutorialState(state);
  }
  return {
    active: false,
    currentStep: null,
    completedSteps: [...TUTORIAL_STEP_ORDER],
    done: true,
    isReplay: state.isReplay,
  };
}
