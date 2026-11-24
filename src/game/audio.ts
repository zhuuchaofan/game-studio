import { loadAudioMuted, saveAudioMuted, type StorageLike } from './save';

export type BgmTrack = 'day' | 'night';

export type SfxName =
  | 'play_card'
  | 'receive_card'
  | 'deal_closed'
  | 'demon_defeated'
  | 'button_click';

export const DEFAULT_MASTER_VOLUME = 0.2;

export interface AudioParamLike {
  value: number;
  setValueAtTime?: (value: number, startTime: number) => void;
  linearRampToValueAtTime?: (value: number, endTime: number) => void;
  exponentialRampToValueAtTime?: (value: number, endTime: number) => void;
  cancelScheduledValues?: (cancelTime: number) => void;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike | void;
  disconnect?: () => void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  frequency: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
  onended?: (() => void) | null;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  resume(): Promise<void> | void;
  close?: () => Promise<void> | void;
}

export interface TimerLike {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

export interface BgmTrackScore {
  readonly stepMs: number;
  readonly lead: readonly number[];
  readonly bass: readonly number[];
}

export interface AudioDebugSnapshot {
  muted: boolean;
  volume: number;
  effectiveGain: number;
  currentTrack: BgmTrack | null;
  unlocked: boolean;
  contextAvailable: boolean;
  isPlayingBgm: boolean;
  sfxLog: SfxName[];
  audibleSfxCount: number;
  sfxCounts: Record<SfxName, number>;
  lastSfx: SfxName | null;
}

export interface AudioDebugHook {
  getState: () => AudioDebugSnapshot;
}

declare global {
  interface Window {
    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    __AUDIO_DEBUG__?: AudioDebugHook;
    webkitAudioContext?: new () => AudioContextLike;
  }
}

export interface AudioEngineOptions {
  storage?: StorageLike | null;
  createAudioContext?: () => AudioContextLike | null;
  timers?: TimerLike;
  defaultVolume?: number;
}

// Note frequencies in Hz (equal temperament, 0 = rest)
const N = {
  _: 0,
  D2: 73.42,
  E2: 82.41,
  F2: 87.31,
  G2: 98.0,
  Gs2: 103.83,
  A2: 110.0,
  C3: 130.81,
  D3: 146.83,
  E3: 164.81,
  G3: 196.0,
  Gs4: 415.3,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880.0,
  B5: 987.77,
  C6: 1046.5,
  E6: 1318.51,
  B6: 1975.53,
} as const;

/**
 * Two 8-bit chiptune loops:
 * - day: warm C-pentatonic pawnshop stroll (~115 BPM)
 * - night: tense A-minor nocturnal card battle (~136 BPM)
 */
export const BGM_SCORES: Record<BgmTrack, BgmTrackScore> = {
  day: {
    stepMs: 260,
    lead: [
      N.C5, N._, N.E5, N.G5, N.A5, N._, N.G5, N.E5,
      N.D5, N.E5, N.G5, N._, N.E5, N.D5, N.C5, N._,
      N.A4, N.C5, N.D5, N.E5, N.G5, N._, N.E5, N.D5,
      N.E5, N._, N.D5, N.C5, N.D5, N._, N.C5, N._,
    ],
    bass: [
      N.C3, N._, N.G3, N._, N.A2, N._, N.E3, N._,
      N.D3, N._, N.G2, N._, N.C3, N._, N.G2, N._,
      N.F2, N._, N.C3, N._, N.G2, N._, N.D3, N._,
      N.A2, N._, N.G2, N._, N.C3, N._, N.G2, N._,
    ],
  },
  night: {
    stepMs: 220,
    lead: [
      N.A4, N._, N.C5, N.B4, N.A4, N._, N.E5, N._,
      N.D5, N.C5, N.B4, N._, N.Gs4, N._, N.B4, N._,
      N.A4, N._, N.C5, N.E5, N.F5, N._, N.E5, N.D5,
      N.C5, N.B4, N.A4, N.Gs4, N.A4, N._, N._, N._,
    ],
    bass: [
      N.A2, N.A2, N._, N.E2, N.A2, N._, N.E2, N._,
      N.D2, N._, N.F2, N._, N.E2, N._, N.E2, N._,
      N.A2, N.A2, N._, N.E2, N.F2, N._, N.D2, N._,
      N.E2, N._, N.Gs2, N._, N.A2, N._, N.E2, N._,
    ],
  },
};

function defaultCreateAudioContext(): AudioContextLike | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    const Ctor =
      (window.AudioContext as unknown as (new () => AudioContextLike) | undefined) ??
      window.webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    return new Ctor();
  } catch {
    return null;
  }
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MASTER_VOLUME;
  }
  return Math.max(0, Math.min(1, value));
}

function createEmptySfxCounts(): Record<SfxName, number> {
  return {
    play_card: 0,
    receive_card: 0,
    deal_closed: 0,
    demon_defeated: 0,
    button_click: 0,
  };
}

interface SynthNoteSpec {
  type: OscillatorType;
  freq: number;
  endFreq?: number;
  offsetSec: number;
  durationSec: number;
  gain: number;
}

const SFX_RECIPES: Record<SfxName, readonly SynthNoteSpec[]> = {
  // 点按钮：短促清脆 8-bit 按钮滴答
  button_click: [
    { type: 'square', freq: 660, endFreq: 880, offsetSec: 0, durationSec: 0.045, gain: 0.35 },
  ],
  // 出牌：牌飞向目标的 8-bit 上扬音阶
  play_card: [
    { type: 'square', freq: 330, offsetSec: 0, durationSec: 0.045, gain: 0.32 },
    { type: 'square', freq: 493.88, offsetSec: 0.04, durationSec: 0.05, gain: 0.34 },
    { type: 'triangle', freq: 659.25, offsetSec: 0.08, durationSec: 0.075, gain: 0.4 },
  ],
  // 收牌：获得新牌的柔和三音上行琶音
  receive_card: [
    { type: 'triangle', freq: N.C5, offsetSec: 0, durationSec: 0.06, gain: 0.42 },
    { type: 'square', freq: N.E5, offsetSec: 0.055, durationSec: 0.06, gain: 0.28 },
    { type: 'triangle', freq: N.G5, offsetSec: 0.11, durationSec: 0.11, gain: 0.44 },
  ],
  // 成交：当铺落槌收钱的温暖双音叮当
  deal_closed: [
    { type: 'square', freq: N.E5, offsetSec: 0, durationSec: 0.065, gain: 0.32 },
    { type: 'square', freq: N.B5, offsetSec: 0.06, durationSec: 0.075, gain: 0.34 },
    { type: 'triangle', freq: N.E6, offsetSec: 0.125, durationSec: 0.13, gain: 0.42 },
  ],
  // 击败：GDD 第 95 行心魔碎成像素点配清脆“叮”声
  demon_defeated: [
    { type: 'square', freq: N.E5, offsetSec: 0, durationSec: 0.055, gain: 0.28 },
    { type: 'square', freq: N.A5, offsetSec: 0.05, durationSec: 0.06, gain: 0.3 },
    { type: 'triangle', freq: N.E6, offsetSec: 0.105, durationSec: 0.28, gain: 0.55 },
    { type: 'square', freq: N.B6, offsetSec: 0.105, durationSec: 0.16, gain: 0.22 },
  ],
};

/**
 * Self-contained WebAudio 8-bit chiptune BGM & SFX engine.
 * - Zero external audio files, zero third-party dependencies.
 * - Respects browser autoplay policy: AudioContext is created/resumed only on user gesture.
 * - Degrades silently when AudioContext is unavailable (headless / legacy / Node environments).
 */
export class AudioEngine {
  private readonly storage: StorageLike | null | undefined;
  private readonly createAudioContextFn: () => AudioContextLike | null;
  private readonly timers: TimerLike;

  private ctx: AudioContextLike | null = null;
  private masterGain: GainNodeLike | null = null;
  private contextAttempted = false;
  private unlocked = false;
  private muted: boolean;
  private volume: number;
  private currentTrack: BgmTrack | null = null;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private stepIndex = 0;

  private sfxLog: SfxName[] = [];
  private audibleSfxCount = 0;
  private sfxCounts: Record<SfxName, number> = createEmptySfxCounts();
  private lastSfx: SfxName | null = null;
  private gestureListenersInstalled = false;

  constructor(options: AudioEngineOptions = {}) {
    this.storage = options.storage;
    this.createAudioContextFn = options.createAudioContext ?? defaultCreateAudioContext;
    this.timers = options.timers ?? {
      setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
      clearInterval: (id) => globalThis.clearInterval(id),
    };
    this.volume = clampVolume(options.defaultVolume ?? DEFAULT_MASTER_VOLUME);
    this.muted = loadAudioMuted(this.storage);
  }

  isMuted(): boolean {
    return this.muted;
  }

  getVolume(): number {
    return this.volume;
  }

  getEffectiveGain(): number {
    return this.muted ? 0 : this.volume;
  }

  getCurrentTrack(): BgmTrack | null {
    return this.currentTrack;
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  isBgmPlaying(): boolean {
    return this.bgmTimer !== null;
  }

  /**
   * Installs capture-phase user-gesture listeners on window so the very first click
   * or key press unlocks WebAudio before scene click handlers play SFX/BGM.
   */
  installGestureUnlock(): void {
    if (this.gestureListenersInstalled || typeof window === 'undefined') {
      return;
    }
    this.gestureListenersInstalled = true;

    const handleGesture = (): void => {
      this.unlock();
      window.removeEventListener('pointerdown', handleGesture, true);
      window.removeEventListener('keydown', handleGesture, true);
    };

    window.addEventListener('pointerdown', handleGesture, true);
    window.addEventListener('keydown', handleGesture, true);
  }

  /**
   * Must be called inside or after a user gesture to satisfy browser autoplay policy.
   * Safe to call repeatedly; silently degrades when WebAudio is unavailable.
   */
  unlock(): void {
    this.unlocked = true;
    this.ensureContext();

    if (this.ctx) {
      this.syncMasterGain();
      try {
        if (this.ctx.state === 'suspended') {
          const maybePromise = this.ctx.resume();
          if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
            (maybePromise as Promise<void>).catch(() => {
              // Ignore autoplay rejection silently
            });
          }
        }
      } catch {
        // Ignore resume errors silently
      }
    }

    if (this.currentTrack !== null && !this.muted && this.bgmTimer === null) {
      this.startBgmLoop();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = Boolean(muted);
    saveAudioMuted(this.muted, this.storage);
    this.syncMasterGain();

    if (this.muted) {
      this.clearBgmTimer();
    } else if (this.unlocked && this.currentTrack !== null && this.bgmTimer === null) {
      this.startBgmLoop();
    }
  }

  toggleMute(): boolean {
    this.unlock();
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    this.syncMasterGain();
  }

  /**
   * Switches to the specified looping chiptune BGM track ('day' or 'night').
   * If audio is not yet unlocked or is muted, remembers the target track so it starts
   * cleanly once unlocked and unmuted.
   */
  playBgm(track: BgmTrack): void {
    if (this.currentTrack === track && this.bgmTimer !== null) {
      return;
    }

    const trackChanged = this.currentTrack !== track;
    this.currentTrack = track;
    if (trackChanged) {
      this.stepIndex = 0;
    }

    this.clearBgmTimer();

    if (this.unlocked && !this.muted) {
      this.startBgmLoop();
    }
  }

  stopBgm(): void {
    this.currentTrack = null;
    this.stepIndex = 0;
    this.clearBgmTimer();
  }

  /**
   * Plays a short synthesized 8-bit sound effect.
   * Always records the trigger in debug state; emits zero audio when muted or unavailable.
   */
  playSfx(name: SfxName): void {
    this.sfxLog.push(name);
    if (this.sfxLog.length > 100) {
      this.sfxLog.shift();
    }
    this.sfxCounts[name] += 1;
    this.lastSfx = name;

    if (this.muted) {
      return;
    }

    this.audibleSfxCount += 1;

    if (!this.unlocked) {
      return;
    }

    this.ensureContext();
    if (!this.ctx || !this.masterGain) {
      return;
    }

    const recipe = SFX_RECIPES[name];
    const baseTime = this.ctx.currentTime;
    for (const note of recipe) {
      this.scheduleNote(note, baseTime);
    }
  }

  /**
   * Stops playback and clears timers. Primarily useful in tests or full teardown.
   */
  dispose(): void {
    this.clearBgmTimer();
    this.currentTrack = null;
    if (this.ctx?.close) {
      try {
        const res = this.ctx.close();
        if (res && typeof (res as Promise<void>).catch === 'function') {
          (res as Promise<void>).catch(() => {});
        }
      } catch {
        // Ignore close errors
      }
    }
    this.ctx = null;
    this.masterGain = null;
  }

  getDebugState(): AudioDebugSnapshot {
    return {
      muted: this.muted,
      volume: this.volume,
      effectiveGain: this.getEffectiveGain(),
      currentTrack: this.currentTrack,
      unlocked: this.unlocked,
      contextAvailable: this.ctx !== null,
      isPlayingBgm: this.bgmTimer !== null,
      sfxLog: [...this.sfxLog],
      audibleSfxCount: this.audibleSfxCount,
      sfxCounts: { ...this.sfxCounts },
      lastSfx: this.lastSfx,
    };
  }

  private ensureContext(): void {
    if (this.ctx || this.contextAttempted) {
      return;
    }
    this.contextAttempted = true;
    try {
      const created = this.createAudioContextFn();
      if (!created) {
        return;
      }
      const gain = created.createGain();
      gain.connect(created.destination);
      this.ctx = created;
      this.masterGain = gain;
      this.syncMasterGain();
    } catch {
      this.ctx = null;
      this.masterGain = null;
    }
  }

  private syncMasterGain(): void {
    if (!this.masterGain) {
      return;
    }
    const target = this.getEffectiveGain();
    try {
      const now = this.ctx?.currentTime ?? 0;
      this.masterGain.gain.cancelScheduledValues?.(now);
      if (this.masterGain.gain.setValueAtTime) {
        this.masterGain.gain.setValueAtTime(target, now);
      }
      this.masterGain.gain.value = target;
    } catch {
      // Ignore WebAudio param errors
    }
  }

  private clearBgmTimer(): void {
    if (this.bgmTimer !== null) {
      this.timers.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  private startBgmLoop(): void {
    this.clearBgmTimer();
    if (!this.currentTrack || this.muted || !this.unlocked) {
      return;
    }
    const score = BGM_SCORES[this.currentTrack];
    this.playCurrentBgmStep();
    this.bgmTimer = this.timers.setInterval(() => {
      this.playCurrentBgmStep();
    }, score.stepMs);
  }

  private playCurrentBgmStep(): void {
    if (!this.currentTrack || this.muted || !this.unlocked) {
      return;
    }

    const score = BGM_SCORES[this.currentTrack];
    const idx = this.stepIndex % score.lead.length;
    this.stepIndex = (idx + 1) % score.lead.length;

    this.ensureContext();
    if (!this.ctx || !this.masterGain) {
      return;
    }

    const now = this.ctx.currentTime;
    const stepSec = score.stepMs / 1000;
    const leadFreq = score.lead[idx];
    const bassFreq = score.bass[idx];

    if (leadFreq > 0) {
      this.scheduleNote(
        {
          type: 'square',
          freq: leadFreq,
          offsetSec: 0,
          durationSec: stepSec * 0.72,
          gain: 0.2,
        },
        now,
      );
    }

    if (bassFreq > 0) {
      this.scheduleNote(
        {
          type: 'triangle',
          freq: bassFreq,
          offsetSec: 0,
          durationSec: stepSec * 0.82,
          gain: 0.36,
        },
        now,
      );
    }
  }

  private scheduleNote(spec: SynthNoteSpec, baseTime: number): void {
    if (!this.ctx || !this.masterGain || this.muted) {
      return;
    }

    try {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      const startTime = baseTime + spec.offsetSec;
      const endTime = startTime + spec.durationSec;
      const attackEnd = startTime + Math.min(0.008, spec.durationSec * 0.25);

      osc.type = spec.type;
      if (osc.frequency.setValueAtTime) {
        osc.frequency.setValueAtTime(spec.freq, startTime);
      } else {
        osc.frequency.value = spec.freq;
      }

      if (spec.endFreq && spec.endFreq !== spec.freq) {
        if (osc.frequency.exponentialRampToValueAtTime) {
          osc.frequency.exponentialRampToValueAtTime(spec.endFreq, endTime);
        } else if (osc.frequency.linearRampToValueAtTime) {
          osc.frequency.linearRampToValueAtTime(spec.endFreq, endTime);
        }
      }

      if (env.gain.setValueAtTime) {
        env.gain.setValueAtTime(0.0001, startTime);
        if (env.gain.linearRampToValueAtTime) {
          env.gain.linearRampToValueAtTime(spec.gain, attackEnd);
          env.gain.linearRampToValueAtTime(0.0001, endTime);
        } else {
          env.gain.value = spec.gain;
        }
      } else {
        env.gain.value = spec.gain;
      }

      osc.connect(env);
      env.connect(this.masterGain);

      osc.onended = () => {
        osc.disconnect?.();
        env.disconnect?.();
      };

      osc.start(startTime);
      osc.stop(endTime + 0.01);
    } catch {
      // Never crash on WebAudio scheduling quirks
    }
  }
}

export const audio = new AudioEngine();

export function installAudioDebugHook(engine: AudioEngine = audio): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.__AUDIO_DEBUG__ = {
    getState: () => engine.getDebugState(),
  };
}
