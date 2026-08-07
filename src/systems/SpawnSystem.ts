/**
 * 슈퍼푸드 스폰. 순수 로직. (§0-4, §15)
 *
 * 스폰 위치는 §0-1 밸런스의 **핵심 레버**다.
 * 플레이어 근처에 뜨면 이동 시간이 사라져 배변 사이클이 짧아지고,
 * 44% 도달 시간이 계산보다 훨씬 빨라진다 (ROADMAP §3-7).
 * 따라서 FOOD_MIN_SPAWN_DIST 는 "연출"이 아니라 밸런스 제약이다.
 *
 * 난수는 전부 state.rng 를 쓴다. Math.random() 을 쓰면 재현이 불가능해진다. (§0-5)
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { FoodItem, GameState } from '../core/GameState.ts';
import { distSq, type Vec2 } from '../core/types.ts';
import { tickDown } from './MovementSystem.ts';

let nextFoodId = 1;

/** 슬롯을 만들고 첫 음식을 배치한다. 게임 시작 시 1회 호출. */
export function initFoods(state: GameState, bus?: EventBus): void {
  state.foods.length = 0;
  nextFoodId = 1;

  for (let i = 0; i < CONFIG.FOOD_MAX_CONCURRENT; i++) {
    const food: FoodItem = {
      id: nextFoodId++,
      pos: { x: 0, z: 0 },
      active: false,
      respawnLeft: 0,
      spawnedAt: 0,
    };
    state.foods.push(food);
    spawnInto(state, food, bus, /* firstSpawn */ true);
  }
}

/**
 * 스폰 위치를 고른다.
 *
 * 조건 우선순위:
 *   1. 캐릭터가 설 수 있는 자리
 *   2. 플레이어에서 FOOD_MIN_SPAWN_DIST 이상 (밸런스 제약)
 *   3. 다른 음식과 겹치지 않음
 *   4. 청소기에서 FOOD_MIN_VACUUM_DIST 이상
 *
 * 조건을 만족하는 후보가 없으면 조건을 순서대로 완화한다.
 * 완화해서라도 반드시 스폰해야 한다 — 음식이 안 나오면 게임이 멈춘다.
 */
function pickSpawnPos(state: GameState, exclude: FoodItem, firstSpawn: boolean): Vec2 {
  const points = state.collision.standablePoints(state.playerRadius);
  const player = state.player.pos;

  // 첫 스폰은 30초 안에 첫 배변을 경험시키기 위해 거리 제약을 절반만 적용한다. (§17, §26)
  const minPlayerDist = firstSpawn
    ? CONFIG.FOOD_MIN_SPAWN_DIST * 0.5
    : CONFIG.FOOD_MIN_SPAWN_DIST;

  const others = state.foods.filter((f) => f !== exclude && f.active);

  const tiers: ((p: Vec2) => boolean)[] = [
    // 모든 조건
    (p) =>
      distSq(p, player) >= minPlayerDist * minPlayerDist &&
      others.every((f) => distSq(p, f.pos) >= 3 * 3) &&
      farFromVacuums(state, p, CONFIG.FOOD_MIN_VACUUM_DIST),
    // 청소기 조건 완화
    (p) =>
      distSq(p, player) >= minPlayerDist * minPlayerDist &&
      others.every((f) => distSq(p, f.pos) >= 2 * 2),
    // 거리 조건 완화
    (p) => distSq(p, player) >= (minPlayerDist * 0.6) ** 2,
    // 최후 — 아무 데나
    () => true,
  ];

  for (const accept of tiers) {
    const candidates = points.filter(accept);
    if (candidates.length > 0) {
      const chosen = state.rng.pick(candidates);
      return { x: chosen.x, z: chosen.z };
    }
  }

  return { x: 0, z: 0 };
}

function farFromVacuums(state: GameState, p: Vec2, minDist: number): boolean {
  const vacuums = state.vacuums;
  if (!vacuums || vacuums.length === 0) return true;
  return vacuums.every((v) => distSq(p, v.pos) >= minDist * minDist);
}

function spawnInto(state: GameState, food: FoodItem, bus?: EventBus, firstSpawn = false): void {
  food.pos = pickSpawnPos(state, food, firstSpawn);
  food.active = true;
  food.respawnLeft = 0;
  food.spawnedAt = state.elapsed;
  bus?.emit('food:spawned', { id: food.id, pos: { ...food.pos } });
}

/** 리스폰 타이머를 진행시킨다. 고정 스텝마다 호출한다. */
export function updateSpawns(state: GameState, dt: number, bus?: EventBus): void {
  for (const food of state.foods) {
    if (food.active) continue;
    food.respawnLeft = tickDown(food.respawnLeft, dt);
    if (food.respawnLeft === 0) spawnInto(state, food, bus);
  }
}

/** 음식을 소비 상태로 만든다. 리스폰 타이머가 시작된다. */
export function consumeFood(state: GameState, food: FoodItem): void {
  food.active = false;
  food.respawnLeft = CONFIG.FOOD_RESPAWN_DELAY;
  void state;
}

/** 지금 먹을 수 있는 활성 음식 목록 */
export function activeFoods(state: GameState): FoodItem[] {
  return state.foods.filter((f) => f.active);
}
