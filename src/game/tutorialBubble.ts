import type Phaser from 'phaser';
import { PALETTE } from './pawnshop';
import { addPixelText } from './pixelFont';
import {
  getTutorialBubbleLayout,
  getTutorialStepLines,
  TUTORIAL_SKIP_LABEL,
  TUTORIAL_STEPS,
  type TutorialSettlementOutcome,
  type TutorialStepId,
} from './tutorial';

export interface TutorialBubbleCallbacks {
  onAdvance: () => void;
  onSkip: () => void;
}

export interface TutorialBubbleOptions {
  settlementOutcome?: TutorialSettlementOutcome;
}

/**
 * Renders a crisp 16-color pixel-art guide bubble for the given tutorial step.
 * - Solid colors only (zero transparency, zero gradients, 1px/2px pixel borders).
 * - Click anywhere on the bubble to advance one step.
 * - Always-visible skip button in the bottom-right of the bubble to skip the entire tutorial.
 * - Non-blocking: never covers the action button the player needs to click next.
 */
export function createTutorialBubble(
  scene: Phaser.Scene,
  step: TutorialStepId,
  callbacks: TutorialBubbleCallbacks,
  options?: TutorialBubbleOptions,
): Phaser.GameObjects.Container {
  const def = TUTORIAL_STEPS[step];
  const lines = getTutorialStepLines(step, options?.settlementOutcome ?? 'win');
  const layout = getTutorialBubbleLayout(step);
  const { box, centerX, centerY, skipButton } = layout;
  const isDay = box.theme === 'day';

  const bgColor = isDay ? PALETTE.paperWhite.num : PALETTE.nightBlack.num;
  const borderColor = isDay ? PALETTE.ink.num : PALETTE.lampYellow.num;
  const accentColor = isDay ? PALETTE.brass.num : PALETTE.brass.num;
  const textColor = isDay ? PALETTE.ink.hex : PALETTE.paperWhite.hex;
  // P10 子项 2：浅底提示字由铜棕(#8A5A33, CR 5.4)改深木(#2E2118, CR 14.45)，保证浅底清晰可读
  const hintColor = isDay ? PALETTE.deepWood.hex : PALETTE.lampYellow.hex;
  const skipFill = isDay ? PALETTE.oldPaper.num : PALETTE.deepBlue.num;
  const skipHover = isDay ? PALETTE.lampYellow.num : PALETTE.nightBlue.num;
  const skipStroke = isDay ? PALETTE.ink.num : PALETTE.silverBlue.num;
  const skipTextColor = isDay ? PALETTE.ink.hex : PALETTE.silverBlue.hex;

  const container = scene.add.container(0, 0).setDepth(100);

  // Outer bubble box (clickable anywhere except the skip button)
  const bubbleBg = scene.add
    .rectangle(centerX, centerY, box.width, box.height, bgColor)
    .setStrokeStyle(2, borderColor)
    .setInteractive({ useHandCursor: true });

  // Top 2px brass accent trim inside the bubble
  const topTrim = scene.add.rectangle(centerX, box.y + 2, box.width - 4, 2, accentColor);

  container.add([bubbleBg, topTrim]);

  // Optional stepped pixel pointer tail (pure solid rectangles)
  if (box.pointer) {
    const px = box.pointer.x;
    if (box.pointer.direction === 'down') {
      const baseY = box.y + box.height;
      container.add(scene.add.rectangle(px, baseY + 1, 8, 2, borderColor));
      container.add(scene.add.rectangle(px, baseY + 1, 6, 2, bgColor));
      container.add(scene.add.rectangle(px, baseY + 3, 4, 2, borderColor));
    } else {
      const baseY = box.y;
      container.add(scene.add.rectangle(px, baseY - 1, 8, 2, borderColor));
      container.add(scene.add.rectangle(px, baseY - 1, 6, 2, bgColor));
      container.add(scene.add.rectangle(px, baseY - 3, 4, 2, borderColor));
    }
  }

  // Two or three short lines of 1980s pawnshop keeper copy (12px bitmap pixel font)
  const textX = box.x + 6;
  const lineStep = lines.length >= 3 ? 12 : 13;
  lines.forEach((line, idx) => {
    container.add(
      addPixelText(scene, textX, box.y + 4 + idx * lineStep, line, {
        color: textColor,
        origin: [0, 0],
      }),
    );
  });

  // Bottom-left progress + click hint
  container.add(
    addPixelText(scene, textX, skipButton.y, def.continueLabel, {
      color: hintColor,
      origin: [0, 0.5],
    }),
  );

  // Bottom-right always-visible skip button
  const skipBg = scene.add
    .rectangle(skipButton.x, skipButton.y, skipButton.width, skipButton.height, skipFill)
    .setStrokeStyle(1, skipStroke)
    .setInteractive({ useHandCursor: true });

  const skipLabel = addPixelText(scene, skipButton.x, skipButton.y, TUTORIAL_SKIP_LABEL, {
    color: skipTextColor,
    origin: 0.5,
  });

  container.add([skipBg, skipLabel]);

  const skipLeft = skipButton.x - skipButton.width / 2;
  const skipRight = skipButton.x + skipButton.width / 2;
  const skipTop = skipButton.y - skipButton.height / 2;
  const skipBottom = skipButton.y + skipButton.height / 2;

  bubbleBg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    const insideSkip =
      pointer.x >= skipLeft &&
      pointer.x <= skipRight &&
      pointer.y >= skipTop &&
      pointer.y <= skipBottom;
    if (!insideSkip) {
      callbacks.onAdvance();
    }
  });

  skipBg.on('pointerover', () => {
    skipBg.setFillStyle(skipHover);
  });
  skipBg.on('pointerout', () => {
    skipBg.setFillStyle(skipFill);
  });
  skipBg.on('pointerdown', () => {
    callbacks.onSkip();
  });

  return container;
}
