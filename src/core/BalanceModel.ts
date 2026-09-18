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

import { CONFIG, DERIVED, cellCenterX, cellCenterZ, levelIndexForAge } from './GameConfig.ts';
import {
  BATHROOM_ENTRANCE,
  LIVING_DOOR,
  TOILET_POS,
} from '../world/bathroomLayout.ts';

/**
 * CONFIG 로는 표현되지 않는 "플레이어가 실제로 어떻게 움직이는가"의 가정.
 * 4단계(S4) 완료 후 디버그 계측 실측치로 보정한다. (ROADMAP R2)
 */
export const ASSUMPTIONS = {
  /**
   * 가구가 차지하는 셀 비율.
   * furnitureLayout 배치의 **실측값** (126/1200, #4 확장 후). CollisionMap.describe() 로 확인한다.
   * 가구를 옮기면 여기도 갱신할 것. tests/collision.test.ts 가 5% 이상 벌어지면 잡아낸다. (R1)
   */
  BLOCKED_RATIO: 126 / 1200,
  /**
   * 음식 하나까지 실제로 이동하는 거리의 **바닥값** (world u).
   *
   * 음식이 어디 있든 방을 가로지르고 가구를 우회하는 데 드는 몫이다.
   * FOOD_MIN_SPAWN_DIST 와 무관하게 항상 든다.
   */
  TRAVEL_FLOOR: 6.5,
  /**
   * 최소 스폰 거리가 이동 거리에 얹히는 몫. `/(동시개수 − 1)` 로 나눠 쓴다.
   *
   * 예전에는 `SPAWN_DIST_FACTOR: 1.12` 하나로 "이동거리 = 최소거리 x 1.12 x 우회"
   * 라고 봤다. **그게 틀렸다.** RESPAWN_WAIT 과 똑같은 병이다 — 동시 개수가
   * 바뀌면 조용히 무효가 된다. 동시 3개면 플레이어는 셋 중 **가장 가까운**
   * 것으로 가므로, 최소 거리를 올려도 이동 거리가 그만큼 늘지 않는다.
   *
   * 실제로 그 때문에 모델이 방향을 틀리게 예측했다. 최소거리 6.5 → 8.0 을
   * 모델은 "사이클 +6%" 로 봤는데 봇 실측은 +2.6% 였다. 그 틀린 예측 위에서
   * 밸런스를 맞추면 게임이 계산과 다르게 나온다.
   *
   * 지금 식:  이동거리 = TRAVEL_FLOOR + 최소거리 x TRAVEL_SLOPE / (동시개수 − 1)
   *
   * 봇 실측(신중, 5시드 평균, 음식 하나당 실제 이동 거리 world u):
   *
   *   동시  최소거리   실측     모델     오차
   *    2      6.5     12.84    12.68    -1.2%
   *    2      8.0     14.26    14.10    -1.1%
   *    3      6.5      9.65     9.59    -0.6%
   *    3      8.0      9.91    10.30    +3.9%
   *    3     10.0     11.32    11.25    -0.6%
   *
   * 다섯 점이 모두 4% 안에 들어온다. 이건 이론이 아니라 **측정 구간 안의
   * 보간**이다. 동시 4개 이상이나 최소거리 10 초과로 나갈 때는 다시 잴 것.
   * tests/balance.test.ts 가 이 표를 지킨다.
   */
  TRAVEL_SLOPE: 0.95,
  /**
   * 가구 회피로 인한 경로 증가율.
   * `node tools/cycle-probe.ts` 의 봇 실측(14.59초)에 맞춰 1.12 → 1.25 로 보정했다.
   * 격자 경로는 직선보다 길고, 모서리에서 미끄러지는 손실도 여기에 포함된다. (R2)
   */
  PATH_DETOUR: 1.25,
  /** 음식을 다 먹고 미개척지까지 추가 이동하는 거리 (world u) */
  REPOSITION_DIST: 2.5,
  /**
   * 음식 하나를 처리하는 실제 시간이 해석값보다 얼마나 긴지의 배율.
   *
   * 예전에는 `RESPAWN_WAIT` 이라는 **손으로 적은 상수**가 있었다. 그게 이
   * 모델에서 가장 잘 틀리는 자리였다 — 값은 1.1 이었는데 실측은 2.25 였고,
   * 아무도 모르는 채 모델이 사이클을 1.15초씩 낙관하고 있었다. 동시 개수나
   * 리스폰 지연을 바꾸면 그 상수는 **조용히 무효가 된다.** 실제로 그렇게 됐다.
   *
   * 그래서 대기 시간을 상수로 두지 않고 `respawnWait()` 에서 **유도**한다.
   * 남은 것은 이 보정계수 하나뿐이고, 이건 설정을 바꿔도 변하지 않는 양이다
   * (봇이 해석값보다 얼마나 굼뜨게 움직이는가).
   *
   * 보정값 0.837 은 아래 7개 실측점에서 얻었다 (이동 거리 모델을 고치면서
   * 1.11 에서 다시 맞췄다 — 이동 시간이 길어진 만큼 보정이 내려간다). tools/cycle-probe.ts 를 계측용
   * 으로 복사해 "활성 음식이 하나도 없어 제자리에 서 있는" 스텝을 직접 셌다
   * (5시드 평균, 사이클당 초):
   *
   *   설정            실측    모델(보정 후)
   *   동시 2 / 6.0초  2.25    2.18
   *   동시 2 / 5.0초  1.18    1.18
   *   동시 2 / 4.5초  0.62    0.68
   *   동시 2 / 4.0초  0.49    0.18   ← 유일하게 어긋난다
   *   동시 3 / 6.0초  0.08    0
   *   동시 3 / 5.0초  0.03    0
   *   동시 3 / 4.0초  0.00    0
   *
   * 동시 2 / 4.0초 만 모델이 낮게 잡는다. 대기가 0 에 가까워지면 "평균은
   * 0 이어도 어떤 사이클은 기다린다" 는 분산이 남기 때문이다. 이 구간에서는
   * 모델이 **낙관적**이라는 뜻이므로, 그쪽으로 갈 때는 실측을 함께 볼 것.
   */
  FOOD_HANDLING_FIT: 0.837,
  /** 청소기 직선 이동 평균 지속 시간 (초) */
  STRAIGHT_AVG: (CONFIG.VACUUM_STRAIGHT_MIN + CONFIG.VACUUM_STRAIGHT_MAX) / 2,
  /** 청소기 경로 중복으로 인한 유효 스윕 감소 계수 */
  COVERAGE_ETA: 0.85,
  /**
   * 중첩 계수 β. 기존 영역 위에 겹쳐 싸서 버려지는 비율.
   * 완전 무작위 배치면 1.0. 플레이어가 미개척지를 고르므로 0.8.
   */
  BETA: 0.8,
  /**
   * 화장실 왕복 시간의 **오버헤드 배율**.
   *
   * 예전에는 `TOILET_TRIP_TIME: 20` 이라는 상수였다. RESPAWN_WAIT · SPAWN_DIST_FACTOR
   * 와 같은 병이다 — 방을 넓히면(#4) 문까지 가는 거리가 늘어나는데 상수는 20 에
   * 머문다. 변기 이득비는 이 시간에 정면으로 걸려 있어서, 방만 키워도 변기가
   * 공짜로 유리해진다. 실제로 확장 직후 이득비가 1.10x → 2.86x 로 튀었다.
   *
   * 지금은 `toiletTripTime()` 이 기하에서 유도한다. 남은 것은 이 배율 하나이고,
   * 이건 "문 앞 페이드, 최단 경로가 아닌 실제 동선, 망설임" 처럼 거리에 비례해
   * 붙는 몫이다.
   *
   * 2.04 는 **예전 값과의 연속성**에서 나왔다. 확장 전 기하(16x12, 문 -5.5)로
   * 계산한 기하 왕복이 9.80초이고, 예전 가정이 20초였다 — 20 / 9.80 = 2.04.
   * 즉 이 배율은 새로 지어낸 값이 아니라, 예전 가정을 기하와 오버헤드로
   * **분해한** 결과다. 확장 후 기하 왕복은 11.29초이므로 23.0초가 된다.
   */
  TOILET_TRIP_FIT: 2.04,
  /**
   * 짝에게 다가가느라 경로에서 벗어나는 시간 (초).
   * `MATE_MIN_SPAWN_DIST` 밖에 나타나지만 음식을 찾아 이미 방을 돌아다니므로
   * 순수 우회분만 센다. 화장실처럼 방을 비우는 왕복이 아니다.
   */
  MATE_DETOUR_TIME: 2.0,
} as const;

/**
 * ⚠️ 특식(`CONFIG.TREAT_*`)은 **일부러 모델에 넣지 않았다.** (#2)
 *
 * `TREAT_POOP_GAIN` 이 생기면서 특식도 똥 게이지를 올린다. 크기를 재 보면
 * 무시할 수준은 아니다 — 기준 도달 399초 동안 5개가 등장하고, 전부 주우면
 * 34 x 5 = 170 게이지 = **배변 1.7회분(약 28셀)** 이다. §3-8i 가 모델에
 * 넣은 새끼 1마리의 출력(24셀)과 같은 급이다.
 *
 * 그런데도 넣지 않은 이유는 **주울지 말지가 순전히 플레이어 선택**이고,
 * 그 선택률을 잴 수단이 지금 없기 때문이다. `tools/cycle-probe.ts` 의 봇은
 * `state.foods` 만 목표로 삼고 특식은 지나친다. 즉 봇 실측값은 **특식을
 * 하나도 줍지 않은 하한**이고, 해석 모델도 같은 하한을 쓰고 있어서 둘의
 * 기준이 어긋나지 않는다. 근거 없는 선택률 상수를 하나 지어내 넣으면
 * 그 정합성이 깨진다.
 *
 * 즉 이 5.7% 는 **모델이 모르는 여유분**이다. #4(집 확장) 이후 통합 조정에서
 * 도달 시간이 상한 480초에 아슬아슬하게 붙으면, 이 여유에 기대지 말고
 * 그때 특식 선택률을 봇에 넣어 실측한 뒤 명시적으로 모델링할 것. (#5)
 */

/**
 * 한 배변 사이클 중 **이동에 쓰는 시간** (초).
 * 임신 감속 페널티가 걸리는 부분이라 따로 뽑아 둔다.
 */
export function travelTimePerCycle(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  return (
    travelPerFood(levelIndex, skillMul) * DERIVED.FOODS_PER_POOP +
    repositionTime(levelIndex, skillMul)
  );
}

/** 이동 속도 (world u/초). 레벨 배율과 숙련도를 반영한다. */
function moveSpeed(levelIndex: 0 | 1 | 2, skillMul: number): number {
  return CONFIG.MOVE_SPEED * (CONFIG.LEVEL_SPEED_MUL[levelIndex] ?? 1) * skillMul;
}

/**
 * 음식 **하나**까지 가는 데 드는 시간 (초).
 *
 * 예전에는 이 식이 travelTimePerCycle 과 cycleTime 에 각각 적혀 있었다.
 * 한쪽만 고치면 두 값이 말없이 어긋난다. 한 곳에서만 계산한다.
 */
export function travelPerFood(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  return travelDistPerFood() / moveSpeed(levelIndex, skillMul);
}

/**
 * 음식 하나까지 실제로 이동하는 **거리** (world u). 가구 우회를 이미 포함한다.
 *
 * 동시 개수가 늘면 "가장 가까운 것"을 고를 수 있어 최소 스폰 거리의 영향이
 * 줄어든다. 그 구조가 이 식의 전부다. 근거와 실측표는 ASSUMPTIONS.TRAVEL_SLOPE.
 */
export function travelDistPerFood(): number {
  const a = ASSUMPTIONS;
  const spare = Math.max(1, CONFIG.FOOD_MAX_CONCURRENT - 1);
  return a.TRAVEL_FLOOR + (CONFIG.FOOD_MIN_SPAWN_DIST * a.TRAVEL_SLOPE) / spare;
}

/** 배변 자리를 찾아 미개척지로 더 걷는 시간 (초). */
export function repositionTime(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  const a = ASSUMPTIONS;
  return (a.REPOSITION_DIST * a.PATH_DETOUR) / moveSpeed(levelIndex, skillMul);
}

/**
 * 화장실 왕복에 드는 시간 (초). 방 크기에서 유도한다.
 *
 * 거실 어디에 있든 문까지 가야 하므로 **방 전체에 대한 평균 거리**를 쓴다.
 * 격자 셀 중심을 훑어 평균을 낸다 — 방을 넓히면 이 값이 저절로 커진다.
 * 거기에 화장실 안에서 변기까지 가는 거리를 더하고, 왕복이므로 2배 한다.
 */
export function toiletTripTime(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  let sum = 0;
  let n = 0;
  for (let cz = 0; cz < CONFIG.GRID_H; cz++) {
    for (let cx = 0; cx < CONFIG.GRID_W; cx++) {
      sum += Math.hypot(cellCenterX(cx) - LIVING_DOOR.x, cellCenterZ(cz) - LIVING_DOOR.z);
      n++;
    }
  }
  const toDoor = n > 0 ? sum / n : 0;
  const inside = Math.hypot(
    TOILET_POS.x - BATHROOM_ENTRANCE.x,
    TOILET_POS.z - BATHROOM_ENTRANCE.z,
  );
  const geometric =
    (2 * (toDoor + inside) * ASSUMPTIONS.PATH_DETOUR) / moveSpeed(levelIndex, skillMul);
  return geometric * ASSUMPTIONS.TOILET_TRIP_FIT;
}

/** 음식 하나를 처리하는 데 드는 시간 = 가는 시간 + 먹는 시간 (초). */
export function foodHandlingTime(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  return (
    (travelPerFood(levelIndex, skillMul) + CONFIG.FOOD_EAT_TIME) *
    ASSUMPTIONS.FOOD_HANDLING_FIT
  );
}

/**
 * 음식 리스폰을 기다리며 **서 있는** 평균 시간 (초/사이클).
 *
 * 상수가 아니라 유도값이다. 하나를 먹으면 그 슬롯이 FOOD_RESPAWN_DELAY 뒤에
 * 다시 차는데, 그동안 플레이어는 **남은 슬롯**을 처리하며 시간을 보낸다.
 * 남은 슬롯이 (FOOD_MAX_CONCURRENT − 1) 개이므로, 그만큼을 처리하고도 시간이
 * 남을 때만 실제로 기다리게 된다.
 *
 *   wait = max(0, 리스폰지연 − (동시개수 − 1) × 음식하나처리시간)
 *
 * 이 식이 말해 주는 것: **동시 개수가 대기를 지배한다.** 동시 3개면 처리
 * 시간 두 개분(약 7.6초)이 리스폰 지연보다 길어서, 지연을 6초로 둬도 기다릴
 * 일이 아예 없어진다. 실측도 그렇게 나왔다 (ASSUMPTIONS.FOOD_HANDLING_FIT 의 표).
 *
 * 그래서 동시 개수를 올리면 사이클이 짧아지고, 배고픔(D1)·변기(§14)·짝
 * 불변식이 한꺼번에 흔들린다. `invariants()` 가 그걸 한눈에 보여 준다.
 */
export function respawnWait(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  const spare = Math.max(0, CONFIG.FOOD_MAX_CONCURRENT - 1);
  return Math.max(0, CONFIG.FOOD_RESPAWN_DELAY - spare * foodHandlingTime(levelIndex, skillMul));
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

/** 새끼 배변 1회의 유효 면적 (셀). 플레이어와 같은 원이라 식도 같다. */
export function hatchlingPoopArea(blockedRatio: number = ASSUMPTIONS.BLOCKED_RATIO): number {
  const r = CONFIG.HATCHLING_POOP_RADIUS_CELLS;
  return Math.PI * r * r * (1 - blockedRatio);
}

/**
 * 새끼 한 마리가 수명 동안 싸는 횟수.
 * 첫 배변이 `HATCHLING_FIRST_POOP_SEC` 에 있고 그 뒤로 간격마다 반복한다.
 * 수명이 다하는 **그 스텝에는 싸지 못한다** (HatchlingSystem 이 먼저 내보낸다).
 */
export function hatchlingPoopCount(): number {
  const window = CONFIG.HATCHLING_LIFETIME_SEC - CONFIG.HATCHLING_FIRST_POOP_SEC;
  if (window < 0) return 0;
  return Math.floor(window / CONFIG.HATCHLING_POOP_INTERVAL) + 1;
}

/**
 * 새끼 한 마리의 총 출력 (셀, 중첩 손실 전).
 * 예전 산란 보너스(V × 0.035 = 24칸)와 같은 급이어야 한다. (ROADMAP §3-8i)
 */
export function hatchlingTotalCells(blockedRatio: number = ASSUMPTIONS.BLOCKED_RATIO): number {
  return hatchlingPoopCount() * hatchlingPoopArea(blockedRatio);
}

/**
 * 배변 1회 사이클 시간 (초).
 * 음식 N개 획득 이동 + 먹기 + 미개척지 재배치 + 배변 애니메이션 + 리스폰 대기
 *
 * @param skillMul 1보다 크면 숙련(빠름), 작으면 미숙(느림)
 */
export function cycleTime(levelIndex: 0 | 1 | 2 = 0, skillMul = 1): number {
  return (
    travelPerFood(levelIndex, skillMul) * DERIVED.FOODS_PER_POOP +
    CONFIG.FOOD_EAT_TIME * DERIVED.FOODS_PER_POOP +
    repositionTime(levelIndex, skillMul) +
    CONFIG.POOP_ANIM_TIME +
    respawnWait(levelIndex, skillMul)
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
  /** 새끼가 싼 횟수 */
  hatchlingPoops: number;
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
  let hatchlingPoops = 0;
  let erasedCells = 0;
  let nextPoopAt = 0;
  let lastLevel = -1;
  const levelLog: SimResult['levelLog'] = [];

  // 짝 진행 상태. useMate 가 false 면 전부 잠들어 있다.
  let mateReadyAt = useMate ? CONFIG.MATE_FIRST_APPEAR_SEC : Infinity;
  let approachLeft = 0;
  let pregnantLeft = 0;
  /** 살아 있는 새끼들의 [남은 수명, 다음 배변까지] (§24) */
  const hatchlings: { lifeLeft: number; poopIn: number }[] = [];

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
        // 알에서 새끼가 나온다. 보상의 대부분이 여기에 있다. (§3-8i)
        if (hatchlings.length >= CONFIG.HATCHLING_MAX) hatchlings.shift();
        hatchlings.push({
          lifeLeft: CONFIG.HATCHLING_LIFETIME_SEC,
          poopIn: CONFIG.HATCHLING_FIRST_POOP_SEC,
        });
      }
    }

    // 새끼는 플레이어를 따라다니므로 **미개척지에서 싼다** — 플레이어 똥과 같은
    // 중첩 손실을 받는다. 산란 보너스(인접 확장)와 다른 점이 이것이다.
    for (let i = hatchlings.length - 1; i >= 0; i--) {
      const h = hatchlings[i]!;
      h.lifeLeft -= dt;
      if (h.lifeLeft <= 0) {
        hatchlings.splice(i, 1);
        continue;
      }
      h.poopIn -= dt;
      if (h.poopIn <= 0) {
        h.poopIn = CONFIG.HATCHLING_POOP_INTERVAL;
        owned = Math.min(V, owned + hatchlingPoopArea(blockedRatio) * (1 - beta * (owned / V)));
        hatchlingPoops++;
      }
    }

    const loss = s * (owned / V) * dt;
    owned -= loss;
    erasedCells += loss;

    if (owned >= target) {
      return {
        cleared: true,
        timeSec: t,
        poops,
        foods,
        lays,
        hatchlingPoops,
        erasedCells,
        finalRatio: owned / V,
        levelLog,
      };
    }
    t += dt;
  }

  return {
    cleared: false,
    timeSec: capSec,
    poops,
    foods,
    lays,
    hatchlingPoops,
    erasedCells,
    finalRatio: owned / V,
    levelLog,
  };
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

  const lossDuringTrip = s * occupancy * toiletTripTime();
  const forgoneNormal = (toiletTripTime() / cycle) * normalNet;
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

  const normalNet = poopArea(0) * (1 - ASSUMPTIONS.BETA * occupancy);
  // 둥지(즉시 인접 확장)는 중첩 손실이 없고, 새끼 똥은 플레이어와 같은 손실을 받는다.
  const bonusCells = V * ratio;
  const hatchlingNet = hatchlingTotalCells() * (1 - ASSUMPTIONS.BETA * occupancy);
  const lossDuringTrip = s * occupancy * cost;
  const forgoneNormal = (cost / cycle) * normalNet;

  return (bonusCells + hatchlingNet - lossDuringTrip - forgoneNormal) / normalNet;
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

// ── 불변식 ────────────────────────────────────────────────────────────────

/**
 * 하나의 밸런스 불변식. 지키지 못하면 게임의 어떤 부분이 무너지는지까지 담는다.
 */
export interface Invariant {
  id: string;
  /** 무엇을 지키는 규칙인지 */
  label: string;
  /** 지금 값 */
  value: number;
  /** 허용 범위 (둘 다 포함하지 않는 열린 구간). null 이면 그쪽 끝은 없음 */
  min: number | null;
  max: number | null;
  ok: boolean;
  /** 깨졌을 때 게임에서 실제로 일어나는 일 */
  breaks: string;
}

/**
 * 밸런스 불변식을 **한곳에서** 계산한다.
 *
 * 이걸 만든 이유가 있다. 음식 빈도를 올렸더니 배고픔(D1)·변기(§14)·짝 세
 * 불변식이 **동시에** 깨졌는데, 그 사실을 `npm test` 의 개별 실패 메시지
 * 세 줄로만 알 수 있었다. 값이 얼마나 벗어났는지, 어느 쪽으로 밀어야 하는지,
 * 다른 불변식은 여유가 얼마나 남았는지는 보이지 않았다.
 *
 * 세 불변식은 전부 **사이클 길이 하나**에 걸려 있다. 그래서 상수 하나를
 * 건드리면 셋이 같이 움직인다. 따로 보면 그 연동이 보이지 않는다.
 *
 * `npm run balance` 가 이 표를 찍고, tests/balance.test.ts 가 같은 함수를
 * 쓴다. 판정 기준이 두 곳에 적히지 않는다.
 */
export function invariants(): Invariant[] {
  const cycle = cycleTime(0);
  const restorePerCycle = CONFIG.FOOD_HUNGER_RESTORE * DERIVED.FOODS_PER_POOP;
  const drainPerCycle = CONFIG.HUNGER_DRAIN * cycle;
  const hungerNet = restorePerCycle - drainPerCycle;
  const sim = simulate();
  const mateRun = simulate({ skillMul: 1 / 0.75, useMate: true });

  const inv = (
    id: string,
    label: string,
    value: number,
    min: number | null,
    max: number | null,
    breaks: string,
  ): Invariant => ({
    id,
    label,
    value,
    min,
    max,
    ok: (min === null || value > min) && (max === null || value < max),
    breaks,
  });

  return [
    inv(
      'p-star',
      '평형 점유율 p*',
      analytic().pStar,
      CRITERIA.MIN_P_STAR,
      null,
      '청소기가 플레이어보다 빨라 목표 점유율에 수학적으로 도달할 수 없다',
    ),
    inv(
      'clear-time',
      '도달 시간 (초)',
      sim.timeSec,
      CRITERIA.MIN_TIME_SEC,
      CRITERIA.MAX_TIME_SEC,
      '너무 짧으면 긴장이 없고, 너무 길면 지루하다',
    ),
    inv(
      'hunger-d1',
      '배고픔 사이클당 순증',
      hungerNet,
      0,
      restorePerCycle * 0.5,
      '음식이 남아돌아 배고픔이 장식이 된다 (ROADMAP D1). 0 이하면 반대로 무조건 굶어 죽는다',
    ),
    inv(
      'toilet-30',
      '변기 이득비 (p=0.30)',
      toiletAdvantage(0.3),
      1.0,
      1.5,
      '1 미만이면 변기에 갈 이유가 사라지고, 1.5 초과면 변기만 도는 게임이 된다 (§14)',
    ),
    inv(
      'toilet-44',
      '변기 이득비 (p=0.44)',
      toiletAdvantage(0.44),
      null,
      2.0,
      '후반에 변기가 압도적이면 다른 선택지가 무의미해진다 (§14)',
    ),
    inv(
      'mate-30',
      '짝 이득비 (p=0.30)',
      mateAdvantage(0.3),
      1.0,
      2.0,
      '1 미만이면 짝에 갈 이유가 없고, 2 초과면 짝만 도는 게임이 된다 (§24, §3-8h)',
    ),
    inv(
      'mate-44',
      '짝 이득비 (p=0.44)',
      mateAdvantage(0.44),
      1.0,
      null,
      '후반에 짝이 손해면 임신 감속을 감수할 이유가 없다 (§24)',
    ),
    inv(
      'mate-floor',
      '짝 최속 루트 도달 (초)',
      mateRun.timeSec,
      CRITERIA.MIN_TIME_SEC - 10,
      null,
      '짝을 최대한 쓰는 플레이가 설계 하한(300초)을 뚫으면 그게 지배적인 최적해가 된다 (§3-8h)',
    ),
  ];
}

/** 깨진 불변식만. 비어 있으면 전부 지켜지고 있다. */
export function brokenInvariants(): Invariant[] {
  return invariants().filter((i) => !i.ok);
}
