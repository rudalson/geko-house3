/**
 * 담요 은신(§13) · 가구 등반(§7) · 화장실 왕복과 변기(§6, §14).
 * 순수 로직. (§0-4)
 *
 * 셋 다 "잠시 안전해지는 대신 영역을 못 늘리는" 같은 구조라 한 파일에 둔다.
 * 셋 모두 배변이 차단되고(§10), 배고픔은 계속 줄어든다 —
 * 그게 농성을 막는 유일한 압박이다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { GameState } from '../core/GameState.ts';
import { Stance, type Vec2 } from '../core/types.ts';
import { findFurniture, type FurnitureDef } from '../world/furnitureLayout.ts';
import { BATHROOM_ENTRANCE, LIVING_DOOR, clampToBathroom } from '../world/bathroomLayout.ts';
import { applyDamage } from './DamageSystem.ts';
import { tickDown } from './MovementSystem.ts';
import { expandFromTerritory } from './TerritorySystem.ts';
import { slowVacuums } from './VacuumSystem.ts';

/** 화장실 왕복 페이드 시간 (§6) */
export const TRANSITION_TIME = 0.4;
/** 가구 위/아래 이동 보간 시간 (§7) */
export const CLIMB_TIME = 0.5;

// ════════════════════════════════════════════════════════════════════════
// 담요 은신 (§13)
// ════════════════════════════════════════════════════════════════════════

export function hideUnderBlanket(state: GameState, blanket: FurnitureDef, bus?: EventBus): void {
  const p = state.player;
  p.stance = Stance.HIDDEN;
  p.hiddenFor = 0;
  p.blanketWarned = false;
  // 담요 한가운데로 옮긴다 — 가장자리에 걸쳐 있으면 판정이 애매해진다.
  p.pos.x = blanket.x;
  p.pos.z = blanket.z;
  void bus;
}

export function leaveBlanket(state: GameState): void {
  const p = state.player;
  p.stance = Stance.GROUND;
  p.hiddenFor = 0;
  p.blanketWarned = false;
}

/**
 * 담요 밑 체류 시간을 관리한다.
 *
 * `BLANKET_WARN_TIME` 뒤에 경고, 그로부터 `BLANKET_DOG_TIME` 안에 나오지 않으면
 * 강아지가 담요 위에 눕는다 — 하트 -1, 밖으로 튕겨 나옴, 무적 적용.
 *
 * 강아지는 추적 AI 없이 이 타이머 이벤트로만 존재한다. (§13)
 */
export function updateBlanket(state: GameState, dt: number, bus?: EventBus): void {
  const p = state.player;
  if (p.stance !== Stance.HIDDEN) return;

  p.hiddenFor += dt;

  if (!p.blanketWarned && p.hiddenFor >= CONFIG.BLANKET_WARN_TIME) {
    p.blanketWarned = true;
    bus?.emit('blanket:warn', {});
  }

  if (p.hiddenFor >= CONFIG.BLANKET_WARN_TIME + CONFIG.BLANKET_DOG_TIME) {
    bus?.emit('blanket:dog', {});

    // 담요 밖으로 튕겨 나온다. 밀려난 자리가 벽/가구면 밀어내서 보정한다.
    const blanket = findFurniture('blanket');
    const from: Vec2 = blanket ? { x: blanket.x, z: blanket.z } : { ...p.pos };
    p.stance = Stance.GROUND;
    p.hiddenFor = 0;
    p.blanketWarned = false;

    // 강아지 피해는 무적을 무시하지 않는다 — 무적 중이면 그냥 쫓겨나기만 한다.
    applyDamage(state, 'dog', from, bus);
    p.pos = state.collision.pushOut(p.pos, state.playerRadius);
  }
}

/** 담요 경고 이후 남은 시간 (HUD 표시용). 숨어 있지 않으면 null */
export function blanketTimeLeft(state: GameState): number | null {
  const p = state.player;
  if (p.stance !== Stance.HIDDEN) return null;
  return Math.max(0, CONFIG.BLANKET_WARN_TIME + CONFIG.BLANKET_DOG_TIME - p.hiddenFor);
}

// ════════════════════════════════════════════════════════════════════════
// 가구 등반 (§7)
// ════════════════════════════════════════════════════════════════════════

/**
 * 가구 위로 올라간다.
 *
 * 자유 표면 등반이 아니라 `climbable` 지점에서만 가능한 문맥형 액션이다.
 * 올라가면 청소기·인간 판정에서 빠지지만 **배변할 수 없다** —
 * 그 기회비용이 체류 시간의 자연스러운 제한이 된다.
 */
export function climbOnto(state: GameState, furniture: FurnitureDef): void {
  const p = state.player;
  p.stance = Stance.ON_FURNITURE;
  p.climbedOn = furniture.id;
  p.climbAnimLeft = CLIMB_TIME;
  p.pos.x = furniture.x;
  p.pos.z = furniture.z;
}

/** 가구에서 내려온다. 내려설 자리는 충돌맵이 보정한다. */
export function climbDown(state: GameState): void {
  const p = state.player;
  p.stance = Stance.GROUND;
  p.climbedOn = null;
  p.climbAnimLeft = CLIMB_TIME;
  p.pos = state.collision.pushOut(p.pos, state.playerRadius);
}

/** 가구 위에서의 이동 범위 — 상판 안으로 제한한다. (§7) */
export function clampToFurnitureTop(state: GameState, target: Vec2): Vec2 {
  const f = state.player.climbedOn ? findFurniture(state.player.climbedOn) : undefined;
  if (!f) return target;

  const margin = state.playerRadius * 0.5;
  const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
  return {
    x: clamp(target.x, f.x - f.w / 2 + margin, f.x + f.w / 2 - margin),
    z: clamp(target.z, f.z - f.d / 2 + margin, f.z + f.d / 2 - margin),
  };
}

/** 올라가 있는 가구의 상판 높이 (렌더링용) */
export function climbedHeight(state: GameState): number {
  const f = state.player.climbedOn ? findFurniture(state.player.climbedOn) : undefined;
  return f?.h ?? 0;
}

// ════════════════════════════════════════════════════════════════════════
// 화장실과 변기 (§6, §14)
// ════════════════════════════════════════════════════════════════════════

/**
 * 화장실로 이동한다. 씬을 언로드하지 않고 좌표만 옮긴다.
 * **거실 시뮬레이션은 계속 돈다** — 그게 이 왕복의 리스크다.
 */
export function enterBathroom(state: GameState): void {
  const p = state.player;
  p.stance = Stance.BATHROOM;
  p.transitionLeft = TRANSITION_TIME;
  p.pos.x = BATHROOM_ENTRANCE.x;
  p.pos.z = BATHROOM_ENTRANCE.z;
}

export function exitBathroom(state: GameState): void {
  const p = state.player;
  p.stance = Stance.GROUND;
  p.transitionLeft = TRANSITION_TIME;
  p.pos.x = LIVING_DOOR.x;
  p.pos.z = LIVING_DOOR.z;
  p.pos = state.collision.pushOut(p.pos, state.playerRadius);
}

/** 변기를 쓸 수 있는지. 게이지가 가득 차야 한다. */
export function canUseToilet(state: GameState): boolean {
  const p = state.player;
  return (
    p.stance === Stance.BATHROOM &&
    p.poop >= CONFIG.POOP_MAX &&
    p.toiletAnimLeft <= 0 &&
    p.transitionLeft <= 0
  );
}

export function startToilet(state: GameState): boolean {
  if (!canUseToilet(state)) return false;
  state.player.toiletAnimLeft = CONFIG.TOILET_ANIM_TIME;
  return true;
}

/**
 * 변기 애니메이션을 진행시키고, 끝나면 보너스를 준다.
 *
 * 보너스는 **기존 영역에 인접한 셀부터 BFS 로 덩어리 확장**한다.
 * 무작위로 흩뿌리면 고립된 셀이 생겨 청소기에 금방 지워진다. (§14)
 */
export function updateToilet(state: GameState, dt: number, bus?: EventBus): void {
  const p = state.player;
  if (p.toiletAnimLeft <= 0) return;

  p.toiletAnimLeft = tickDown(p.toiletAnimLeft, dt);
  if (p.toiletAnimLeft > 0) return;

  const bonus = Math.round(state.effectiveCells * CONFIG.TOILET_BONUS_RATIO);
  const gained = expandFromTerritory(state, bonus);

  p.poop = 0;
  state.stats.poops++;
  slowVacuums(state);

  bus?.emit('toilet:done', { gainedCells: gained });
  bus?.emit('territory:changed', { owned: state.ownedCells, ratio: state.territoryRatio });
}

// ════════════════════════════════════════════════════════════════════════

/** 페이드·등반 보간 타이머를 진행시킨다. 고정 스텝마다 호출한다. */
export function updateShelterTimers(state: GameState, dt: number): void {
  const p = state.player;
  if (p.transitionLeft > 0) p.transitionLeft = tickDown(p.transitionLeft, dt);
  if (p.climbAnimLeft > 0) p.climbAnimLeft = tickDown(p.climbAnimLeft, dt);
}

/**
 * 자세에 맞는 이동 범위 보정.
 * MovementSystem 이 호출한다 — 화장실과 가구 위는 거실 충돌맵을 쓰지 않는다.
 */
export function resolveByStance(state: GameState, from: Vec2, to: Vec2): Vec2 {
  const p = state.player;

  if (p.stance === Stance.BATHROOM) {
    return clampToBathroom(to, state.playerRadius);
  }
  if (p.stance === Stance.ON_FURNITURE) {
    return clampToFurnitureTop(state, to);
  }
  return state.collision.resolveMove(from, to, state.playerRadius);
}

/** 화장실 안에 있는지 (렌더·카메라 전환용) */
export function isInBathroom(state: GameState): boolean {
  return state.player.stance === Stance.BATHROOM;
}

