import Phaser from 'phaser';
import demonsJson from '../data/demons.json';
import { audio, installAudioDebugHook } from '../game/audio';
import {
  composeBoss,
  formatCalendarBossPreviewText,
  getBossDemonDef,
  type ComposedBossResult,
} from '../game/bossComposition';
import {
  buildCalendarEntries,
  CHAPTER_ONE_ID,
  createInitialChapterState,
  getChapterConfig,
  getPactDef,
  type CalendarDayEntry,
  type ChapterSaveState,
} from '../game/chapters';
import type { DemonDef } from '../game/effects';
import { ITEMS, PALETTE, parseHexColor } from '../game/pawnshop';
import { addPixelText } from '../game/pixelFont';
import { loadSave, type SaveData } from '../game/save';
import { CALENDAR_DAY_CELLS, CALENDAR_RETURN_BUTTON } from '../game/layout';
import { createRngFromUrl } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export { CALENDAR_DAY_CELLS, CALENDAR_RETURN_BUTTON } from '../game/layout';

export interface CalendarMapSceneData {
  returnTo: 'TitleScene' | 'PawnshopScene';
  save?: SaveData | null;
  seed?: number;
}

export interface CalendarDebugDayEntry extends CalendarDayEntry {
  demonName: string;
  shortDemonName: string;
}

export interface CalendarDebugSnapshot {
  active: boolean;
  returnTo: 'TitleScene' | 'PawnshopScene';
  chapterId: number;
  chapterName: string;
  dayInChapter: number;
  selectedDay: number;
  bossName: string;
  bossHp: number;
  bossComponentCount: number;
  bossActiveItemIds: string[];
  bossFragmentNames: string[];
  bossHpCapped: boolean;
  bossChargeThreshold: number;
  bossPreviewText: string;
  chapter1Completed: boolean;
  chapter1FailedCount: number;
  status: ChapterSaveState['status'];
  pactChoice: ChapterSaveState['pactChoice'];
  days: CalendarDebugDayEntry[];
}

export interface CalendarDebugHook {
  getState: () => CalendarDebugSnapshot;
}

declare global {
  interface Window {
    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    __CALENDAR_DEBUG__?: CalendarDebugHook;
  }
}

const DEMONS: readonly DemonDef[] = demonsJson as DemonDef[];

function isLightPaletteHex(hex: string): boolean {
  const num = parseHexColor(hex);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  return r * 0.299 + g * 0.587 + b * 0.114 > 150;
}

function getDemonById(id: string): DemonDef | undefined {
  return DEMONS.find((d) => d.id === id);
}

function getShortDemonName(demon: DemonDef | undefined): string {
  if (!demon) {
    return '心魔';
  }
  if (demon.isBoss) {
    return '催账单';
  }
  return demon.name;
}

function formatDayStatusLabel(status: CalendarDayEntry['status']): string {
  switch (status) {
    case 'cleared':
      return '已收';
    case 'visited':
      return '已过';
    case 'current':
      return '当前';
    case 'upcoming':
      return '未到';
  }
}

export class CalendarMapScene extends Phaser.Scene {
  private returnTo: 'TitleScene' | 'PawnshopScene' = 'TitleScene';
  private chapterState!: ChapterSaveState;
  private composedBoss!: ComposedBossResult;
  private entries: CalendarDebugDayEntry[] = [];
  private selectedDay = 1;
  private isOpen = false;
  private contentLayer!: Phaser.GameObjects.Container;
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'CalendarMapScene' });
  }

  create(data?: CalendarMapSceneData): void {
    this.returnTo = data?.returnTo ?? 'TitleScene';
    const loadedSave = data?.save ?? loadSave();
    this.chapterState = loadedSave?.chapter
      ? {
          ...loadedSave.chapter,
          daysCleared: [...loadedSave.chapter.daysCleared],
          daysVisited: [...loadedSave.chapter.daysVisited],
        }
      : createInitialChapterState();

    const { seed: urlSeed } = createRngFromUrl();
    const seed = data?.seed ?? urlSeed;
    const chapterCfg = getChapterConfig(this.chapterState.currentChapter || CHAPTER_ONE_ID);
    const rawEntries = buildCalendarEntries(this.chapterState, seed);

    this.entries = rawEntries.map((entry) => {
      const demon = getDemonById(entry.demonId);
      return {
        ...entry,
        demonName: demon?.name ?? entry.demonId,
        shortDemonName: getShortDemonName(demon),
      };
    });

    this.selectedDay = this.chapterState.dayInChapter;
    this.isOpen = true;

    const baseBossDef = getBossDemonDef(DEMONS, chapterCfg.bossId);
    const liveDeck = loadedSave?.deck ? [...loadedSave.deck] : [];
    const composed = composeBoss(liveDeck, this.chapterState.pactChoice, baseBossDef);
    this.composedBoss = composed;
    const bossHp = composed.finalHp;
    const bossPreviewText = formatCalendarBossPreviewText(composed);

    installAudioDebugHook(audio);

    window.__CALENDAR_DEBUG__ = {
      getState: () => ({
        active: this.isOpen,
        returnTo: this.returnTo,
        chapterId: chapterCfg.id,
        chapterName: chapterCfg.name,
        dayInChapter: this.chapterState.dayInChapter,
        selectedDay: this.selectedDay,
        bossName: composed.bossDef.name,
        bossHp,
        bossComponentCount: composed.componentCount,
        bossActiveItemIds: composed.activeComponents.map((c) => c.itemId),
        bossFragmentNames: [...composed.fragmentNames],
        bossHpCapped: composed.hpCapped,
        bossChargeThreshold: composed.chargeThreshold,
        bossPreviewText,
        chapter1Completed: this.chapterState.chapter1Completed,
        chapter1FailedCount: this.chapterState.chapter1FailedCount,
        status: this.chapterState.status,
        pactChoice: this.chapterState.pactChoice,
        days: this.entries.map((e) => ({ ...e })),
      }),
    };

    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);

    // 16 色像素复古台历底板（640×360）
    this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.ink.num);
    this.add.rectangle(centerX, centerY, BASE_WIDTH - 8, BASE_HEIGHT - 8, PALETTE.woodBrown.num);

    // 顶栏（y=0..34）
    this.add.rectangle(centerX, 17, BASE_WIDTH, 34, PALETTE.deepWood.num);
    this.add.rectangle(centerX, 34, BASE_WIDTH, 2, PALETTE.brass.num);
    this.add.rectangle(centerX, 36, BASE_WIDTH, 2, PALETTE.ink.num);

    addPixelText(this, 16, 17, `第${chapterCfg.id}章·${chapterCfg.name}`, {
      color: PALETTE.lampYellow.hex,
      origin: [0, 0.5],
    });

    const rightStatus =
      this.chapterState.status === 'completed'
        ? '第1章·完成'
        : this.chapterState.status === 'failed'
          ? '第1章未通关'
          : `老街台历 第${this.chapterState.dayInChapter}/7天`;
    if (this.chapterState.status === 'completed' || this.chapterState.status === 'failed') {
      const pillW = rightStatus.length * 24 + 20;
      const pillFill =
        this.chapterState.status === 'completed' ? PALETTE.jade.num : PALETTE.vermilion.num;
      this.add
        .rectangle(BASE_WIDTH - 16 - Math.floor(pillW / 2), 17, pillW, 26, pillFill)
        .setStrokeStyle(2, PALETTE.ink.num);
      addPixelText(this, BASE_WIDTH - 26, 17, rightStatus, {
        color: PALETTE.paperWhite.hex,
        origin: [1, 0.5],
      });
    } else {
      addPixelText(this, BASE_WIDTH - 16, 17, rightStatus, {
        color: PALETTE.candle.hex,
        origin: [1, 0.5],
      });
    }

    this.contentLayer = this.add.container(0, 0);
    this.renderCalendarGrid(composed.bossDef.name, bossHp);

    // 底部返回按钮
    const retBtn = this.add
      .rectangle(
        CALENDAR_RETURN_BUTTON.x,
        CALENDAR_RETURN_BUTTON.y,
        CALENDAR_RETURN_BUTTON.width,
        CALENDAR_RETURN_BUTTON.height,
        PALETTE.candle.num,
      )
      .setStrokeStyle(2, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });

    addPixelText(this, CALENDAR_RETURN_BUTTON.x, CALENDAR_RETURN_BUTTON.y, '返回', {
      color: PALETTE.ink.hex,
      origin: 0.5,
    });

    retBtn.on('pointerover', () => retBtn.setFillStyle(PALETTE.lampYellow.num));
    retBtn.on('pointerout', () => retBtn.setFillStyle(PALETTE.candle.num));
    retBtn.on('pointerdown', () => {
      audio.unlock();
      audio.playSfx('button_click');
      this.handleReturn();
    });

    this.syncInputBounds();
  }

  private renderCalendarGrid(bossName: string, bossHp: number): void {
    this.contentLayer.removeAll(true);

    this.entries.forEach((entry, idx) => {
      const cell = CALENDAR_DAY_CELLS[idx];
      const isSelected = entry.day === this.selectedDay;

      const bodyFill = entry.isBossDay
        ? PALETTE.nightBlack.num
        : entry.status === 'current'
          ? PALETTE.candle.num
          : entry.status === 'cleared'
            ? PALETTE.oldPaper.num
            : entry.status === 'visited'
              ? PALETTE.deepWood.num
              : PALETTE.deepBlue.num;

      const borderColor = isSelected
        ? PALETTE.lampYellow.num
        : entry.isBossDay
          ? PALETTE.vermilion.num
          : PALETTE.ink.num;
      const borderWidth = isSelected || entry.isBossDay ? 4 : 2;

      const card = this.add
        .rectangle(cell.x, cell.y, cell.width, cell.height, bodyFill)
        .setStrokeStyle(borderWidth, borderColor)
        .setInteractive({ useHandCursor: true });

      card.on('pointerdown', () => {
        audio.unlock();
        audio.playSfx('button_click');
        this.selectedDay = entry.day;
        this.renderCalendarGrid(bossName, bossHp);
      });

      const headerFill = entry.isBossDay
        ? PALETTE.vermilion.num
        : entry.status === 'current'
          ? PALETTE.lampYellow.num
          : entry.status === 'cleared' || entry.status === 'visited'
            ? PALETTE.woodBrown.num
            : PALETTE.nightBlack.num;
      const headerTextColor =
        entry.status === 'current' && !entry.isBossDay
          ? PALETTE.ink.hex
          : PALETTE.paperWhite.hex;

      const headerRect = this.add.rectangle(cell.x, cell.y - 45, cell.width - 4, 26, headerFill);
      const headerText = addPixelText(this, cell.x, cell.y - 45, `第${entry.day}天`, {
        color: headerTextColor,
        origin: 0.5,
      });

      // Row 1 (y=88): special tag (集市日 / 大心魔 / 暗当) or day label
      let row1Text = entry.tag ?? formatDayStatusLabel(entry.status);
      if (entry.day === 4) {
        row1Text = '集市日';
      } else if (entry.isBossDay) {
        row1Text = '大心魔';
      }
      // 对比度审计：深底“大心魔”用灯黄(9.25:1)替朱红(2.94:1)，旧纸底用深木(6.81:1)替铜棕(2.55:1)
      const row1Color = entry.isBossDay
        ? PALETTE.lampYellow.hex
        : entry.day === 4
          ? entry.status === 'current'
            ? PALETTE.vermilion.hex
            : entry.status === 'cleared'
              ? PALETTE.ink.hex
              : PALETTE.lampYellow.hex
          : entry.status === 'current' || entry.status === 'cleared'
            ? PALETTE.deepWood.hex
            : PALETTE.silverBlue.hex;

      const tagLabel = addPixelText(this, cell.x, 88, row1Text, {
        color: row1Color,
        origin: 0.5,
      });

      // Row 2 (y=114): that day's demon name (or Boss name on Day 7)
      const demonColor = entry.isBossDay
        ? PALETTE.paperWhite.hex
        : entry.status === 'current' || entry.status === 'cleared'
          ? PALETTE.ink.hex
          : PALETTE.candle.hex;
      const demonLabel = addPixelText(this, cell.x, 114, entry.shortDemonName, {
        color: demonColor,
        origin: 0.5,
      });

      // Row 3 (y=144): status stamp box (已收 / 当前 / 已过 / 未到)
      const stampText = formatDayStatusLabel(entry.status);
      const stampFill =
        entry.status === 'cleared'
          ? PALETTE.vermilion.num
          : entry.status === 'current'
            ? PALETTE.lampYellow.num
            : entry.status === 'visited'
              ? PALETTE.woodBrown.num
              : PALETTE.nightBlack.num;
      const stampStroke =
        entry.status === 'cleared'
          ? PALETTE.paperWhite.num
          : entry.status === 'current'
            ? PALETTE.ink.num
            : PALETTE.mistBlue.num;
      const stampTextColor =
        entry.status === 'current'
          ? PALETTE.ink.hex
          : entry.status === 'upcoming'
            ? PALETTE.silverBlue.hex
            : PALETTE.paperWhite.hex;

      const stampBox = this.add
        .rectangle(cell.x, 144, 68, 24, stampFill)
        .setStrokeStyle(2, stampStroke);
      const stampLabel = addPixelText(this, cell.x, 144, stampText, {
        color: stampTextColor,
        origin: 0.5,
      });

      this.contentLayer.add([card, headerRect, headerText, tagLabel, demonLabel, stampBox, stampLabel]);
    });

    const centerX = Math.floor(BASE_WIDTH / 2);
    const composed = this.composedBoss;
    const activeSet = new Set(composed.activeComponents.map((c) => c.itemId));

    // P11 子项 1：第 7 天 Boss 组件徽章 + 血量常驻预览带（y=176..238，从第 1 天起可见，随收当/赎当实时变化）
    this.contentLayer.add(
      this.add
        .rectangle(centerX, 207, 608, 62, PALETTE.nightBlack.num)
        .setStrokeStyle(2, composed.componentCount > 0 ? PALETTE.vermilion.num : PALETTE.mistBlue.num),
    );
    this.contentLayer.add(
      addPixelText(this, 28, 191, '执念:', {
        color: PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
    );

    composed.allComponents.forEach((comp, cIdx) => {
      const bx = 122 + cIdx * 34;
      const by = 191;
      const isActive = activeSet.has(comp.itemId);
      const itemMeta = ITEMS.find((it) => it.id === comp.itemId);
      const activeColorHex = itemMeta ? itemMeta.color : PALETTE.lampYellow.hex;
      const activeFill = parseHexColor(activeColorHex);
      const boxFill = isActive ? activeFill : PALETTE.nightBlack.num;
      const boxStroke = isActive ? PALETTE.lampYellow.num : PALETTE.mistBlue.num;
      const labelColor = isActive
        ? isLightPaletteHex(activeColorHex)
          ? PALETTE.ink.hex
          : PALETTE.paperWhite.hex
        : PALETTE.silverBlue.hex;

      this.contentLayer.add([
        this.add.rectangle(bx, by, 28, 28, boxFill).setStrokeStyle(2, boxStroke),
        addPixelText(this, bx, by, comp.shortLabel, {
          color: labelColor,
          origin: 0.5,
        }),
      ]);
    });

    const rightTag =
      composed.r1Shield > 0
        ? `${composed.componentCount}/6块 盾+${composed.r1Shield} 阈${composed.chargeThreshold}`
        : `${composed.componentCount}/6块 阈${composed.chargeThreshold}`;
    this.contentLayer.add(
      addPixelText(this, 612, 191, rightTag, {
        color: composed.componentCount > 0 ? PALETTE.lampYellow.hex : PALETTE.silverBlue.hex,
        origin: [1, 0.5],
      }),
    );
    this.contentLayer.add(
      addPixelText(this, centerX, 223, formatCalendarBossPreviewText(composed), {
        color: composed.hpCapped ? PALETTE.lampYellow.hex : PALETTE.candle.hex,
        origin: 0.5,
      }),
    );

    // 中下详情预览条（y=244..298，选中某日展示详情与完整 Boss 名）
    const selected = this.entries.find((e) => e.day === this.selectedDay) ?? this.entries[0];

    this.contentLayer.add(
      this.add
        .rectangle(centerX, 271, 608, 54, PALETTE.deepWood.num)
        .setStrokeStyle(2, selected.isBossDay ? PALETTE.vermilion.num : PALETTE.brass.num),
    );

    const statusName = formatDayStatusLabel(selected.status);
    let line1 = `第${selected.day}天(${statusName}) 心魔:${selected.demonName}`;
    if (selected.day === 4) {
      line1 = `第4天·集市日(${statusName}) 心魔:${selected.demonName}`;
    } else if (selected.isBossDay) {
      const capSuffix = composed.hpCapped ? '[已到顶]' : '';
      line1 = `第7天·大心魔「${bossName}」${bossHp}血${capSuffix}`;
    }

    let line2 = '白天3位当客，夜里心魔牌局';
    if (selected.day === 3) {
      line2 = '收当后传出老街风声，预告第4天集市';
    } else if (selected.day === 4) {
      const pactDef = this.chapterState.pactChoice ? getPactDef(this.chapterState.pactChoice) : null;
      line2 = pactDef
        ? `已签契约:${pactDef.name}(${pactDef.benefit})`
        : '开张前:掌柜契约三选一 + 免费整理柜台';
    } else if (selected.day === 6) {
      line2 = '收当后可选「偏巷暗当」:多收1件/心魔+4血';
    } else if (selected.isBossDay) {
      line2 = `4回战:R2封门4盾,累伤${composed.chargeThreshold}打断返+1情`;
    } else if (this.chapterState.pactChoice) {
      const pactDef = getPactDef(this.chapterState.pactChoice);
      if (pactDef) {
        line2 = `本章契约:${pactDef.name}(${pactDef.benefit})`;
      }
    }

    this.contentLayer.add(
      addPixelText(this, 28, 258, line1, {
        color: PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, 28, 284, line2, {
        color: PALETTE.paperWhite.hex,
        origin: [0, 0.5],
      }),
    );
  }

  private handleReturn(): void {
    this.isOpen = false;
    if (this.returnTo === 'PawnshopScene') {
      this.scene.stop('CalendarMapScene');
      this.scene.resume('PawnshopScene');
    } else {
      this.scene.start('TitleScene');
    }
  }

  private syncInputBounds(): void {
    const refresh = (): void => {
      if (this.scene.isActive()) {
        this.scale.refresh();
      }
    };

    refresh();
    requestAnimationFrame(refresh);
    this.handleWindowResize = refresh;
    window.addEventListener('resize', refresh);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.isOpen = false;
      if (this.handleWindowResize) {
        window.removeEventListener('resize', this.handleWindowResize);
        this.handleWindowResize = undefined;
      }
    });
  }
}
