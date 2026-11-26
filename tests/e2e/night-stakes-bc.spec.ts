import { expect, test, type Page } from '@playwright/test';
import {
  BATTLE_END_TURN_BUTTON,
  DEMON_INTRO_BANNER_RECT,
  MORNING_OPTION_BUTTONS,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  RESULT_NEXT_DAY_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TITLE_START_BUTTON,
} from '../../src/game/layout';
import { clickLogical } from './helpers';

const SAVE_STORAGE_KEY = 'pawnshop-cards-save-v1';
const TUTORIAL_STORAGE_KEY = 'pawnshop-cards-tutorial-v1';
const GLOSSARY_STORAGE_KEY = 'pawnshop-cards-glossary-v1';

interface MorningOptionStatus {
  enabled: boolean;
  reason: 'full_hp' | 'insufficient_funds' | null;
}

interface PawnshopDebugState {
  phase: string;
  customerIndex: number;
  money: number;
  reputation: number;
  currentHp?: number;
  dailyCustomerCount?: number;
  morningAvailability?: {
    rest: MorningOptionStatus;
    medicine: MorningOptionStatus;
    work: MorningOptionStatus;
  } | null;
  deck: string[];
  day?: number;
  lastToast?: string | null;
}

interface BattleDebugState {
  phase: string;
  round: number;
  playerHp: number;
  maxPlayerHp?: number;
  renqing: number;
  demonHp: number;
  hand: string[];
  handSlotXs?: number[];
  handSlotYs?: number[];
  discardCount: number;
  introBannerVisible?: boolean;
  lastGlossaryTip?: string | null;
  result: string;
  heirlooms?: string[];
  loseReason?: string | null;
  normalFailContinueLine?: string | null;
  savedData?: {
    day: number;
    money: number;
    reputation: number;
    currentHp?: number;
    deck: string[];
    chapter?: { status: string };
  } | null;
  isAnimating?: boolean;
}

function trackErrors(page: Page): { pageErrors: string[]; failedRequests: string[] } {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('requestfailed', (req) =>
    failedRequests.push(`requestfailed ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });
  return { pageErrors, failedRequests };
}

async function getPawnshopState(page: Page): Promise<PawnshopDebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __PAWNSHOP_DEBUG__?: { getState: () => PawnshopDebugState } })
      .__PAWNSHOP_DEBUG__;
    if (!hook) throw new Error('__PAWNSHOP_DEBUG__ missing');
    return hook.getState();
  });
}

async function waitForPawnshopPhase(page: Page, phase: string): Promise<PawnshopDebugState> {
  await expect
    .poll(async () => {
      try {
        return (await getPawnshopState(page)).phase;
      } catch {
        return null;
      }
    })
    .toBe(phase);
  return getPawnshopState(page);
}

async function getBattleState(page: Page): Promise<BattleDebugState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __BATTLE_DEBUG__?: { getState: () => BattleDebugState } })
      .__BATTLE_DEBUG__;
    if (!hook) throw new Error('__BATTLE_DEBUG__ missing');
    return hook.getState();
  });
}

async function waitForBattleReady(page: Page, phase: string): Promise<BattleDebugState> {
  await expect
    .poll(async () => {
      try {
        const s = await getBattleState(page);
        return s.isAnimating ? 'animating' : s.phase;
      } catch {
        return null;
      }
    })
    .toBe(phase);
  return getBattleState(page);
}

function buildSeededSave(opts: {
  day: number;
  money: number;
  currentHp: number;
  deck: string[];
  reputation?: number;
  day4TrimDone?: boolean;
}) {
  return JSON.stringify({
    version: 3,
    day: opts.day,
    money: opts.money,
    reputation: opts.reputation ?? 0,
    deck: opts.deck,
    shopLevel: 2,
    redeemTickets: 0,
    currentHp: opts.currentHp,
    tutorialCompleted: true,
    chapter: {
      currentChapter: 1,
      dayInChapter: opts.day,
      chapter1Completed: false,
      chapter1FailedCount: 0,
      status: 'in_progress',
      bossBattleActive: false,
      pactChoice: null,
      sideQuestChoice: null,
      daysCleared: [],
      daysVisited: Array.from({ length: opts.day - 1 }, (_, i) => i + 1),
      pawnsCollected: opts.deck.length,
      demonsDefeated: 0,
      day4TrimDone: opts.day4TrimDone ?? false,
      day6SideQuestDone: false,
    },
  });
}

test('Task 19 §2/§3/§6: persistent HP carries across nights (+5 sleep heal), adds 欠条 + rep -1 on loss, and KO wakes at 5 HP without failing chapter', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, tutKey, glosKey]) => {
      localStorage.removeItem(saveKey);
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glosKey,
        JSON.stringify(['reputation', 'renqing', 'obsession', 'charge_threshold']),
      );
    },
    [SAVE_STORAGE_KEY, TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await expect(canvas).toBeVisible();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_START_BUTTON);

  // Day 1 starts at full 30 HP (HUD shows currentHp=30)
  const day1 = await waitForPawnshopPhase(page, 'negotiating');
  expect(day1.currentHp).toBe(30);

  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_TIER_BUTTONS.high);
    await waitForPawnshopPhase(page, 'feedback');
    await clickLogical(page, canvas, PAWNSHOP_FEEDBACK_NEXT_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const night1 = await waitForBattleReady(page, 'play');
  expect(night1.playerHp).toBe(30);
  expect(night1.maxPlayerHp).toBe(30);

  // End 3 turns without playing cards -> Demon A deals 3+3+5 = 11 dmg -> endHp = 19 -> sleep +5 -> 24
  for (let r = 1; r <= 3; r += 1) {
    await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
    if (r < 3) {
      await expect.poll(async () => {
        const s = await getBattleState(page);
        return !s.isAnimating && s.round === r + 1;
      }).toBe(true);
    }
  }
  const n1Res = await waitForBattleReady(page, 'result_scene');
  expect(n1Res.result).toBe('lose_timeout');
  expect(n1Res.normalFailContinueLine).toBe('输了这一夜，留下一张欠条，口碑-1，明天继续');
  expect(n1Res.savedData?.currentHp).toBe(24);
  expect(n1Res.savedData?.reputation).toBe(3); // Day 1 high on stamp_album(+2)/tin_trunk(+1)/erhu(+1) = +4, Night 1 loss -1 => 3
  expect(n1Res.savedData?.deck).toEqual(['集邮', '顶住', '余音', '欠条']);

  // Advance to Day 2 morning -> pick 打理当铺 -> Night 2 enters at 24/30 HP
  await clickLogical(page, canvas, RESULT_NEXT_DAY_BUTTON);
  const day2Morning = await waitForPawnshopPhase(page, 'morning');
  expect(day2Morning.currentHp).toBe(24);
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const night2 = await waitForBattleReady(page, 'play');
  // 第 1 天三次高价成交累计口碑 +4，触发口碑里程碑 [2, 4]；?seed=7 下抽中棉被（每夜开始回血 +3），故第 2 夜开局为 24 + 3 = 27
  expect(night2.heirlooms).toContain('quilt');
  expect(night2.playerHp).toBe(27);
  const quiltHeal = night2.heirlooms?.includes('quilt') ? 3 : 0;
  expect(night2.playerHp).toBe(24 + quiltHeal);
  expect(night2.maxPlayerHp).toBe(30);

  // 2) KO via ?deck=test&playerHp=2 on Night 2 -> wakes at 5 HP on Day 3, chapter continues
  await page.goto('/?seed=7&deck=test&playerHp=2');
  await page.evaluate(
    ([saveKey, save]) => {
      localStorage.setItem(saveKey, save);
    },
    [SAVE_STORAGE_KEY, buildSeededSave({ day: 2, money: 100, currentHp: 26, deck: ['倒转', '余音'] })] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const koNight = await waitForBattleReady(page, 'play');
  expect(koNight.playerHp).toBe(2);
  expect(koNight.maxPlayerHp).toBe(30);

  // Demon B deals 2 dmg R1 -> playerHp = 0 (lose_hp)
  await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
  const koRes = await waitForBattleReady(page, 'result_scene');
  expect(koRes.result).toBe('lose_hp');
  expect(koRes.loseReason).toBe('被打倒');
  expect(koRes.normalFailContinueLine).toBe('输了这一夜，留下一张欠条，口碑-1，明天继续');
  expect(koRes.savedData?.currentHp).toBe(5);
  expect(koRes.savedData?.chapter?.status).toBe('in_progress');

  await clickLogical(page, canvas, RESULT_NEXT_DAY_BUTTON);
  const day3Wake = await waitForPawnshopPhase(page, 'morning');
  expect(day3Wake.day).toBe(3);
  expect(day3Wake.currentHp).toBe(5);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 19 §3/§6: 欠条 is unplayable in battle, triggers debt_note glossary tip, and winning removes 1 欠条', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);

  await page.goto('/?seed=7&demon=a');
  await page.evaluate(
    ([saveKey, tutKey, glosKey, save]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glosKey,
        JSON.stringify(['reputation', 'renqing', 'obsession', 'charge_threshold']),
      );
      localStorage.setItem(saveKey, save);
    },
    [
      SAVE_STORAGE_KEY,
      TUTORIAL_STORAGE_KEY,
      GLOSSARY_STORAGE_KEY,
      buildSeededSave({
        day: 2,
        money: 100,
        currentHp: 20,
        deck: ['欠条', '欠条', '秤砣', '秤砣', '秤砣', '秤砣'],
      }),
    ] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const battleStart = await waitForBattleReady(page, 'play');
  expect(battleStart.hand).toContain('欠条');
  // Dismiss intro banner -> debt_note glossary tip fires
  await clickLogical(page, canvas, {
    x: Math.floor(DEMON_INTRO_BANNER_RECT.x + DEMON_INTRO_BANNER_RECT.width / 2),
    y: Math.floor(DEMON_INTRO_BANNER_RECT.y + DEMON_INTRO_BANNER_RECT.height / 2),
  });
  await expect.poll(async () => (await getBattleState(page)).introBannerVisible).toBe(false);
  expect((await getBattleState(page)).lastGlossaryTip).toBe('欠条：输夜留下的债，占一张手牌，打不出去');

  // Clicking 欠条 does nothing (unplayable)
  const beforeDebtClick = await getBattleState(page);
  const debtIdx = beforeDebtClick.hand.indexOf('欠条');
  expect(debtIdx).toBeGreaterThanOrEqual(0);
  await clickLogical(page, canvas, {
    x: beforeDebtClick.handSlotXs![debtIdx],
    y: beforeDebtClick.handSlotYs![debtIdx],
  });
  await page.waitForTimeout(200);
  const afterDebtClick = await getBattleState(page);
  expect(afterDebtClick.hand).toEqual(beforeDebtClick.hand);
  expect(afterDebtClick.discardCount).toBe(beforeDebtClick.discardCount);
  expect(afterDebtClick.renqing).toBe(beforeDebtClick.renqing);

  // Win Night 2 using 秤砣 -> 1 欠条 removed from deck (2 -> 1)
  let cur = afterDebtClick;
  while (cur.phase === 'play' && cur.result === 'ongoing') {
    const dmgIdx = cur.hand.indexOf('秤砣');
    if (dmgIdx >= 0 && cur.renqing >= 1) {
      const prevDiscard = cur.discardCount;
      await clickLogical(page, canvas, { x: cur.handSlotXs![dmgIdx], y: cur.handSlotYs![dmgIdx] });
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && (s.phase === 'result_scene' || s.discardCount > prevDiscard);
        })
        .toBe(true);
    } else {
      const prevRound = cur.round;
      await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
      await expect
        .poll(async () => {
          const s = await getBattleState(page);
          return !s.isAnimating && (s.phase === 'result_scene' || s.round > prevRound);
        })
        .toBe(true);
    }
    cur = await getBattleState(page);
  }
  const winRes = await waitForBattleReady(page, 'result_scene');
  expect(winRes.result).toBe('win');
  expect(winRes.savedData?.deck.filter((n) => n === '欠条')).toHaveLength(1);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 19 §4: morning 3-way board disabled states, rest (2 customers), medicine (-20/+10/3 customers), Day 4 & Day 7 ordering, and multi-viewport check', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  const canvas = page.locator('#game-container canvas');

  // 1) Full HP (30): rest & medicine disabled ('已满血'), work enabled
  await page.goto('/?seed=7');
  await page.evaluate(
    ([saveKey, tutKey, glosKey, save]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glosKey,
        JSON.stringify(['reputation', 'renqing', 'obsession', 'charge_threshold', 'debt_note']),
      );
      localStorage.setItem(saveKey, save);
    },
    [
      SAVE_STORAGE_KEY,
      TUTORIAL_STORAGE_KEY,
      GLOSSARY_STORAGE_KEY,
      buildSeededSave({ day: 2, money: 100, currentHp: 30, deck: ['倒转'] }),
    ] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);

  const fullMorning = await waitForPawnshopPhase(page, 'morning');
  expect(fullMorning.morningAvailability?.rest).toEqual({ enabled: false, reason: 'full_hp' });
  expect(fullMorning.morningAvailability?.medicine).toEqual({ enabled: false, reason: 'full_hp' });
  expect(fullMorning.morningAvailability?.work).toEqual({ enabled: true, reason: null });

  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.rest);
  await expect.poll(async () => (await getPawnshopState(page)).lastToast).toBe('已满血');
  expect((await getPawnshopState(page)).phase).toBe('morning');

  // 2) Low HP (16) + money 15 (<20): medicine disabled ('钱不够'), rest gives +10 HP & 2 customers
  await page.evaluate(
    ([saveKey, save]) => {
      localStorage.setItem(saveKey, save);
    },
    [SAVE_STORAGE_KEY, buildSeededSave({ day: 2, money: 15, currentHp: 16, deck: ['倒转'] })] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);

  const poorMorning = await waitForPawnshopPhase(page, 'morning');
  expect(poorMorning.morningAvailability?.rest.enabled).toBe(true);
  expect(poorMorning.morningAvailability?.medicine).toEqual({
    enabled: false,
    reason: 'insufficient_funds',
  });

  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.medicine);
  await expect.poll(async () => (await getPawnshopState(page)).lastToast).toBe('钱不够');
  expect((await getPawnshopState(page)).phase).toBe('morning');

  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.rest);
  const afterRest = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterRest.currentHp).toBe(26);
  expect(afterRest.dailyCustomerCount).toBe(2);
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  await waitForPawnshopPhase(page, 'negotiating');
  await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  const restSummary = await waitForPawnshopPhase(page, 'summary');
  expect(restSummary.customerIndex).toBe(2);

  // 3) Low HP (16) + money 100 (>=20): medicine gives -20 money, +10 HP, 3 customers
  await page.evaluate(
    ([saveKey, save]) => {
      localStorage.setItem(saveKey, save);
    },
    [SAVE_STORAGE_KEY, buildSeededSave({ day: 2, money: 100, currentHp: 16, deck: ['倒转'] })] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.medicine);

  const afterMed = await waitForPawnshopPhase(page, 'negotiating');
  expect(afterMed.currentHp).toBe(26);
  expect(afterMed.money).toBe(80);
  expect(afterMed.dailyCustomerCount).toBe(3);

  // 4) Ordering: Day 4 morning precedes pact; Day 7 morning precedes boss_preview
  await page.evaluate(
    ([saveKey, save]) => {
      localStorage.setItem(saveKey, save);
    },
    [SAVE_STORAGE_KEY, buildSeededSave({ day: 4, money: 100, currentHp: 20, deck: ['倒转'] })] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'pact');

  await page.evaluate(
    ([saveKey, save]) => {
      localStorage.setItem(saveKey, save);
    },
    [
      SAVE_STORAGE_KEY,
      buildSeededSave({ day: 7, money: 100, currentHp: 20, deck: ['倒转'], day4TrimDone: true }),
    ] as const,
  );
  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  await waitForPawnshopPhase(page, 'boss_preview');

  // 5) Multi-viewport layout checks on morning board
  for (const vp of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 800, height: 500 },
  ]) {
    await page.setViewportSize(vp);
    await page.evaluate(
      ([saveKey, save]) => {
        localStorage.setItem(saveKey, save);
      },
      [
        SAVE_STORAGE_KEY,
        buildSeededSave({ day: 7, money: 100, currentHp: 20, deck: ['倒转'], day4TrimDone: true }),
      ] as const,
    );
    await page.reload();
    await waitForPawnshopPhase(page, 'title');
    await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
    await waitForPawnshopPhase(page, 'morning');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.rest);
    const preview = await waitForPawnshopPhase(page, 'boss_preview');
    expect(preview.currentHp).toBe(30);
  }

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 19 修整 1: morning choice persists per day — refresh cannot re-rest or re-buy medicine', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  await page.goto('/?seed=7');
  await page.evaluate(
    ([tutKey, glosKey]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glosKey,
        JSON.stringify(['reputation', 'renqing', 'obsession', 'charge_threshold']),
      );
    },
    [TUTORIAL_STORAGE_KEY, GLOSSARY_STORAGE_KEY] as const,
  );
  const canvas = page.locator('#game-container canvas');

  const seed = async (money: number, currentHp: number) => {
    await page.evaluate(
      ([saveKey, save]) => localStorage.setItem(saveKey, save),
      [SAVE_STORAGE_KEY, buildSeededSave({ day: 2, money, currentHp, deck: ['倒转'] })] as const,
    );
    await page.reload();
    await waitForPawnshopPhase(page, 'title');
    await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  };

  // Rest at 10 HP -> 20 HP, 2 customers; refresh must not offer the board again
  await seed(100, 10);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.rest);
  const rested = await waitForPawnshopPhase(page, 'negotiating');
  expect(rested.currentHp).toBe(20);
  expect(rested.dailyCustomerCount).toBe(2);

  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  const restedAgain = await waitForPawnshopPhase(page, 'negotiating');
  expect(restedAgain.currentHp).toBe(20);
  expect(restedAgain.money).toBe(100);
  expect(restedAgain.dailyCustomerCount).toBe(2);

  // Medicine at 16 HP, money 100 -> 26 HP, 80 money, 3 customers; refresh must not allow another purchase
  await seed(100, 16);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.medicine);
  const bought = await waitForPawnshopPhase(page, 'negotiating');
  expect(bought.currentHp).toBe(26);
  expect(bought.money).toBe(80);

  await page.reload();
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  const boughtAgain = await waitForPawnshopPhase(page, 'negotiating');
  expect(boughtAgain.currentHp).toBe(26);
  expect(boughtAgain.money).toBe(80);
  expect(boughtAgain.dailyCustomerCount).toBe(3);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('Task 19 修整 2: 欠条 first seen on a later draw auto-shows the glossary tip once', async ({
  page,
}) => {
  const { pageErrors, failedRequests } = trackErrors(page);
  await page.goto('/?seed=7&demon=a');
  await page.evaluate(
    ([saveKey, tutKey, glosKey, save]) => {
      localStorage.setItem(tutKey, '1');
      localStorage.setItem(
        glosKey,
        JSON.stringify(['reputation', 'renqing', 'obsession', 'charge_threshold']),
      );
      localStorage.setItem(saveKey, save);
    },
    [
      SAVE_STORAGE_KEY,
      TUTORIAL_STORAGE_KEY,
      GLOSSARY_STORAGE_KEY,
      buildSeededSave({
        day: 2,
        money: 100,
        currentHp: 30,
        deck: ['欠条', '秤砣', '秤砣', '秤砣', '秤砣', '秤砣'],
      }),
    ] as const,
  );
  await page.reload();

  const canvas = page.locator('#game-container canvas');
  await waitForPawnshopPhase(page, 'title');
  await clickLogical(page, canvas, TITLE_CONTINUE_BUTTON);
  await waitForPawnshopPhase(page, 'morning');
  await clickLogical(page, canvas, MORNING_OPTION_BUTTONS.work);
  for (let i = 0; i < 3; i += 1) {
    await waitForPawnshopPhase(page, 'negotiating');
    await clickLogical(page, canvas, PAWNSHOP_SKIP_BUTTON);
  }
  await waitForPawnshopPhase(page, 'summary');
  await clickLogical(page, canvas, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON);

  const start = await waitForBattleReady(page, 'play');
  expect(start.hand).not.toContain('欠条');
  expect(start.lastGlossaryTip ?? null).toBeNull();

  await clickLogical(page, canvas, BATTLE_END_TURN_BUTTON);
  await expect
    .poll(async () => {
      const s = await getBattleState(page);
      return !s.isAnimating && s.round === 2;
    })
    .toBe(true);
  const round2 = await getBattleState(page);
  expect(round2.hand).toContain('欠条');
  expect(round2.lastGlossaryTip).toBe('欠条：输夜留下的债，占一张手牌，打不出去');
  const seen = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]') as string[], GLOSSARY_STORAGE_KEY);
  expect(seen.filter((id) => id === 'debt_note')).toHaveLength(1);

  expect(failedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
