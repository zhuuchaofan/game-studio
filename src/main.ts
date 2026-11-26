import Phaser from 'phaser';
import { audio, installAudioDebugHook } from './game/audio';
import { BootScene } from './scenes/BootScene';
import { CalendarMapScene } from './scenes/CalendarMapScene';
import { CardBattleScene } from './scenes/CardBattleScene';
import { PawnshopScene } from './scenes/PawnshopScene';
import { ResultScene } from './scenes/ResultScene';
import { TitleScene } from './scenes/TitleScene';
import { TransitionScene } from './scenes/TransitionScene';
import {
  BASE_HEIGHT,
  BASE_WIDTH,
  calculateScaledDimensions,
  isPortraitViewport,
} from './utils/scale';

audio.installGestureUnlock();
installAudioDebugHook(audio);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: BASE_WIDTH,
  height: BASE_HEIGHT,
  backgroundColor: '#120e16',
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.NONE,
  },
  scene: [
    BootScene,
    TitleScene,
    CalendarMapScene,
    PawnshopScene,
    TransitionScene,
    CardBattleScene,
    ResultScene,
  ],
};

const game = new Phaser.Game(config);

function syncPortraitHint(): void {
  const hint = document.getElementById('portrait-hint');
  const portrait = isPortraitViewport(window.innerWidth, window.innerHeight);
  document.body.classList.toggle('is-portrait', portrait);
  if (!hint) {
    return;
  }
  hint.hidden = !portrait;
}

function applyIntegerCanvasScale(): void {
  syncPortraitHint();

  const canvas = game.canvas;
  if (!canvas) {
    return;
  }

  const { width, height } = calculateScaledDimensions(window.innerWidth, window.innerHeight);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (width > 0 && height > 0) {
    game.scale?.refresh();
  }
}

syncPortraitHint();
game.events.once(Phaser.Core.Events.READY, applyIntegerCanvasScale);
window.addEventListener('resize', applyIntegerCanvasScale);
window.addEventListener('orientationchange', applyIntegerCanvasScale);
