/**
 * 새끼 도마뱀. 순수 로직. (§0-4, §24)
 *
 * 산란(§24 MateSystem)의 보상을 **즉시 한 덩어리**에서 **따라다니는 동안 조금씩**
 * 으로 옮긴 것이다. 산란하면 새끼가 태어나 플레이어를 쫓아다니며 일정 간격마다
 * 제자리에 싼다. 총량은 예전 산란 보너스(24칸)와 같은 급이고, 대신 새끼 똥도
 * 플레이어 똥과 **같은 `applyPoop`** 을 쓰므로 중첩 손실과 청소기 침식을 똑같이 받는다.
 * 근거는 ROADMAP §3-8i.
 *
 * 새끼는 적이 아니다 — 피해를 주지도 받지도 않고, 플레이어와 부딪히지도 않는다.
 * "새끼를 지켜야 한다" 는 압박을 얹으면 §1 의 욕심 vs 안전 위에 다른 축이 하나 더
 * 생겨서, 이미 빡빡한 판단이 흐려진다.
 *
 * 경로는 인간과 **같은 것**을 쓴다 (Pathfinding 의 BFS + 0.5초 재계산 제한).
 * 따라다니는 것은 쫓아다니는 것과 같은 문제라 새 경로 코드를 쓸 이유가 없다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { GameState, HatchlingState } from '../core/GameState.ts';
import { Phase, dist, normalize, type Vec2 } from '../core/types.ts';
import { tickDown } from './MovementSystem.ts';
import { nextWaypoint } from './Pathfinding.ts';
import { applyPoop } from './TerritorySystem.ts';

/** 인간과 같은 재계산 제한 (§24) */
const PATH_INTERVAL = 0.5;

let nextHatchlingId = 1;

/**
 * 새끼를 태어나게 한다. 산란 지점에서 부른다.
 *
 * 상한을 넘으면 **가장 오래된 새끼가 먼저 떠난다.** 새로 태어난 쪽을 거절하면
 * 산란했는데 아무 일도 안 일어나는 판이 생긴다 — 25초를 기다린 대가가 그럴 수는 없다.
 */
export function spawnHatchling(state: GameState, pos: Vec2, bus?: EventBus): HatchlingState {
  while (state.hatchlings.length >= CONFIG.HATCHLING_MAX) {
    const gone = state.hatchlings.shift();
    if (gone) bus?.emit('hatchling:left', { pos: { ...gone.pos } });
  }

  const born: HatchlingState = {
    id: nextHatchlingId++,
    pos: { x: pos.x, z: pos.z },
    facing: state.player.facing,
    lifeLeft: CONFIG.HATCHLING_LIFETIME_SEC,
    poopIn: CONFIG.HATCHLING_FIRST_POOP_SEC,
    pathCooldown: 0,
    waypoint: { x: pos.x, z: pos.z },
  };

  state.hatchlings.push(born);
  bus?.emit('hatchling:born', { pos: { ...born.pos } });
  return born;
}

/** 고정 스텝마다 호출한다. */
export function updateHatchlings(state: GameState, dt: number, bus?: EventBus): void {
  if (state.phase !== Phase.PLAYING) return;
  if (state.hatchlings.length === 0) return;

  let territoryChanged = false;

  // 뒤에서부터 도는 이유: 수명이 다한 새끼를 그 자리에서 빼도 인덱스가 밀리지 않는다.
  for (let i = state.hatchlings.length - 1; i >= 0; i--) {
    const h = state.hatchlings[i]!;

    h.lifeLeft = tickDown(h.lifeLeft, dt);
    if (h.lifeLeft === 0) {
      state.hatchlings.splice(i, 1);
      bus?.emit('hatchling:left', { pos: { ...h.pos } });
      continue;
    }

    follow(state, h, dt);
    if (poop(state, h, dt, bus)) territoryChanged = true;
  }

  // 여러 마리가 같은 스텝에 쌌어도 통지는 한 번이면 된다.
  if (territoryChanged) {
    bus?.emit('territory:changed', { owned: state.ownedCells, ratio: state.territoryRatio });
  }
}

/**
 * 플레이어를 따라간다.
 *
 * `HATCHLING_FOLLOW_DIST` 안에 들어오면 멈춘다. 끝까지 붙으면 쿼터뷰에서 부모
 * 실루엣 아래로 파고들어 두 마리가 한 덩어리로 보인다.
 *
 * 플레이어가 담요 밑·가구 위·화장실에 있어도 목표는 그대로 그 좌표다. 새끼는
 * 그 근처에서 서성이며 계속 싼다 — 화장실에 간 사이에도 방이 조금씩 칠해지는
 * 것이 §14 변기 왕복의 대가를 덜어 주는 쪽으로 작동한다.
 */
function follow(state: GameState, h: HatchlingState, dt: number): void {
  const target = state.player.pos;
  if (dist(h.pos, target) <= CONFIG.HATCHLING_FOLLOW_DIST) return;

  h.pathCooldown = tickDown(h.pathCooldown, dt);
  if (h.pathCooldown === 0) {
    h.pathCooldown = PATH_INTERVAL;
    h.waypoint = nextWaypoint(state.collision, CONFIG.HATCHLING_RADIUS, h.pos, target);
  }

  const dir = normalize({ x: h.waypoint.x - h.pos.x, z: h.waypoint.z - h.pos.z });
  if (dir.x === 0 && dir.z === 0) return;

  const step = state.moveSpeed * CONFIG.HATCHLING_SPEED_MUL * dt;
  const to = { x: h.pos.x + dir.x * step, z: h.pos.z + dir.z * step };
  const resolved = state.collision.resolveMove(h.pos, to, CONFIG.HATCHLING_RADIUS);

  h.pos.x = resolved.x;
  h.pos.z = resolved.z;
  h.facing = Math.atan2(dir.x, dir.z);
}

/** 간격마다 제자리에 싼다. 실제로 영역이 늘었으면 true. */
function poop(state: GameState, h: HatchlingState, dt: number, bus?: EventBus): boolean {
  h.poopIn = tickDown(h.poopIn, dt);
  if (h.poopIn > 0) return false;

  h.poopIn = CONFIG.HATCHLING_POOP_INTERVAL;

  const gained = applyPoop(state, h.pos, CONFIG.HATCHLING_POOP_RADIUS_CELLS);
  bus?.emit('hatchling:poop', { pos: { ...h.pos }, gainedCells: gained });
  return gained > 0;
}

/** 지금 살아 있는 새끼 중 남은 수명이 가장 짧은 값 [0, 1]. 없으면 null (HUD 용) */
export function hatchlingLifeProgress(state: GameState): number | null {
  let min = Infinity;
  for (const h of state.hatchlings) min = Math.min(min, h.lifeLeft);
  return Number.isFinite(min) ? min / CONFIG.HATCHLING_LIFETIME_SEC : null;
}

/** 재시작 시 초기화. GameState 를 새로 만들지만 명시적으로 둔다. (§8) */
export function resetHatchlings(state: GameState): void {
  state.hatchlings.length = 0;
  nextHatchlingId = 1;
}
