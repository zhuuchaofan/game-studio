import type Phaser from 'phaser';
import cardsJson from '../data/cards.json';
import { audio } from './audio';
import { buildCardMap, formatEffectShort, type CardDef } from './battle';
import type { ChapterSaveState } from './chapters';
import {
  computeCollectionCounts,
  getAftermathLine,
  getCollectibleCards,
  getDiaryFragments,
  type CollectionCounts,
} from './collection';
import { HEIRLOOMS } from './heirlooms';
import {
  LEDGER_CLOSE_BUTTON,
  LEDGER_COLLECTION_CLIP_RECT,
  LEDGER_COLLECTION_SCROLL_DOWN_BUTTON,
  LEDGER_COLLECTION_SCROLL_UP_BUTTON,
  LEDGER_DECK_NEXT_BUTTON,
  LEDGER_DECK_PREV_BUTTON,
  LEDGER_OVERLAY_RECT,
  LEDGER_TAB_BUTTONS,
} from './layout';
import { ITEMS, PALETTE, parseHexColor } from './pawnshop';
import { addPixelText } from './pixelFont';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export type LedgerTab = 'deck' | 'heirlooms' | 'collection';

export interface LedgerDiarySlotSnapshot {
  id: string;
  unlocked: boolean;
  text: string;
}

export interface LedgerOverlaySnapshot {
  open: boolean;
  tab: LedgerTab;
  deckPage: number;
  deckTotalPages: number;
  deckCardNames: string[];
  visibleDeckCardNames: string[];
  ownedHeirloomIds: string[];
  unownedHeirloomIds: string[];
  counts: CollectionCounts;
  countBarText: string;
  visibleAftermaths: Record<string, string>;
  unlockedDiaryFragments: string[];
  diarySlots: LedgerDiarySlotSnapshot[];
  collectionScrollY: number;
  collectionMaxScrollY: number;
}

export interface LedgerOverlayStateInput {
  deck: readonly string[];
  chapter: ChapterSaveState;
}

const ALL_CARDS = cardsJson as CardDef[];
const CARDS_BY_NAME = buildCardMap(ALL_CARDS);
const DECK_PAGE_SIZE = 12;
const COLLECTION_SCROLL_STEP = 104;

const TAB_LABELS: { id: LedgerTab; label: string }[] = [
  { id: 'deck', label: '牌库' },
  { id: 'heirlooms', label: '老物件' },
  { id: 'collection', label: '收集' },
];

/**
 * Pure helper to build a read-only ledger snapshot for tests and debugging.
 */
export function buildLedgerSnapshot(
  open: boolean,
  tab: LedgerTab,
  deckPage: number,
  input: LedgerOverlayStateInput,
  collectionScrollY = 0,
  collectionMaxScrollY = 0,
): LedgerOverlaySnapshot {
  const deckCardNames = [...input.deck];
  const deckTotalPages = Math.max(1, Math.ceil(deckCardNames.length / DECK_PAGE_SIZE));
  const clampedPage = Math.max(0, Math.min(deckPage, deckTotalPages - 1));
  const visibleDeckCardNames = deckCardNames.slice(
    clampedPage * DECK_PAGE_SIZE,
    (clampedPage + 1) * DECK_PAGE_SIZE,
  );

  const ownedSet = new Set(input.chapter.heirlooms ?? []);
  const ownedHeirloomIds = HEIRLOOMS.filter((h) => ownedSet.has(h.id)).map((h) => h.id);
  const unownedHeirloomIds = HEIRLOOMS.filter((h) => !ownedSet.has(h.id)).map((h) => h.id);

  const counts = computeCollectionCounts(input.chapter);
  const countBarText = `收集 ${counts.seenItemsCount}/${counts.totalItems} | 牌 ${counts.seenCardsCount}/${counts.totalCards} | 老物件 ${counts.ownedHeirloomsCount}/${counts.totalHeirlooms}`;

  const redeemedSet = new Set(input.chapter.redeemedItems ?? []);
  const visibleAftermaths: Record<string, string> = {};
  for (const item of ITEMS) {
    if (redeemedSet.has(item.id)) {
      const line = getAftermathLine(item.id);
      if (line) {
        visibleAftermaths[item.id] = line;
      }
    }
  }

  const unlockedSet = new Set(input.chapter.diaryFragments ?? []);
  const diarySlots: LedgerDiarySlotSnapshot[] = getDiaryFragments().map((frag) => {
    const unlocked = unlockedSet.has(frag.id);
    return {
      id: frag.id,
      unlocked,
      text: unlocked ? frag.text : '未找到',
    };
  });

  return {
    open,
    tab,
    deckPage: clampedPage,
    deckTotalPages,
    deckCardNames,
    visibleDeckCardNames,
    ownedHeirloomIds,
    unownedHeirloomIds,
    counts,
    countBarText,
    visibleAftermaths,
    unlockedDiaryFragments: [...(input.chapter.diaryFragments ?? [])],
    diarySlots,
    collectionScrollY,
    collectionMaxScrollY,
  };
}

/**
 * Modal 552x288 ledger overlay rendered above PawnshopScene with 3 tabs (牌库/老物件/收集).
 */
export class LedgerOverlay {
  private readonly scene: Phaser.Scene;
  private readonly getInput: () => LedgerOverlayStateInput;
  private readonly onCloseCallback?: () => void;

  private rootContainer?: Phaser.GameObjects.Container;
  private collectionMaskGraphics?: Phaser.GameObjects.Graphics;
  private collectionScrollContainer?: Phaser.GameObjects.Container;
  private scrollThumb?: Phaser.GameObjects.Rectangle;
  private wheelHandler?: (
    pointer: Phaser.Input.Pointer,
    gameObjects: Phaser.GameObjects.GameObject[],
    deltaX: number,
    deltaY: number,
  ) => void;

  private isOpen = false;
  private activeTab: LedgerTab = 'deck';
  private deckPage = 0;
  private collectionScrollY = 0;
  private collectionMaxScrollY = 0;

  constructor(
    scene: Phaser.Scene,
    getInput: () => LedgerOverlayStateInput,
    onClose?: () => void,
  ) {
    this.scene = scene;
    this.getInput = getInput;
    this.onCloseCallback = onClose;
  }

  public get openState(): boolean {
    return this.isOpen;
  }

  public getSnapshot(): LedgerOverlaySnapshot {
    return buildLedgerSnapshot(
      this.isOpen,
      this.activeTab,
      this.deckPage,
      this.getInput(),
      this.collectionScrollY,
      this.collectionMaxScrollY,
    );
  }

  public open(initialTab: LedgerTab = 'deck'): void {
    this.isOpen = true;
    this.activeTab = initialTab;
    this.deckPage = 0;
    this.collectionScrollY = 0;
    this.render();
  }

  public close(): void {
    if (!this.isOpen) {
      return;
    }
    this.isOpen = false;
    this.destroyNodes();
    this.onCloseCallback?.();
  }

  public destroy(): void {
    this.isOpen = false;
    this.destroyNodes();
  }

  private destroyNodes(): void {
    if (this.wheelHandler) {
      this.scene.input.off('wheel', this.wheelHandler);
      this.wheelHandler = undefined;
    }
    if (this.collectionMaskGraphics) {
      this.collectionMaskGraphics.destroy();
      this.collectionMaskGraphics = undefined;
    }
    this.collectionScrollContainer = undefined;
    this.scrollThumb = undefined;
    if (this.rootContainer) {
      this.rootContainer.destroy(true);
      this.rootContainer = undefined;
    }
  }

  private render(): void {
    this.destroyNodes();
    if (!this.isOpen) {
      return;
    }

    const centerX = LEDGER_OVERLAY_RECT.x;
    const centerY = LEDGER_OVERLAY_RECT.y;
    const root = this.scene.add.container(0, 0).setDepth(130);
    this.rootContainer = root;

    // 模态全屏遮罩：阻止底层白天交互，点空白可关闭
    const backdrop = this.scene.add
      .rectangle(
        Math.floor(BASE_WIDTH / 2),
        Math.floor(BASE_HEIGHT / 2),
        BASE_WIDTH,
        BASE_HEIGHT,
        PALETTE.ink.num,
        0.72,
      )
      .setInteractive({ useHandCursor: true });
    backdrop.on('pointerdown', () => {
      audio.unlock();
      audio.playSfx('button_click');
      this.close();
    });

    // 账本主底板（552×288 居中），阻止点击穿透到遮罩
    const panel = this.scene.add
      .rectangle(
        centerX,
        centerY,
        LEDGER_OVERLAY_RECT.width,
        LEDGER_OVERLAY_RECT.height,
        PALETTE.candle.num,
      )
      .setStrokeStyle(2, PALETTE.brass.num)
      .setInteractive();

    // 顶部深木标题与 Tab 条
    const headerBar = this.scene.add.rectangle(
      centerX,
      52,
      LEDGER_OVERLAY_RECT.width - 4,
      32,
      PALETTE.deepWood.num,
    );
    const titleText = addPixelText(this.scene, 56, 52, '账本', {
      color: PALETTE.lampYellow.hex,
      origin: [0, 0.5],
    });

    root.add([backdrop, panel, headerBar, titleText]);

    // 三页 Tab 按钮
    for (const tabInfo of TAB_LABELS) {
      const rect = LEDGER_TAB_BUTTONS[tabInfo.id];
      const selected = this.activeTab === tabInfo.id;
      const tabBg = this.scene.add
        .rectangle(
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          selected ? PALETTE.candle.num : PALETTE.woodBrown.num,
        )
        .setStrokeStyle(2, selected ? PALETTE.lampYellow.num : PALETTE.ink.num)
        .setInteractive({ useHandCursor: true });
      const tabTxt = addPixelText(this.scene, rect.x, rect.y, tabInfo.label, {
        color: selected ? PALETTE.ink.hex : PALETTE.candle.hex,
        origin: 0.5,
      });
      tabBg.on('pointerover', () => {
        if (this.activeTab !== tabInfo.id) {
          tabBg.setFillStyle(PALETTE.copperBrown.num);
        }
      });
      tabBg.on('pointerout', () => {
        if (this.activeTab !== tabInfo.id) {
          tabBg.setFillStyle(PALETTE.woodBrown.num);
        }
      });
      tabBg.on('pointerdown', () => {
        if (this.activeTab === tabInfo.id) {
          return;
        }
        audio.unlock();
        audio.playSfx('button_click');
        this.activeTab = tabInfo.id;
        this.deckPage = 0;
        this.collectionScrollY = 0;
        this.render();
      });
      root.add([tabBg, tabTxt]);
    }

    // 「点空白收起」提示与常驻右上角关闭按钮「×」
    const hintText = addPixelText(this.scene, 510, 52, '点空白收起', {
      size: 12,
      color: PALETTE.oldPaper.hex,
      origin: 0.5,
    });
    const closeBtn = this.scene.add
      .rectangle(
        LEDGER_CLOSE_BUTTON.x,
        LEDGER_CLOSE_BUTTON.y,
        LEDGER_CLOSE_BUTTON.width,
        LEDGER_CLOSE_BUTTON.height,
        PALETTE.vermilion.num,
      )
      .setStrokeStyle(2, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });
    const closeTxt = addPixelText(this.scene, LEDGER_CLOSE_BUTTON.x, LEDGER_CLOSE_BUTTON.y, '×', {
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });
    closeBtn.on('pointerover', () => closeBtn.setFillStyle(PALETTE.lampYellow.num));
    closeBtn.on('pointerout', () => closeBtn.setFillStyle(PALETTE.vermilion.num));
    closeBtn.on('pointerdown', () => {
      audio.unlock();
      audio.playSfx('button_click');
      this.close();
    });
    root.add([hintText, closeBtn, closeTxt]);

    const body = this.scene.add.container(0, 0);
    root.add(body);

    const input = this.getInput();
    if (this.activeTab === 'deck') {
      this.collectionMaxScrollY = 0;
      this.renderDeckTab(body, input.deck);
    } else if (this.activeTab === 'heirlooms') {
      this.collectionMaxScrollY = 0;
      this.renderHeirloomsTab(body, input.chapter.heirlooms ?? []);
    } else {
      this.renderCollectionTab(body, input.chapter);
    }
  }

  private renderDeckTab(container: Phaser.GameObjects.Container, deck: readonly string[]): void {
    const totalPages = Math.max(1, Math.ceil(deck.length / DECK_PAGE_SIZE));
    if (this.deckPage >= totalPages) {
      this.deckPage = totalPages - 1;
    }

    container.add(
      addPixelText(this.scene, 56, 80, `当前牌组 ${deck.length}张`, {
        size: 12,
        color: PALETTE.ink.hex,
        origin: [0, 0.5],
      }),
    );
    if (totalPages > 1) {
      container.add(
        addPixelText(this.scene, 584, 80, `第${this.deckPage + 1}/${totalPages}页`, {
          size: 12,
          color: PALETTE.deepWood.hex,
          origin: [1, 0.5],
        }),
      );
    }

    if (deck.length === 0) {
      container.add(
        addPixelText(this.scene, LEDGER_OVERLAY_RECT.x, 194, '当前暂无牌', {
          color: PALETTE.deepWood.hex,
          origin: 0.5,
        }),
      );
      return;
    }

    const startIdx = this.deckPage * DECK_PAGE_SIZE;
    const pageCards = deck.slice(startIdx, startIdx + DECK_PAGE_SIZE);
    const colXs = [140, 320, 500];
    const rowYs = [114, 164, 214, 264];

    pageCards.forEach((cardName, slotIdx) => {
      const col = slotIdx % 3;
      const row = Math.floor(slotIdx / 3);
      const cx = colXs[col];
      const cy = rowYs[row];
      const globalIdx = startIdx + slotIdx;
      const cardDef = CARDS_BY_NAME.get(cardName);
      const matchedItem = ITEMS.find((item) => item.cardName === cardName);
      const stripColor = matchedItem
        ? parseHexColor(matchedItem.color)
        : cardDef?.color
          ? parseHexColor(cardDef.color)
          : PALETTE.brass.num;
      const costStr = cardDef ? `${cardDef.cost}费` : '';
      const setTag = cardDef?.set === '旧物' ? ' 旧' : '';
      const shortEff = cardDef ? formatEffectShort(cardDef) : '';

      const bg = this.scene.add
        .rectangle(cx, cy, 172, 44, PALETTE.paperWhite.num)
        .setStrokeStyle(2, cardDef?.unplayable ? PALETTE.vermilion.num : PALETTE.ink.num);
      const strip = this.scene.add.rectangle(cx, cy - 19, 168, 4, stripColor);
      const nameTxt = addPixelText(this.scene, cx - 80, cy - 6, `${globalIdx + 1}.${cardName}`, {
        size: 12,
        color: PALETTE.ink.hex,
        origin: [0, 0.5],
      });
      const costTxt = addPixelText(this.scene, cx + 80, cy - 6, `${costStr}${setTag}`, {
        size: 12,
        color: PALETTE.copperBrown.hex,
        origin: [1, 0.5],
      });
      const effTxt = addPixelText(this.scene, cx - 80, cy + 10, shortEff, {
        size: 12,
        color: cardDef?.unplayable ? PALETTE.vermilion.hex : PALETTE.deepWood.hex,
        origin: [0, 0.5],
      });
      container.add([bg, strip, nameTxt, costTxt, effTxt]);
    });

    if (totalPages > 1) {
      this.addSmallButton(
        container,
        LEDGER_DECK_PREV_BUTTON.x,
        LEDGER_DECK_PREV_BUTTON.y,
        LEDGER_DECK_PREV_BUTTON.width,
        LEDGER_DECK_PREV_BUTTON.height,
        '上一页',
        () => {
          this.deckPage = (this.deckPage - 1 + totalPages) % totalPages;
          this.render();
        },
      );
      this.addSmallButton(
        container,
        LEDGER_DECK_NEXT_BUTTON.x,
        LEDGER_DECK_NEXT_BUTTON.y,
        LEDGER_DECK_NEXT_BUTTON.width,
        LEDGER_DECK_NEXT_BUTTON.height,
        '下一页',
        () => {
          this.deckPage = (this.deckPage + 1) % totalPages;
          this.render();
        },
      );
    }
  }

  private renderHeirloomsTab(
    container: Phaser.GameObjects.Container,
    ownedIds: readonly string[],
  ): void {
    const ownedSet = new Set(ownedIds);
    const ownedCount = HEIRLOOMS.filter((h) => ownedSet.has(h.id)).length;

    container.add(
      addPixelText(
        this.scene,
        56,
        80,
        `老物件 ${ownedCount}/${HEIRLOOMS.length}(最多持有3件)`,
        {
          size: 12,
          color: PALETTE.ink.hex,
          origin: [0, 0.5],
        },
      ),
    );

    const colXs = [184, 456];
    const rowYs = [118, 174, 230, 286];

    HEIRLOOMS.forEach((h, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const cx = colXs[col];
      const cy = rowYs[row];
      const owned = ownedSet.has(h.id);

      const bg = this.scene.add
        .rectangle(cx, cy, 262, 50, owned ? PALETTE.paperWhite.num : PALETTE.deepWood.num)
        .setStrokeStyle(2, owned ? PALETTE.brass.num : PALETTE.woodBrown.num);
      const badgeBg = this.scene.add
        .rectangle(
          cx - 108,
          cy,
          32,
          32,
          owned ? PALETTE.candle.num : PALETTE.ink.num,
        )
        .setStrokeStyle(2, owned ? PALETTE.lampYellow.num : PALETTE.woodBrown.num);
      const badgeTxt = addPixelText(this.scene, cx - 108, cy, h.shortLabel, {
        color: owned ? PALETTE.ink.hex : PALETTE.oldPaper.hex,
        origin: 0.5,
      });
      const nameTxt = addPixelText(this.scene, cx - 84, cy - 12, h.name, {
        size: 12,
        color: owned ? PALETTE.ink.hex : PALETTE.candle.hex,
        origin: [0, 0.5],
      });
      const statusTxt = addPixelText(this.scene, cx + 122, cy - 12, owned ? '已拥有' : '未拥有', {
        size: 12,
        color: owned ? PALETTE.jade.hex : PALETTE.oldPaper.hex,
        origin: [1, 0.5],
      });
      const effTxt = addPixelText(this.scene, cx - 84, cy + 3, h.effectText, {
        size: 12,
        color: owned ? PALETTE.deepWood.hex : PALETTE.silverBlue.hex,
        origin: [0, 0.5],
      });
      const storyTxt = addPixelText(this.scene, cx - 84, cy + 16, h.story, {
        size: 12,
        color: owned ? PALETTE.copperBrown.hex : PALETTE.oldPaper.hex,
        origin: [0, 0.5],
      });

      container.add([bg, badgeBg, badgeTxt, nameTxt, statusTxt, effTxt, storyTxt]);
    });
  }

  private renderCollectionTab(
    container: Phaser.GameObjects.Container,
    chapter: ChapterSaveState,
  ): void {
    const counts = computeCollectionCounts(chapter);
    const seenItemsSet = new Set(chapter.seenItems ?? []);
    const seenCardsSet = new Set(chapter.seenCards ?? []);
    const redeemedSet = new Set(chapter.redeemedItems ?? []);
    const ownedHeirloomsSet = new Set(chapter.heirlooms ?? []);

    // 顶部计数行（收集 X/12、牌 Y/29、老物件 Z/7）
    container.add([
      this.scene.add.rectangle(LEDGER_OVERLAY_RECT.x, 79, 536, 18, PALETTE.deepWood.num),
      addPixelText(this.scene, 60, 79, `收集 ${counts.seenItemsCount}/${counts.totalItems}`, {
        size: 12,
        color: PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
      addPixelText(this.scene, LEDGER_OVERLAY_RECT.x, 79, `牌 ${counts.seenCardsCount}/${counts.totalCards}`, {
        size: 12,
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      }),
      addPixelText(
        this.scene,
        580,
        79,
        `老物件 ${counts.ownedHeirloomsCount}/${counts.totalHeirlooms}`,
        {
          size: 12,
          color: PALETTE.candle.hex,
          origin: [1, 0.5],
        },
      ),
    ]);

    // 中部可滚动内容区
    const clip = LEDGER_COLLECTION_CLIP_RECT;
    const scrollContainer = this.scene.add.container(0, clip.y);
    this.collectionScrollContainer = scrollContainer;
    container.add(scrollContainer);

    const maskGraphics = this.scene.make.graphics({ x: 0, y: 0 });
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(clip.x, clip.y, clip.width, clip.height);
    this.collectionMaskGraphics = maskGraphics;
    scrollContainer.setMask(maskGraphics.createGeometryMask());

    let cursorY = 0;

    // 1. 12 件旧物格（已赎回显示「赎当后日谈」）
    scrollContainer.add(
      addPixelText(this.scene, 56, cursorY + 6, `旧物 ${counts.seenItemsCount}/${counts.totalItems}`, {
        size: 12,
        color: PALETTE.deepWood.hex,
        origin: [0, 0.5],
      }),
    );
    cursorY += 16;

    const itemColLefts = [54, 312];
    const itemBoxWidth = 250;
    for (let r = 0; r < Math.ceil(ITEMS.length / 2); r += 1) {
      const leftItem = ITEMS[r * 2];
      const rightItem = ITEMS[r * 2 + 1];
      const rowHasAftermath =
        (leftItem && redeemedSet.has(leftItem.id)) ||
        (rightItem && redeemedSet.has(rightItem.id));
      const rowHeight = rowHasAftermath ? 38 : 22;
      const cy = cursorY + Math.floor(rowHeight / 2);

      [leftItem, rightItem].forEach((item, col) => {
        if (!item) {
          return;
        }
        const cx = itemColLefts[col] + Math.floor(itemBoxWidth / 2);
        const redeemed = redeemedSet.has(item.id);
        const seen = seenItemsSet.has(item.id) || redeemed;
        const stripColor = seen ? parseHexColor(item.color) : PALETTE.woodBrown.num;
        const statusText = redeemed ? '已赎' : seen ? '已见' : '未见';
        const statusColor = redeemed
          ? PALETTE.vermilion.hex
          : seen
            ? PALETTE.jade.hex
            : PALETTE.oldPaper.hex;

        const boxBg = this.scene.add
          .rectangle(
            cx,
            cy,
            itemBoxWidth,
            rowHeight,
            seen ? PALETTE.paperWhite.num : PALETTE.deepWood.num,
          )
          .setStrokeStyle(1, redeemed ? PALETTE.brass.num : seen ? PALETTE.ink.num : PALETTE.woodBrown.num);
        const strip = this.scene.add.rectangle(
          cx,
          cy - Math.floor(rowHeight / 2) + 2,
          itemBoxWidth - 2,
          3,
          stripColor,
        );
        const topRowY = rowHasAftermath ? cy - 7 : cy + 1;
        const nameTxt = addPixelText(this.scene, cx - 118, topRowY, item.name, {
          size: 12,
          color: seen ? PALETTE.ink.hex : PALETTE.oldPaper.hex,
          origin: [0, 0.5],
        });
        const stateTxt = addPixelText(this.scene, cx + 118, topRowY, statusText, {
          size: 12,
          color: statusColor,
          origin: [1, 0.5],
        });
        scrollContainer.add([boxBg, strip, nameTxt, stateTxt]);

        if (redeemed) {
          const aftermath = getAftermathLine(item.id);
          if (aftermath) {
            scrollContainer.add(
              addPixelText(this.scene, cx - 118, cy + 9, aftermath, {
                size: 12,
                color: PALETTE.deepWood.hex,
                origin: [0, 0.5],
              }),
            );
          }
        }
      });

      cursorY += rowHeight + 4;
    }

    cursorY += 4;

    // 2. 29 张可收集卡牌格（动态排除不可出牌）
    const collectibleCards = getCollectibleCards(ALL_CARDS);
    scrollContainer.add(
      addPixelText(
        this.scene,
        56,
        cursorY + 6,
        `牌 ${counts.seenCardsCount}/${counts.totalCards}`,
        {
          size: 12,
          color: PALETTE.deepWood.hex,
          origin: [0, 0.5],
        },
      ),
    );
    cursorY += 16;

    const cardCols = 5;
    const cardW = 98;
    const cardH = 20;
    const cardGap = 4;
    const cardStartX = 54 + Math.floor(cardW / 2);

    collectibleCards.forEach((card, idx) => {
      const col = idx % cardCols;
      const row = Math.floor(idx / cardCols);
      const cx = cardStartX + col * (cardW + cardGap);
      const cy = cursorY + row * (cardH + cardGap) + Math.floor(cardH / 2);
      const seen = seenCardsSet.has(card.id);
      const stripColor = seen && card.color ? parseHexColor(card.color) : PALETTE.woodBrown.num;

      scrollContainer.add([
        this.scene.add
          .rectangle(cx, cy, cardW, cardH, seen ? PALETTE.paperWhite.num : PALETTE.deepWood.num)
          .setStrokeStyle(1, seen ? PALETTE.ink.num : PALETTE.woodBrown.num),
        this.scene.add.rectangle(cx, cy - Math.floor(cardH / 2) + 2, cardW - 2, 3, stripColor),
        addPixelText(this.scene, cx, cy + 1, card.name, {
          size: 12,
          color: seen ? PALETTE.ink.hex : PALETTE.oldPaper.hex,
          origin: 0.5,
        }),
      ]);
    });

    const cardRows = Math.ceil(collectibleCards.length / cardCols);
    cursorY += cardRows * (cardH + cardGap) + 6;

    // 3. 7 件老物件格
    scrollContainer.add(
      addPixelText(
        this.scene,
        56,
        cursorY + 6,
        `老物件 ${counts.ownedHeirloomsCount}/${counts.totalHeirlooms}`,
        {
          size: 12,
          color: PALETTE.deepWood.hex,
          origin: [0, 0.5],
        },
      ),
    );
    cursorY += 16;

    const heirloomCols = 4;
    const heirloomW = 124;
    const heirloomH = 20;
    const heirloomGap = 4;
    const heirloomStartX = 54 + Math.floor(heirloomW / 2);

    HEIRLOOMS.forEach((h, idx) => {
      const col = idx % heirloomCols;
      const row = Math.floor(idx / heirloomCols);
      const cx = heirloomStartX + col * (heirloomW + heirloomGap);
      const cy = cursorY + row * (heirloomH + heirloomGap) + Math.floor(heirloomH / 2);
      const owned = ownedHeirloomsSet.has(h.id);

      scrollContainer.add([
        this.scene.add
          .rectangle(
            cx,
            cy,
            heirloomW,
            heirloomH,
            owned ? PALETTE.paperWhite.num : PALETTE.deepWood.num,
          )
          .setStrokeStyle(1, owned ? PALETTE.brass.num : PALETTE.woodBrown.num),
        this.scene.add.rectangle(
          cx,
          cy - Math.floor(heirloomH / 2) + 2,
          heirloomW - 2,
          3,
          owned ? PALETTE.brass.num : PALETTE.woodBrown.num,
        ),
        addPixelText(this.scene, cx, cy + 1, `${h.shortLabel} ${h.name}`, {
          size: 12,
          color: owned ? PALETTE.ink.hex : PALETTE.oldPaper.hex,
          origin: 0.5,
        }),
      ]);
    });

    const heirloomRows = Math.ceil(HEIRLOOMS.length / heirloomCols);
    cursorY += heirloomRows * (heirloomH + heirloomGap) + 4;

    this.collectionMaxScrollY = Math.max(0, cursorY - clip.height);
    this.collectionScrollY = Math.max(0, Math.min(this.collectionScrollY, this.collectionMaxScrollY));
    scrollContainer.y = clip.y - this.collectionScrollY;

    // 右侧页内滚动按钮与滚动条
    const trackBg = this.scene.add.rectangle(578, 182, 6, 100, PALETTE.deepWood.num);
    const thumb = this.scene.add.rectangle(578, 146, 6, 28, PALETTE.brass.num);
    this.scrollThumb = thumb;
    container.add([trackBg, thumb]);

    this.addSmallButton(
      container,
      LEDGER_COLLECTION_SCROLL_UP_BUTTON.x,
      LEDGER_COLLECTION_SCROLL_UP_BUTTON.y,
      LEDGER_COLLECTION_SCROLL_UP_BUTTON.width,
      LEDGER_COLLECTION_SCROLL_UP_BUTTON.height,
      '上',
      () => this.scrollCollectionBy(-COLLECTION_SCROLL_STEP),
    );
    this.addSmallButton(
      container,
      LEDGER_COLLECTION_SCROLL_DOWN_BUTTON.x,
      LEDGER_COLLECTION_SCROLL_DOWN_BUTTON.y,
      LEDGER_COLLECTION_SCROLL_DOWN_BUTTON.width,
      LEDGER_COLLECTION_SCROLL_DOWN_BUTTON.height,
      '下',
      () => this.scrollCollectionBy(COLLECTION_SCROLL_STEP),
    );
    this.syncScrollThumb();

    this.wheelHandler = (pointer, _objs, _dx, dy) => {
      if (!this.isOpen || this.activeTab !== 'collection') {
        return;
      }
      if (
        pointer.x >= clip.x &&
        pointer.x <= clip.x + clip.width &&
        pointer.y >= clip.y &&
        pointer.y <= clip.y + clip.height
      ) {
        this.scrollCollectionBy(dy > 0 ? 48 : -48);
      }
    };
    this.scene.input.on('wheel', this.wheelHandler);

    // 底部固定《老掌柜的日记》碎片 3 格（见过亮、未见过暗）
    container.add([
      this.scene.add.rectangle(LEDGER_OVERLAY_RECT.x, 272, 536, 2, PALETTE.oldPaper.num),
      addPixelText(this.scene, 56, 282, '老掌柜的日记', {
        size: 12,
        color: PALETTE.deepWood.hex,
        origin: [0, 0.5],
      }),
    ]);

    const unlockedFragments = new Set(chapter.diaryFragments ?? []);
    const diaryXs = [140, 320, 500];
    getDiaryFragments().forEach((frag, idx) => {
      const cx = diaryXs[idx];
      const unlocked = unlockedFragments.has(frag.id);
      container.add([
        this.scene.add
          .rectangle(
            cx,
            304,
            174,
            26,
            unlocked ? PALETTE.paperWhite.num : PALETTE.deepWood.num,
          )
          .setStrokeStyle(1, unlocked ? PALETTE.brass.num : PALETTE.woodBrown.num),
        addPixelText(this.scene, cx, 304, unlocked ? frag.text : '未找到', {
          size: 12,
          color: unlocked ? PALETTE.ink.hex : PALETTE.oldPaper.hex,
          origin: 0.5,
        }),
      ]);
    });
  }

  private scrollCollectionBy(deltaY: number): void {
    if (this.collectionMaxScrollY <= 0) {
      return;
    }
    this.collectionScrollY = Math.max(
      0,
      Math.min(this.collectionMaxScrollY, this.collectionScrollY + deltaY),
    );
    if (this.collectionScrollContainer) {
      this.collectionScrollContainer.y = LEDGER_COLLECTION_CLIP_RECT.y - this.collectionScrollY;
    }
    this.syncScrollThumb();
  }

  private syncScrollThumb(): void {
    if (!this.scrollThumb) {
      return;
    }
    if (this.collectionMaxScrollY <= 0) {
      this.scrollThumb.y = 146;
      return;
    }
    const ratio = this.collectionScrollY / this.collectionMaxScrollY;
    this.scrollThumb.y = Math.round(146 + ratio * 72);
  }

  private addSmallButton(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
  ): void {
    const bg = this.scene.add
      .rectangle(x, y, width, height, PALETTE.oldPaper.num)
      .setStrokeStyle(2, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });
    const txt = addPixelText(this.scene, x, y, label, {
      size: 12,
      color: PALETTE.ink.hex,
      origin: 0.5,
    });
    bg.on('pointerover', () => bg.setFillStyle(PALETTE.lampYellow.num));
    bg.on('pointerout', () => bg.setFillStyle(PALETTE.oldPaper.num));
    bg.on('pointerdown', () => {
      audio.unlock();
      audio.playSfx('button_click');
      onClick();
    });
    container.add([bg, txt]);
  }
}
