/**
 * 게코 하우스 서바이벌 — 밸런스 검증 (§0-1)
 *
 *   npm run balance
 *
 * ROADMAP.md §3 의 모든 수치를 재생산한다.
 * GameConfig 의 밸런스 상수를 바꾸면 반드시 이 스크립트를 다시 돌리고
 * ROADMAP.md §3 의 표를 갱신할 것.
 *
 * 모델:  dC/dt = G0·(1 − β·p) − S·p = G0 − (S + β·G0)·p     (p = C/V)
 *        p*    = G0 / S_eff,   S_eff = S + β·G0
 *        t     = −(V / S_eff) · ln(1 − 0.44 / p*)
 */

import { pathToFileURL } from 'node:url';

// ── 격자 ────────────────────────────────────────────────────────────────
const GRID_W = 32;
const GRID_H = 24;
const CELL_SIZE = 0.5;
const TOTAL_CELLS = GRID_W * GRID_H;
const BLOCKED_RATIO = 0.12; // 가구 배치 실측치로 갱신할 것 (허용 10~15%)
const V = Math.round(TOTAL_CELLS * (1 - BLOCKED_RATIO));
const TARGET_RATIO = 0.44;
const TARGET_C = V * TARGET_RATIO;

// ── 플레이어 배변 사이클 ─────────────────────────────────────────────────
const MOVE_SPEED = 3.2; // world u/s
const FOODS_PER_POOP = 3; // POOP_PER_FOOD = 34 → 3개로 100 충전
const FOOD_MIN_SPAWN_DIST = 7.5; // world u
const SPAWN_DIST_FACTOR = 1.12; // 최소거리 대비 평균 스폰 거리
const PATH_DETOUR = 1.12; // 가구/청소기 회피 경로 증가율
const FOOD_EAT_TIME = 0.6;
const POOP_ANIM_TIME = 1.0;
const REPOSITION_DIST = 2.5; // 미개척지까지 추가 이동
const RESPAWN_WAIT = 0.6; // 리스폰 대기 평균

function cycleTime(speedMul = 1) {
  const spd = MOVE_SPEED * speedMul;
  const perFood = (FOOD_MIN_SPAWN_DIST * SPAWN_DIST_FACTOR * PATH_DETOUR) / spd;
  return (
    perFood * FOODS_PER_POOP +
    FOOD_EAT_TIME * FOODS_PER_POOP +
    (REPOSITION_DIST * PATH_DETOUR) / spd +
    POOP_ANIM_TIME +
    RESPAWN_WAIT
  );
}

// 연속 좌표 배치이므로 기대 셀 수 = 원 면적. BLOCKED 만큼 손실.
const aEff = (rCells) => Math.PI * rCells * rCells * (1 - BLOCKED_RATIO);

// ── 로봇청소기 ──────────────────────────────────────────────────────────
const VACUUM_SPEED_CELLS = 1.2;
const VACUUM_CLEAN_WIDTH = 1.2; // VACUUM_CLEAN_RADIUS_CELLS 0.6 × 2
const STRAIGHT_AVG = 2.5;
const TURN_TIME = 0.4;
const DUTY = STRAIGHT_AVG / (STRAIGHT_AVG + TURN_TIME); // 회전 중 청소 정지
const COVERAGE_ETA = 0.85; // 경로 중복으로 인한 유효 스윕 감소
const S = VACUUM_SPEED_CELLS * VACUUM_CLEAN_WIDTH * DUTY * COVERAGE_ETA;

const BETA = 0.8; // 중첩 계수 (1.0 = 완전 무작위 배치)

// ── 성장 ────────────────────────────────────────────────────────────────
const FOOD_PER_AGE = 10;
const LEVEL_THRESHOLDS = [1, 4, 7];
const LVL_POOP_RADIUS = [2.3, 2.5, 2.7];
const LVL_SPEED_MUL = [1.0, 1.0, 1.1];
const levelOf = (age) =>
  age >= LEVEL_THRESHOLDS[2] ? 2 : age >= LEVEL_THRESHOLDS[1] ? 1 : 0;

// ── 변기 ────────────────────────────────────────────────────────────────
const TOILET_BONUS_RATIO = 0.05;
const TOILET_TRIP_TIME = 20; // 왕복 추가 시간
const TOILET_VACUUM_SLOW = 0.5;
const TOILET_VACUUM_SLOW_TIME = 8;

// ════════════════════════════════════════════════════════════════════════
// A. 해석해 (배변 반경 고정 가정)
// ════════════════════════════════════════════════════════════════════════
export function analytic(T, rCells) {
  const G0 = aEff(rCells) / T;
  const Seff = S + BETA * G0;
  const pStar = G0 / Seff;
  const t =
    pStar > TARGET_RATIO
      ? -(V / Seff) * Math.log(1 - TARGET_RATIO / pStar)
      : Infinity;
  return { T, G0, S, Seff, pStar, t };
}

// ════════════════════════════════════════════════════════════════════════
// B. 수치 적분 (Age → Lvl 성장 반영). 이쪽이 기준값.
// ════════════════════════════════════════════════════════════════════════
export function simulate({ speedMul = 1, dt = 0.05, cap = 2400 } = {}) {
  let C = 0,
    t = 0,
    foods = 0,
    next = 0,
    poops = 0,
    erased = 0;
  const levelLog = [];
  let lastLvl = -1;

  while (t < cap) {
    const lvl = levelOf(Math.floor(foods / FOOD_PER_AGE));
    if (lvl !== lastLvl) {
      levelLog.push({ lvl: lvl + 1, t: +t.toFixed(1), pct: +((100 * C) / V).toFixed(1) });
      lastLvl = lvl;
    }
    const T = cycleTime(LVL_SPEED_MUL[lvl] * speedMul);
    if (next === 0) next = T;

    if (t >= next) {
      C = Math.min(V, C + aEff(LVL_POOP_RADIUS[lvl]) * (1 - BETA * (C / V)));
      foods += FOODS_PER_POOP;
      poops++;
      next = t + T;
    }
    const loss = S * (C / V) * dt;
    C -= loss;
    erased += loss;

    if (C >= TARGET_C) return { cleared: true, t, poops, foods, erased, levelLog };
    t += dt;
  }
  return { cleared: false, t: cap, poops, foods, erased, levelLog, finalPct: (100 * C) / V };
}

// ════════════════════════════════════════════════════════════════════════
// 합격 기준 (§21 밸런스 회귀 테스트가 그대로 사용)
// ════════════════════════════════════════════════════════════════════════
export const CRITERIA = { MIN_P_STAR: TARGET_RATIO, MIN_TIME: 300, MAX_TIME: 480 };

export function verdict() {
  const a = analytic(cycleTime(1), LVL_POOP_RADIUS[0]);
  const b = simulate();
  return {
    pStar: a.pStar,
    clearTime: b.t,
    pass: a.pStar > CRITERIA.MIN_P_STAR && b.t >= CRITERIA.MIN_TIME && b.t <= CRITERIA.MAX_TIME,
    analytic: a,
    sim: b,
  };
}

// ════════════════════════════════════════════════════════════════════════
// 리포트
// ════════════════════════════════════════════════════════════════════════
// Windows 경로에서도 안전하게 진입점 판정 (file:/// 슬래시 개수 차이 회피)
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain || process.argv.includes('--report')) {
  const n = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '∞');
  const T = cycleTime(1);
  const a = analytic(T, LVL_POOP_RADIUS[0]);

  console.log('=== 기본 제원 ===');
  console.log(`거실 ${GRID_W * CELL_SIZE} x ${GRID_H * CELL_SIZE} world units (${GRID_W}x${GRID_H} 격자)`);
  console.log(`전체 ${TOTAL_CELLS}셀 / BLOCKED ${(BLOCKED_RATIO * 100).toFixed(0)}% (${TOTAL_CELLS - V}셀) / 유효 V=${V} / 목표 ${TARGET_C.toFixed(0)}셀`);
  console.log(`배변 유효면적 A_eff = ${n(aEff(LVL_POOP_RADIUS[0]), 1)}셀 (r=${LVL_POOP_RADIUS[0]}셀)`);
  console.log(`배변 사이클 T = ${n(T)}초 (음식 ${FOODS_PER_POOP}개)`);
  console.log(`S = ${VACUUM_SPEED_CELLS} x ${VACUUM_CLEAN_WIDTH} x duty ${n(DUTY, 3)} x eta ${COVERAGE_ETA} = ${n(S, 3)} 셀/초`);

  console.log('\n=== A. 해석해 (Lvl1 고정) ===');
  console.log(`G0=${n(a.G0)}  S=${n(a.S)}  S_eff=${n(a.Seff)}  p*=${n(a.pStar, 3)}  t=${n(a.t)}초 (${n(a.t / 60, 1)}분)`);

  console.log('\n=== B. 숙련도 민감도 (수치 적분, 성장 반영) ===');
  console.log('시나리오\t\t사이클\t도달(초)\t도달(분)\t배변\t음식\t지워진셀\t판정');
  for (const [name, mul] of [
    ['숙련 (-25%)', 1 / 0.75],
    ['기준', 1.0],
    ['보통 (+25%)', 0.8],
    ['미숙 (+60%)', 0.625],
  ]) {
    const r = simulate({ speedMul: mul });
    const v = !r.cleared
      ? `실패(${n(r.finalPct, 1)}%)`
      : r.t < CRITERIA.MIN_TIME ? '빠름' : r.t <= CRITERIA.MAX_TIME ? 'OK' : '느림';
    console.log(`${name.padEnd(16)}\t${n(cycleTime(mul), 1)}\t${r.t.toFixed(0)}\t\t${n(r.t / 60, 1)}\t\t${r.poops}\t${r.foods}\t${r.erased.toFixed(0)}\t\t${v}`);
  }
  const base = simulate();
  console.log('레벨업 시점:', base.levelLog.map((l) => `Lvl${l.lvl}@${l.t}s(${l.pct}%)`).join('  '));

  let breakEven = 0;
  for (let x = 5; x < 60; x += 0.05) {
    if (analytic(x, LVL_POOP_RADIUS[0]).pStar <= TARGET_RATIO) { breakEven = x; break; }
  }
  console.log(`\n클리어 가능 한계 사이클: T < ${n(breakEven, 1)}초 (기준 ${n(T, 1)}초 대비 ${n(((breakEven / T) - 1) * 100, 0)}% 여유)`);

  console.log('\n=== C. 변기 보너스 손익 ===');
  console.log('비율\t보너스셀\tp=0.30\t\tp=0.44');
  for (const ratio of [0.1, 0.07, TOILET_BONUS_RATIO, 0.04]) {
    const B = V * ratio;
    const cells = [ratio.toFixed(3), B.toFixed(0)];
    for (const p of [0.3, 0.44]) {
      const normal = aEff(LVL_POOP_RADIUS[0]) * (1 - BETA * p);
      const net =
        B - S * p * TOILET_TRIP_TIME - (TOILET_TRIP_TIME / T) * normal +
        TOILET_VACUUM_SLOW * S * p * TOILET_VACUUM_SLOW_TIME;
      cells.push(n(net / normal) + 'x');
    }
    console.log(cells.join('\t\t'));
  }

  const vd = verdict();
  console.log(`\n=== 판정: ${vd.pass ? '✅ 합격' : '❌ 불합격'} ===`);
  console.log(`p* = ${n(vd.pStar, 3)} (> ${CRITERIA.MIN_P_STAR} 필요) / 도달 ${vd.clearTime.toFixed(0)}초 (${CRITERIA.MIN_TIME}~${CRITERIA.MAX_TIME}초 필요)`);
  if (!vd.pass) process.exitCode = 1;
}
