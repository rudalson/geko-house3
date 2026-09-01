/**
 * 1인칭 탱크 조작 이동 + 짧은 달리기. 순수 로직. (§0-4, §25)
 *
 * 고정 타임스텝에서만 호출되므로 dt 는 항상 1/60 이다. (§0-5)
 *
 * 쿼터뷰 시절에는 입력이 **월드 방향**(x, z)이었고 `facing` 은 그 결과를 따라가는
 * 파생값이었다. 1인칭에서는 반대다 — `facing` 이 곧 카메라 시선이고, 입력은
 * "그 시선을 얼마나 돌릴지(turn)" 와 "그 시선 쪽으로 얼마나 갈지(forward)" 다.
 * 그래서 방향 전환에 **시간이 든다.** 그게 이 조작의 비용이자 긴장이다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import type { Vec2 } from '../core/types.ts';
import { resolveByStance } from './ShelterSystem.ts';

export interface MoveInput {
  /** -1(후진) ~ 1(전진). 시선 방향 기준 */
  forward: number;
  /** -1(좌회전) ~ 1(우회전) */
  turn: number;
  /** Shift 를 누르고 있는지 */
  run: boolean;
}

export const NO_INPUT: MoveInput = { forward: 0, turn: 0, run: false };

/**
 * 각도를 (-π, π] 로 접는다. 누적 회전이 무한히 커지지 않게 한다.
 *
 * 범위를 `Math.atan2` 와 **정확히 같게** 맞춘 이유가 있다. `facing` 은 두 곳에서
 * 나온다 — 여기(플레이어 선회)와 atan2(적·새끼가 목표를 바라볼 때). 범위가
 * 반 칸이라도 어긋나면 −π 와 +π 를 오갈 때 한쪽만 부호가 뒤집혀서, 정확히
 * 뒤를 보고 있는 순간에만 카메라나 미니맵이 튄다. 재현이 거의 안 되는 버그다.
 */
export function wrapAngle(a: number): number {
  const t = (a - Math.PI) % (Math.PI * 2);
  return (t <= 0 ? t + Math.PI * 2 : t) - Math.PI;
}

/**
 * `from` 에서 `to` 로 가는 최단 회전량 (-π, π].
 * 봇(tools/cycle-probe.ts)과 새끼·인간 AI 가 목표 방향으로 선회할 때 쓴다.
 */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

/** 월드 방향 벡터를 `facing` 규약(+z 기준, atan2(x, z))으로 바꾼다. */
export function headingTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

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
 * 입력을 받아 플레이어를 선회·이동시킨다. (§25)
 *
 * 선회가 먼저다. 같은 스텝에 W+D 를 누르면 새 시선 쪽으로 나아가므로,
 * 달리면서 도는 곡선 주행이 자연스럽게 나온다.
 *
 * 벽·가구 충돌은 CollisionMap 이 처리하며, 벽에 비스듬히 부딪히면 미끄러진다.
 * 미끄러지는 동안에도 `facing` 은 건드리지 않는다 — 1인칭에서 벽에 스쳤다고
 * 카메라가 제멋대로 돌면 방향 감각이 통째로 무너진다.
 *
 * @returns 실제로 움직인 거리 (world units). 애니메이션 판정에 쓴다.
 */
export function updateMovement(state: GameState, input: MoveInput, dt: number): number {
  const p = state.player;

  // 배변 애니메이션 타이머는 PoopSystem 이 소유한다.
  // 여기서는 state.canMove 를 통해 "움직일 수 없다"만 반영한다.
  const running = updateRun(state, input.run, dt);

  // 배변·먹기·교미 중에는 선회도 막는다. 무방비 시간에 주변을 둘러볼 수 있으면
  // "몸을 못 움직인다" 는 대가가 절반으로 줄어든다. (§9-3, §14, §24)
  if (!state.canMove) return 0;

  const turn = Math.max(-1, Math.min(1, input.turn));
  if (turn !== 0) p.facing = wrapAngle(p.facing + turn * CONFIG.TURN_SPEED * dt);

  const forward = Math.max(-1, Math.min(1, input.forward));
  if (forward === 0) return 0;

  // 시선 방향 단위벡터. facing 규약은 atan2(x, z) 이므로 (sin, cos) 다.
  const dirX = Math.sin(p.facing) * Math.sign(forward);
  const dirZ = Math.cos(p.facing) * Math.sign(forward);

  const backward = forward < 0 ? CONFIG.BACK_MULTIPLIER : 1;
  const speed = state.moveSpeed * (running ? CONFIG.RUN_MULTIPLIER : 1) * backward;
  const step = speed * dt * Math.abs(forward);

  const target: Vec2 = { x: p.pos.x + dirX * step, z: p.pos.z + dirZ * step };
  // 자세에 따라 다른 범위를 쓴다 — 화장실과 가구 상판은 거실 충돌맵 밖이다. (§6, §7)
  const resolved = resolveByStance(state, p.pos, target);

  const movedX = resolved.x - p.pos.x;
  const movedZ = resolved.z - p.pos.z;
  p.pos.x = resolved.x;
  p.pos.z = resolved.z;

  return Math.hypot(movedX, movedZ);
}
