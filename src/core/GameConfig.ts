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
  /**
   * [조정] 25 → 10 → 13.
   *
   * 원안 25 는 사이클당 +75 vs 소모 18.3 이라 배고픔이 장식이 됐다 (ROADMAP D1).
   * 10 으로 낮춰 긴장을 만들었는데, 인간 적(§24)이 들어오면서 사이클이
   * 13.4초 → 20초로 늘자 **수지가 정확히 0** 이 되어(3×10=30 회복 vs 20×1.5=30 소모)
   * 조금만 방해받아도 굶어 죽는 외길이 됐다. 실측에서 5판 중 4판이 아사.
   * 13 이면 20초 사이클에서도 30% 여유가 남는다.
   */
  FOOD_HUNGER_RESTORE: 13,
  /** [조정] 3 → 2. 최근접 음식까지의 거리 증가 */
  FOOD_MAX_CONCURRENT: 2,
  /** [조정] 4 → 6 */
  FOOD_RESPAWN_DELAY: 6,
  /** [조정] 0.4 → 0.6 */
  FOOD_EAT_TIME: 0.6,
  /**
   * [신설] 플레이어로부터 이 거리(world u) 밖에만 스폰. 이동 시간을 결정적으로 보장.
   * 7.5 → 6.5 로 조정: 봇 실측 결과 격자 경로 detour 가 예상보다 커서
   * 사이클이 14.6초까지 늘어났고, 44% 도달이 7.5분으로 상한에 붙었다. (ROADMAP R2)
   */
  FOOD_MIN_SPAWN_DIST: 6.5,
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

  // ── 인간 적 (§24) ──────────────────────────────────────────────────────
  /** 이 레벨 인덱스부터 등장 (1 = Lvl 2 = Age 4) */
  HUMAN_FROM_LEVEL: 1,
  /**
   * 이동 속도 (world u/초). 플레이어 걷기(3.2)보다 조금 느리고
   * 달리기(5.12)보다는 확실히 느리다 — 달리면 벗어날 수 있지만
   * 쿨다운 3초 동안은 계속 쫓기므로 결국 담요·가구로 피해야 한다.
   */
  HUMAN_SPEED: 2.9,
  /**
   * 이 거리 안에 들어오면 발견한다.
   * 거실이 16x12 라 6.0 은 방의 절반을 덮어서, 인간이 등장한 뒤로는 사실상
   * 계속 쫓기게 된다. 4.5 로 낮춰 '피할 구석이 있는' 위협으로 만든다.
   */
  HUMAN_SIGHT: 3.5,
  /** 이 거리 밖으로 나가면 추적을 포기한다 (시야보다 넓어야 깜빡이지 않는다) */
  HUMAN_LOSE_RANGE: 7.5,
  HUMAN_RADIUS: 0.42,
  /** 경로 재계산 간격 — §24 는 0.5초에 1회로 제한하라고 요구한다 */
  HUMAN_PATH_INTERVAL: 0.5,
  /** 발견 시 말풍선이 떠 있는 시간 */
  HUMAN_SPEECH_TIME: 2.0,
  /**
   * 추적을 포기한 뒤 다시 발견하기까지의 대기 시간.
   * 이 동안 인간은 플레이어에게서 먼 곳으로 걸어간다. 짧으면 담요에서 나오자마자
   * 다시 잡혀 §24 의 대응 수단(은신·등반)이 무의미해진다.
   */
  HUMAN_GIVEUP_TIME: 6.0,
  /**
   * 사냥/휴식 주기 (초).
   *
   * 인간이 쉬지 않고 노리면 등장 이후로는 음식을 먹을 창이 사라져서
   * "도망 → 굶주림 → 사망"의 외길이 된다. 실측에서 실제로 그랬다.
   * 청소기에 읽히는 직선 구간을 준 것과 같은 이유로, 인간에게도 **예측 가능한
   * 리듬**을 준다. 휴식 중에는 방을 어슬렁거릴 뿐 플레이어를 찾지 않는다.
   */
  HUMAN_HUNT_TIME: 8,
  HUMAN_REST_TIME: 25,
  /**
   * 한 번 발견했을 때 쫓아다니는 최대 시간 (초).
   *
   * 이 상한이 없으면 "발견 → 피난처로 → 기다림" 한 번에 15초 안팎이 날아가고,
   * 그게 반복되면 먹을 시간이 사라져 굶어 죽는다. 실측에서 인간을 넣은 순간
   * 신중한 플레이가 5판 전부 아사했다 (인간 없이는 4/5 클리어).
   * 짧게 덮치고 물러나는 '기습'이라야 대응 가능한 위협이 된다.
   */
  HUMAN_MAX_CHASE_TIME: 5,

  // ── 특식 (§24) ─────────────────────────────────────────────────────────
  /** 동시 최대 1개 */
  TREAT_MAX_CONCURRENT: 1,
  /** 첫 등장까지 / 이후 재등장까지 걸리는 시간 (초) */
  TREAT_FIRST_DELAY: 60,
  TREAT_RESPAWN_DELAY: 75,
  /** 무적 특식의 지속 시간 */
  TREAT_INVULN_TIME: 6,
  /** 청소기 정지 특식의 지속 시간 */
  TREAT_VACUUM_STOP_TIME: 6,
  /** 초대형 똥 영역의 반경 배율 */
  TREAT_MEGA_POOP_MUL: 2.2,

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
