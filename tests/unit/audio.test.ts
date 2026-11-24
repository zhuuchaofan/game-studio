import { describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  BGM_SCORES,
  DEFAULT_MASTER_VOLUME,
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
  resumeSpy: ReturnType<typeof vi.fn>;
  setState: (state: string) => void;
}

function createMockAudioEnv(initialState = 'suspended'): MockAudioEnv {
  let state = initialState;
  const oscillators: OscillatorNodeLike[] = [];
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
    get currentTime() {
      return 1.0;
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
    resume: resumeSpy,
    close: vi.fn(() => Promise.resolve()),
  };

  return {
    ctx,
    get masterGain() {
      return gains[0];
    },
    oscillators,
    resumeSpy,
    setState: (next: string) => {
      state = next;
    },
  };
}

describe('AudioEngine state machine & WebAudio synthesis', () => {
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

    // Toggling mute unlocks and persists muted=true
    const afterFirstToggle = engine.toggleMute();
    expect(afterFirstToggle).toBe(true);
    expect(engine.isMuted()).toBe(true);
    expect(engine.getEffectiveGain()).toBe(0);
    expect(env.masterGain.gain.value).toBe(0);
    expect(storage.store.get(AUDIO_STORAGE_KEY)).toBe('1');
    expect(loadAudioMuted(storage)).toBe(true);

    // Reloading a fresh engine reads persisted muted=true
    const reloaded = new AudioEngine({
      storage,
      createAudioContext: () => null,
    });
    expect(reloaded.isMuted()).toBe(true);
    expect(reloaded.getEffectiveGain()).toBe(0);

    // Toggling back ON restores master gain and persists '0'
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

    // Requesting BGM or SFX before user gesture must NOT create AudioContext
    engine.playBgm('day');
    engine.playSfx('button_click');
    expect(createSpy).not.toHaveBeenCalled();
    expect(engine.getCurrentTrack()).toBe('day');
    expect(engine.isBgmPlaying()).toBe(false);
    expect(engine.getDebugState().sfxLog).toEqual(['button_click']);

    // Once user gesture calls unlock(), AudioContext is created, resumed, and queued BGM starts
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

    // Muting keeps stored volume while driving effective gain & AudioNode gain to 0
    engine.setVolume(0.22);
    engine.setMuted(true);
    expect(engine.getVolume()).toBe(0.22);
    expect(engine.getEffectiveGain()).toBe(0);
    expect(env.masterGain.gain.value).toBe(0);

    engine.dispose();
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

      // Stepping forward schedules more day chiptune notes
      vi.advanceTimersByTime(BGM_SCORES.day.stepMs * 2);
      expect(env.oscillators.length).toBeGreaterThan(dayStartOscCount);

      // Switch to night track
      engine.playBgm('night');
      expect(engine.getCurrentTrack()).toBe('night');
      expect(engine.isBgmPlaying()).toBe(true);
      const nightOscCount = env.oscillators.length;
      vi.advanceTimersByTime(BGM_SCORES.night.stepMs * 2);
      expect(env.oscillators.length).toBeGreaterThan(nightOscCount);

      // Muting silences master gain, halts BGM loop, and blocks SFX synthesis
      engine.setMuted(true);
      expect(env.masterGain.gain.value).toBe(0);
      expect(engine.isBgmPlaying()).toBe(false);
      const mutedOscSnapshot = env.oscillators.length;

      vi.advanceTimersByTime(2000);
      engine.playSfx('play_card');
      engine.playSfx('demon_defeated');
      expect(env.oscillators.length).toBe(mutedOscSnapshot);
      expect(engine.getDebugState().audibleSfxCount).toBe(0);
      expect(engine.getDebugState().sfxCounts.play_card).toBe(1);
      expect(engine.getDebugState().sfxCounts.demon_defeated).toBe(1);

      // Unmuting resumes the remembered night track and re-enables SFX
      engine.setMuted(false);
      expect(env.masterGain.gain.value).toBe(DEFAULT_MASTER_VOLUME);
      expect(engine.isBgmPlaying()).toBe(true);
      expect(engine.getCurrentTrack()).toBe('night');
      const beforeSfx = env.oscillators.length;
      engine.playSfx('deal_closed');
      expect(env.oscillators.length).toBeGreaterThan(beforeSfx);
      expect(engine.getDebugState().audibleSfxCount).toBe(1);

      // Stopping BGM clears current track and interval
      engine.stopBgm();
      expect(engine.getCurrentTrack()).toBeNull();
      expect(engine.isBgmPlaying()).toBe(false);

      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('synthesizes all 5 SFX recipes when unlocked and unmuted', () => {
    const storage = createMemoryStorage();
    const env = createMockAudioEnv('running');
    const engine = new AudioEngine({
      storage,
      createAudioContext: () => env.ctx,
    });

    engine.unlock();

    const sfxList = [
      'button_click',
      'play_card',
      'receive_card',
      'deal_closed',
      'demon_defeated',
    ] as const;

    for (const name of sfxList) {
      const before = env.oscillators.length;
      engine.playSfx(name);
      expect(env.oscillators.length, `SFX "${name}" should synthesize notes`).toBeGreaterThan(before);
    }

    const debug = engine.getDebugState();
    expect(debug.sfxLog).toEqual([...sfxList]);
    expect(debug.lastSfx).toBe('demon_defeated');
    expect(debug.audibleSfxCount).toBe(5);

    engine.dispose();
  });

  it('degrades silently with zero crashes when AudioContext is unavailable or throws', () => {
    vi.useFakeTimers();
    try {
      const storage = createMemoryStorage();

      // Case 1: AudioContext returns null (Node / headless / unsupported browser)
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
        noCtxEngine.playSfx('button_click');
        noCtxEngine.playSfx('play_card');
        noCtxEngine.playSfx('receive_card');
        noCtxEngine.playSfx('deal_closed');
        noCtxEngine.playSfx('demon_defeated');
        noCtxEngine.setVolume(0.3);
        noCtxEngine.toggleMute();
        noCtxEngine.toggleMute();
        noCtxEngine.stopBgm();
        noCtxEngine.dispose();
      }).not.toThrow();

      expect(noCtxEngine.getDebugState().contextAvailable).toBe(false);
      expect(noCtxEngine.getDebugState().sfxCounts.demon_defeated).toBe(1);

      // Case 2: AudioContext constructor throws
      const throwingEngine = new AudioEngine({
        storage,
        createAudioContext: () => {
          throw new Error('AudioContext blocked');
        },
      });

      expect(() => {
        throwingEngine.unlock();
        throwingEngine.playBgm('day');
        throwingEngine.playSfx('deal_closed');
        throwingEngine.toggleMute();
        throwingEngine.dispose();
      }).not.toThrow();

      expect(throwingEngine.getDebugState().contextAvailable).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
