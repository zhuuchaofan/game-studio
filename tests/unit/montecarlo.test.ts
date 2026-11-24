import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import type { BattleBalanceConfig, CardDef, DemonDef } from '../../src/game/battle';
import { runMonteCarlo, TEST_DECK } from '../../src/game/montecarlo';

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
      `[MonteCarlo] Demon A (${statsA.demonName}, HP 24): winRate=${(statsA.winRate * 100).toFixed(1)}% (${statsA.wins}/${statsA.runs}), avgEndRound=${statsA.avgEndRound.toFixed(2)}, avgWinHp=${statsA.avgWinRemainingHp.toFixed(2)}, lossesHp=${statsA.lossesHp}, lossesTimeout=${statsA.lossesTimeout}`,
    );
    console.info(
      `[MonteCarlo] Demon B (${statsB.demonName}, HP 22): winRate=${(statsB.winRate * 100).toFixed(1)}% (${statsB.wins}/${statsB.runs}), avgEndRound=${statsB.avgEndRound.toFixed(2)}, avgWinHp=${statsB.avgWinRemainingHp.toFixed(2)}, lossesHp=${statsB.lossesHp}, lossesTimeout=${statsB.lossesTimeout}`,
    );
    console.info(
      `[MonteCarlo] Demon C (${statsC.demonName}, HP 26): winRate=${(statsC.winRate * 100).toFixed(1)}% (${statsC.wins}/${statsC.runs}), avgEndRound=${statsC.avgEndRound.toFixed(2)}, avgWinHp=${statsC.avgWinRemainingHp.toFixed(2)}, lossesHp=${statsC.lossesHp}, lossesTimeout=${statsC.lossesTimeout}`,
    );
    console.info(
      `[MonteCarlo] Demon D (${statsD.demonName}, HP 20): winRate=${(statsD.winRate * 100).toFixed(1)}% (${statsD.wins}/${statsD.runs}), avgEndRound=${statsD.avgEndRound.toFixed(2)}, avgWinHp=${statsD.avgWinRemainingHp.toFixed(2)}, lossesHp=${statsD.lossesHp}, lossesTimeout=${statsD.lossesTimeout}`,
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
});
