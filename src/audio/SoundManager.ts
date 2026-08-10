/**
 * Web Audio 효과음. (§16, §0-6)
 *
 * **에셋을 쓰지 않는다.** 모든 소리를 오실레이터와 노이즈 버퍼로 그 자리에서 만든다.
 * 이 프로젝트의 메시가 전부 코드로 만들어진 것과 같은 이유다 — 받아올 파일이 없다.
 *
 * §0-6 오디오 언락: `AudioContext` 는 사용자 제스처 전에는 만들지 않는다.
 * 만들어 두고 resume() 만 미루면 브라우저가 콘솔 경고를 남기는데,
 * §21-2 의 "콘솔 에러 0" 을 지키려면 아예 늦게 만드는 편이 확실하다.
 * `unlock()` 전의 재생 요청은 조용히 무시된다.
 *
 * EventBus 를 **구독만** 한다. 게임 로직이 이 클래스를 직접 호출하지 않는다. (§6-2)
 */

import type { EventBus, GameEvents } from '../core/EventBus.ts';
import type { GameState } from '../core/GameState.ts';
import { Rng } from '../core/Rng.ts';
import { Phase, dist } from '../core/types.ts';

/** 마스터 볼륨. 이 게임은 오래 켜 두는 종류라 기본을 낮게 잡는다. */
const MASTER_GAIN = 0.32;

/** 청소기 험이 최대로 들리는 거리와 완전히 안 들리는 거리 (world units) */
const HUM_NEAR = 1.5;
const HUM_FAR = 9.0;

interface ToneSpec {
  freq: number;
  /** 지정하면 freq → slideTo 로 미끄러진다 */
  slideTo?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** 시작 지연 (초) */
  delay?: number;
}

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** 청소기 험 — 계속 돌아가는 소스라 따로 들고 있다가 게인만 바꾼다 */
  private humOsc: OscillatorNode | null = null;
  private humGain: GainNode | null = null;

  private muted = false;
  private unsubscribe: (() => void)[] = [];
  private disposed = false;

  /**
   * 노이즈 버퍼 생성용. `Math.random()` 은 저장소 전체에서 금지되어 있고
   * (tests/architecture.test.ts), 소리 역시 같은 시드면 같아야 디버깅이 쉽다.
   */
  private readonly rng = new Rng(0x5eed_1234);

  get isUnlocked(): boolean {
    return this.ctx !== null;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * 첫 사용자 입력에서 1회 호출한다. (§0-6)
   * 두 번째 호출부터는 컨텍스트가 중단돼 있을 때만 재개한다.
   */
  unlock(): void {
    if (this.disposed) return;

    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }

    // 브라우저가 아닌 환경(Vitest·헤드리스)에서는 조용히 비활성으로 둔다.
    const Ctor =
      typeof globalThis.AudioContext === 'function' ? globalThis.AudioContext : null;
    if (!Ctor) return;

    try {
      this.ctx = new Ctor();
    } catch {
      // 오디오는 게임의 필수 요소가 아니다. 실패하면 소리 없이 계속 돈다.
      this.ctx = null;
      return;
    }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
    this.master.connect(this.ctx.destination);

    this.noise = this.createNoiseBuffer(1.0);
    this.startHum();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      // 급격히 끊으면 클릭 노이즈가 난다.
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.02);
    }
  }

  /** 이벤트 구독. 반환값 없이 내부에 해제 함수를 모아 둔다. (§8 누수 방지) */
  attach(bus: EventBus): void {
    const on = <K extends keyof GameEvents>(event: K, fn: () => void): void => {
      this.unsubscribe.push(bus.on(event, fn));
    };

    on('food:eaten', () => this.play([
      { freq: 640, dur: 0.05, type: 'square', gain: 0.5 },
      { freq: 880, dur: 0.07, type: 'square', gain: 0.5, delay: 0.05 },
    ]));

    on('food:spawned', () => this.play([
      { freq: 1180, dur: 0.09, type: 'sine', gain: 0.35 },
      { freq: 1560, dur: 0.09, type: 'sine', gain: 0.25, delay: 0.06 },
    ]));

    // 배변은 이 게임의 핵심 동사다. 다른 소리와 확실히 구분되게 길고 낮게.
    on('poop:done', () => {
      this.play([{ freq: 300, slideTo: 95, dur: 0.34, type: 'sine', gain: 0.7 }]);
      this.playNoise(0.22, 900, 0.35, 0.06);
    });

    on('poop:blocked', () => this.play([
      { freq: 200, slideTo: 130, dur: 0.16, type: 'square', gain: 0.4 },
    ]));

    on('toilet:done', () => this.play([
      { freq: 220, slideTo: 660, dur: 0.5, type: 'sine', gain: 0.5 },
      { freq: 880, dur: 0.2, type: 'triangle', gain: 0.4, delay: 0.42 },
    ]));

    // 피해는 가장 크게 들려야 한다 — 화면을 안 보고 있어도 알아야 하는 정보다.
    on('player:damaged', () => {
      this.playNoise(0.26, 1400, 0.75, 0);
      this.play([{ freq: 180, slideTo: 60, dur: 0.3, type: 'sawtooth', gain: 0.6 }]);
    });

    on('player:levelUp', () =>
      this.play(
        [523.25, 659.25, 783.99, 1046.5].map((freq, i) => ({
          freq,
          dur: 0.16,
          type: 'triangle' as OscillatorType,
          gain: 0.45,
          delay: i * 0.075,
        })),
      ),
    );

    on('treat:taken', () =>
      this.play(
        [784, 988, 1175, 1568, 1976].map((freq, i) => ({
          freq,
          dur: 0.13,
          type: 'sine' as OscillatorType,
          gain: 0.4,
          delay: i * 0.05,
        })),
      ),
    );

    // ── 짝 (§24) ──
    // 셋 다 위협음과 겹치지 않게 장3화음 위주로 짠다. 짝은 유일하게
    // "가도 되는" 신호라, 소리만 듣고 청소기·인간과 헷갈리면 안 된다.
    on('mate:appeared', () => this.play([
      { freq: 659.25, dur: 0.14, type: 'sine', gain: 0.32 },
      { freq: 830.61, dur: 0.14, type: 'sine', gain: 0.32, delay: 0.12 },
      { freq: 987.77, dur: 0.22, type: 'sine', gain: 0.3, delay: 0.24 },
    ]));

    on('mate:mated', () => this.play([
      { freq: 523.25, slideTo: 783.99, dur: 0.34, type: 'triangle', gain: 0.42 },
      { freq: 659.25, slideTo: 987.77, dur: 0.34, type: 'triangle', gain: 0.34, delay: 0.05 },
    ]));

    // 산란은 이 게임에서 가장 긴 기다림의 끝이다. 변기보다 한 겹 더 얹는다.
    on('mate:laid', () =>
      this.play(
        [659.25, 783.99, 987.77, 1318.5].map((freq, i) => ({
          freq,
          dur: 0.18,
          type: 'sine' as OscillatorType,
          gain: 0.42,
          delay: i * 0.07,
        })),
      ),
    );

    on('human:spotted', () => this.play([
      { freq: 900, dur: 0.13, type: 'sawtooth', gain: 0.4 },
      { freq: 660, dur: 0.18, type: 'sawtooth', gain: 0.4, delay: 0.14 },
    ]));

    on('blanket:warn', () => this.play([
      { freq: 260, slideTo: 200, dur: 0.16, type: 'sawtooth', gain: 0.4 },
    ]));

    // 강아지 — 낮은 톱니 두 번. "멍멍" 으로 읽히게 짧고 급하게 감쇠시킨다.
    on('blanket:dog', () => this.play([
      { freq: 320, slideTo: 180, dur: 0.12, type: 'sawtooth', gain: 0.65 },
      { freq: 300, slideTo: 165, dur: 0.14, type: 'sawtooth', gain: 0.6, delay: 0.17 },
    ]));

    on('stage:clear', () =>
      this.play(
        [523.25, 659.25, 783.99, 1046.5, 1318.5].map((freq, i) => ({
          freq,
          dur: 0.3,
          type: 'triangle' as OscillatorType,
          gain: 0.5,
          delay: i * 0.13,
        })),
      ),
    );

    on('stage:gameOver', () =>
      this.play(
        [440, 349.23, 261.63, 196].map((freq, i) => ({
          freq,
          dur: 0.4,
          type: 'sawtooth' as OscillatorType,
          gain: 0.4,
          delay: i * 0.19,
        })),
      ),
    );
  }

  /** UI 클릭·화면 전환음 */
  playUi(kind: 'confirm' | 'toggle'): void {
    if (kind === 'confirm') {
      this.play([
        { freq: 660, dur: 0.08, type: 'triangle', gain: 0.4 },
        { freq: 990, dur: 0.14, type: 'triangle', gain: 0.4, delay: 0.07 },
      ]);
    } else {
      this.play([{ freq: 520, dur: 0.06, type: 'square', gain: 0.3 }]);
    }
  }

  /**
   * 청소기 험의 크기를 플레이어와의 거리로 정한다.
   *
   * 청소기는 화면 밖에 있을 때가 가장 위험하다. 소리로 위치를 알려 주면
   * §12 의 "읽히는 움직임" 이 카메라 밖에서도 이어진다.
   *
   * 매 렌더 프레임 호출된다. 값을 즉시 대입하지 않고 `setTargetAtTime` 으로
   * 완만하게 따라가게 해서, 프레임률이 흔들려도 소리가 지직거리지 않게 한다.
   */
  update(state: GameState): void {
    if (!this.ctx || !this.humGain || !this.humOsc) return;

    let gain = 0;
    let pitch = 62;

    if (state.phase === Phase.PLAYING && state.vacuumStopLeft <= 0) {
      let nearest = Infinity;
      for (const v of state.vacuums) nearest = Math.min(nearest, dist(v.pos, state.player.pos));

      if (nearest < HUM_FAR) {
        const t = 1 - (Math.max(HUM_NEAR, nearest) - HUM_NEAR) / (HUM_FAR - HUM_NEAR);
        gain = t * t * 0.22;
        // 감속(변기 보너스) 중에는 확실히 낮게 — 효과가 걸렸는지 귀로 알 수 있다.
        const slowed = state.vacuums.some((v) => v.slowLeft > 0);
        pitch = slowed ? 40 : 62 + t * 16;
      }
    }

    const now = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(gain, now, 0.12);
    this.humOsc.frequency.setTargetAtTime(pitch, now, 0.2);
  }

  // ── 내부 ────────────────────────────────────────────────────────────────

  private startHum(): void {
    if (!this.ctx || !this.master) return;

    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 62;

    // 톱니를 그대로 쓰면 모터가 아니라 벌 소리가 된다. 배음을 깎는다.
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;

    const gain = this.ctx.createGain();
    gain.gain.value = 0;

    osc.connect(lp).connect(gain).connect(this.master);
    osc.start();

    this.humOsc = osc;
    this.humGain = gain;
  }

  private createNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = this.rng.next() * 2 - 1;
    return buffer;
  }

  /** 짧은 톤 여러 개를 한 번에 예약한다. */
  private play(tones: ToneSpec[]): void {
    if (!this.ctx || !this.master || this.muted) return;
    const now = this.ctx.currentTime;

    for (const t of tones) {
      const start = now + (t.delay ?? 0);
      const osc = this.ctx.createOscillator();
      osc.type = t.type ?? 'sine';
      osc.frequency.setValueAtTime(t.freq, start);
      if (t.slideTo !== undefined) {
        // 선형이 아니라 지수로 미끄러뜨려야 음정 변화가 귀에 균등하게 들린다.
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, t.slideTo), start + t.dur);
      }

      const gain = this.ctx.createGain();
      const peak = t.gain ?? 0.5;
      // 어택 없이 시작하면 클릭이 난다. 5ms 만 준다.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);

      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + t.dur + 0.02);
    }
  }

  /** 노이즈 버스트 (충돌·배변 퍼프처럼 음정이 없는 소리) */
  private playNoise(dur: number, cutoff: number, peak: number, delay: number): void {
    if (!this.ctx || !this.master || !this.noise || this.muted) return;
    const start = this.ctx.currentTime + delay;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = cutoff;
    bp.Q.value = 0.8;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    src.connect(bp).connect(gain).connect(this.master);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  /** §8 재시작·종료 시 노드와 구독을 전부 끊는다. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];

    try {
      this.humOsc?.stop();
    } catch {
      // 이미 멈춘 노드를 다시 멈추면 던진다. 종료 경로라 무시해도 된다.
    }
    this.humOsc?.disconnect();
    this.humGain?.disconnect();
    this.master?.disconnect();
    void this.ctx?.close();

    this.humOsc = null;
    this.humGain = null;
    this.master = null;
    this.noise = null;
    this.ctx = null;
  }
}
