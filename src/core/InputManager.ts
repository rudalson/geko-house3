/**
 * 키보드 입력. DOM 이벤트를 게임이 읽을 수 있는 형태로 바꾼다.
 * Three.js 를 import 하지 않는다. (§0-4)
 *
 * "눌린 상태"(이동)와 "눌린 순간"(상호작용)을 구분한다.
 * 눌린 순간 플래그는 고정 스텝마다 consume 해야 입력이 중복 처리되지 않는다.
 */

import type { MoveInput } from '../systems/MovementSystem.ts';

export type GameAction = 'interact' | 'poop' | 'pause' | 'restart' | 'debug';

const MOVE_KEYS: Record<string, { x: number; z: number }> = {
  // 쿼터뷰라 화면 위쪽이 -z 다.
  KeyW: { x: 0, z: -1 },
  ArrowUp: { x: 0, z: -1 },
  KeyS: { x: 0, z: 1 },
  ArrowDown: { x: 0, z: 1 },
  KeyA: { x: -1, z: 0 },
  ArrowLeft: { x: -1, z: 0 },
  KeyD: { x: 1, z: 0 },
  ArrowRight: { x: 1, z: 0 },
};

const ACTION_KEYS: Record<string, GameAction> = {
  KeyE: 'interact',
  KeyZ: 'interact',
  Space: 'poop',
  Escape: 'pause',
  KeyR: 'restart',
  Backquote: 'debug',
};

export class InputManager {
  private held = new Set<string>();
  private pressed = new Set<GameAction>();
  private disposed = false;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // 스페이스로 페이지가 스크롤되거나 방향키로 화면이 밀리지 않게 한다.
    if (e.code in MOVE_KEYS || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;

    this.held.add(e.code);
    const action = ACTION_KEYS[e.code];
    if (action) this.pressed.add(action);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  /** 창을 벗어나면 키가 눌린 채로 남아 캐릭터가 계속 움직이는 문제를 막는다. */
  private readonly onBlur = (): void => {
    this.held.clear();
  };

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** 현재 이동 입력 */
  readMove(): MoveInput {
    let x = 0;
    let z = 0;
    for (const code of this.held) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        x += dir.x;
        z += dir.z;
      }
    }
    // 반대 방향 동시 입력은 상쇄된다.
    return {
      x: Math.sign(x),
      z: Math.sign(z),
      run: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
    };
  }

  /** 이번 스텝에 눌린 액션인지 확인하고 소비한다. */
  consume(action: GameAction): boolean {
    return this.pressed.delete(action);
  }

  /** 소비되지 않은 액션을 버린다. 스텝 끝에서 호출한다. */
  endStep(): void {
    this.pressed.clear();
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  /** 재시작 시 리스너 누수를 막는다. (§8) */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.held.clear();
    this.pressed.clear();
  }
}
