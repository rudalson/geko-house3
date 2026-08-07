import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/core/GameConfig.ts';
import { GameLoop } from '../src/core/GameLoop.ts';

const DT = CONFIG.FIXED_DT;

describe('고정 타임스텝 (§0-5)', () => {
  it('로직은 항상 정확히 1/60초 간격으로 호출된다', () => {
    const dts: number[] = [];
    const loop = new GameLoop((dt) => dts.push(dt));

    loop.advance(0.05); // 3스텝 (0.05 / 0.01667 = 3.0)
    expect(dts).toHaveLength(3);
    expect(dts.every((d) => d === DT)).toBe(true);
  });

  it('가변 프레임률이어도 총 시뮬레이션 시간은 같다 — 프레임률 독립성', () => {
    const run = (frameDt: number, frames: number): number => {
      let steps = 0;
      const loop = new GameLoop(() => steps++);
      for (let i = 0; i < frames; i++) loop.advance(frameDt);
      return steps;
    };

    // 둘 다 실시간 2초. 60fps 와 30fps 가 같은 스텝 수를 내야 한다.
    const at60 = run(1 / 60, 120);
    const at30 = run(1 / 30, 60);
    expect(at60).toBe(120);
    expect(at30).toBe(120);
  });

  it('나머지 시간은 다음 프레임으로 이월된다 — 시간이 소실되지 않는다', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++);

    // 0.01초씩 5번 = 0.05초 → 3스텝이 나와야 한다 (한 프레임에 몰아주는 것과 동일)
    for (let i = 0; i < 5; i++) loop.advance(0.01);
    expect(steps).toBe(3);
  });

  it('프레임 드랍 시 MAX_CATCHUP_STEPS 까지만 따라잡는다 (spiral of death 방지)', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++);

    loop.advance(10); // 10초 = 600스텝 분량
    expect(steps).toBe(CONFIG.MAX_CATCHUP_STEPS);
    expect(loop.droppedTime).toBeGreaterThan(0);
  });

  it('reset() 은 누적 시간을 비운다 — 탭 복귀 시 한꺼번에 소비 방지 (§20)', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++);

    loop.advance(0.01); // 스텝 미달, accumulator 에 0.01 남음
    expect(steps).toBe(0);
    loop.reset();
    loop.advance(0.01); // 이월분이 없으므로 여전히 미달
    expect(steps).toBe(0);
  });

  it('timeScale 로 배속을 걸 수 있다 (디버그 ×2/×4, §19)', () => {
    let steps = 0;
    let scale = 1;
    const loop = new GameLoop(() => steps++, () => scale);

    loop.advance(DT * 2);
    expect(steps).toBe(2);

    scale = 2;
    loop.advance(DT * 2); // 실시간 2스텝 분량 → 4스텝
    expect(steps).toBe(6);
  });

  it('배속을 걸어도 캐치업 상한은 그대로 적용된다', () => {
    let steps = 0;
    // ×4 배속으로 3스텝 분량을 요청하면 12스텝이 필요하지만 상한에서 잘린다.
    const loop = new GameLoop(() => steps++, () => 4);
    loop.advance(DT * 3);
    expect(steps).toBe(CONFIG.MAX_CATCHUP_STEPS);
  });

  it('alpha 는 두 로직 스텝 사이 보간 위치를 [0,1) 로 준다', () => {
    const loop = new GameLoop(() => {});
    loop.advance(DT * 1.5);
    expect(loop.alpha).toBeGreaterThanOrEqual(0);
    expect(loop.alpha).toBeLessThan(1);
    expect(loop.alpha).toBeCloseTo(0.5, 5);
  });
});
