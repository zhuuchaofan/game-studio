import { describe, expect, it, vi } from 'vitest';
import {
  ALL_SFX_NAMES,
  AudioEngine,
  BGM_LOOKAHEAD_SEC,
  BGM_SCORES,
  DEFAULT_MASTER_VOLUME,
  ZZFX_SFX_RECIPES,
  zzfxBuildSamples,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextLike,
  type GainNodeLike,
  type OscillatorNodeLike,
} from '../../src/game/audio';
import { AUDIO_STORAGE_KEY, loadAudioMuted, saveAudioMuted, type StorageLike } from '../../src/game/save';

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
  };
}

interface MockAudioEnv {
  ctx: AudioContextLike;
  masterGain: GainNodeLike;
  oscillators: OscillatorNodeLike[];
  bufferSources: AudioBufferSourceNodeLike[];
  resumeSpy: ReturnType<typeof vi.fn>;
  setState: (state: string) => void;
  setTime: (sec: number) => void;
}

function createMockAudioEnv(initialState = 'suspended'): MockAudioEnv {
  let state = initialState;
  let manualTime: number | null = null;
  const startNow = Date.now();
  const oscillators: OscillatorNodeLike[] = [];
  const bufferSources: AudioBufferSourceNodeLike[] = [];
  const gains: GainNodeLike[] = [];
  const resumeSpy = vi.fn(() => {
    state = 'running';
    return Promise.resolve();
  });

  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: vi.fn(function (this: { value: number }, v: number) {
      this.value = v;
    }),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });

  const ctx: AudioContextLike = {
    sampleRate: 44100,
    get currentTime() {
      return manualTime !== null ? manualTime : 1.0 + (Date.now() - startNow) / 1000;
    },
    get state() {
      return state;
    },
    destination: { connect: vi.fn() },
    createGain: () => {
      const g: GainNodeLike = {
        gain: makeParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      gains.push(g);
      return g;
    },
    createOscillator: () => {
      const osc: OscillatorNodeLike = {
        type: 'square',
        frequency: makeParam(440),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      oscillators.push(osc);
      return osc;
    },
    createBuffer: (_channels: number, length: number): AudioBufferLike => {
      const data = new Float32Array(length);
      return {
        getChannelData: () => data,
      };
    },
    createBufferSource: () => {
      const src: AudioBufferSourceNodeLike = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      bufferSources.push(src);
      return src;
    },
    resume: resumeSpy,
    close: vi.fn(() => Promise.resolve()),
  };

  return {
    ctx,
    get masterGain() {
      return gains[0];
    },
    oscillators,
    bufferSources,
    resumeSpy,
    setState: (next: string) => {
      state = next;
    },
    setTime: (sec: number) => {
      manualTime = sec;
    },
  };
}

describe('AudioEngine state machine, Lookahead BGM & ZzFX synthesis', () => {
  it('defaults to unmuted with quiet master volume and persists mute state in storage', () => {
    const storage = createMemoryStorage();
    const env = createMockAudioEnv();
    const engine = new AudioEngine({
      storage,
      createAudioContext: () => env.ctx,
    });

    expect(engine.isMuted()).toBe(false);
    expect(engine.getVolume()).toBe(DEFAULT_MASTER_VOLUME);
    expect(engine.getVolume()).toBeGreaterThanOrEqual(0.15);
    expect(engine.getVolume()).toBeLessThanOrEqual(0.25);
    expect(engine.getEffectiveGain()).toBe(DEFAULT_MASTER_VOLUME);
    expect(engine.isUnlocked()).toBe(false);
    expect(engine.getCurrentTrack()).toBeNull();

    const afterFirstToggle = engine.toggleMute();
    expect(afterFirstToggle).toBe(true);
    expect(engine.isMuted()).toBe(true);
    expect(engine.getEffectiveGain()).toBe(0);
    expect(env.masterGain.gain.value).toBe(0);
    expect(storage.store.get(AUDIO_STORAGE_KEY)).toBe('1');
    expect(loadAudioMuted(storage)).toBe(true);

    const reloaded = new AudioEngine({
      storage,
      createAudioContext: () => null,
    });
    expect(reloaded.isMuted()).toBe(true);
    expect(reloaded.getEffectiveGain()).toBe(0);

    const afterSecondToggle = engine.toggleMute();
    expect(afterSecondToggle).toBe(false);
    expect(engine.isMuted()).toBe(false);
    expect(engine.getEffectiveGain()).toBe(DEFAULT_MASTER_VOLUME);
    expect(env.masterGain.gain.value).toBe(DEFAULT_MASTER_VOLUME);
    expect(storage.store.get(AUDIO_STORAGE_KEY)).toBe('0');

    saveAudioMuted(false, storage);
    expect(loadAudioMuted(storage)).toBe(false);

    engine.dispose();
  });

  it('respects browser autoplay policy: does not create AudioContext before unlock()', () => {
    const storage = createMemoryStorage();
    const createSpy = vi.fn(() => createMockAudioEnv().ctx);
    const engine = new AudioEngine({
      storage,
      createAudioContext: createSpy,
    });

    engine.playBgm('day');
    engine.playSfx('button_click');
    expect(createSpy).not.toHaveBeenCalled();
    expect(engine.getCurrentTrack()).toBe('day');
    expect(engine.isBgmPlaying()).toBe(false);
    expect(engine.getDebugState().sfxLog).toEqual(['button_click']);

    engine.unlock();
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(engine.isUnlocked()).toBe(true);
    expect(engine.isBgmPlaying()).toBe(true);
    expect(engine.getDebugState().contextAvailable).toBe(true);

    engine.dispose();
  });

  it('clamps volume to [0, 1] and updates master gain immediately when unmuted', () => {
    const storage = createMemoryStorage();
    const env = createMockAudioEnv('running');
    const engine = new AudioEngine({
      storage,
      createAudioContext: () => env.ctx,
    });

    engine.unlock();
    engine.setVolume(0.5);
    expect(engine.getVolume()).toBe(0.5);
    expect(env.masterGain.gain.value).toBe(0.5);

    engine.setVolume(2.5);
    expect(engine.getVolume()).toBe(1);
    expect(env.masterGain.gain.value).toBe(1);

    engine.setVolume(-0.4);
    expect(engine.getVolume()).toBe(0);
    expect(env.masterGain.gain.value).toBe(0);

    engine.setVolume(0.22);
    engine.setMuted(true);
    expect(engine.getVolume()).toBe(0.22);
    expect(engine.getEffectiveGain()).toBe(0);
    expect(env.masterGain.gain.value).toBe(0);

    engine.dispose();
  });

  it('schedules BGM with 100ms ctx.currentTime lookahead without timing drift', () => {
    vi.useFakeTimers();
    try {
      const storage = createMemoryStorage();
      const env = createMockAudioEnv('running');
      env.setTime(10.0);

      const engine = new AudioEngine({
        storage,
        createAudioContext: () => env.ctx,
      });

      expect(BGM_LOOKAHEAD_SEC).toBe(0.1);
      engine.unlock();
      engine.playBgm('day');

      // Step 0 starts at exact 10.0
      const stepSec = BGM_SCORES.day.stepMs / 1000;
      const startTimes = (): number[] =>
        env.oscillators.map((osc) => (osc.start as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as number);
      expect(startTimes()[0]).toBeCloseTo(10.0, 5);

      // Advance audio clock into the lookahead window for step 2 (10.0 + 2*stepSec = 10.52; at 10.45 it is within 100ms lookahead!)
      env.setTime(10.45);
      vi.advanceTimersByTime(30);

      const uniqueStarts = [...new Set(startTimes().map((t) => Number(t.toFixed(4))))].sort((a, b) => a - b);
      // Step 0 (10.00) and Step 2 (10.52) both have notes; spacing is exact multiple of stepSec despite irregular tick at 10.45
      expect(uniqueStarts).toContain(10);
      expect(uniqueStarts).toContain(Number((10 + stepSec * 2).toFixed(4)));

      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches between day and night BGM tracks cleanly and silences all output when muted', () => {
    vi.useFakeTimers();
    try {
      const storage = createMemoryStorage();
      const env = createMockAudioEnv('running');
      const engine = new AudioEngine({
        storage,
        createAudioContext: () => env.ctx,
      });

      engine.unlock();
      engine.playBgm('day');
      expect(engine.getCurrentTrack()).toBe('day');
      expect(engine.isBgmPlaying()).toBe(true);
      const dayStartOscCount = env.oscillators.length;
      expect(dayStartOscCount).toBeGreaterThan(0);

      vi.advanceTimersByTime(BGM_SCORES.day.stepMs * 2);
      expect(env.oscillators.length).toBeGreaterThan(dayStartOscCount);

      engine.playBgm('night');
      expect(engine.getCurrentTrack()).toBe('night');
      expect(engine.isBgmPlaying()).toBe(true);
      const nightOscCount = env.oscillators.length;
      vi.advanceTimersByTime(BGM_SCORES.night.stepMs * 2);
      expect(env.oscillators.length).toBeGreaterThan(nightOscCount);

      engine.setMuted(true);
      expect(env.masterGain.gain.value).toBe(0);
      expect(engine.isBgmPlaying()).toBe(false);
      const mutedOscSnapshot = env.oscillators.length;
      const mutedBufSnapshot = env.bufferSources.length;

      vi.advanceTimersByTime(2000);
      engine.playSfx('play_card');
      engine.playSfx('hit_demon');
      expect(env.oscillators.length).toBe(mutedOscSnapshot);
      expect(env.bufferSources.length).toBe(mutedBufSnapshot);
      expect(engine.getDebugState().audibleSfxCount).toBe(0);
      expect(engine.getDebugState().sfxCounts.play_card).toBe(1);
      expect(engine.getDebugState().sfxCounts.hit_demon).toBe(1);

      engine.setMuted(false);
      expect(env.masterGain.gain.value).toBe(DEFAULT_MASTER_VOLUME);
      expect(engine.isBgmPlaying()).toBe(true);
      expect(engine.getCurrentTrack()).toBe('night');
      const beforeSfx = env.oscillators.length;
      engine.playSfx('deal_closed');
      expect(env.oscillators.length).toBeGreaterThan(beforeSfx);
      expect(engine.getDebugState().audibleSfxCount).toBe(1);

      engine.stopBgm();
      expect(engine.getCurrentTrack()).toBeNull();
      expect(engine.isBgmPlaying()).toBe(false);

      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('synthesizes all 11 SFX recipes (5 classic + 6 ZzFX) with non-silent PCM buffers', () => {
    const storage = createMemoryStorage();
    const env = createMockAudioEnv('running');
    const engine = new AudioEngine({
      storage,
      createAudioContext: () => env.ctx,
    });

    engine.unlock();

    const newZzfxNames = [
      'hit_demon',
      'shield_block',
      'player_hurt',
      'offer_rejected',
      'insufficient_funds',
      'redeem_deal',
    ] as const;

    // Verify ZzFX sample synthesis produces valid finite non-zero waveforms for all 6 new recipes
    for (const name of newZzfxNames) {
      const samples = zzfxBuildSamples(ZZFX_SFX_RECIPES[name], 44100, () => 0.5);
      expect(samples.length, `ZzFX "${name}" must have non-empty samples`).toBeGreaterThan(500);
      let maxAbs = 0;
      for (let i = 0; i < samples.length; i += 1) {
        expect(Number.isFinite(samples[i])).toBe(true);
        const a = Math.abs(samples[i]);
        if (a > maxAbs) maxAbs = a;
      }
      expect(maxAbs, `ZzFX "${name}" must not be silent`).toBeGreaterThan(0.05);
    }

    for (const name of ALL_SFX_NAMES) {
      const beforeTotal = env.oscillators.length + env.bufferSources.length;
      engine.playSfx(name);
      expect(
        env.oscillators.length + env.bufferSources.length,
        `SFX "${name}" should emit audio nodes`,
      ).toBeGreaterThan(beforeTotal);
    }

    expect(env.bufferSources.length).toBe(newZzfxNames.length);
    const debug = engine.getDebugState();
    expect(debug.sfxLog).toEqual([...ALL_SFX_NAMES]);
    expect(debug.audibleSfxCount).toBe(ALL_SFX_NAMES.length);

    engine.dispose();
  });

  it('degrades silently with zero crashes when AudioContext is unavailable or throws', () => {
    vi.useFakeTimers();
    try {
      const storage = createMemoryStorage();

      const noCtxEngine = new AudioEngine({
        storage,
        createAudioContext: () => null,
      });

      expect(() => {
        noCtxEngine.unlock();
        noCtxEngine.playBgm('day');
        vi.advanceTimersByTime(1000);
        noCtxEngine.playBgm('night');
        vi.advanceTimersByTime(1000);
        for (const sfx of ALL_SFX_NAMES) {
          noCtxEngine.playSfx(sfx);
        }
        noCtxEngine.setVolume(0.3);
        noCtxEngine.toggleMute();
        noCtxEngine.toggleMute();
        noCtxEngine.stopBgm();
        noCtxEngine.dispose();
      }).not.toThrow();

      expect(noCtxEngine.getDebugState().contextAvailable).toBe(false);
      expect(noCtxEngine.getDebugState().sfxCounts.redeem_deal).toBe(1);

      const throwingEngine = new AudioEngine({
        storage,
        createAudioContext: () => {
          throw new Error('AudioContext blocked');
        },
      });

      expect(() => {
        throwingEngine.unlock();
        throwingEngine.playBgm('day');
        throwingEngine.playSfx('hit_demon');
        throwingEngine.toggleMute();
        throwingEngine.dispose();
      }).not.toThrow();

      expect(throwingEngine.getDebugState().contextAvailable).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
