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
export const PAWNSHOP_CALENDAR_BUTTON = { x: 594, y: 17, width: 76, height: 28 } as const;
export const PAWNSHOP_TIER_BUTTONS = {
  low: { x: 116, y: 330, width: 184, height: 56 },
  fair: { x: 320, y: 330, width: 184, height: 56 },
  high: { x: 524, y: 330, width: 184, height: 56 },
} as const;
export const PAWNSHOP_SKIP_BUTTON = { x: 562, y: 249, width: 128, height: 32 } as const;
export const PAWNSHOP_FEEDBACK_NEXT_BUTTON = { x: 320, y: 325, width: 236, height: 54 } as const;
export const PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON = { x: 184, y: 314, width: 244, height: 48 } as const;
export const PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON = { x: 456, y: 314, width: 244, height: 48 } as const;
export const REDEMPTION_ACCEPT_BUTTON = { x: 192, y: 306, width: 248, height: 62 } as const;
export const REDEMPTION_REJECT_BUTTON = { x: 448, y: 306, width: 248, height: 62 } as const;
export const SIDE_QUEST_ACCEPT_BUTTON = { x: 192, y: 306, width: 248, height: 62 } as const;
export const SIDE_QUEST_REJECT_BUTTON = { x: 448, y: 306, width: 248, height: 62 } as const;
export const PACT_OPTION_BUTTONS = [
  { id: 'high_margin' as PactId, x: 116, y: 216, width: 184, height: 240 },
  { id: 'credit_stock' as PactId, x: 320, y: 216, width: 184, height: 240 },
  { id: 'steady_shop' as PactId, x: 524, y: 216, width: 184, height: 240 },
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
export const PAWNSHOP_TRIM_PREV_BUTTON = { x: 104, y: 316, width: 120, height: 44 } as const;
export const PAWNSHOP_TRIM_NEXT_BUTTON = { x: 536, y: 316, width: 120, height: 44 } as const;
export const BOSS_PREVIEW_CONFIRM_BUTTON = { x: 320, y: 316, width: 240, height: 44 } as const;

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

export const HAND_FAN_THRESHOLD = 7;
export const HAND_FAN_MAX_ANGLE_DEG = 5;
export const HAND_FAN_ARC_DROP = 8;

export interface HandCardPose {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly compactText: boolean;
}

/**
 * Computes fixed-slot fan pose (center X, arc Y, rotation radians, compact text mode)
 * for a hand card in 640x360 logical coordinates.
 * Counts <= 6 stay flat at natural 104px spacing; counts >= 7 use fixed 9/11-slot fan buckets
 * so cards stay legible and never shift when played mid-turn.
 */
export function computeHandCardPose(index: number, count: number): HandCardPose {
  if (count <= 0) {
    return {
      x: Math.floor(BASE_WIDTH / 2),
      y: BATTLE_HAND_Y,
      rotation: 0,
      compactText: false,
    };
  }
  if (count < HAND_FAN_THRESHOLD) {
    const naturalStep = BATTLE_CARD_WIDTH + BATTLE_CARD_GAP;
    const totalWidth = BATTLE_CARD_WIDTH + (count - 1) * naturalStep;
    const startCenterX =
      Math.floor((BASE_WIDTH - totalWidth) / 2) + Math.floor(BATTLE_CARD_WIDTH / 2);
    return {
      x: startCenterX + index * naturalStep,
      y: BATTLE_HAND_Y,
      rotation: 0,
      compactText: false,
    };
  }

  const slotCount = count <= 9 ? 9 : count <= 11 ? 11 : count;
  const margin = slotCount <= 9 ? 8 : 6;
  const availableWidth = BASE_WIDTH - margin * 2;
  const step = Math.floor((availableWidth - BATTLE_CARD_WIDTH) / (slotCount - 1));
  const totalWidth = BATTLE_CARD_WIDTH + (slotCount - 1) * step;
  const startCenterX =
    Math.floor((BASE_WIDTH - totalWidth) / 2) + Math.floor(BATTLE_CARD_WIDTH / 2);
  const slotOffset = Math.floor((slotCount - count) / 2);
  const fixedSlot = Math.max(0, Math.min(slotCount - 1, slotOffset + index));
  const t = slotCount > 1 ? (fixedSlot / (slotCount - 1)) * 2 - 1 : 0;

  return {
    x: startCenterX + fixedSlot * step,
    y: BATTLE_HAND_Y + Math.round(t * t * HAND_FAN_ARC_DROP) - Math.round(HAND_FAN_ARC_DROP / 2),
    rotation: (t * HAND_FAN_MAX_ANGLE_DEG * Math.PI) / 180,
    compactText: true,
  };
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
