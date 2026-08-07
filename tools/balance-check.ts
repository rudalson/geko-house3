/**
 * 밸런스 검증 리포트. §0-1
 *
 *   npm run balance
 *
 * 계산은 전부 src/core/BalanceModel.ts (= CONFIG 기반) 에 있다.
 * 이 파일은 출력만 담당하므로 상수를 여기에 다시 적지 않는다.
 * 합격 기준을 만족하지 못하면 exit code 1 로 끝난다.
 */

import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import {
  ASSUMPTIONS,
  CRITERIA,
  analytic,
  breakEvenCycleSec,
  cycleTime,
  effectiveCells,
  poopArea,
  simulate,
  targetCells,
  toiletAdvantage,
  vacuumSweepRate,
  verdict,
} from '../src/core/BalanceModel.ts';

const n = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : '∞');
const V = effectiveCells();

console.log('=== 기본 제원 ===');
console.log(
  `거실 ${DERIVED.ROOM_W} x ${DERIVED.ROOM_H} world units (${CONFIG.GRID_W}x${CONFIG.GRID_H} 격자)`,
);
console.log(
  `전체 ${DERIVED.TOTAL_CELLS}셀 / BLOCKED ${(ASSUMPTIONS.BLOCKED_RATIO * 100).toFixed(0)}% ` +
    `(${DERIVED.TOTAL_CELLS - V}셀) / 유효 V=${V} / 목표 ${targetCells().toFixed(0)}셀`,
);
console.log(
  `배변 유효면적 A_eff = ${n(poopArea(0), 1)}셀 (r=${CONFIG.LEVEL_POOP_RADIUS_CELLS[0]}셀)`,
);
console.log(`배변 사이클 T = ${n(cycleTime(0))}초 (음식 ${DERIVED.FOODS_PER_POOP}개)`);
console.log(`청소 감소율 S = ${n(vacuumSweepRate(), 3)} 셀/초`);

console.log('\n=== A. 해석해 (Lvl1 반경 고정 가정) ===');
const a = analytic();
console.log(
  `G0=${n(a.g0)}  S=${n(a.s)}  S_eff=${n(a.sEff)}  p*=${n(a.pStar, 3)}  ` +
    `t=${n(a.timeSec)}초 (${n(a.timeSec / 60, 1)}분)`,
);

console.log('\n=== B. 숙련도 민감도 (수치 적분, 성장 반영) — 기준값 ===');
console.log('시나리오\t\t사이클\t도달(초)\t도달(분)\t배변\t음식\t지워진셀\t판정');
const scenarios: [string, number][] = [
  ['숙련 (-25%)', 1 / 0.75],
  ['기준', 1.0],
  ['보통 (+25%)', 0.8],
  ['미숙 (+60%)', 0.625],
];
for (const [name, mul] of scenarios) {
  const r = simulate({ skillMul: mul });
  const v = !r.cleared
    ? `실패(${n(r.finalRatio * 100, 1)}%)`
    : r.timeSec < CRITERIA.MIN_TIME_SEC
      ? '빠름'
      : r.timeSec <= CRITERIA.MAX_TIME_SEC
        ? 'OK'
        : '느림';
  console.log(
    `${name.padEnd(16)}\t${n(cycleTime(0, mul), 1)}\t${r.timeSec.toFixed(0)}\t\t` +
      `${n(r.timeSec / 60, 1)}\t\t${r.poops}\t${r.foods}\t${r.erasedCells.toFixed(0)}\t\t${v}`,
  );
}
const base = simulate();
console.log(
  '레벨업 시점:',
  base.levelLog.map((l) => `Lvl${l.level}@${l.atSec}s(${(l.ratio * 100).toFixed(1)}%)`).join('  '),
);

const be = breakEvenCycleSec();
console.log(
  `\n클리어 가능 한계 사이클: T < ${n(be, 1)}초 ` +
    `(기준 ${n(cycleTime(0), 1)}초 대비 ${n((be / cycleTime(0) - 1) * 100, 0)}% 여유)`,
);

console.log('\n=== C. 변기 보너스 손익 (§14 "미세하게 유리") ===');
console.log('비율\t보너스셀\tp=0.30\t\tp=0.44');
for (const ratio of [0.1, 0.07, CONFIG.TOILET_BONUS_RATIO, 0.04]) {
  const mark = ratio === CONFIG.TOILET_BONUS_RATIO ? ' ←채택' : '';
  console.log(
    `${ratio.toFixed(3)}\t\t${(V * ratio).toFixed(0)}\t\t` +
      `${n(toiletAdvantage(0.3, ratio))}x\t\t${n(toiletAdvantage(0.44, ratio))}x${mark}`,
  );
}

const vd = verdict();
console.log(`\n=== 판정: ${vd.pass ? '✅ 합격' : '❌ 불합격'} ===`);
console.log(
  `p* = ${n(vd.pStar, 3)} (> ${CRITERIA.MIN_P_STAR} 필요) / ` +
    `도달 ${vd.clearTimeSec.toFixed(0)}초 (${CRITERIA.MIN_TIME_SEC}~${CRITERIA.MAX_TIME_SEC}초 필요)`,
);
for (const r of vd.reasons) console.log(`  ✗ ${r}`);
if (!vd.pass) process.exitCode = 1;
