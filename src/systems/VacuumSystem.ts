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
 *   - 흔들림과 반사 각도는 시드 기반 RNG 로 결정한다 (§0-5)
 *
 * 방향을 **어디로** 틀지는 무작위가 아니라 커버리지가 정한다. 방을 4x3 구역으로
 * 나눠 머문 시간을 재고, 직선 구간이 끝나면 가장 덜 간 구역 쪽으로 향한다.
 * 이유와 실측은 아래 ZONES_X 주석 참고.
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

/**
 * 커버리지 기억. 방을 이 격자로 나눠 구역마다 머문 시간을 재고, 방향을 새로 고를 때
 * **덜 간 구역** 쪽을 고른다.
 *
 * 이게 없으면 청소기는 방 한구석에서 2~3초짜리 짧은 직선을 왕복한다. 직선 한 구간은
 * 1~2 world unit 인데 방은 16x12 라, 무작위 반사만으로는 반대편까지 갈 이유가 없다.
 * (실측: 4분 동안 바닥의 17%만 지나갔고, 12구역 중 7곳은 아예 밟지 않았다.
 *  `node tools/vacuum-coverage.ts` 로 재현된다)
 *
 * 무작위를 없애는 게 아니라 **방향 선택에만 편향을 준다.** 속도도 청소 폭도 직선
 * 길이도 그대로이므로 §3 의 침식 속도 모델(S = 속도 x 폭)은 영향을 받지 않는다.
 */
const ZONES_X = 4;
const ZONES_Z = 3;
export const ZONE_COUNT = ZONES_X * ZONES_Z;

/** 구역 기억이 절반으로 옅어지는 시간 (초). 한 바퀴 돌고 나면 다시 돌 이유가 생긴다. */
const ZONE_HALF_LIFE = 90;
/** 앞을 살피는 거리 (world units) */
const LOOKAHEAD = 2.5;
/**
 * 가는 길이 막혔을 때의 감점. 코앞에서 막힐수록 크다.
 * 목표 비용(GOAL_COST)보다 확실히 커야 한다 — 작으면 "목표 쪽이니까" 하며 가구로
 * 돌진하고, 부딪히고, 또 같은 방향을 골라 그 자리에서 시간을 태운다.
 */
const BLOCKED_PENALTY = 150;
/** 목표 구역에서 빗나간 각도에 매기는 비용 */
const GOAL_COST = 100;
/**
 * 목표 구역이 멀수록 매기는 비용 (방 대각선 기준).
 *
 * 이게 없으면 아직 아무 데도 안 가 본 판 시작 직후에는 모든 구역의 점수가 0 이라
 * 늘 같은 구역(인덱스가 가장 앞선 곳)으로 직행한다. 가까운 미개척 구역부터 훑는
 * 편이 자연스럽고, 방금 지나간 자리 근처를 아예 버리고 떠나지도 않는다.
 */
const DISTANCE_COST = 25;
/** 크게 꺾는 데 드는 비용. 읽을 수 있는 움직임을 위해 완만한 쪽을 조금 선호한다. (§12) */
const TURN_COST = 15;
/** 후보 방향 개수 */
const HEADINGS = 12;

/**
 * 갇힘 감지. 이 시간 동안 이 거리만큼도 못 벗어났으면 좁은 자리에 갇힌 것으로 본다.
 *
 * 가구 사이의 주머니 같은 자리에서는 몇 걸음 못 가 부딪히고, 부딪힐 때마다 0.4초를
 * 제자리 회전에 쓴다. 그러면 "움직이고는 있는데 벗어나지는 못하는" 상태가 길게
 * 이어진다. (실측: 어떤 시드에서는 안락의자 옆 1 unit 남짓한 틈에서 100초를 보냈다)
 */
const STUCK_WINDOW = 12;
const STUCK_MIN_TRAVEL = 1.6;
/** 탈출할 때 살피는 거리와 표본 간격 */
const ESCAPE_RANGE = 7;
const ESCAPE_STEP = 0.5;
/** 탈출 방향을 고를 때 목표 쪽을 얼마나 고려할지 (거리 단위당 라디안) */
const ESCAPE_GOAL_WEIGHT = 1.5;

/**
 * 갇혔을 때 쓸 방향. **멀리 뻗은 쪽**을 고르되 목표 구역 쪽을 조금 우대한다.
 *
 * 순수하게 가장 넓은 쪽만 보면 늘 방 한가운데로 나오게 되어, 애써 만든 커버리지
 * 편향이 탈출할 때마다 지워진다. 반대로 목표만 보면 애초에 갇히게 만든 그 방향을
 * 다시 고른다.
 */
function escapeHeading(state: GameState, v: VacuumState, want: number): number {
  let best = v.heading;
  let bestScore = -Infinity;

  for (let i = 0; i < HEADINGS * 2; i++) {
    const h = -Math.PI + (i / (HEADINGS * 2)) * Math.PI * 2;
    const dir = headingToDir(h);

    let clear = 0;
    for (let d = ESCAPE_STEP; d <= ESCAPE_RANGE; d += ESCAPE_STEP) {
      const probe = { x: v.pos.x + dir.x * d, z: v.pos.z + dir.z * d };
      if (!state.collision.canStand(probe, CONFIG.VACUUM_RADIUS)) break;
      clear = d;
    }

    const score = clear - ESCAPE_GOAL_WEIGHT * Math.abs(normalizeAngle(h - want));
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

/** 좌표가 속한 구역. 방 밖이면 가장 가까운 구역으로 몰아 준다. */
function zoneAt(pos: { x: number; z: number }): number {
  const u = (pos.x + DERIVED.ROOM_W / 2) / DERIVED.ROOM_W;
  const w = (pos.z + DERIVED.ROOM_H / 2) / DERIVED.ROOM_H;
  const zx = Math.min(ZONES_X - 1, Math.max(0, Math.floor(u * ZONES_X)));
  const zz = Math.min(ZONES_Z - 1, Math.max(0, Math.floor(w * ZONES_Z)));
  return zz * ZONES_X + zx;
}

/** 구역 한가운데의 월드 좌표 */
function zoneCenter(zone: number): { x: number; z: number } {
  const zx = zone % ZONES_X;
  const zz = Math.floor(zone / ZONES_X);
  return {
    x: ((zx + 0.5) / ZONES_X) * DERIVED.ROOM_W - DERIVED.ROOM_W / 2,
    z: ((zz + 0.5) / ZONES_Z) * DERIVED.ROOM_H - DERIVED.ROOM_H / 2,
  };
}

/**
 * 다음에 향할 방향.
 *
 * 먼저 **가장 덜 간 구역**을 목표로 잡고, 후보 방향 중 그쪽으로 가장 잘 향하면서
 * 막히지 않은 것을 고른다.
 *
 *   점수 = 목표에서 빗나간 각도 + 가는 길이 막힌 정도 + 꺾는 비용
 *
 * 목표를 먼저 정하는 게 핵심이다. 앞만 몇 미터 내다보고 고르게 하면 시야(4 units)
 * 밖의 구역은 존재하지도 않는 것이 되어, 청소기는 방 반대편으로 갈 이유를 영영
 * 찾지 못한다. 실제로 그렇게 만들었더니 8분을 돌려도 북서쪽 구역은 0% 였다.
 *
 * 경로를 계산하지는 않는다. 목표는 방향일 뿐이고 장애물은 그때그때 피한다 —
 * 1.5~3.5초마다 다시 고르므로 가구는 몇 구간에 걸쳐 자연스럽게 돌아간다.
 */
function goalHeading(v: VacuumState): number {
  const here = zoneAt(v.pos);
  const diagonal = Math.hypot(DERIVED.ROOM_W, DERIVED.ROOM_H);
  let target = here;
  let least = Infinity;
  for (let i = 0; i < v.zoneVisits.length; i++) {
    // 지금 있는 구역은 목표가 될 수 없다 — 그러면 제자리를 맴돈다.
    if (i === here) continue;
    const c = zoneCenter(i);
    const cost =
      v.zoneVisits[i]! + DISTANCE_COST * (Math.hypot(c.x - v.pos.x, c.z - v.pos.z) / diagonal);
    if (cost < least) {
      least = cost;
      target = i;
    }
  }

  const goal = zoneCenter(target);
  return Math.atan2(goal.x - v.pos.x, goal.z - v.pos.z);
}

function chooseHeading(state: GameState, v: VacuumState): number {
  const want = goalHeading(v);
  let best = want;
  let bestScore = Infinity;

  for (let i = 0; i < HEADINGS; i++) {
    const h = -Math.PI + (i / HEADINGS) * Math.PI * 2;
    const dir = headingToDir(h);

    // 가는 길을 3등분해서 막힌 지점을 찾는다. 일찍 막힐수록 크게 감점한다.
    let blocked = 0;
    for (let s = 1; s <= 3; s++) {
      const d = (s / 3) * LOOKAHEAD;
      const probe = { x: v.pos.x + dir.x * d, z: v.pos.z + dir.z * d };
      if (!state.collision.canStand(probe, CONFIG.VACUUM_RADIUS)) {
        blocked = BLOCKED_PENALTY * ((4 - s) / 3);
        break;
      }
    }

    const off = Math.abs(normalizeAngle(h - want)) / Math.PI;
    const turn = Math.abs(normalizeAngle(h - v.heading)) / Math.PI;
    const score = blocked + GOAL_COST * off + TURN_COST * turn;

    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}

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
      zoneVisits: new Array<number>(ZONE_COUNT).fill(0),
      stuckLeft: STUCK_WINDOW,
      stuckFrom: { x: spot.x, z: spot.z },
    });
  }
}

/** 변기 보너스로 감속시킨다. (§14) */
export function slowVacuums(state: GameState): void {
  for (const v of state.vacuums) v.slowLeft = CONFIG.TOILET_VACUUM_SLOW_TIME;
}

export function updateVacuums(state: GameState, dt: number, bus?: EventBus): void {
  if (state.phase !== Phase.PLAYING) return;
  // 특식 효과로 완전 정지 중이면 이동도 청소도 하지 않는다. (§24)
  if (state.vacuumStopLeft > 0) return;

  // 오래된 기록을 옅게 만드는 계수. 매 프레임 같은 값이므로 한 번만 구한다.
  const decay = Math.pow(0.5, dt / ZONE_HALF_LIFE);

  for (const v of state.vacuums) {
    if (v.slowLeft > 0) v.slowLeft = tickDown(v.slowLeft, dt);

    // ── 커버리지 기억 ──
    // 회전 중에도 센다. 그 자리에 있었던 건 사실이고, 그래야 제자리 회전을 반복하는
    // 동안 그 구역 점수가 올라가서 다음 방향이 바깥으로 향한다.
    for (let i = 0; i < v.zoneVisits.length; i++) v.zoneVisits[i]! *= decay;
    v.zoneVisits[zoneAt(v.pos)]! += dt;

    // ── 갇힘 감지 ──
    v.stuckLeft = tickDown(v.stuckLeft, dt);
    if (v.stuckLeft === 0) {
      if (dist(v.pos, v.stuckFrom) < STUCK_MIN_TRAVEL) {
        beginTurn(state, v, escapeHeading(state, v, goalHeading(v)));
        // 빠져나갈 때는 끝까지 뻗는다. 짧게 끊으면 같은 틈으로 되돌아온다.
        v.straightLeft = CONFIG.VACUUM_STRAIGHT_MAX;
      }
      v.stuckFrom.x = v.pos.x;
      v.stuckFrom.z = v.pos.z;
      v.stuckLeft = STUCK_WINDOW;
    }

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
          // 직선 구간 종료 — 덜 훑은 쪽으로 방향을 잡는다.
          //
          // 예전에는 `heading + rng(60°..300°)` 이었다. 그 분포의 평균은 180°,
          // 즉 **되돌아가기**다. 짧은 직선을 왔다 갔다 하니 방 한구석을 벗어나지 못했다.
          beginTurn(state, v, chooseHeading(state, v));
        }
      } else {
        // 부딪히면 반사한다. 여기서 커버리지를 따져 새로 고르게도 해 봤지만 더 나빴다 —
        // 목표 쪽이 가구로 막힌 자리에서는 부딪힐 때마다 같은 방향을 다시 골라
        // 제자리에서 회전만 반복했다. 물리적인 반사가 그런 교착에 빠지지 않는다.
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
