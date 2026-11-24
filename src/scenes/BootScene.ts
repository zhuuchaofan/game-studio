import Phaser from 'phaser';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);

    this.add
      .rectangle(centerX, centerY, BASE_WIDTH - 16, BASE_HEIGHT - 16, 0x1e1826)
      .setStrokeStyle(2, 0xc9a24b);

    this.add
      .text(centerX, centerY - 10, 'PAWN SHOP CARDS', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#f5e6c8',
        resolution: 1,
      })
      .setOrigin(0.5);

    this.add
      .text(centerX, centerY + 14, '当铺纸牌', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#c9a24b',
        resolution: 1,
      })
      .setOrigin(0.5);
  }
}
