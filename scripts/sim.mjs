#!/usr/bin/env node
import { createServer } from 'vite';

const isCheck = process.argv.includes('--check');

const server = await createServer({
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
});

try {
  const mod = await server.ssrLoadModule('/src/game/montecarlo.ts');
  const rawTune = process.env.SIM_TUNE;
  const overrides = mod.parseSimTuneEnv(rawTune);
  const report = mod.runBalanceSimulation(overrides);
  console.log(mod.formatSimReport(report));

  if (isCheck) {
    const check = mod.checkSimGuardrails(report);
    if (!check.passed) {
      console.error('\n[sim:check] FAILED guardrail assertions:');
      for (const err of check.errors) {
        console.error(`  - ${err}`);
      }
      process.exitCode = 1;
    } else {
      console.log('\n[sim:check] PASSED all balance guardrails.');
    }
  }
} catch (error) {
  console.error('[sim] Error:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await server.close();
}
