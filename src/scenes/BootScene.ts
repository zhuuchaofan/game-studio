import Phaser from 'phaser';
import { CARD_PIXEL_ART, DEMON_PIXEL_ART, ITEM_PIXEL_ART } from '../data/pixelart';
import { pixelRowsToTexture } from '../game/pixelart';
import { loadPixelFont } from '../game/pixelFont';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    loadPixelFont(this);

    for (const [id, rows] of Object.entries(CARD_PIXEL_ART)) {
      pixelRowsToTexture(this, `card-art-${id}`, rows);
    }
    for (const [id, rows] of Object.entries(ITEM_PIXEL_ART)) {
      pixelRowsToTexture(this, `item-art-${id}`, rows);
    }
    for (const [id, rows] of Object.entries(DEMON_PIXEL_ART)) {
      pixelRowsToTexture(this, `demon-art-${id}`, rows);
    }
  }

  create(): void {
    this.scene.start('TitleScene');
  }
}
