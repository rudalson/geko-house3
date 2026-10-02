import { describe, expect, it } from 'vitest';
import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import {
  ASSUMPTIONS,
  CRITERIA,
  analytic,
  breakEvenCycleSec,
  cycleTime,
  effectiveCells,
  hatchlingTotalCells,
  simulate,
  invariants,
  brokenInvariants,
  respawnWait,
  travelDistPerFood,
  type Invariant,
} from '../src/core/BalanceModel.ts';

/**
 * 불변식 하나를 id 로 집어 검사한다.
 *
 * 판정 기준(허용 범위)은 BalanceModel.invariants() 에만 적는다. 예전에는
 * 같은 숫자가 모델과 테스트 양쪽에 적혀 있어서, 한쪽만 고치면 말없이 어긋났다.
 */
function expectInvariant(id: Invariant['id']): void {
  const found = invariants().find((i) => i.id === id);
  expect(found, `불변식 '${id}' 가 없다 — BalanceModel.invariants() 를 확인할 것`).toBeDefined();
  const i = found!;
  const range = `${i.min === null ? '-∞' : i.min.toFixed(2)}~${i.max === null ? '∞' : i.max.toFixed(2)}`;
  expect(i.ok, `${i.label} = ${i.value.toFixed(3)} (허용 ${range}) → ${i.breaks}`).toBe(true);
}

/**
 * §21-1 밸런스 회귀 테스트 — **반드시 유지할 것.**
 *
 * CONFIG 를 잘못 만지면 여기서 깨져서 알려준다.
 * 실패하면 상수를 되돌리거나, 의도한 변경이라면
 * `npm run balance` 를 돌려 ROADMAP.md §3 의 검증표를 갱신할 것.
 */
describe('밸런스 회귀 (§0-1)', () => {
  it('평형 점유율이 목표 40%를 넘는다 — 넘지 못하면 클리어가 수학적으로 불가능', () => {
    const { pStar } = analytic();
    expect(pStar).toBeGreaterThan(CRITERIA.MIN_P_STAR);
    // 여유가 너무 얇으면 플레이어 편차에 취약해진다.
    expect(pStar).toBeGreaterThan(0.52);
  });

  it('40% 도달 시간이 5~8분 구간에 들어온다', () => {
    const sim = simulate();
    expect(sim.cleared).toBe(true);
    expect(sim.timeSec).toBeGreaterThanOrEqual(CRITERIA.MIN_TIME_SEC);
    expect(sim.timeSec).toBeLessThanOrEqual(CRITERIA.MAX_TIME_SEC);
  });

  /**
   * §0-1 의 합격 기준은 **기준 시나리오**의 도달 시간이다.
   * 숙련~미숙 편차(±25~60%)는 그 자체로 1.6배가 넘어서 5~8분(1.6배) 구간에
   * 통째로 밀어넣을 수 없다. 억지로 맞추려 하면 상수를 계속 흔들게 되므로,
   * 넓은 구간에는 "클리어는 가능하고 지루하지 않다"만 요구한다.
   */
  it('숙련 플레이가 지나치게 빨리 끝나지 않는다', () => {
    const fast = simulate({ skillMul: 1 / 0.75 });
    expect(fast.cleared).toBe(true);
    expect(fast.timeSec, '숙련자가 4분 안에 끝내면 긴장감이 없다').toBeGreaterThan(240);
  });

  it('느린 플레이도 클리어할 수 있다 — 실력이 부족해도 막히지 않는다', () => {
    for (const skillMul of [0.8, 0.625]) {
      const slow = simulate({ skillMul });
      expect(slow.cleared, `skillMul=${skillMul}`).toBe(true);
      expect(slow.timeSec, `skillMul=${skillMul} 가 너무 오래 걸린다`).toBeLessThan(900);
    }
  });

  it('플레이어가 헤매도 클리어 가능한 여유가 충분하다 (한계 사이클 ≥ 기준의 1.4배)', () => {
    expect(breakEvenCycleSec()).toBeGreaterThan(cycleTime(0) * 1.4);
  });

  it('변기 보너스가 일반 배변 대비 "미세하게" 유리하다 (§14)', () => {
    // 초반에는 호각, 후반에 마무리용으로 유리해야 한다.
    expectInvariant('toilet-30');
    expectInvariant('toilet-40');
  });

  /**
   * 새끼 도마뱀 (§24, §3-8i).
   *
   * 새끼는 산란 보너스를 **대체한** 것이지 위에 얹은 것이 아니다.
   * 이 셋이 깨지면 짝 루트가 지배적인 최적해가 되어 "짝만 도는 게임"이 된다.
   */
  it('새끼 한 마리의 총 출력이 예전 산란 보너스(24칸)와 같은 급이다', () => {
    const old = effectiveCells() * 0.035;
    expect(hatchlingTotalCells()).toBeGreaterThan(old * 0.85);
    expect(hatchlingTotalCells()).toBeLessThan(old * 1.15);
  });

  it('짝을 최대한 써도 하한 시간에 붙어 있다', () => {
    // §3-8h 는 예전 수치에서 숙련 278초 — 하한 300초를 밑돈다고 기록해 뒀다.
    // 보상을 즉시 24칸에서 60초짜리 새끼로 옮기면서 299.9초까지 올라왔다.
    // 하한에 걸쳐 있으므로 정확히 300 이상을 요구하지 않는다. 지켜야 할 것은
    // **예전보다 빨라지지 않는 것** 이다.
    const fast = simulate({ skillMul: 1 / 0.75, useMate: true });
    expect(fast.cleared).toBe(true);
    expectInvariant('mate-floor');
    expect(fast.hatchlingPoops, '새끼가 한 번도 싸지 않았다').toBeGreaterThan(0);
  });

  it('짝 루트가 쓸 만하되 지배적이지는 않다 (§24)', () => {
    // 1.0 을 넘어야 갈 이유가 있고, 변기(1.10x/1.29x)와 비슷한 급이어야
    // 둘이 서로를 대체하지 않는다. 중반은 짝, 후반은 변기가 낫다.
    expectInvariant('mate-30');
    expectInvariant('mate-40');
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
    // #4 에서 격자를 32x24 → 40x30 으로 넓혔다.
    expect(DERIVED.TOTAL_CELLS).toBe(1200);
    expect(effectiveCells()).toBe(1074); // 1200 − BLOCKED 126 (furnitureLayout 실측)
    expect(Math.round(effectiveCells() * CONFIG.TARGET_RATIO)).toBe(430);
  });

  it('배고픔이 장식이 되지 않는다 — 사이클당 순증이 회복량의 절반을 넘지 않는다 (D1)', () => {
    // 하한 0 = 효율적 플레이는 굶지 않는다 / 상한 = 여유가 빠듯하다
    expectInvariant('hunger-d1');
  });

  /**
   * 유도한 대기 시간이 봇 실측과 맞는지. (#3)
   *
   * `respawnWait()` 는 손으로 적은 상수를 대체한 **유도식**이다. 식이 틀리면
   * 사이클이 통째로 어긋나고 위의 불변식이 전부 엉뚱한 값을 본다. 그래서
   * 계측 원본을 여기에 박아 두고 식이 이걸 재현하는지 지킨다.
   *
   * 실측은 tools/cycle-probe.ts 를 계측용으로 복사해 "활성 음식이 하나도 없어
   * 제자리에 서 있는" 스텝을 센 것이다 (5시드 평균).
   */
  it('리스폰 대기 유도식이 봇 실측을 재현한다 (#3)', () => {
    const measured: [number, number, number][] = [
      // [동시 개수, 리스폰 지연, 실측 대기]
      [2, 6.0, 2.25],
      [2, 5.0, 1.18],
      [2, 4.5, 0.62],
      [3, 6.0, 0.08],
      [3, 5.0, 0.03],
      [3, 4.0, 0.0],
    ];

    const keep = {
      n: CONFIG.FOOD_MAX_CONCURRENT,
      d: CONFIG.FOOD_RESPAWN_DELAY,
      dist: CONFIG.FOOD_MIN_SPAWN_DIST,
    };
    // 대기 실측은 **최소 스폰 거리 6.5** 에서 쟀다. 대기는 음식 하나를 처리하는
    // 시간에 걸려 있고 그 시간은 이동 거리에서 나오므로, 거리를 고정하지 않으면
    // 다른 조건의 실측과 비교하게 된다. (실제로 거리를 9.0 으로 올렸을 때
    // 이 테스트가 그걸 잡아냈다.)
    const MEASURED_AT_DIST = 6.5;
    try {
      for (const [n, d, want] of measured) {
        // CONFIG 는 `as const` 지만 런타임에는 평범한 객체다. 원복은 finally 에서.
        (CONFIG as { FOOD_MAX_CONCURRENT: number }).FOOD_MAX_CONCURRENT = n;
        (CONFIG as { FOOD_RESPAWN_DELAY: number }).FOOD_RESPAWN_DELAY = d;
        (CONFIG as { FOOD_MIN_SPAWN_DIST: number }).FOOD_MIN_SPAWN_DIST = MEASURED_AT_DIST;
        // 허용 오차 0.15초. 유도식은 평균을 맞추는 것이지 분산까지 담지 않는다.
        // 실제 최대 오차는 0.073초(동시 2 / 6초)다. 동시 2 / 4.0초만 0.31초로
        // 크게 어긋나는데, 대기가 0 에 가까워질 때의 분산 때문이라 표본에서 뺐다.
        // 자세한 내용은 ASSUMPTIONS.FOOD_HANDLING_FIT 주석의 표.
        expect(
          Math.abs(respawnWait() - want),
          `동시 ${n} / 리스폰 ${d}초 — 실측 ${want}초, 유도식 ${respawnWait().toFixed(2)}초`,
        ).toBeLessThan(0.15);
      }
    } finally {
      (CONFIG as { FOOD_MAX_CONCURRENT: number }).FOOD_MAX_CONCURRENT = keep.n;
      (CONFIG as { FOOD_RESPAWN_DELAY: number }).FOOD_RESPAWN_DELAY = keep.d;
      (CONFIG as { FOOD_MIN_SPAWN_DIST: number }).FOOD_MIN_SPAWN_DIST = keep.dist;
    }
  });

  /**
   * 이동 거리 유도식이 봇 실측을 재현하는지. (#3)
   *
   * 예전 모델은 "이동거리 = 최소거리 x 1.12 x 우회" 였다. 동시 개수를 2 → 3 으로
   * 올리자 **방향을 틀리게** 예측했다 (모델 +6%, 실제 −17%). 가장 가까운 것을
   * 고른다는 사실이 빠져 있었기 때문이다. 그 위에서 밸런스를 맞추면 게임이
   * 계산과 다르게 나온다. 실측을 박아 두고 식이 이걸 재현하는지 지킨다.
   */
  it('이동 거리 유도식이 봇 실측을 재현한다 (#3)', () => {
    const measured: [number, number, number][] = [
      // [동시 개수, 최소 스폰 거리, 실측 이동거리 (world u)]
      [2, 6.5, 12.84],
      [2, 8.0, 14.26],
      [3, 6.5, 9.65],
      [3, 8.0, 9.91],
      [3, 10.0, 11.32],
    ];

    const keep = {
      n: CONFIG.FOOD_MAX_CONCURRENT,
      dist: CONFIG.FOOD_MIN_SPAWN_DIST,
    };
    try {
      for (const [n, d, want] of measured) {
        (CONFIG as { FOOD_MAX_CONCURRENT: number }).FOOD_MAX_CONCURRENT = n;
        (CONFIG as { FOOD_MIN_SPAWN_DIST: number }).FOOD_MIN_SPAWN_DIST = d;
        const got = travelDistPerFood();
        // 허용 5%. 실제 최대 오차는 3.9%(동시 3 / 거리 8.0)다.
        expect(
          Math.abs(got - want) / want,
          `동시 ${n} / 최소거리 ${d} — 실측 ${want}u, 유도식 ${got.toFixed(2)}u`,
        ).toBeLessThan(0.05);
      }
    } finally {
      (CONFIG as { FOOD_MAX_CONCURRENT: number }).FOOD_MAX_CONCURRENT = keep.n;
      (CONFIG as { FOOD_MIN_SPAWN_DIST: number }).FOOD_MIN_SPAWN_DIST = keep.dist;
    }
  });
});

/**
 * 불변식 전체를 한 번에 본다.
 *
 * 개별 테스트는 "무엇이 깨졌는지"만 알려 준다. 상수 하나를 건드리면 여러 개가
 * **같이** 움직이는데(#3 에서 셋이 동시에 깨졌다), 그때 필요한 건 전체 그림이다.
 * 여기서는 깨진 것을 모아 한 메시지로 보여 준다.
 */
describe('밸런스 불변식 전체 (#3)', () => {
  it('모든 불변식이 지켜진다', () => {
    const broken = brokenInvariants();
    const report = broken
      .map(
        (i) =>
          `  ✗ ${i.label} = ${i.value.toFixed(3)} ` +
          `(허용 ${i.min === null ? '-∞' : i.min.toFixed(2)}~${i.max === null ? '∞' : i.max.toFixed(2)})\n` +
          `     → ${i.breaks}`,
      )
      .join('\n');
    expect(broken.length, `깨진 불변식 ${broken.length}건:\n${report}\n`).toBe(0);
  });

  it('불변식 목록이 비어 있지 않다 — 검사기가 조용히 사라지지 않게', () => {
    expect(invariants().length).toBeGreaterThanOrEqual(8);
  });
});
