import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import type { BattleBalanceConfig, CardDef, DemonDef } from '../../src/game/battle';
import {
  checkSimGuardrails,
  formatSimReport,
  parseSimTuneEnv,
  runBalanceSimulation,
  runMonteCarlo,
  simulateSevenDayEconomy,
  TEST_DECK,
} from '../../src/game/montecarlo';

const CARDS = cardsJson as CardDef[];
const DEMONS = demonsJson as DemonDef[];
const BALANCE: BattleBalanceConfig = {
  startingHp: balanceJson.startingHp,
  startingRenqing: balanceJson.startingRenqing,
  maxRenqing: balanceJson.maxRenqing,
  drawFirst: balanceJson.drawFirst,
  drawPerRound: balanceJson.drawPerRound,
  winRewardMoney: balanceJson.winRewardMoney,
};

describe('Monte Carlo battle simulation (1000 runs per demon)', () => {
  it('simulates 1000 seeded runs vs Demons A/B/C/D and verifies all four are killable within 3 rounds', () => {
    const statsA = runMonteCarlo(CARDS, DEMONS, BALANCE, TEST_DECK, 'a', 1000);
    const statsB = runMonteCarlo(CARDS, DEMONS, BALANCE, TEST_DECK, 'b', 1000);
    const statsC = runMonteCarlo(CARDS, DEMONS, BALANCE, TEST_DECK, 'c', 1000);
    const statsD = runMonteCarlo(CARDS, DEMONS, BALANCE, TEST_DECK, 'd', 1000);

    // Output summary for balance observation & reporting
    console.info(
      `[MonteCarlo] Demon A (${statsA.demonName}, HP ${DEMONS[0].hp}): winRate=${(statsA.winRate * 100).toFixed(1)}% (${statsA.wins}/${statsA.runs}), avgEndRound=${statsA.avgEndRound.toFixed(2)}, avgWinHp=${statsA.avgWinRemainingHp.toFixed(2)}, lossesHp=${statsA.lossesHp}, lossesTimeout=${statsA.lossesTimeout}`,
    );
    console.info(
      `[MonteCarlo] Demon B (${statsB.demonName}, HP ${DEMONS[1].hp}): winRate=${(statsB.winRate * 100).toFixed(1)}% (${statsB.wins}/${statsB.runs}), avgEndRound=${statsB.avgEndRound.toFixed(2)}, avgWinHp=${statsB.avgWinRemainingHp.toFixed(2)}, lossesHp=${statsB.lossesHp}, lossesTimeout=${statsB.lossesTimeout}`,
    );
    console.info(
      `[MonteCarlo] Demon C (${statsC.demonName}, HP ${DEMONS[2].hp}): winRate=${(statsC.winRate * 100).toFixed(1)}% (${statsC.wins}/${statsC.runs}), avgEndRound=${statsC.avgEndRound.toFixed(2)}, avgWinHp=${statsC.avgWinRemainingHp.toFixed(2)}, lossesHp=${statsC.lossesHp}, lossesTimeout=${statsC.lossesTimeout}`,
    );
    console.info(
      `[MonteCarlo] Demon D (${statsD.demonName}, HP ${DEMONS[3].hp}): winRate=${(statsD.winRate * 100).toFixed(1)}% (${statsD.wins}/${statsD.runs}), avgEndRound=${statsD.avgEndRound.toFixed(2)}, avgWinHp=${statsD.avgWinRemainingHp.toFixed(2)}, lossesHp=${statsD.lossesHp}, lossesTimeout=${statsD.lossesTimeout}`,
    );

    const demonWinRates = {
      a: statsA.winRate,
      b: statsB.winRate,
      c: statsC.winRate,
      d: statsD.winRate,
    };

    // 7-day economy simulation (P6 B3): compare P5 (20 reward, no redemption) vs P6 (40 reward, +/- redemption)
    const p5Direct = simulateSevenDayEconomy({
      winRewardMoney: 20,
      demonWinRates,
      runs: 1000,
      days: 7,
      tightBuffer: 0,
      enableRedemption: false,
    });
    const p6DirectNoRedeem = simulateSevenDayEconomy({
      winRewardMoney: BALANCE.winRewardMoney,
      demonWinRates,
      runs: 1000,
      days: 7,
      tightBuffer: 0,
      enableRedemption: false,
    });
    const p6DirectWithRedeem = simulateSevenDayEconomy({
      winRewardMoney: BALANCE.winRewardMoney,
      demonWinRates,
      runs: 1000,
      days: 7,
      tightBuffer: 0,
      enableRedemption: true,
      minDeckForRedeem: 4,
    });
    const p5Base = simulateSevenDayEconomy({
      winRewardMoney: 20,
      demonWinRates,
      runs: 1000,
      days: 7,
      tightBuffer: 60,
      enableRedemption: false,
    });
    const p6NoRedeem = simulateSevenDayEconomy({
      winRewardMoney: BALANCE.winRewardMoney,
      demonWinRates,
      runs: 1000,
      days: 7,
      tightBuffer: 60,
      enableRedemption: false,
    });
    const p6WithRedeem = simulateSevenDayEconomy({
      winRewardMoney: BALANCE.winRewardMoney,
      demonWinRates,
      runs: 1000,
      days: 7,
      tightBuffer: 60,
      enableRedemption: true,
      minDeckForRedeem: 4,
    });

    const fmt = (arr: number[]): string => arr.map((v) => v.toFixed(1)).join(' -> ');
    console.info(
      `[7DayEconomy P5 reward=20, tightBuffer=0, noRedeem] avg=[${fmt(p5Direct.avgMoneyByDay)}], freqWinners(${p5Direct.frequentWinnerCount})=[${fmt(p5Direct.frequentWinnerAvgByDay)}]`,
    );
    console.info(
      `[7DayEconomy P6 reward=40, tightBuffer=0, noRedeem] avg=[${fmt(p6DirectNoRedeem.avgMoneyByDay)}], freqWinners(${p6DirectNoRedeem.frequentWinnerCount})=[${fmt(p6DirectNoRedeem.frequentWinnerAvgByDay)}]`,
    );
    console.info(
      `[7DayEconomy P6 reward=40, tightBuffer=0, withRedeem] avg=[${fmt(p6DirectWithRedeem.avgMoneyByDay)}], freqWinners(${p6DirectWithRedeem.frequentWinnerCount})=[${fmt(p6DirectWithRedeem.frequentWinnerAvgByDay)}]`,
    );
    console.info(
      `[7DayEconomy P5 reward=20, tightBuffer=60, noRedeem] avg=[${fmt(p5Base.avgMoneyByDay)}], freqWinners(${p5Base.frequentWinnerCount})=[${fmt(p5Base.frequentWinnerAvgByDay)}]`,
    );
    console.info(
      `[7DayEconomy P6 reward=40, tightBuffer=60, noRedeem] avg=[${fmt(p6NoRedeem.avgMoneyByDay)}], freqWinners(${p6NoRedeem.frequentWinnerCount})=[${fmt(p6NoRedeem.frequentWinnerAvgByDay)}]`,
    );
    console.info(
      `[7DayEconomy P6 reward=40, tightBuffer=60, withRedeem] avg=[${fmt(p6WithRedeem.avgMoneyByDay)}], freqWinners(${p6WithRedeem.frequentWinnerCount})=[${fmt(p6WithRedeem.frequentWinnerAvgByDay)}], avgRedeem=${p6WithRedeem.avgRedemptionsAccepted.toFixed(2)}`,
    );

    // Frequent winners in P6 must escape the 20-gold loop and accumulate money cleanly above P5
    expect(p6DirectNoRedeem.frequentWinnerAvgByDay[6]).toBeGreaterThan(
      p5Direct.frequentWinnerAvgByDay[6],
    );
    expect(p6NoRedeem.frequentWinnerAvgByDay[6]).toBeGreaterThan(p5Base.frequentWinnerAvgByDay[6]);
    expect(p6NoRedeem.frequentWinnerAvgByDay[6]).toBeGreaterThan(80);
    expect(p6WithRedeem.frequentWinnerAvgByDay[6]).toBeGreaterThan(
      p6NoRedeem.frequentWinnerAvgByDay[6],
    );

    for (const stats of [statsA, statsB, statsC, statsD]) {
      expect(stats.runs).toBe(1000);
      expect(stats.wins + stats.lossesHp + stats.lossesTimeout).toBe(1000);
      expect(stats.winRate).toBeGreaterThan(0);
      expect(stats.winRate).toBeLessThanOrEqual(1);
      expect(stats.avgEndRound).toBeGreaterThanOrEqual(1);
      expect(stats.avgEndRound).toBeLessThanOrEqual(3);
      expect(stats.avgWinRemainingHp).toBeGreaterThan(0);
      expect(stats.avgWinRemainingHp).toBeLessThanOrEqual(BALANCE.startingHp);
    }

    expect(statsA.demonId).toBe('a');
    expect(statsA.demonName).toBe('药费');
    expect(statsB.demonId).toBe('b');
    expect(statsB.demonName).toBe('车票');
    expect(statsC.demonId).toBe('c');
    expect(statsC.demonName).toBe('房租');
    expect(statsD.demonId).toBe('d');
    expect(statsD.demonName).toBe('学费');
  });

  it('passes P7 sim:check guardrails on baseline data and supports SIM_TUNE hot overrides', () => {
    const baseline = runBalanceSimulation({ runs: 1000 });
    const check = checkSimGuardrails(baseline);
    expect(check.errors).toEqual([]);
    expect(check.passed).toBe(true);

    const text = formatSimReport(baseline);
    expect(text).toContain('心魔 A');
    expect(text).toContain('中位现金流');
    expect(text).toContain('平均赎当次数');

    const parsed = parseSimTuneEnv('{"demonAHp":22,"runs":200}');
    expect(parsed).toEqual({ demonAHp: 22, runs: 200 });
    const tuned = runBalanceSimulation(parsed);
    expect(tuned.demons[0].winRate).toBeLessThan(baseline.demons[0].winRate);

    // Guardrail fails when a demon HP is tuned to an impossible value
    const broken = runBalanceSimulation({ demonAHp: 999, runs: 100 });
    const brokenCheck = checkSimGuardrails(broken);
    expect(brokenCheck.passed).toBe(false);
    expect(brokenCheck.errors.some((e) => e.includes('Demon A'))).toBe(true);
  });
});
