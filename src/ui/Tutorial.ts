/**
 * 튜토리얼 안내. (§18)
 *
 * 별도의 튜토리얼 스테이지를 만들지 않는다. **실제 판 위에서** 한 단계씩 안내하고,
 * 조건이 충족되면 스스로 다음으로 넘어간다. 따로 만든 연습장은 본 게임의 압박
 * (청소기가 계속 지운다) 을 재현하지 못해서 배운 게 그대로 쓰이지 않는다.
 *
 * 게임 상태를 **읽기만** 한다. 진행을 위해 게임을 멈추거나 적을 치우지 않는다.
 */

import type { GameState } from '../core/GameState.ts';
import { Phase, Stance } from '../core/types.ts';
import { hasSignal } from '../systems/PoopSystem.ts';

interface StepDef {
  key: string;
  text: string;
  /** 완료 조건 */
  done: (state: GameState, moved: number) => boolean;
  /**
   * 이 시간이 지나면 조건과 무관하게 넘어간다 (초).
   * "청소기를 조심해라" 처럼 플레이어가 굳이 만족시킬 필요 없는 안내에 쓴다.
   */
  timeout?: number;
}

const STEPS: StepDef[] = [
  {
    key: 'move',
    text: '<kbd>WASD</kbd> 로 움직여 보자. <kbd>Shift</kbd> 는 짧은 달리기다.',
    done: (_s, moved) => moved > 3,
  },
  {
    key: 'eat',
    text: '🍖 <b>슈퍼푸드</b> 옆에서 <kbd>E</kbd>. 3개를 먹으면 똥 게이지가 찬다.',
    done: (s) => s.player.foodsEaten >= 1,
  },
  {
    key: 'signal',
    text: '게이지가 차면 <b>!</b> 신호가 뜬다. <b>아직 초록색이 아닌 곳</b>으로 가자 — 겹쳐 싸면 손해다.',
    done: (s) => hasSignal(s),
    timeout: 45,
  },
  {
    key: 'poop',
    text: '<kbd>Space</kbd> 로 똥 싸기. <b>1초 동안 움직일 수 없고 무적도 아니다.</b>',
    done: (s) => s.stats.poops >= 1,
  },
  {
    key: 'vacuum',
    text: '🤖 로봇청소기가 네 땅을 <b>계속 지운다</b>. 부딪히면 ♥ 가 하나 줄어든다.',
    done: () => false,
    timeout: 7,
  },
  {
    key: 'shelter',
    text: '위험하면 <kbd>E</kbd> — 담요 밑 · 가구 위 · 화장실. 다만 <b>가구 위에서는 똥을 못 싼다.</b>',
    done: (s) => s.player.stance !== Stance.GROUND,
    timeout: 9,
  },
  {
    key: 'goal',
    text: '목표는 <b>44%</b>. 왼쪽 위 ♥ 가 0이 되면 끝이다. 행운을 빈다.',
    done: () => false,
    timeout: 5,
  },
];

export class Tutorial {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly counter: HTMLSpanElement;

  private index = -1;
  private stepTime = 0;
  private movedTotal = 0;
  private enabled: boolean;
  /** 완료 표시를 잠깐 보여 준 뒤 다음 단계로 넘어가기까지 남은 시간 */
  private clearedLeft = 0;
  /** 이 세션에서 한 번이라도 시작했는지 */
  private everStarted = false;

  constructor(parent: HTMLElement, enabled: boolean) {
    this.enabled = enabled;

    this.root = document.createElement('div');
    this.root.className = 'tutorial';
    this.root.innerHTML = `
      <div class="tutorial-head">
        <span class="tutorial-tag">튜토리얼</span>
        <span class="tutorial-count" data-count></span>
      </div>
      <div class="tutorial-body" data-body></div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel) as T;
    this.body = q('[data-body]');
    this.counter = q('[data-count]');
  }

  get isRunning(): boolean {
    return this.enabled && this.index >= 0 && this.index < STEPS.length;
  }

  /** 현재 단계의 key. 테스트·디버그용 */
  get currentKey(): string | null {
    return this.isRunning ? STEPS[this.index]!.key : null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.finish();
  }

  /**
   * 판이 시작될 때 호출.
   *
   * **한 세션에 한 번만** 돈다. 재시작할 때마다 다시 뜨면, 이미 한 판을 끝낸
   * 사람에게 같은 안내를 반복하게 된다 — 그건 안내가 아니라 방해다.
   */
  start(): void {
    this.movedTotal = 0;
    this.clearedLeft = 0;
    if (!this.enabled || this.everStarted) {
      this.finish();
      return;
    }
    this.everStarted = true;
    this.index = 0;
    this.stepTime = 0;
    this.render();
  }

  /**
   * @param movedDistance 이번 프레임에 실제로 움직인 거리 (world units)
   * @param dt 렌더 델타 (가변)
   */
  update(state: GameState, movedDistance: number, dt: number): void {
    if (!this.isRunning) return;
    if (state.phase !== Phase.PLAYING) return;

    this.movedTotal += movedDistance;
    this.stepTime += dt;

    if (this.clearedLeft > 0) {
      this.clearedLeft -= dt;
      if (this.clearedLeft <= 0) this.advance();
      return;
    }

    const step = STEPS[this.index]!;
    const timedOut = step.timeout !== undefined && this.stepTime >= step.timeout;

    if (step.done(state, this.movedTotal)) {
      this.root.classList.add('cleared');
      // 완료를 0.9초 보여 준다. 즉시 넘기면 무엇을 해서 넘어갔는지 못 읽는다.
      this.clearedLeft = 0.9;
    } else if (timedOut) {
      this.advance();
    }
  }

  private advance(): void {
    this.root.classList.remove('cleared');
    this.index++;
    this.stepTime = 0;
    if (this.index >= STEPS.length) {
      this.finish();
      return;
    }
    this.render();
  }

  private render(): void {
    const step = STEPS[this.index]!;
    this.body.innerHTML = step.text;
    this.counter.textContent = `${this.index + 1} / ${STEPS.length}`;
    this.root.classList.add('visible');
  }

  private finish(): void {
    this.index = STEPS.length;
    this.root.classList.remove('visible', 'cleared');
  }

  dispose(): void {
    this.root.remove();
  }
}
