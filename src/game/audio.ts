import { loadAudioMuted, saveAudioMuted, type StorageLike } from './save';

export type BgmTrack = 'day' | 'night';

export type SfxName =
  | 'play_card'
  | 'receive_card'
  | 'deal_closed'
  | 'demon_defeated'
  | 'button_click'
  | 'hit_demon'
  | 'shield_block'
  | 'player_hurt'
  | 'offer_rejected'
  | 'insufficient_funds'
  | 'redeem_deal';

export const ALL_SFX_NAMES: readonly SfxName[] = [
  'play_card',
  'receive_card',
  'deal_closed',
  'demon_defeated',
  'button_click',
  'hit_demon',
  'shield_block',
  'player_hurt',
  'offer_rejected',
  'insufficient_funds',
  'redeem_deal',
] as const;

export const DEFAULT_MASTER_VOLUME = 0.2;
export const BGM_LOOKAHEAD_SEC = 0.1;
export const BGM_SCHEDULER_INTERVAL_MS = 25;
export const ZZFX_SAMPLE_RATE = 44100;

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

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  start(when?: number): void;
  stop?: (when?: number) => void;
  onended?: (() => void) | null;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly sampleRate?: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBuffer?: (
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ) => AudioBufferLike;
  createBufferSource?: () => AudioBufferSourceNodeLike;
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

/**
 * ZzFX - Zuper Zmall Zound Zynth v1.4.0 (buildSamples core)
 * Source: https://github.com/KilledByAPixel/ZzFX
 * License: MIT License — Copyright (c) 2019 Frank Force (see docs/licenses/ZzFX-LICENSE.txt)
 */
export type ZzfxParams = readonly (number | undefined)[];

export function zzfxBuildSamples(
  p: ZzfxParams,
  sampleRate = ZZFX_SAMPLE_RATE,
  rng: () => number = Math.random,
): Float32Array {
  let [
    volume = 1,
    randomness = 0.05,
    frequency = 220,
    attack = 0,
    sustain = 0,
    release = 0.1,
    shape = 0,
    shapeCurve = 1,
    slide = 0,
    deltaSlide = 0,
    pitchJump = 0,
    pitchJumpTime = 0,
    repeatTime = 0,
    noise = 0,
    modulation = 0,
    bitCrush = 0,
    delay = 0,
    sustainVolume = 1,
    decay = 0,
    tremolo = 0,
    filter = 0,
  ] = p;

  const PI2 = Math.PI * 2;
  const abs = Math.abs;
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate);
  let startFrequency = (frequency *= ((1 + randomness * 2 * rng() - randomness) * PI2) / sampleRate);
  let modOffset = 0;
  let repeat = 0;
  let crush = 0;
  let jump = 1;
  let t = 0;
  let i = 0;
  let s = 0;

  const w = (PI2 * abs(filter) * 2) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / 4;
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (1 + sign(filter) * cos) / 2 / a0;
  const b1 = -(sign(filter) + cos) / a0;
  const b2 = b0;
  let x2 = 0;
  let x1 = 0;
  let y2 = 0;
  let y1 = 0;

  attack = attack * sampleRate || 9;
  decay *= sampleRate;
  sustain *= sampleRate;
  release *= sampleRate;
  delay *= sampleRate;
  deltaSlide *= (500 * PI2) / sampleRate ** 3;
  modulation *= PI2 / sampleRate;
  pitchJump *= PI2 / sampleRate;
  pitchJumpTime *= sampleRate;
  repeatTime = (repeatTime * sampleRate) | 0;

  const length = (attack + decay + sustain + release + delay) | 0;
  const b = new Float32Array(length > 0 ? length : 0);

  for (; i < length; b[i++] = s * volume) {
    if (!(++crush % ((bitCrush * 100) | 0))) {
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? shape > 4
                ? (t / PI2) % 1 < shapeCurve / 2
                  ? 1
                  : -1
                : Math.sin(t ** 3)
              : Math.max(Math.min(Math.tan(t), 1), -1)
            : 1 - ((((2 * t) / PI2) % 2) + 2) % 2
          : 1 - 4 * abs(Math.round(t / PI2) - t / PI2)
        : Math.sin(t);

      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
        (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) *
        (i < attack
          ? i / attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain
              ? sustainVolume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume
                : 0);

      s = delay
        ? s / 2 +
          (delay > i ? 0 : (i < length - delay ? 1 : (length - i) / delay) * (b[(i - delay) | 0] / 2 / (volume || 1)))
        : s;

      if (filter) {
        const prevX1 = x1;
        x1 = s;
        const prevY1 = y1;
        s = y1 = b2 * x2 + b1 * prevX1 + b0 * s - a2 * y2 - a1 * prevY1;
        x2 = prevX1;
        y2 = prevY1;
      }
    }

    const f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++);
    t += f + f * noise * (((i * i * PI2) % 2) - 1);

    if (jump && ++jump > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      jump = 0;
    }

    if (repeatTime && !(++repeat % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      jump ||= 1;
    }
  }

  return b;
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
    hit_demon: 0,
    shield_block: 0,
    player_hurt: 0,
    offer_rejected: 0,
    insufficient_funds: 0,
    redeem_deal: 0,
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

const SFX_RECIPES: Partial<Record<SfxName, readonly SynthNoteSpec[]>> = {
  button_click: [
    { type: 'square', freq: 660, endFreq: 880, offsetSec: 0, durationSec: 0.045, gain: 0.35 },
  ],
  play_card: [
    { type: 'square', freq: 330, offsetSec: 0, durationSec: 0.045, gain: 0.32 },
    { type: 'square', freq: 493.88, offsetSec: 0.04, durationSec: 0.05, gain: 0.34 },
    { type: 'triangle', freq: 659.25, offsetSec: 0.08, durationSec: 0.075, gain: 0.4 },
  ],
  receive_card: [
    { type: 'triangle', freq: N.C5, offsetSec: 0, durationSec: 0.06, gain: 0.42 },
    { type: 'square', freq: N.E5, offsetSec: 0.055, durationSec: 0.06, gain: 0.28 },
    { type: 'triangle', freq: N.G5, offsetSec: 0.11, durationSec: 0.11, gain: 0.44 },
  ],
  deal_closed: [
    { type: 'square', freq: N.E5, offsetSec: 0, durationSec: 0.065, gain: 0.32 },
    { type: 'square', freq: N.B5, offsetSec: 0.06, durationSec: 0.075, gain: 0.34 },
    { type: 'triangle', freq: N.E6, offsetSec: 0.125, durationSec: 0.13, gain: 0.42 },
  ],
  demon_defeated: [
    { type: 'square', freq: N.E5, offsetSec: 0, durationSec: 0.055, gain: 0.28 },
    { type: 'square', freq: N.A5, offsetSec: 0.05, durationSec: 0.06, gain: 0.3 },
    { type: 'triangle', freq: N.E6, offsetSec: 0.105, durationSec: 0.28, gain: 0.55 },
    { type: 'square', freq: N.B6, offsetSec: 0.105, durationSec: 0.16, gain: 0.22 },
  ],
};

/**
 * 6 P7 ZzFX recipes adding white-noise, bitcrush, and retro distortion texture.
 * Format: ZzFX 21-parameter tuple (volume, randomness, freq, attack, sustain, release,
 * shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise,
 * modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter).
 */
export const ZZFX_SFX_RECIPES: Record<
  'hit_demon' | 'shield_block' | 'player_hurt' | 'offer_rejected' | 'insufficient_funds' | 'redeem_deal',
  ZzfxParams
> = {
  // 受击：带白噪声与失真的复古打击声
  hit_demon: [0.85, 0.05, 190, 0.005, 0.03, 0.11, 4, 1.8, -6, 0, 0, 0, 0, 0.7, 0, 0.35, 0, 0.65, 0.02],
  // 格挡：清脆木铜格挡共振声
  shield_block: [0.75, 0.04, 520, 0.004, 0.03, 0.12, 1, 1.4, 3, 0, 140, 0.03, 0, 0.2, 0, 0.15, 0.02, 0.7, 0.02],
  // 玩家受伤：低频重击 + 噪声碎裂感
  player_hurt: [0.9, 0.05, 130, 0.01, 0.04, 0.18, 3, 2.2, -5, 0, -35, 0.04, 0, 0.9, 0, 0.45, 0, 0.55, 0.04],
  // 拒收：双段下行否定嗡鸣
  offer_rejected: [0.7, 0.03, 260, 0.01, 0.05, 0.14, 2, 1.6, -2, 0, -70, 0.06, 0, 0.18, 0, 0.2, 0, 0.75, 0.03],
  // 钱不够：短促非法低音蜂鸣
  insufficient_funds: [0.65, 0.02, 175, 0.005, 0.03, 0.08, 5, 0.9, 0, 0, -30, 0.035, 0, 0.12, 0, 0.15, 0, 0.8, 0.02],
  // 赎当成交：清亮暖调双跳金铃声
  redeem_deal: [0.8, 0.03, 587, 0.008, 0.05, 0.2, 1, 1.2, 1.5, 0, 293, 0.06, 0, 0.06, 0, 0, 0.04, 0.75, 0.03],
};

/**
 * Self-contained WebAudio 8-bit chiptune BGM & SFX engine.
 * - Zero external audio files.
 * - Lookahead BGM scheduler anchored to ctx.currentTime (100ms lookahead).
 * - ZzFX (MIT) procedural synth for textured retro SFX (noise/bitcrush/distortion).
 * - Respects browser autoplay policy & degrades silently when WebAudio is unavailable.
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
  private nextNoteTime = 0;

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
    this.nextNoteTime = 0;
    this.clearBgmTimer();
  }

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

    const zzfxParams = ZZFX_SFX_RECIPES[name as keyof typeof ZZFX_SFX_RECIPES];
    if (zzfxParams) {
      this.playZzfxBuffer(zzfxParams);
      return;
    }

    const recipe = SFX_RECIPES[name];
    if (!recipe) {
      return;
    }
    const baseTime = this.ctx.currentTime;
    for (const note of recipe) {
      this.scheduleNote(note, baseTime);
    }
  }

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
    this.ensureContext();
    this.nextNoteTime = this.ctx ? this.ctx.currentTime : 0;
    this.scheduleBgmLookahead();
    this.bgmTimer = this.timers.setInterval(() => {
      this.scheduleBgmLookahead();
    }, BGM_SCHEDULER_INTERVAL_MS);
  }

  /**
   * Lookahead scheduler anchored to ctx.currentTime (ahead by BGM_LOOKAHEAD_SEC = 100ms).
   * Eliminates interval drift/jitter on frame drops or background tab throttling.
   */
  private scheduleBgmLookahead(): void {
    if (!this.currentTrack || this.muted || !this.unlocked) {
      return;
    }

    this.ensureContext();
    if (!this.ctx || !this.masterGain) {
      return;
    }

    const score = BGM_SCORES[this.currentTrack];
    const stepSec = score.stepMs / 1000;
    const now = this.ctx.currentTime;

    // Resync if audio clock jumped forward (e.g. after returning from a backgrounded tab)
    if (this.nextNoteTime < now - stepSec * 2) {
      this.nextNoteTime = now;
    }

    const horizon = now + BGM_LOOKAHEAD_SEC;
    while (this.nextNoteTime < horizon) {
      this.scheduleBgmStepAt(score, this.nextNoteTime);
      this.nextNoteTime += stepSec;
    }
  }

  private scheduleBgmStepAt(score: BgmTrackScore, scheduledTime: number): void {
    const idx = this.stepIndex % score.lead.length;
    this.stepIndex = (idx + 1) % score.lead.length;

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
        scheduledTime,
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
        scheduledTime,
      );
    }
  }

  private playZzfxBuffer(params: ZzfxParams): void {
    if (!this.ctx || !this.masterGain || this.muted) {
      return;
    }

    try {
      const sampleRate = this.ctx.sampleRate ?? ZZFX_SAMPLE_RATE;
      const samples = zzfxBuildSamples(params, sampleRate);
      if (samples.length === 0) {
        return;
      }

      if (this.ctx.createBuffer && this.ctx.createBufferSource) {
        const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
        buffer.getChannelData(0).set(samples);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.masterGain);
        source.onended = () => {
          source.disconnect?.();
        };
        source.start(this.ctx.currentTime);
        return;
      }

      // Fallback for minimal WebAudio mocks without createBuffer/createBufferSource
      const freq = typeof params[2] === 'number' ? params[2] : 220;
      const dur = Math.max(0.05, (params[3] ?? 0) + (params[4] ?? 0) + (params[5] ?? 0.1));
      this.scheduleNote(
        {
          type: 'square',
          freq,
          offsetSec: 0,
          durationSec: dur,
          gain: Math.min(0.45, (params[0] ?? 0.7) * 0.5),
        },
        this.ctx.currentTime,
      );
    } catch {
      // Never crash on WebAudio buffer quirks
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
