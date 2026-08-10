/**
 * 밸런스 해석 모델. §0-1
 *
 * CONFIG 를 직접 읽어 계산하므로 상수를 바꾸면 결과가 즉시 따라온다.
 * - `npm run balance` (tools/balance-check.ts) → 사람이 읽는 리포트
 * - `tests/balance.test.ts`                    → 회귀 방지 assert
 * 둘 다 이 파일 하나를 쓴다. 계산식을 두 곳에 적지 않는다.
 *
 * Three.js 를 import 하지 않는다. (§0-4)
 *
 * 모델:
 *   dC/dt = G₀·(1 − β·p) − S·p = G₀ − (S + β·G₀)·p     (p = C/V)
 *   p*    = G₀ / S_eff,   S_eff = S + β·G₀
 *   t     = −(V / S_eff) · ln(1 − TARGET_RATIO / p*)
 */

import { CONFIG, DERIVED, levelIndexForAge } from './GameConfig.ts';

/**
 * CONFIG 로는 표현되지 않는 "플레이어가 실제로 어떻게 움직이는가"의 가정.
 * 4단계(S4) 완료 후 디버그 계측 실측치로 보정한다. (ROADMAP R2)
 */
export const ASSUMPTIONS = {
  /**
   * 가구가 차지하는 셀 비율.
   * furnitureLayout 배치의 **실측값** (89/768). CollisionMap.describe() 로 확인한다.
   * 가구를 옮기면 여기도 갱신할 것. tests/collision.test.ts 가 5% 이상 벌어지면 잡아낸다. (R1)
   */
  BLOCKED_RATIO: 89 / 768,
  /** 최소 스폰 거리 대비 실제 평균 스폰 거리 배율 */
  SPAWN_DIST_FACTOR: 1.12,
  /**
   * 가구 회피로 인한 경로 증가율.
   * `node tools/cycle-probe.ts` 의 봇 실측(14.59초)에 맞춰 1.12 → 1.25 로 보정했다.
   * 격자 경로는 직선보다 길고, 모서리에서 미끄러지는 손실도 여기에 포함된다. (R2)
   */
  PATH_DETOUR: 1.25,
  /** 음식을 다 먹고 미개척지까지 추가 이동하는 거리 (world u) */
  REPOSITION_DIST: 2.5,
  /**
   * 음식 리스폰을 기다리는 평균 시간 (초).
   * 동시 2개뿐이라 둘을 연달아 먹으면 실제로 서서 기다리게 된다. 실측 반영. (R2)
   */
  RESPAWN_WAIT: 1.1,
  /** 청소기 직선 이동 평균 지속 시간 (초) */
  STRAIGHT_AVG: (CONFIG.VACUUM_STRAIGHT_MIN + CONFIG.VACUUM_STRAIGHT_MAX) / 2,
  /** 청소기 경로 중복으로 인한 유효 스윕 감소 계수 */
  COVERAGE_ETA: 0.85,
  /**
   * 중첩 계수 β. 기존 영역 위에 겹쳐 싸서 버려지는 비율.
   * 완전 무작위 배치면 1.0. 플레이어가 미개척지를 고르므로 0.8.
   */
  BETA: 0.8,
  /** 화장실 왕복에 드는 추가 시간 (초) */
  TOILET_TRIP_TIME: 20,
  /**
   * 짝에게 다가가느라 경로에서 벗어나는 시간 (초).
   * `MATE_MIN_SPAWN_DIST` 밖에 나타나지만 음식을 찾아 이미 방을 돌아다니므로
   * 순수 우회분만 센다. 화장실처럼 방을 비우는 왕복이 아니다.
   */
  MATE_DETOUR_TIME: 2.0,
} as const;

/**
 * 한 배변 사이클 중 **이동에 쓰는 시간** (초).
 * 임신 감속 페널티가 걸리는 부분이라 따로 뽑아 둔다.
 */
export function travelTimePerCycle(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  const a = ASSUMPTIONS;
  const speed = CONFIG.MOVE_SPEED * (CONFIG.LEVEL_SPEED_MUL[levelIndex] ?? 1) * skillMul;
  return (
    ((CONFIG.FOOD_MIN_SPAWN_DIST * a.SPAWN_DIST_FACTOR * a.PATH_DETOUR) / speed) *
      DERIVED.FOODS_PER_POOP +
    (a.REPOSITION_DIST * a.PATH_DETOUR) / speed
  );
}

/** §0-1 합격 기준 */
export const CRITERIA = {
  /** 평형 점유율이 이 값 이하면 클리어가 수학적으로 불가능 */
  MIN_P_STAR: CONFIG.TARGET_RATIO,
  MIN_TIME_SEC: 300,
  MAX_TIME_SEC: 480,
} as const;

/** 유효 셀 수 V (전체 − BLOCKED) */
export function effectiveCells(blockedRatio: number = ASSUMPTIONS.BLOCKED_RATIO): number {
  return Math.round(DERIVED.TOTAL_CELLS * (1 - blockedRatio));
}

/** 목표 셀 수 */
export function targetCells(blockedRatio: number = ASSUMPTIONS.BLOCKED_RATIO): number {
  return effectiveCells(blockedRatio) * CONFIG.TARGET_RATIO;
}

/**
 * 배변 1회의 유효 면적 (셀).
 * 연속 좌표에 배치되므로 기대 셀 수 = 원 면적. BLOCKED 만큼 손실.
 */
export function poopArea(levelIndex: 0 | 1 | 2, blockedRatio: number = ASSUMPTIONS.BLOCKED_RATIO): number {
  const r = CONFIG.LEVEL_POOP_RADIUS_CELLS[levelIndex] ?? CONFIG.LEVEL_POOP_RADIUS_CELLS[0]!;
  return Math.PI * r * r * (1 - blockedRatio);
}

/**
 * 배변 1회 사이클 시간 (초).
 * 음식 N개 획득 이동 + 먹기 + 미개척지 재배치 + 배변 애니메이션 + 리스폰 대기
 *
 * @param skillMul 1보다 크면 숙련(빠름), 작으면 미숙(느림)
 */
export function cycleTime(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  const a = ASSUMPTIONS;
  const speed = CONFIG.MOVE_SPEED * (CONFIG.LEVEL_SPEED_MUL[levelIndex] ?? 1) * skillMul;
  const perFoodTravel = (CONFIG.FOOD_MIN_SPAWN_DIST * a.SPAWN_DIST_FACTOR * a.PATH_DETOUR) / speed;
  return (
    perFoodTravel * DERIVED.FOODS_PER_POOP +
    CONFIG.FOOD_EAT_TIME * DERIVED.FOODS_PER_POOP +
    (a.REPOSITION_DIST * a.PATH_DETOUR) / speed +
    CONFIG.POOP_ANIM_TIME +
    a.RESPAWN_WAIT
  );
}

/** 청소기가 초당 훑는 유효 바닥 면적 S (셀/초) */
export function vacuumSweepRate(): number {
  const a = ASSUMPTIONS;
  const widthCells = CONFIG.VACUUM_CLEAN_RADIUS_CELLS * 2;
  // 회전 중에는 청소하지 않으므로 duty 를 곱한다.
  const duty = a.STRAIGHT_AVG / (a.STRAIGHT_AVG + CONFIG.VACUUM_TURN_TIME);
  return CONFIG.VACUUM_SPEED_CELLS * widthCells * duty * a.COVERAGE_ETA * CONFIG.VACUUM_COUNT;
}

export interface AnalyticResult {
  cycleSec: number;
  /** 점유율 0일 때의 영역 증가율 (셀/초) */
  g0: number;
  /** 청소기 감소율 (셀/초) */
  s: number;
  sEff: number;
  /** 평형 점유율 */
  pStar: number;
  /** 44% 도달 예상 시간 (초). 도달 불가면 Infinity */
  timeSec: number;
}

/** 해석해 (배변 반경이 고정이라고 가정). Lvl 1 기준. */
export function analytic(skillMul = 1, blockedRatio = ASSUMPTIONS.BLOCKED_RATIO): AnalyticResult {
  const V = effectiveCells(blockedRatio);
  const cycleSec = cycleTime(0, skillMul);
  const g0 = poopArea(0, blockedRatio) / cycleSec;
  const s = vacuumSweepRate();
  const sEff = s + ASSUMPTIONS.BETA * g0;
  const pStar = g0 / sEff;
  const timeSec =
    pStar > CONFIG.TARGET_RATIO
      ? -(V / sEff) * Math.log(1 - CONFIG.TARGET_RATIO / pStar)
      : Infinity;
  return { cycleSec, g0, s, sEff, pStar, timeSec };
}

export interface SimResult {
  cleared: boolean;
  timeSec: number;
  poops: number;
  foods: number;
  /** 산란 횟수 (useMate 일 때만 0 이 아니다) */
  lays: number;
  /** 청소기가 지운 누적 셀 수 */
  erasedCells: number;
  finalRatio: number;
  levelLog: { level: number; atSec: number; ratio: number }[];
}

/**
 * 수치 적분. Age → Lvl 성장에 따른 배변 반경·이동 속도 변화를 반영한다.
 * 해석해보다 실제에 가까우므로 **이쪽이 기준값**이다.
 */
export function simulate({
  skillMul = 1,
  dt = 0.05,
  capSec = 2400,
  blockedRatio = ASSUMPTIONS.BLOCKED_RATIO,
  useMate = false,
}: {
  skillMul?: number;
  dt?: number;
  capSec?: number;
  blockedRatio?: number;
  /**
   * true 면 짝이 보일 때마다 곧바로 간다 — **가장 공격적인 플레이**를 가정한다.
   * 기본값이 false 인 이유: §0-1 의 합격 기준은 확장 기능 없는 기준선이다.
   * 이 옵션은 "짝을 최대한 써도 구간을 벗어나지 않는가"를 따로 확인하는 용도다.
   */
  useMate?: boolean;
} = {}): SimResult {
  const V = effectiveCells(blockedRatio);
  const target = targetCells(blockedRatio);
  const s = vacuumSweepRate();
  const beta = ASSUMPTIONS.BETA;

  let owned = 0;
  let t = 0;
  let foods = 0;
  let poops = 0;
  let lays = 0;
  let erasedCells = 0;
  let nextPoopAt = 0;
  let lastLevel = -1;
  const levelLog: SimResult['levelLog'] = [];

  // 짝 진행 상태. useMate 가 false 면 전부 잠들어 있다.
  let mateReadyAt = useMate ? CONFIG.MATE_FIRST_APPEAR_SEC : Infinity;
  let approachLeft = 0;
  let pregnantLeft = 0;

  while (t < capSec) {
    const lvl = levelIndexForAge(Math.floor(foods / CONFIG.FOOD_PER_AGE));
    if (lvl !== lastLevel) {
      levelLog.push({ level: lvl + 1, atSec: +t.toFixed(1), ratio: owned / V });
      lastLevel = lvl;
    }

    // 임신 중에는 이동이 느려 사이클이 늘어난다.
    const cycle =
      pregnantLeft > 0 ? pregnantCycleTime(lvl, skillMul) : cycleTime(lvl, skillMul);
    if (nextPoopAt === 0) nextPoopAt = cycle;

    if (approachLeft > 0) {
      // 짝에게 가는 중 + 교미 중에는 배변이 진행되지 않는다.
      approachLeft -= dt;
      nextPoopAt += dt;
    } else if (t >= nextPoopAt) {
      owned = Math.min(V, owned + poopArea(lvl, blockedRatio) * (1 - beta * (owned / V)));
      foods += DERIVED.FOODS_PER_POOP;
      poops++;
      nextPoopAt = t + cycle;
    }

    if (t >= mateReadyAt && pregnantLeft <= 0 && approachLeft <= 0) {
      approachLeft = ASSUMPTIONS.MATE_DETOUR_TIME + CONFIG.MATE_ANIM_TIME;
      pregnantLeft = CONFIG.MATE_PREGNANCY_TIME;
      mateReadyAt = Infinity;
    }
    if (pregnantLeft > 0) {
      pregnantLeft -= dt;
      if (pregnantLeft <= 0) {
        // 산란은 인접 확장이라 중첩 손실이 없다 (변기와 동일).
        owned = Math.min(V, owned + V * CONFIG.MATE_EGG_BONUS_RATIO);
        lays++;
        mateReadyAt = t + CONFIG.MATE_COOLDOWN_SEC;
      }
    }

    const loss = s * (owned / V) * dt;
    owned -= loss;
    erasedCells += loss;

    if (owned >= target) {
      return { cleared: true, timeSec: t, poops, foods, lays, erasedCells, finalRatio: owned / V, levelLog };
    }
    t += dt;
  }

  return { cleared: false, timeSec: capSec, poops, foods, lays, erasedCells, finalRatio: owned / V, levelLog };
}

/**
 * 변기 보너스가 일반 배변 대비 몇 배로 이득인지.
 * §14 는 "미세하게 유리"를 요구하므로 1.0 을 약간 넘는 값이 목표다.
 */
export function toiletAdvantage(occupancy: number, ratio = CONFIG.TOILET_BONUS_RATIO): number {
  const V = effectiveCells();
  const s = vacuumSweepRate();
  const cycle = cycleTime(0);
  const bonusCells = V * ratio;
  const normalNet = poopArea(0) * (1 - ASSUMPTIONS.BETA * occupancy);

  const lossDuringTrip = s * occupancy * ASSUMPTIONS.TOILET_TRIP_TIME;
  const forgoneNormal = (ASSUMPTIONS.TOILET_TRIP_TIME / cycle) * normalNet;
  const slowSaved =
    CONFIG.TOILET_VACUUM_SLOW * s * occupancy * CONFIG.TOILET_VACUUM_SLOW_TIME;

  return (bonusCells - lossDuringTrip - forgoneNormal + slowSaved) / normalNet;
}

/**
 * 임신 중 늘어난 배변 사이클 (초).
 * 이동 부분만 느려진다 — 먹기·배변 애니메이션·리스폰 대기는 그대로다.
 */
export function pregnantCycleTime(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  const travel = travelTimePerCycle(levelIndex, skillMul);
  return cycleTime(levelIndex, skillMul) + travel * (1 / CONFIG.MATE_SPEED_MUL - 1);
}

/**
 * 짝 왕복이 잡아먹는 **실효 시간** (초).
 *
 * 임신 25초를 통째로 손실로 세면 안 된다. 그동안에도 계속 싸고 있고,
 * 느려진 만큼만 손해다. 그래서 감속으로 늘어난 사이클 비율을 시간으로 환산한다.
 */
export function mateEffectiveCostSec(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  const normal = cycleTime(levelIndex, skillMul);
  const pregnant = pregnantCycleTime(levelIndex, skillMul);
  return (
    ASSUMPTIONS.MATE_DETOUR_TIME +
    CONFIG.MATE_ANIM_TIME +
    CONFIG.MATE_PREGNANCY_TIME * (1 - normal / pregnant)
  );
}

/**
 * 짝·산란이 일반 배변 대비 몇 배로 이득인지.
 *
 * `toiletAdvantage` 와 **같은 식**을 쓴다. 그래야 두 선택지를 한 표에 놓고
 * 비교할 수 있다. 다른 잣대로 잰 두 숫자를 나란히 적으면 읽는 사람이 속는다.
 *
 * 목표는 변기(1.10x / 1.29x)보다 **조금 위**다. 셀 계산에 안 잡히는 대가가
 * 이쪽에만 있기 때문이다 — 교미 2.5초는 무방비이고, 임신 25초 동안 히트박스가
 * 1.25배라 청소기·인간에게 더 자주 걸린다.
 */
export function mateAdvantage(occupancy: number, ratio = CONFIG.MATE_EGG_BONUS_RATIO): number {
  const V = effectiveCells();
  const s = vacuumSweepRate();
  const cycle = cycleTime(0);
  const cost = mateEffectiveCostSec(0);

  const bonusCells = V * ratio;
  const normalNet = poopArea(0) * (1 - ASSUMPTIONS.BETA * occupancy);
  const lossDuringTrip = s * occupancy * cost;
  const forgoneNormal = (cost / cycle) * normalNet;

  return (bonusCells - lossDuringTrip - forgoneNormal) / normalNet;
}

/** 클리어가 가능한 최대 배변 사이클 (초). 이보다 느리면 p* ≤ 0.44 */
export function breakEvenCycleSec(): number {
  const s = vacuumSweepRate();
  const area = poopArea(0);
  // p* = G₀/(S + βG₀) = TARGET  →  G₀ = TARGET·S / (1 − β·TARGET)
  const target = CONFIG.TARGET_RATIO;
  const g0AtBreakEven = (target * s) / (1 - ASSUMPTIONS.BETA * target);
  return area / g0AtBreakEven;
}

/** §0-1 합격 판정 */
export function verdict(): {
  pass: boolean;
  pStar: number;
  clearTimeSec: number;
  reasons: string[];
} {
  const a = analytic();
  const sim = simulate();
  const reasons: string[] = [];

  if (a.pStar <= CRITERIA.MIN_P_STAR) {
    reasons.push(`평형 점유율 ${a.pStar.toFixed(3)} ≤ ${CRITERIA.MIN_P_STAR} — 클리어 불가능`);
  }
  if (!sim.cleared) {
    reasons.push('수치 적분에서 목표에 도달하지 못함');
  } else if (sim.timeSec < CRITERIA.MIN_TIME_SEC) {
    reasons.push(`도달 ${sim.timeSec.toFixed(0)}초 < ${CRITERIA.MIN_TIME_SEC}초 — 너무 쉬움`);
  } else if (sim.timeSec > CRITERIA.MAX_TIME_SEC) {
    reasons.push(`도달 ${sim.timeSec.toFixed(0)}초 > ${CRITERIA.MAX_TIME_SEC}초 — 너무 지루함`);
  }

  return { pass: reasons.length === 0, pStar: a.pStar, clearTimeSec: sim.timeSec, reasons };
}
