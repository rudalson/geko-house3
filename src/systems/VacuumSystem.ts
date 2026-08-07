/**
 * 로봇청소기. 순수 로직. (§0-4, §12)
 *
 * **읽을 수 있는 움직임이 핵심이다.** 완전 무작위로 만들면 플레이어가 회피를
 * 학습할 수 없어 피해가 불공정하게 느껴진다.
 *
 *   - 1.5~3.5초 동안 **직선으로만** 이동한다
 *   - 벽·가구에 부딪히거나 직선 시간이 끝나면 회전한다
 *   - 회전은 즉시 꺾지 않고 0.4초 동안 시각적으로 돌아서
 *     플레이어가 다음 방향을 예측할 수 있게 한다
 *   - 반사 각도는 시드 기반 RNG 로 결정한다 (§0-5)
 */

import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { GameState, VacuumState } from '../core/GameState.ts';
import { Phase, dist } from '../core/types.ts';
import { circlesOverlap } from '../world/CollisionMap.ts';
import { applyDamage } from './DamageSystem.ts';
import { tickDown } from './MovementSystem.ts';
import { eraseCircle } from './TerritorySystem.ts';

/** 회전 후 방향에 섞는 무작위 흔들림 (라디안). 같은 궤도를 무한 반복하지 않게 한다. */
const TURN_JITTER = 0.35;

/** 각도를 [-π, π) 로 정규화 */
function normalizeAngle(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}

/** 최단 방향으로 각도 보간 */
function lerpAngle(from: number, to: number, t: number): number {
  return from + normalizeAngle(to - from) * t;
}

const headingToDir = (h: number): { x: number; z: number } => ({
  x: Math.sin(h),
  z: Math.cos(h),
});

/** 회전을 시작한다. 이 동안에는 이동하지 않는다. */
function beginTurn(state: GameState, v: VacuumState, target: number): void {
  v.turnFrom = v.heading;
  v.turnTo = normalizeAngle(target + state.rng.range(-TURN_JITTER, TURN_JITTER));
  v.turnLeft = CONFIG.VACUUM_TURN_TIME;
  v.straightLeft = state.rng.range(CONFIG.VACUUM_STRAIGHT_MIN, CONFIG.VACUUM_STRAIGHT_MAX);
}

export function initVacuums(state: GameState): void {
  state.vacuums.length = 0;

  const points = state.collision.standablePoints(CONFIG.VACUUM_RADIUS);
  if (points.length === 0) return;

  for (let i = 0; i < CONFIG.VACUUM_COUNT; i++) {
    // 시작하자마자 플레이어를 덮치지 않도록 충분히 떨어진 곳에서 시작한다.
    const far = points.filter((p) => dist(p, state.player.pos) > 5);
    const spot = state.rng.pick(far.length > 0 ? far : points);
    const heading = state.rng.range(-Math.PI, Math.PI);

    state.vacuums.push({
      id: i + 1,
      pos: { x: spot.x, z: spot.z },
      heading,
      straightLeft: state.rng.range(CONFIG.VACUUM_STRAIGHT_MIN, CONFIG.VACUUM_STRAIGHT_MAX),
      turnLeft: 0,
      turnFrom: heading,
      turnTo: heading,
      slowLeft: 0,
    });
  }
}

/** 변기 보너스로 감속시킨다. (§14) */
export function slowVacuums(state: GameState): void {
  for (const v of state.vacuums) v.slowLeft = CONFIG.TOILET_VACUUM_SLOW_TIME;
}

export function updateVacuums(state: GameState, dt: number, bus?: EventBus): void {
  if (state.phase !== Phase.PLAYING) return;

  for (const v of state.vacuums) {
    if (v.slowLeft > 0) v.slowLeft = tickDown(v.slowLeft, dt);

    // ── 회전 중: 제자리에서 시각적으로 돌기만 한다 ──
    if (v.turnLeft > 0) {
      v.turnLeft = tickDown(v.turnLeft, dt);
      const progress = 1 - v.turnLeft / CONFIG.VACUUM_TURN_TIME;
      v.heading = lerpAngle(v.turnFrom, v.turnTo, progress);
      if (v.turnLeft === 0) {
        v.heading = v.turnTo;
        bus?.emit('vacuum:turn', { heading: v.heading });
      }
    } else {
      // ── 직선 이동 ──
      const speed = DERIVED.VACUUM_SPEED_WORLD * (v.slowLeft > 0 ? CONFIG.TOILET_VACUUM_SLOW : 1);
      const step = speed * dt;
      const dir = headingToDir(v.heading);
      const next = { x: v.pos.x + dir.x * step, z: v.pos.z + dir.z * step };

      if (state.collision.canStand(next, CONFIG.VACUUM_RADIUS)) {
        v.pos.x = next.x;
        v.pos.z = next.z;
        v.straightLeft = tickDown(v.straightLeft, dt);
        if (v.straightLeft === 0) {
          // 직선 구간 종료 — 크게 방향을 튼다
          beginTurn(state, v, v.heading + state.rng.range(Math.PI / 3, (Math.PI * 5) / 3));
        }
      } else {
        beginTurn(state, v, reflectHeading(state, v, next));
      }
    }

    // ── 청소 ──
    // 회전 중에도 호출되지만 제자리라 새로 지워지는 셀이 없다.
    // (모델의 duty 계수가 바로 이 "회전 중에는 새 바닥을 훑지 못함"이다)
    const erased = eraseCircle(state, v.pos, DERIVED.VACUUM_CLEAN_RADIUS_WORLD);
    if (erased > 0) {
      state.stats.erasedCells += erased;
      bus?.emit('vacuum:cleaned', { pos: { ...v.pos }, erasedCells: erased });
      bus?.emit('territory:changed', { owned: state.ownedCells, ratio: state.territoryRatio });
    }

    // ── 플레이어 충돌 ──
    // 가구 위·담요 밑에서는 판정 대상에서 제외된다. (§7, §13)
    if (state.isVulnerableToVacuum && circlesOverlap(v.pos, CONFIG.VACUUM_RADIUS, state.player.pos, state.playerRadius)) {
      applyDamage(state, 'vacuum', v.pos, bus);
    }
  }
}

/**
 * 벽·가구에 부딪혔을 때의 반사 방향.
 * 어느 축이 막혔는지 각각 시험해서 그 축만 뒤집는다.
 * (둘 다 막혔으면 되돌아간다)
 */
function reflectHeading(state: GameState, v: VacuumState, blocked: { x: number; z: number }): number {
  const r = CONFIG.VACUUM_RADIUS;
  const xBlocked = !state.collision.canStand({ x: blocked.x, z: v.pos.z }, r);
  const zBlocked = !state.collision.canStand({ x: v.pos.x, z: blocked.z }, r);

  // dir = (sin h, cos h) 이므로
  //   x 뒤집기 → -h,  z 뒤집기 → π − h
  if (xBlocked && !zBlocked) return -v.heading;
  if (zBlocked && !xBlocked) return Math.PI - v.heading;
  return v.heading + Math.PI;
}

/** 청소기가 지금 초당 지우고 있는 양 (셀/초). 디버그 계측용 (§19) */
export function currentErosionRate(state: GameState): number {
  const widthCells = CONFIG.VACUUM_CLEAN_RADIUS_CELLS * 2;
  let rate = 0;
  for (const v of state.vacuums) {
    if (v.turnLeft > 0) continue; // 회전 중에는 새 바닥을 훑지 않는다
    const speedCells = CONFIG.VACUUM_SPEED_CELLS * (v.slowLeft > 0 ? CONFIG.TOILET_VACUUM_SLOW : 1);
    rate += speedCells * widthCells;
  }
  // 실제로 지워지는 건 그 중 똥 땅인 비율만큼이다.
  return rate * state.territoryRatio;
}
