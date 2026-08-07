/**
 * 모든 밸런스 상수의 유일한 정의 위치. (§4)
 * 코드 어디에도 하드코딩하지 않는다.
 *
 * ⚠️ 이 파일의 값을 바꾸면 반드시 `npm run balance` 를 다시 돌리고
 *    ROADMAP.md §3 의 검증표를 갱신할 것.
 *    tests/balance.test.ts 가 회귀를 막는다.
 *
 * §4 원안에서 조정된 항목은 [조정] 주석으로 표시했다. 근거는 ROADMAP §3-7.
 */

export const CONFIG = {
  // ── 격자 ───────────────────────────────────────────────────────────────
  GRID_W: 32,
  GRID_H: 24,
  CELL_SIZE: 0.5, // world units. 거실 = 16 x 12
  TARGET_RATIO: 0.44,
  /** 가구가 차지하는 셀 비율의 허용 범위. 벗어나면 밸런스 계산이 무너진다. (R1) */
  BLOCKED_RATIO_RANGE: [0.1, 0.15],

  // ── 플레이어 ───────────────────────────────────────────────────────────
  MAX_HEARTS: 3,
  INVULN_TIME: 1.5,
  MOVE_SPEED: 3.2, // world units/초
  RUN_MULTIPLIER: 1.6,
  RUN_DURATION: 1.5,
  RUN_COOLDOWN: 3.0,
  KNOCKBACK_DISTANCE: 1.2,
  /** 도마뱀 충돌 반경 (Lvl 1 기준). 원-AABB 판정에 사용. */
  PLAYER_RADIUS: 0.28,

  // ── 배고픔 ─────────────────────────────────────────────────────────────
  HUNGER_MAX: 100,
  HUNGER_DRAIN: 1.5, // 초당
  STARVE_DAMAGE_INTERVAL: 5,
  STARVE_GRACE: 3,

  // ── 똥 게이지 ──────────────────────────────────────────────────────────
  POOP_MAX: 100,
  /** [조정] 50 → 34. 음식 3개로 1회 배변. 사이클 시간 확보용 최대 레버 (ROADMAP D2) */
  POOP_PER_FOOD: 34,
  /** 상한 초과분은 버린다 (이월 없음) */
  POOP_OVERFLOW: 'discard',
  /** [조정] 0.8 → 1.0. 무방비 시간 확대 = 긴장감 + 사이클 */
  POOP_ANIM_TIME: 1.0,

  // ── 음식 ───────────────────────────────────────────────────────────────
  /** [조정] 25 → 10. 원안은 사이클당 +75 vs 소모 18.3 이라 배고픔이 장식이 됨 (ROADMAP D1) */
  FOOD_HUNGER_RESTORE: 10,
  /** [조정] 3 → 2. 최근접 음식까지의 거리 증가 */
  FOOD_MAX_CONCURRENT: 2,
  /** [조정] 4 → 6 */
  FOOD_RESPAWN_DELAY: 6,
  /** [조정] 0.4 → 0.6 */
  FOOD_EAT_TIME: 0.6,
  /** [신설] 플레이어로부터 이 거리(world u) 밖에만 스폰. 이동 시간을 결정적으로 보장 */
  FOOD_MIN_SPAWN_DIST: 7.5,
  /** 청소기로부터 최소 이 거리(world u) 밖을 우선한다 (§15) */
  FOOD_MIN_VACUUM_DIST: 3.0,
  /** [조정] 3 → 10. 한 판 음식이 약 90개라 원안은 Age 30까지 감 */
  FOOD_PER_AGE: 10,

  // ── 배변 영역 ──────────────────────────────────────────────────────────
  /** [조정] 0.10 → 0.05. 원안은 일반 배변 대비 4.1배로 압도적 (ROADMAP §3-8) */
  TOILET_BONUS_RATIO: 0.05,
  TOILET_ANIM_TIME: 2.0,
  TOILET_VACUUM_SLOW: 0.5,
  TOILET_VACUUM_SLOW_TIME: 8,

  // ── 로봇청소기 ─────────────────────────────────────────────────────────
  VACUUM_COUNT: 1,
  VACUUM_SPEED_CELLS: 1.2, // 원안 유지
  /** [조정] VACUUM_CLEAN_WIDTH 2셀 → 반경 0.6셀(폭 1.2셀). 연속값이라 미세 조정 가능 */
  VACUUM_CLEAN_RADIUS_CELLS: 0.6,
  VACUUM_STRAIGHT_MIN: 1.5,
  VACUUM_STRAIGHT_MAX: 3.5,
  VACUUM_TURN_TIME: 0.4,
  /** 청소기 본체 충돌 반경 (world u) */
  VACUUM_RADIUS: 0.32,

  // ── 은신 ───────────────────────────────────────────────────────────────
  BLANKET_WARN_TIME: 6,
  BLANKET_DOG_TIME: 4,

  // ── 성장 (§9-4) ────────────────────────────────────────────────────────
  LEVEL_THRESHOLDS: [1, 4, 7], // Age 기준
  /** [조정] 3.0/3.5/4.0 → 2.3/2.5/2.7. 성장 가속 완화 */
  LEVEL_POOP_RADIUS_CELLS: [2.3, 2.5, 2.7],
  LEVEL_SCALE: [1.0, 1.15, 1.3],
  LEVEL_SPEED_MUL: [1.0, 1.0, 1.1],
  LEVEL_HITBOX_MUL: [1.0, 1.15, 1.3],

  // ── 루프 ───────────────────────────────────────────────────────────────
  FIXED_DT: 1 / 60,
  /** 프레임 드랍 시 최대 캐치업 스텝. 초과분은 버린다 (spiral of death 방지) */
  MAX_CATCHUP_STEPS: 5,
} as const;

// ── 파생 상수 ────────────────────────────────────────────────────────────

export const DERIVED = {
  TOTAL_CELLS: CONFIG.GRID_W * CONFIG.GRID_H,
  /** 거실 크기 (world units) */
  ROOM_W: CONFIG.GRID_W * CONFIG.CELL_SIZE,
  ROOM_H: CONFIG.GRID_H * CONFIG.CELL_SIZE,
  /** 청소기 이동 속도 (world units/초) */
  VACUUM_SPEED_WORLD: CONFIG.VACUUM_SPEED_CELLS * CONFIG.CELL_SIZE,
  /** 청소 반경 (world units) */
  VACUUM_CLEAN_RADIUS_WORLD: CONFIG.VACUUM_CLEAN_RADIUS_CELLS * CONFIG.CELL_SIZE,
  /** 똥 게이지를 채우는 데 필요한 음식 개수 */
  FOODS_PER_POOP: Math.ceil(CONFIG.POOP_MAX / CONFIG.POOP_PER_FOOD),
} as const;

/** Age → Lvl 인덱스 (0-based). §9-4 */
export function levelIndexForAge(age: number): 0 | 1 | 2 {
  const [, t2, t3] = CONFIG.LEVEL_THRESHOLDS;
  if (age >= t3) return 2;
  if (age >= t2) return 1;
  return 0;
}

/** 격자 좌표계는 셀 중심 기준. 셀 (cx, cz) 의 월드 중심 좌표를 돌려준다. */
export function cellCenterX(cx: number): number {
  return (cx + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_W / 2;
}
export function cellCenterZ(cz: number): number {
  return (cz + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_H / 2;
}
/** 월드 좌표 → 격자 인덱스. 범위를 벗어나면 -1 을 포함한 값이 나올 수 있다. */
export function worldToCellX(x: number): number {
  return Math.floor((x + DERIVED.ROOM_W / 2) / CONFIG.CELL_SIZE);
}
export function worldToCellZ(z: number): number {
  return Math.floor((z + DERIVED.ROOM_H / 2) / CONFIG.CELL_SIZE);
}
