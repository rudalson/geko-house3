import { describe, expect, it } from 'vitest';
import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import {
  ASSUMPTIONS,
  CRITERIA,
  analytic,
  breakEvenCycleSec,
  cycleTime,
  effectiveCells,
  simulate,
  toiletAdvantage,
} from '../src/core/BalanceModel.ts';

/**
 * §21-1 밸런스 회귀 테스트 — **반드시 유지할 것.**
 *
 * CONFIG 를 잘못 만지면 여기서 깨져서 알려준다.
 * 실패하면 상수를 되돌리거나, 의도한 변경이라면
 * `npm run balance` 를 돌려 ROADMAP.md §3 의 검증표를 갱신할 것.
 */
describe('밸런스 회귀 (§0-1)', () => {
  it('평형 점유율이 목표 44%를 넘는다 — 넘지 못하면 클리어가 수학적으로 불가능', () => {
    const { pStar } = analytic();
    expect(pStar).toBeGreaterThan(CRITERIA.MIN_P_STAR);
    // 여유가 너무 얇으면 플레이어 편차에 취약해진다.
    expect(pStar).toBeGreaterThan(0.52);
  });

  it('44% 도달 시간이 5~8분 구간에 들어온다', () => {
    const sim = simulate();
    expect(sim.cleared).toBe(true);
    expect(sim.timeSec).toBeGreaterThanOrEqual(CRITERIA.MIN_TIME_SEC);
    expect(sim.timeSec).toBeLessThanOrEqual(CRITERIA.MAX_TIME_SEC);
  });

  it('숙련~보통 플레이 전 구간이 합격 구간 안에 있다', () => {
    for (const skillMul of [1 / 0.75, 1.0, 0.8]) {
      const sim = simulate({ skillMul });
      expect(sim.cleared, `skillMul=${skillMul}`).toBe(true);
      expect(sim.timeSec, `skillMul=${skillMul}`).toBeLessThanOrEqual(CRITERIA.MAX_TIME_SEC);
    }
  });

  it('플레이어가 헤매도 클리어 가능한 여유가 충분하다 (한계 사이클 ≥ 기준의 1.4배)', () => {
    expect(breakEvenCycleSec()).toBeGreaterThan(cycleTime(0) * 1.4);
  });

  it('변기 보너스가 일반 배변 대비 "미세하게" 유리하다 (§14)', () => {
    // 초반에는 호각, 후반에 마무리용으로 유리해야 한다.
    expect(toiletAdvantage(0.3)).toBeGreaterThan(1.0);
    expect(toiletAdvantage(0.3)).toBeLessThan(1.5);
    expect(toiletAdvantage(0.44)).toBeLessThan(2.0);
  });

  it('BLOCKED 비율이 허용 범위를 벗어나면 계산이 무너진다는 것을 문서화한다 (R1)', () => {
    const [lo, hi] = CONFIG.BLOCKED_RATIO_RANGE;
    expect(ASSUMPTIONS.BLOCKED_RATIO).toBeGreaterThanOrEqual(lo);
    expect(ASSUMPTIONS.BLOCKED_RATIO).toBeLessThanOrEqual(hi);
    // 허용 범위 양 끝에서도 클리어는 가능해야 한다.
    for (const blockedRatio of [lo, hi]) {
      const sim = simulate({ blockedRatio });
      expect(sim.cleared, `blockedRatio=${blockedRatio}`).toBe(true);
    }
  });
});

describe('밸런스 파생값 정합성', () => {
  it('음식 3개로 똥 게이지가 정확히 가득 찬다', () => {
    expect(DERIVED.FOODS_PER_POOP).toBe(3);
    expect(CONFIG.POOP_PER_FOOD * 3).toBeGreaterThanOrEqual(CONFIG.POOP_MAX);
    expect(CONFIG.POOP_PER_FOOD * 2).toBeLessThan(CONFIG.POOP_MAX);
  });

  it('유효 셀 수와 목표 셀 수가 ROADMAP §3-2 와 일치한다', () => {
    expect(DERIVED.TOTAL_CELLS).toBe(768);
    expect(effectiveCells()).toBe(676);
    expect(Math.round(effectiveCells() * CONFIG.TARGET_RATIO)).toBe(297);
  });

  it('배고픔이 장식이 되지 않는다 — 사이클당 순증이 회복량의 절반을 넘지 않는다 (D1)', () => {
    const restorePerCycle = CONFIG.FOOD_HUNGER_RESTORE * DERIVED.FOODS_PER_POOP;
    const drainPerCycle = CONFIG.HUNGER_DRAIN * cycleTime(0);
    expect(restorePerCycle).toBeGreaterThan(drainPerCycle); // 효율적 플레이는 굶지 않는다
    expect(restorePerCycle - drainPerCycle).toBeLessThan(restorePerCycle * 0.5); // 그러나 여유는 빠듯하다
  });
});
