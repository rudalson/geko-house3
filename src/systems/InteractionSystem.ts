/**
 * 상황별 상호작용 (`E` / `Z`). 순수 로직. (§0-4, §7)
 *
 * **동시에 여러 대상이 범위 안에 있으면 가장 가까운 것 하나만** 표시하고
 * 그것만 실행한다. 그러지 않으면 담요 옆 음식을 먹으려다 숨어버리는 식의
 * 오작동이 생긴다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { FoodItem, GameState } from '../core/GameState.ts';
import { Stance, dist, type Vec2 } from '../core/types.ts';
import { restoreHunger } from './HungerSystem.ts';
import { addPoopGauge } from './PoopSystem.ts';
import { consumeFood } from './SpawnSystem.ts';
import { tickDown } from './MovementSystem.ts';

/** 상호작용 사정거리 (world units) */
export const INTERACT_RANGE = 1.1;
/** 음식이 반짝이기 시작하는 거리 (§15) */
export const SPARKLE_RANGE = 2.2;

export type InteractionKind = 'food';

export interface Interaction {
  kind: InteractionKind;
  label: string;
  distance: number;
  food?: FoodItem;
}

/**
 * 지금 상호작용할 수 있는 가장 가까운 대상.
 * HUD 안내와 실제 실행이 **같은 함수**를 쓰므로 안내와 동작이 어긋나지 않는다.
 */
export function findInteraction(state: GameState): Interaction | null {
  if (state.phase !== 'PLAYING') return null;
  const p = state.player;
  if (p.eatAnimLeft > 0 || p.poopAnimLeft > 0) return null;
  if (p.stance === Stance.HIDDEN) return null;

  let best: Interaction | null = null;

  for (const food of state.foods) {
    if (!food.active) continue;
    const d = dist(p.pos, food.pos);
    if (d > INTERACT_RANGE) continue;
    if (best && d >= best.distance) continue;
    best = { kind: 'food', label: 'E: 슈퍼푸드 먹기', distance: d, food };
  }

  return best;
}

/** 플레이어와 가까워 반짝여야 하는 음식인지 (§15) */
export function isSparkling(state: GameState, food: FoodItem): boolean {
  return food.active && dist(state.player.pos, food.pos) <= SPARKLE_RANGE;
}

/**
 * 상호작용을 실행한다.
 * @returns 실행했으면 true
 */
export function executeInteraction(state: GameState, bus?: EventBus): boolean {
  const target = findInteraction(state);
  if (!target) return false;

  if (target.kind === 'food' && target.food) {
    startEating(state, target.food, bus);
    return true;
  }
  return false;
}

/** 먹기 시작. 애니메이션 동안 이동할 수 없다 — 사이클 시간에 포함된다. */
function startEating(state: GameState, food: FoodItem, bus?: EventBus): void {
  state.player.eatAnimLeft = CONFIG.FOOD_EAT_TIME;
  // 먹는 도중 다른 캐릭터가 같은 음식을 먹지 못하도록 즉시 소비 처리한다.
  consumeFood(state, food);
  state.pendingFood = { ...food.pos };
  bus?.emit('food:eaten', {
    id: food.id,
    pos: { ...food.pos },
    hunger: CONFIG.FOOD_HUNGER_RESTORE,
    poop: CONFIG.POOP_PER_FOOD,
  });
}

/**
 * 먹기 애니메이션을 진행시키고, 끝나면 실제 효과를 적용한다.
 * 고정 스텝마다 호출한다.
 */
export function updateEating(state: GameState, dt: number, bus?: EventBus): void {
  const p = state.player;
  if (p.eatAnimLeft <= 0) return;

  p.eatAnimLeft = tickDown(p.eatAnimLeft, dt);
  if (p.eatAnimLeft > 0) return;

  // ── 완료 ──
  restoreHunger(state, CONFIG.FOOD_HUNGER_RESTORE);
  addPoopGauge(state, CONFIG.POOP_PER_FOOD);

  p.foodsEaten++;
  if (state.refreshGrowth()) {
    bus?.emit('player:levelUp', { level: p.levelIndex + 1, age: p.age });
  }

  state.pendingFood = null;
}

/** 먹는 중인 음식의 위치 (연출용) */
export function eatingAt(state: GameState): Vec2 | null {
  return state.pendingFood;
}
