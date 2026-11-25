import Phaser from 'phaser';
import demonsJson from '../data/demons.json';
import { audio, installAudioDebugHook } from '../game/audio';
import {
  buildCalendarEntries,
  CHAPTER_ONE_ID,
  createInitialChapterState,
  getBossHpBonus,
  getChapterConfig,
  getPactDef,
  type CalendarDayEntry,
  type ChapterSaveState,
} from '../game/chapters';
import type { DemonDef } from '../game/effects';
import { PALETTE } from '../game/pawnshop';
import { addPixelText } from '../game/pixelFont';
import { loadSave, type SaveData } from '../game/save';
import { createRngFromUrl } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

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

export const CALENDAR_DAY_CELLS = Array.from({ length: 7 }, (_, i) => ({
  day: i + 1,
  x: 28 + i * 44,
  y: 62,
  width: 40,
  height: 72,
})) as readonly { day: number; x: number; y: number; width: number; height: number }[];

export const CALENDAR_RETURN_BUTTON = { x: 160, y: 163, width: 96, height: 22 } as const;

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

    const bossDef = getDemonById(chapterCfg.bossId);
    const bossHp = (bossDef?.hp ?? 38) + getBossHpBonus(this.chapterState.pactChoice);

    installAudioDebugHook(audio);

    window.__CALENDAR_DEBUG__ = {
      getState: () => ({
        active: this.isOpen,
        returnTo: this.returnTo,
        chapterId: chapterCfg.id,
        chapterName: chapterCfg.name,
        dayInChapter: this.chapterState.dayInChapter,
        selectedDay: this.selectedDay,
        bossName: bossDef?.name ?? '老债主·催账单',
        bossHp,
        chapter1Completed: this.chapterState.chapter1Completed,
        chapter1FailedCount: this.chapterState.chapter1FailedCount,
        status: this.chapterState.status,
        pactChoice: this.chapterState.pactChoice,
        days: this.entries.map((e) => ({ ...e })),
      }),
    };

    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);

    // 16 色像素复古台历底板
    this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.ink.num);
    this.add.rectangle(centerX, 90, BASE_WIDTH - 4, BASE_HEIGHT - 4, PALETTE.woodBrown.num);

    // 顶栏（y=0..20）
    this.add.rectangle(centerX, 10, BASE_WIDTH, 20, PALETTE.deepWood.num);
    this.add.rectangle(centerX, 20, BASE_WIDTH, 1, PALETTE.brass.num);
    this.add.rectangle(centerX, 21, BASE_WIDTH, 1, PALETTE.ink.num);

    addPixelText(this, 8, 10, `第${chapterCfg.id}章·${chapterCfg.name}`, {
      color: PALETTE.lampYellow.hex,
      origin: [0, 0.5],
    });

    const rightStatus =
      this.chapterState.status === 'completed'
        ? '第1章·完成'
        : this.chapterState.status === 'failed'
          ? '第1章未通关'
          : `老街台历 第${this.chapterState.dayInChapter}/7天`;
    const rightColor =
      this.chapterState.status === 'completed'
        ? PALETTE.jade.hex
        : this.chapterState.status === 'failed'
          ? PALETTE.vermilion.hex
          : PALETTE.candle.hex;
    addPixelText(this, BASE_WIDTH - 8, 10, rightStatus, {
      color: rightColor,
      origin: [1, 0.5],
    });

    this.contentLayer = this.add.container(0, 0);
    this.renderCalendarGrid(bossDef?.name ?? '老债主·催账单', bossHp);

    // 底部返回按钮
    const retBtn = this.add
      .rectangle(
        CALENDAR_RETURN_BUTTON.x,
        CALENDAR_RETURN_BUTTON.y,
        CALENDAR_RETURN_BUTTON.width,
        CALENDAR_RETURN_BUTTON.height,
        PALETTE.candle.num,
      )
      .setStrokeStyle(1, PALETTE.ink.num)
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
      const borderWidth = isSelected || entry.isBossDay ? 2 : 1;

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

      const headerRect = this.add.rectangle(cell.x, cell.y - 29, cell.width - 2, 14, headerFill);
      const headerText = addPixelText(this, cell.x, cell.y - 29, `第${entry.day}天`, {
        color: headerTextColor,
        origin: 0.5,
      });

      // Row 1 (y=48): special tag (集市日 / 大心魔 / 暗当) or day label
      let row1Text = entry.tag ?? formatDayStatusLabel(entry.status);
      if (entry.day === 4) {
        row1Text = '集市日';
      } else if (entry.isBossDay) {
        row1Text = '大心魔';
      }
      const row1Color = entry.isBossDay
        ? PALETTE.vermilion.hex
        : entry.day === 4
          ? entry.status === 'current' || entry.status === 'cleared'
            ? PALETTE.vermilion.hex
            : PALETTE.lampYellow.hex
          : entry.status === 'current' || entry.status === 'cleared'
            ? PALETTE.copperBrown.hex
            : PALETTE.silverBlue.hex;

      const tagLabel = addPixelText(this, cell.x, 48, row1Text, {
        color: row1Color,
        origin: 0.5,
      });

      // Row 2 (y=64): that day's demon name (or Boss name on Day 7)
      const demonColor = entry.isBossDay
        ? PALETTE.paperWhite.hex
        : entry.status === 'current' || entry.status === 'cleared'
          ? PALETTE.ink.hex
          : PALETTE.candle.hex;
      const demonLabel = addPixelText(this, cell.x, 64, entry.shortDemonName, {
        color: demonColor,
        origin: 0.5,
      });

      // Row 3 (y=84): status stamp box (已收 / 当前 / 已过 / 未到)
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
        .rectangle(cell.x, 84, 32, 14, stampFill)
        .setStrokeStyle(1, stampStroke);
      const stampLabel = addPixelText(this, cell.x, 84, stampText, {
        color: stampTextColor,
        origin: 0.5,
      });

      this.contentLayer.add([card, headerRect, headerText, tagLabel, demonLabel, stampBox, stampLabel]);
    });

    // 中下详情预览条（y=104..144，选中某日展示详情与完整 Boss 名）
    const selected = this.entries.find((e) => e.day === this.selectedDay) ?? this.entries[0];
    const centerX = Math.floor(BASE_WIDTH / 2);

    this.contentLayer.add(
      this.add
        .rectangle(centerX, 124, 304, 38, PALETTE.deepWood.num)
        .setStrokeStyle(1, selected.isBossDay ? PALETTE.vermilion.num : PALETTE.brass.num),
    );

    const statusName = formatDayStatusLabel(selected.status);
    let line1 = `第${selected.day}天(${statusName}) 心魔:${selected.demonName}`;
    if (selected.day === 4) {
      line1 = `第4天·集市日(${statusName}) 心魔:${selected.demonName}`;
    } else if (selected.isBossDay) {
      line1 = `第7天·大心魔「${bossName}」${bossHp}血`;
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
      line2 = '4回合战:R2蓄力封门4盾，累伤10打断返+1情';
    } else if (this.chapterState.pactChoice) {
      const pactDef = getPactDef(this.chapterState.pactChoice);
      if (pactDef) {
        line2 = `本章契约:${pactDef.name}(${pactDef.benefit})`;
      }
    }

    this.contentLayer.add(
      addPixelText(this, 14, 114, line1, {
        color: selected.isBossDay ? PALETTE.vermilion.hex : PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, 14, 132, line2, {
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
