/**
 * 8방향 이동 + 짧은 달리기. 순수 로직. (§0-4)
 *
 * 고정 타임스텝에서만 호출되므로 dt 는 항상 1/60 이다. (§0-5)
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import type { Vec2 } from '../core/types.ts';
import { resolveByStance } from './ShelterSystem.ts';

export interface MoveInput {
  /** -1 ~ 1. 정규화 전 원시 입력 */
  x: number;
  z: number;
  /** Shift 를 누르고 있는지 */
  run: boolean;
}

export const NO_INPUT: MoveInput = { x: 0, z: 0, run: false };

/**
 * 타이머를 dt 만큼 줄이고 0 이하면 정확히 0 으로 스냅한다.
 *
 * dt = 1/60 은 이진 부동소수점으로 정확히 표현되지 않아, 90번 빼도 1.5 가
 * 정확히 0 이 되지 않고 ~5e-15 가 남는다. 그대로 두면 달리기·무적 같은
 * 지속 시간이 프레임 하나만큼 더 가고, 종료 분기가 늦게 걸린다.
 */
export function tickDown(value: number, dt: number, epsilon = 1e-9): number {
  const next = value - dt;
  return next <= epsilon ? 0 : next;
}

/**
 * 달리기 타이머를 갱신한다.
 *
 * 지속 1.5초 / 쿨다운 3초. 쿨다운은 달리기가 **끝난 시점부터** 흐른다.
 * 이동 여부와 무관하게 매 스텝 호출해야 쿨다운이 정상적으로 회복된다.
 */
export function updateRun(state: GameState, wantRun: boolean, dt: number): boolean {
  const p = state.player;

  if (p.runLeft > 0) {
    p.runLeft = tickDown(p.runLeft, dt);
    if (p.runLeft === 0) p.runCooldownLeft = CONFIG.RUN_COOLDOWN;
    return true;
  }

  if (p.runCooldownLeft > 0) {
    p.runCooldownLeft = tickDown(p.runCooldownLeft, dt);
    return false;
  }

  if (wantRun && state.canMove) {
    p.runLeft = CONFIG.RUN_DURATION;
    return true;
  }

  return false;
}

/**
 * 입력을 받아 플레이어를 이동시킨다.
 * 벽·가구 충돌은 CollisionMap 이 처리하며, 벽에 비스듬히 부딪히면 미끄러진다.
 *
 * @returns 실제로 움직인 거리 (world units). 애니메이션 판정에 쓴다.
 */
export function updateMovement(state: GameState, input: MoveInput, dt: number): number {
  const p = state.player;

  // 배변 애니메이션 타이머는 PoopSystem 이 소유한다.
  // 여기서는 state.canMove 를 통해 "움직일 수 없다"만 반영한다.
  const running = updateRun(state, input.run, dt);

  if (!state.canMove) return 0;

  const len = Math.hypot(input.x, input.z);
  if (len < 1e-4) return 0;

  // 대각선이 빨라지지 않도록 정규화한다.
  const dirX = input.x / len;
  const dirZ = input.z / len;

  const speed = state.moveSpeed * (running ? CONFIG.RUN_MULTIPLIER : 1);
  const step = speed * dt;

  const target: Vec2 = { x: p.pos.x + dirX * step, z: p.pos.z + dirZ * step };
  // 자세에 따라 다른 범위를 쓴다 — 화장실과 가구 상판은 거실 충돌맵 밖이다. (§6, §7)
  const resolved = resolveByStance(state, p.pos, target);

  const movedX = resolved.x - p.pos.x;
  const movedZ = resolved.z - p.pos.z;
  p.pos.x = resolved.x;
  p.pos.z = resolved.z;

  // 입력 방향을 바라본다. 벽에 막혀 미끄러지는 중에도 입력 쪽을 보게 해
  // 조작감이 어긋나지 않게 한다.
  p.facing = Math.atan2(dirX, dirZ);

  return Math.hypot(movedX, movedZ);
}
