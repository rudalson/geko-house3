/**
 * 인간 적. Lvl 2(Age 4) 부터 등장한다. 순수 로직. (§0-4, §24)
 *
 * §24 는 "복잡한 내비게이션 메시를 만들지 말고 격자 기반 경로를 쓰되
 * 경로 재계산은 0.5초에 1회로 제한"하라고 요구한다. Pathfinding 의 BFS 를 쓴다.
 *
 * 인간은 청소기와 역할이 다르다.
 *   - 청소기는 **영역**을 지운다. 느리고, 경로가 읽히고, 피하기 쉽다.
 *   - 인간은 **플레이어**를 쫓는다. 빠르고, 피하려면 담요·가구로 숨어야 한다.
 *
 * 그래서 인간이 등장하는 순간 §13 은신과 §7 등반이 선택지에서 필수가 된다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { GameState, HumanState } from '../core/GameState.ts';
import { Phase, Stance, dist, normalize } from '../core/types.ts';
import { circlesOverlap } from '../world/CollisionMap.ts';
import { applyDamage } from './DamageSystem.ts';
import { tickDown } from './MovementSystem.ts';
import { nextWaypoint } from './Pathfinding.ts';

let nextHumanId = 1;

/** 인간이 등장해야 하는 레벨인지 */
export function shouldHumanAppear(state: GameState): boolean {
  return state.player.levelIndex >= CONFIG.HUMAN_FROM_LEVEL;
}

/**
 * 플레이어가 인간에게 보이는지.
 * 담요 밑·가구 위·화장실에서는 추적 대상이 아니다. (§24)
 */
export function isVisibleToHuman(state: GameState): boolean {
  return state.phase === Phase.PLAYING && state.player.stance === Stance.GROUND;
}

/** Lvl 2 에 도달하면 인간을 등장시킨다. 이미 있으면 아무 일도 하지 않는다. */
export function spawnHumanIfDue(state: GameState, bus?: EventBus): boolean {
  if (!shouldHumanAppear(state) || state.humans.length > 0) return false;

  const points = state.collision.standablePoints(CONFIG.HUMAN_RADIUS);
  if (points.length === 0) return false;

  // 플레이어에게서 충분히 떨어진 곳에서 걸어 들어온다.
  const far = points.filter((p) => dist(p, state.player.pos) > CONFIG.HUMAN_SIGHT + 2);
  const spot = state.rng.pick(far.length > 0 ? far : points);

  state.humans.push({
    id: nextHumanId++,
    pos: { x: spot.x, z: spot.z },
    facing: 0,
    mode: 'idle',
    pathCooldown: 0,
    waypoint: { x: spot.x, z: spot.z },
    speechLeft: 0,
    giveupLeft: 0,
    wanderTo: { x: spot.x, z: spot.z },
    resting: false,
    dutyLeft: CONFIG.HUMAN_HUNT_TIME,
  });

  bus?.emit('player:levelUp', { level: state.player.levelIndex + 1, age: state.player.age });
  return true;
}

export function resetHumans(state: GameState): void {
  state.humans.length = 0;
  nextHumanId = 1;
}

export function updateHumans(state: GameState, dt: number, bus?: EventBus): void {
  if (state.phase !== Phase.PLAYING) return;

  spawnHumanIfDue(state);

  for (const h of state.humans) {
    if (h.speechLeft > 0) h.speechLeft = tickDown(h.speechLeft, dt);
    if (h.giveupLeft > 0) h.giveupLeft = tickDown(h.giveupLeft, dt);
    h.pathCooldown = tickDown(h.pathCooldown, dt);

    updateDutyCycle(state, h, dt);
    updateMode(state, h, bus);
    moveHuman(state, h, dt);
    checkCatch(state, h, bus);
  }
}

/**
 * 사냥 ↔ 휴식 주기.
 * 휴식 중에는 플레이어를 찾지 않는다 — 그동안이 파밍 창이다.
 */
function updateDutyCycle(state: GameState, h: HumanState, dt: number): void {
  h.dutyLeft = tickDown(h.dutyLeft, dt);
  if (h.dutyLeft > 0) return;

  if (h.resting) {
    h.resting = false;
    h.dutyLeft = CONFIG.HUMAN_HUNT_TIME;
  } else {
    h.resting = true;
    h.dutyLeft = CONFIG.HUMAN_REST_TIME;
    // 쉬러 갈 때는 플레이어에게서 멀어진다.
    giveUp(state, h);
  }
}

/** 지금 사냥 중인지 (HUD·연출용) */
export function isHunting(h: HumanState): boolean {
  return !h.resting;
}

function updateMode(state: GameState, h: HumanState, bus?: EventBus): void {
  const visible = isVisibleToHuman(state);
  const d = dist(h.pos, state.player.pos);

  if (h.mode === 'chase') {
    // 숨거나 올라가면 즉시 놓친다. 멀어져도 놓친다.
    if (!visible || d > CONFIG.HUMAN_LOSE_RANGE) {
      giveUp(state, h);
    }
    return;
  }

  if (h.resting) return; // 휴식 중에는 찾지 않는다
  if (h.giveupLeft > 0) return; // 포기 직후에는 다시 발견하지 않는다

  if (visible && d <= CONFIG.HUMAN_SIGHT) {
    h.mode = 'chase';
    h.speechLeft = CONFIG.HUMAN_SPEECH_TIME;
    h.pathCooldown = 0;
    bus?.emit('human:spotted', { pos: { ...h.pos } });
  } else if (h.mode === 'giveup') {
    h.mode = 'idle';
  }
}

/**
 * 추적을 포기한다.
 *
 * **반드시 플레이어에게서 먼 곳으로 걸어가게 해야 한다.**
 * 제자리에서 배회하면 은신이 끝나 나오는 순간 시야(6m) 안이라 곧바로 다시
 * 발견되고, 담요·가구가 아무 의미가 없어진다. 그러면 §24 가 의도한 대응 수단이
 * 사라지고 "도망만 다니다 굶어 죽는" 게임이 된다.
 */
function giveUp(state: GameState, h: HumanState): void {
  h.mode = 'giveup';
  h.giveupLeft = CONFIG.HUMAN_GIVEUP_TIME;
  h.pathCooldown = 0;

  const points = state.collision.standablePoints(CONFIG.HUMAN_RADIUS);
  const far = points.filter((p) => dist(p, state.player.pos) > CONFIG.HUMAN_SIGHT * 1.6);
  if (far.length > 0) {
    const spot = state.rng.pick(far);
    h.wanderTo = { x: spot.x, z: spot.z };
  }
}

function moveHuman(state: GameState, h: HumanState, dt: number): void {
  // 목적지 갱신 — 재계산은 HUMAN_PATH_INTERVAL 에 1회로 제한한다. (§24)
  if (h.pathCooldown === 0) {
    h.pathCooldown = CONFIG.HUMAN_PATH_INTERVAL;

    if (h.mode === 'chase') {
      h.waypoint = nextWaypoint(state.collision, CONFIG.HUMAN_RADIUS, h.pos, state.player.pos);
    } else {
      // 배회 — 목적지에 닿았으면 새로 고른다
      if (dist(h.pos, h.wanderTo) < 0.6) {
        const points = state.collision.standablePoints(CONFIG.HUMAN_RADIUS);
        if (points.length > 0) {
          const p = state.rng.pick(points);
          h.wanderTo = { x: p.x, z: p.z };
        }
      }
      h.waypoint = nextWaypoint(state.collision, CONFIG.HUMAN_RADIUS, h.pos, h.wanderTo);
    }
  }

  const speed = CONFIG.HUMAN_SPEED * (h.mode === 'chase' ? 1 : 0.45);
  const dir = normalize({ x: h.waypoint.x - h.pos.x, z: h.waypoint.z - h.pos.z });
  if (dir.x === 0 && dir.z === 0) return;

  const step = speed * dt;
  const target = { x: h.pos.x + dir.x * step, z: h.pos.z + dir.z * step };
  const resolved = state.collision.resolveMove(h.pos, target, CONFIG.HUMAN_RADIUS);

  h.pos.x = resolved.x;
  h.pos.z = resolved.z;
  h.facing = Math.atan2(dir.x, dir.z);
}

function checkCatch(state: GameState, h: HumanState, bus?: EventBus): void {
  if (!isVisibleToHuman(state) || state.isInvulnerable) return;
  if (!circlesOverlap(h.pos, CONFIG.HUMAN_RADIUS, state.player.pos, state.playerRadius)) return;

  applyDamage(state, 'human', h.pos, bus);
  // 잡은 뒤에는 멀리 물러난다 — 무적이 풀리자마자 다시 잡으면 불공정하다.
  giveUp(state, h);
}

/** 지금 추적당하고 있는지 (HUD·연출용) */
export function isBeingChased(state: GameState): boolean {
  return state.humans.some((h) => h.mode === 'chase');
}
