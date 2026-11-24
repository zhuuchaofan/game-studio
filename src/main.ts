import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { BASE_HEIGHT, BASE_WIDTH, calculateScaledDimensions } from './utils/scale';

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
  scene: [BootScene],
};

const game = new Phaser.Game(config);

function applyIntegerCanvasScale(): void {
  const canvas = game.canvas;
  if (!canvas) {
    return;
  }

  const { width, height } = calculateScaledDimensions(window.innerWidth, window.innerHeight);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

game.events.once(Phaser.Core.Events.READY, applyIntegerCanvasScale);
window.addEventListener('resize', applyIntegerCanvasScale);
