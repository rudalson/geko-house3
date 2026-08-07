/**
 * 게임 로직 공용 타입. Three.js 를 import 하지 않는다. (§0-4)
 * 벡터 연산은 Three.js Vector3 대신 자체 { x, z } 평면 타입을 쓴다.
 */

/** 바닥 평면 좌표. y(높이)는 로직에서 다루지 않는다. */
export interface Vec2 {
  x: number;
  z: number;
}

export const vec = (x = 0, z = 0): Vec2 => ({ x, z });

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function distSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** 길이를 1로 맞춘다. 길이가 0이면 {0,0} 을 그대로 돌려준다. */
export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.z);
  return len === 0 ? { x: 0, z: 0 } : { x: v.x / len, z: v.z / len };
}

/** 격자 셀 상태. Uint8Array 에 그대로 저장한다. (§10) */
export const Cell = {
  EMPTY: 0,
  POOP_TERRITORY: 1,
  /** 가구가 차지해 영역 계산의 분모에서 제외 */
  BLOCKED: 2,
} as const;
export type CellState = (typeof Cell)[keyof typeof Cell];

/** 게임 상태 머신. (§8) */
export const Phase = {
  BOOT: 'BOOT',
  LOADING: 'LOADING',
  TITLE: 'TITLE',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  STAGE_CLEAR: 'STAGE_CLEAR',
  GAME_OVER: 'GAME_OVER',
} as const;
export type GamePhase = (typeof Phase)[keyof typeof Phase];

/** 플레이어가 지금 무엇을 하고 있는지. 배변 가능 여부 판정에 쓴다. (§7, §10) */
export const Stance = {
  /** 거실 바닥. 유일하게 배변이 가능한 상태 */
  GROUND: 'GROUND',
  /** 가구 위 — 청소기/인간 판정 제외, 배변 불가 */
  ON_FURNITURE: 'ON_FURNITURE',
  /** 담요 밑 — 이동 불가, 배변 불가 */
  HIDDEN: 'HIDDEN',
  /** 화장실 구역 — 변기 상호작용으로만 배변 */
  BATHROOM: 'BATHROOM',
} as const;
export type PlayerStance = (typeof Stance)[keyof typeof Stance];

/** 배변이 차단되는 상태인지. 차단 시 게이지를 소모하지 않고 안내만 표시한다. */
export function isPoopBlocked(stance: PlayerStance): boolean {
  return stance !== Stance.GROUND;
}
