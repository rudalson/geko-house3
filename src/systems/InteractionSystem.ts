/**
 * 상황별 상호작용 (`E` / `Z`). 순수 로직. (§0-4, §7)
 *
 * **동시에 여러 대상이 범위 안에 있으면 가장 가까운 것 하나만** 표시하고
 * 그것만 실행한다. 그러지 않으면 담요 옆 음식을 먹으려다 숨어버리는 식의
 * 오작동이 생긴다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { FoodItem, GameState, TreatItem } from '../core/GameState.ts';
import { Stance, dist, type Vec2 } from '../core/types.ts';
import { restoreHunger } from './HungerSystem.ts';
import { addPoopGauge } from './PoopSystem.ts';
import { consumeFood } from './SpawnSystem.ts';
import { consumeTreat } from './TreatSystem.ts';
import { tickDown } from './MovementSystem.ts';
import { climbableFurniture, findFurniture, type FurnitureDef } from '../world/furnitureLayout.ts';
import { BATHROOM_EXIT, LIVING_DOOR, TOILET_POS } from '../world/bathroomLayout.ts';
import {
  climbDown,
  climbOnto,
  enterBathroom,
  exitBathroom,
  hideUnderBlanket,
  leaveBlanket,
  startToilet,
} from './ShelterSystem.ts';

/** 상호작용 사정거리 (world units) */
export const INTERACT_RANGE = 1.1;
/** 음식이 반짝이기 시작하는 거리 (§15) */
export const SPARKLE_RANGE = 2.2;

export type InteractionKind =
  | 'food'
  | 'blanket-hide'
  | 'blanket-leave'
  | 'climb-up'
  | 'climb-down'
  | 'bathroom-enter'
  | 'bathroom-exit'
  | 'toilet'
  | 'treat';

export interface Interaction {
  kind: InteractionKind;
  label: string;
  distance: number;
  food?: FoodItem;
  treat?: TreatItem;
  furniture?: FurnitureDef;
}

/**
 * 지금 상호작용할 수 있는 가장 가까운 대상.
 * HUD 안내와 실제 실행이 **같은 함수**를 쓰므로 안내와 동작이 어긋나지 않는다.
 */
export function findInteraction(state: GameState): Interaction | null {
  if (state.phase !== 'PLAYING') return null;
  const p = state.player;
  if (p.eatAnimLeft > 0 || p.poopAnimLeft > 0 || p.toiletAnimLeft > 0) return null;
  if (p.climbAnimLeft > 0 || p.transitionLeft > 0) return null;

  // ── 이미 특수 자세라면 "나가기"가 유일한 선택지다 ──
  if (p.stance === Stance.HIDDEN) {
    return { kind: 'blanket-leave', label: 'E: 담요 밖으로 나가기', distance: 0 };
  }
  if (p.stance === Stance.ON_FURNITURE) {
    return { kind: 'climb-down', label: 'E: 내려가기', distance: 0 };
  }
  if (p.stance === Stance.BATHROOM) {
    const toToilet = dist(p.pos, TOILET_POS);
    const toExit = dist(p.pos, BATHROOM_EXIT);
    if (toToilet <= INTERACT_RANGE && toToilet <= toExit) {
      return p.poop >= CONFIG.POOP_MAX
        ? { kind: 'toilet', label: 'E: 변기 사용', distance: toToilet }
        : { kind: 'toilet', label: '똥 게이지가 가득 차야 해', distance: toToilet };
    }
    if (toExit <= INTERACT_RANGE) {
      return { kind: 'bathroom-exit', label: 'E: 거실로 돌아가기', distance: toExit };
    }
    return null;
  }

  // ── 거실 바닥 ──
  // 음식이 사정거리 안에 있으면 **무조건 음식이 우선**이다.
  //
  // 담요는 밟고 지나갈 수 있어서 그 위에 음식이 스폰될 수 있다. 그때 거리로만
  // 비교하면 담요(사각형까지 거리 0)가 항상 이겨서 그 음식을 영영 못 먹는다.
  // 애초에 점(음식)까지의 거리와 면(가구)까지의 거리를 같은 자로 재는 게 잘못이다.
  // 먹기는 이 게임의 주 동사이므로 우선권을 준다.
  let nearestFood: Interaction | null = null;
  for (const treat of state.treats) {
    if (!treat.active) continue;
    const d = dist(p.pos, treat.pos);
    if (d > INTERACT_RANGE) continue;
    if (!nearestFood || d < nearestFood.distance) {
      nearestFood = { kind: 'treat', label: 'E: 특식 열기 ✨', distance: d, treat };
    }
  }
  for (const food of state.foods) {
    if (!food.active) continue;
    const d = dist(p.pos, food.pos);
    if (d > INTERACT_RANGE) continue;
    if (!nearestFood || d < nearestFood.distance) {
      nearestFood = { kind: 'food', label: 'E: 슈퍼푸드 먹기', distance: d, food };
    }
  }
  if (nearestFood) return nearestFood;

  let best: Interaction | null = null;
  const consider = (c: Interaction): void => {
    if (!best || c.distance < best.distance) best = c;
  };

  const blanket = findFurniture('blanket');
  if (blanket) {
    // 담요는 넓은 면이라 중심 거리가 아니라 사각형까지의 거리로 본다.
    const d = distanceToFurniture(p.pos, blanket);
    if (d <= INTERACT_RANGE) {
      consider({ kind: 'blanket-hide', label: 'E: 담요 밑에 숨기', distance: d, furniture: blanket });
    }
  }

  for (const f of climbableFurniture()) {
    const d = distanceToFurniture(p.pos, f);
    if (d <= INTERACT_RANGE) {
      consider({
        kind: 'climb-up',
        label: `E: ${f.label ?? '가구'} 위로 올라가기`,
        distance: d,
        furniture: f,
      });
    }
  }

  const doorDist = dist(p.pos, LIVING_DOOR);
  if (doorDist <= INTERACT_RANGE * 1.6) {
    consider({ kind: 'bathroom-enter', label: 'E: 화장실로 이동', distance: doorDist });
  }

  return best;
}

/** 가구 사각형까지의 최단 거리 (안에 있으면 0) */
function distanceToFurniture(p: Vec2, f: FurnitureDef): number {
  const dx = Math.max(f.x - f.w / 2 - p.x, 0, p.x - (f.x + f.w / 2));
  const dz = Math.max(f.z - f.d / 2 - p.z, 0, p.z - (f.z + f.d / 2));
  return Math.hypot(dx, dz);
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

  switch (target.kind) {
    case 'food':
      if (!target.food) return false;
      startEating(state, target.food, bus);
      return true;

    case 'treat':
      if (!target.treat) return false;
      return consumeTreat(state, target.treat, bus) !== null;

    case 'blanket-hide':
      if (!target.furniture) return false;
      hideUnderBlanket(state, target.furniture, bus);
      return true;

    case 'blanket-leave':
      leaveBlanket(state);
      return true;

    case 'climb-up':
      if (!target.furniture) return false;
      climbOnto(state, target.furniture);
      return true;

    case 'climb-down':
      climbDown(state);
      return true;

    case 'bathroom-enter':
      enterBathroom(state);
      return true;

    case 'bathroom-exit':
      exitBathroom(state);
      return true;

    case 'toilet':
      return startToilet(state);

    default:
      return false;
  }
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
