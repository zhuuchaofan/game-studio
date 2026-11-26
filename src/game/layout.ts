import { BASE_WIDTH } from '../utils/scale';
import type { PactId } from './chapters';

export interface ButtonRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// TitleScene
export const TITLE_START_BUTTON = { x: 320, y: 256, width: 200, height: 40 } as const;
export const TITLE_COMPLETED_START_BUTTON = { x: 320, y: 280, width: 200, height: 40 } as const;
export const TITLE_CONTINUE_BUTTON = { x: 320, y: 312, width: 200, height: 40 } as const;
export const TITLE_VOLUME_BUTTON = { x: 112, y: 312, width: 132, height: 38 } as const;
export const TITLE_CALENDAR_BUTTON = { x: 528, y: 256, width: 132, height: 38 } as const;
export const TITLE_COMPLETED_CALENDAR_BUTTON = { x: 528, y: 270, width: 132, height: 34 } as const;
export const TITLE_TUTORIAL_BUTTON = { x: 528, y: 312, width: 132, height: 38 } as const;

// PawnshopScene
export const PAWNSHOP_HUD_HEIGHT = 34;
export const PAWNSHOP_LEDGER_BUTTON = { x: 546, y: 17, width: 56, height: 28 } as const;
export const PAWNSHOP_CALENDAR_BUTTON = { x: 608, y: 17, width: 56, height: 28 } as const;
export const PAWNSHOP_TIER_BUTTONS = {
  low: { x: 116, y: 330, width: 184, height: 56 },
  fair: { x: 320, y: 330, width: 184, height: 56 },
  high: { x: 524, y: 330, width: 184, height: 56 },
} as const;
export const PAWNSHOP_SKIP_BUTTON = { x: 562, y: 249, width: 128, height: 32 } as const;
export const PAWNSHOP_FEEDBACK_NEXT_BUTTON = { x: 320, y: 325, width: 236, height: 54 } as const;
export const PAWNSHOP_SUMMARY_LEDGER_BUTTON = { x: 544, y: 64, width: 92, height: 26 } as const;
export const PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON = { x: 184, y: 314, width: 244, height: 48 } as const;
export const PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON = { x: 456, y: 314, width: 244, height: 48 } as const;

// LedgerOverlay (552x288 centered at 320x180 -> x=44..596, y=36..324)
export const LEDGER_OVERLAY_RECT = { x: 320, y: 180, width: 552, height: 288 } as const;
export const LEDGER_TAB_BUTTONS = {
  deck: { x: 176, y: 52, width: 104, height: 26 },
  heirlooms: { x: 292, y: 52, width: 116, height: 26 },
  collection: { x: 408, y: 52, width: 104, height: 26 },
} as const;
export const LEDGER_CLOSE_BUTTON = { x: 576, y: 52, width: 30, height: 26 } as const;
export const LEDGER_DECK_PREV_BUTTON = { x: 168, y: 308, width: 108, height: 22 } as const;
export const LEDGER_DECK_NEXT_BUTTON = { x: 472, y: 308, width: 108, height: 22 } as const;
export const LEDGER_COLLECTION_CLIP_RECT = { x: 52, y: 94, width: 512, height: 176 } as const;
export const LEDGER_COLLECTION_SCROLL_UP_BUTTON = { x: 578, y: 112, width: 22, height: 28 } as const;
export const LEDGER_COLLECTION_SCROLL_DOWN_BUTTON = { x: 578, y: 252, width: 22, height: 28 } as const;
export const REDEMPTION_ACCEPT_BUTTON = { x: 192, y: 306, width: 248, height: 62 } as const;
export const REDEMPTION_REJECT_BUTTON = { x: 448, y: 306, width: 248, height: 62 } as const;
export const SIDE_QUEST_ACCEPT_BUTTON = { x: 192, y: 306, width: 248, height: 62 } as const;
export const SIDE_QUEST_REJECT_BUTTON = { x: 448, y: 306, width: 248, height: 62 } as const;
export const PACT_OPTION_BUTTONS = [
  { id: 'high_margin' as PactId, x: 86, y: 216, width: 148, height: 240 },
  { id: 'credit_stock' as PactId, x: 242, y: 216, width: 148, height: 240 },
  { id: 'steady_shop' as PactId, x: 398, y: 216, width: 148, height: 240 },
  { id: 'street_favor' as PactId, x: 554, y: 216, width: 148, height: 240 },
] as const;
export const HEIRLOOM_BAR_RECT = { x: 140, y: 209, width: 248, height: 30 } as const;
export const HEIRLOOM_BAR_SLOTS = [
  { x: 138, y: 209, width: 40, height: 24 },
  { x: 186, y: 209, width: 40, height: 24 },
  { x: 234, y: 209, width: 40, height: 24 },
] as const;
export const HEIRLOOM_REPLACE_SLOTS = [
  { x: 116, y: 206, width: 184, height: 120 },
  { x: 320, y: 206, width: 184, height: 120 },
  { x: 524, y: 206, width: 184, height: 120 },
] as const;
export const TRIM_CARD_SLOTS = [
  { x: 116, y: 148, width: 184, height: 68 },
  { x: 320, y: 148, width: 184, height: 68 },
  { x: 524, y: 148, width: 184, height: 68 },
  { x: 116, y: 232, width: 184, height: 68 },
  { x: 320, y: 232, width: 184, height: 68 },
  { x: 524, y: 232, width: 184, height: 68 },
] as const;
export const TRIM_SKIP_BUTTON = { x: 320, y: 316, width: 184, height: 44 } as const;
export const HEIRLOOM_REPLACE_SKIP_BUTTON = TRIM_SKIP_BUTTON;
export const PAWNSHOP_TRIM_PREV_BUTTON = { x: 104, y: 316, width: 120, height: 44 } as const;
export const PAWNSHOP_TRIM_NEXT_BUTTON = { x: 536, y: 316, width: 120, height: 44 } as const;
export const BOSS_PREVIEW_CONFIRM_BUTTON = { x: 320, y: 316, width: 240, height: 44 } as const;
export const MORNING_OPTION_BUTTONS = {
  rest: { x: 116, y: 216, width: 184, height: 240 },
  medicine: { x: 320, y: 216, width: 184, height: 240 },
  work: { x: 524, y: 216, width: 184, height: 240 },
} as const;

// CalendarMapScene
export const CALENDAR_DAY_CELLS = Array.from({ length: 7 }, (_, i) => ({
  day: i + 1,
  x: 50 + i * 90,
  y: 108,
  width: 84,
  height: 122,
})) as readonly { day: number; x: number; y: number; width: number; height: number }[];
export const CALENDAR_RETURN_BUTTON = { x: 320, y: 330, width: 192, height: 42 } as const;

// CardBattleScene
export const BATTLE_CARD_WIDTH = 96;
export const BATTLE_CARD_HEIGHT = 128;
export const BATTLE_HAND_Y = 288;
export const BATTLE_HAND_MARGIN_X = 12;
export const BATTLE_CARD_GAP = 8;
export const BATTLE_DETAIL_TOGGLE_BUTTON = { x: 24, y: 177, width: 32, height: 28 } as const;
export const BATTLE_END_TURN_BUTTON = { x: 564, y: 186, width: 128, height: 44 } as const;
export const BATTLE_EMPTY_RETURN_BUTTON = { x: 320, y: 236, width: 192, height: 48 } as const;
export const DEMON_HP_BAR_RECT = { x: 212, y: 76, width: 316, height: 8 } as const;
export const DEMON_INTRO_BANNER_RECT = { x: 46, y: 130, width: 444, height: 74 } as const;

export const HAND_SCROLL_THRESHOLD = 7;
export const HAND_SLOT_STEP = BATTLE_CARD_WIDTH + BATTLE_CARD_GAP;
/** 横向滚动手牌区两侧留给箭头按钮的边距。 */
export const HAND_SCROLL_MARGIN = 20;
export const HAND_SCROLL_ARROW_WIDTH = 18;
export const HAND_SCROLL_ARROW_Y = BATTLE_HAND_Y;
export const HAND_SCROLL_ARROW_HEIGHT = 64;
export const HAND_CLIP_RECT = { x: 0, y: 200, width: 640, height: 160 } as const;
/** 拖动与点按的分界：按下后移动 <6px 算点按。 */
export const HAND_DRAG_THRESHOLD_PX = 6;

export interface HandCardPose {
  readonly x: number;
  readonly y: number;
}

/**
 * Hand card pose in 640x360 logical coordinates (scroll offset not applied).
 * Counts <= 6 are centered at natural 104px spacing; counts >= 7 keep the same 104px spacing,
 * left-aligned after the arrow margin, and the hand layer scrolls horizontally.
 */
export function computeHandCardPose(index: number, count: number): HandCardPose {
  if (count <= 0) {
    return { x: Math.floor(BASE_WIDTH / 2), y: BATTLE_HAND_Y };
  }
  if (count < HAND_SCROLL_THRESHOLD) {
    const totalWidth = BATTLE_CARD_WIDTH + (count - 1) * HAND_SLOT_STEP;
    const startCenterX =
      Math.floor((BASE_WIDTH - totalWidth) / 2) + Math.floor(BATTLE_CARD_WIDTH / 2);
    return { x: startCenterX + index * HAND_SLOT_STEP, y: BATTLE_HAND_Y };
  }
  return {
    x: HAND_SCROLL_MARGIN + BATTLE_CARD_WIDTH / 2 + index * HAND_SLOT_STEP,
    y: BATTLE_HAND_Y,
  };
}

/** Max horizontal scroll (px) for `slotCount` slots; 0 when everything fits. */
export function computeHandMaxScroll(slotCount: number): number {
  if (slotCount < HAND_SCROLL_THRESHOLD) return 0;
  const content = HAND_SCROLL_MARGIN * 2 + BATTLE_CARD_WIDTH + (slotCount - 1) * HAND_SLOT_STEP;
  return Math.max(0, content - BASE_WIDTH);
}

/**
 * Computes the horizontal center X of a hand card in 640x360 logical coordinates.
 */
export function computeHandCardX(index: number, count: number): number {
  return computeHandCardPose(index, count).x;
}

// ResultScene
export const RESULT_NEXT_DAY_BUTTON = { x: 184, y: 310, width: 232, height: 48 } as const;
export const RESULT_RETURN_BUTTON = { x: 456, y: 310, width: 232, height: 48 } as const;
export const DIARY_CONTINUE_BUTTON = { x: 320, y: 322, width: 232, height: 44 } as const;
export const ENDING_RESTART_BUTTON = { x: 192, y: 312, width: 232, height: 46 } as const;
export const ENDING_TITLE_BUTTON = { x: 448, y: 312, width: 232, height: 46 } as const;
export const ENDING_EPILOGUE_BUTTON = { x: 320, y: 312, width: 240, height: 46 } as const;
export const CHAPTER_FAIL_TITLE_BUTTON = { x: 320, y: 304, width: 240, height: 48 } as const;
