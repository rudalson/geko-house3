/**
 * 화장실 구역. §6, §14
 *
 * 화장실은 **거실과 물리적으로 이어진 별도 구역**이다. 씬을 언로드하지 않는다.
 * 문 앞에서 `E` 를 누르면 짧은 페이드 뒤 좌표만 화장실 입구로 옮긴다.
 *
 * 그동안에도 **거실 시뮬레이션은 계속 돈다.** 로봇청소기는 계속 청소한다.
 * 그게 화장실 보너스의 리스크다 — 왕복하는 20여 초 동안 영역이 깎인다.
 *
 * **화장실 바닥은 똥 땅 달성률 계산에서 제외된다.** 격자는 거실만 덮는다.
 *
 * Three.js 를 import 하지 않는다. (§0-4)
 */

import type { Vec2 } from '../core/types.ts';

/**
 * 거실 북쪽 벽 너머에 둔다.
 * 거실이 z ∈ [-7.5, 7.5] 로 넓어지면서(#4) 화장실도 북쪽으로 1.5 밀었다.
 * 거실 북쪽 벽(-7.5)과 화장실 남쪽 경계(-8.5) 사이 1.0 이 벽 두께 구간이다.
 */
export const BATHROOM_BOUNDS = {
  minX: -3.0,
  maxX: 4.0,
  minZ: -15.0,
  maxZ: -8.5,
} as const;

/** 거실 쪽 문 위치 — furnitureLayout 의 `bathroom-door` 와 같은 자리여야 한다. */
export const LIVING_DOOR: Vec2 = { x: 0.625, z: -6.875 };

/** 화장실에 들어왔을 때 서는 자리 */
export const BATHROOM_ENTRANCE: Vec2 = { x: 0.625, z: -9.1 };

/** 거실로 돌아가는 문 (화장실 쪽) */
export const BATHROOM_EXIT: Vec2 = { x: 0.625, z: -8.7 };

/** 변기 상호작용 위치 */
export const TOILET_POS: Vec2 = { x: -1.8, z: -13.7 };

/** 세면대 (장식) */
export const SINK_POS: Vec2 = { x: 2.6, z: -13.9 };

/** 화장실 안에서 캐릭터가 설 수 있는지 (가구 충돌 없이 경계만 본다) */
export function insideBathroom(p: Vec2, radius: number): boolean {
  return (
    p.x - radius >= BATHROOM_BOUNDS.minX &&
    p.x + radius <= BATHROOM_BOUNDS.maxX &&
    p.z - radius >= BATHROOM_BOUNDS.minZ &&
    p.z + radius <= BATHROOM_BOUNDS.maxZ
  );
}

/** 화장실 경계 안으로 밀어 넣는다. */
export function clampToBathroom(p: Vec2, radius: number): Vec2 {
  const clamp = (v: number, lo: number, hi: number): number =>
    v < lo ? lo : v > hi ? hi : v;
  return {
    x: clamp(p.x, BATHROOM_BOUNDS.minX + radius, BATHROOM_BOUNDS.maxX - radius),
    z: clamp(p.z, BATHROOM_BOUNDS.minZ + radius, BATHROOM_BOUNDS.maxZ - radius),
  };
}
