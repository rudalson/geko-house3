import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Rng.ts';

/**
 * §0-5 결정성 — 시드를 고정하면 같은 입력이 같은 결과를 낸다.
 * 이게 깨지면 로봇청소기 AI·음식 스폰을 테스트에서 재현할 수 없고,
 * 디버그 모드의 버그 재현 기능도 무의미해진다.
 */
describe('시드 기반 PRNG (§0-5)', () => {
  it('같은 시드는 같은 수열을 낸다', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 200 }, () => a.next());
    const seqB = Array.from({ length: 200 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('다른 시드는 다른 수열을 낸다', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('출력이 [0, 1) 범위를 벗어나지 않는다', () => {
    const r = new Rng(999);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('분포가 한쪽으로 심하게 치우치지 않는다', () => {
    const r = new Rng(2024);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]!++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(n / 10 - n / 100);
      expect(count).toBeLessThan(n / 10 + n / 100);
    }
  });

  it('int(min, max) 는 양 끝을 포함한다', () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('range(min, max) 는 범위를 지킨다', () => {
    const r = new Rng(42);
    for (let i = 0; i < 5000; i++) {
      const v = r.range(1.5, 3.5);
      expect(v).toBeGreaterThanOrEqual(1.5);
      expect(v).toBeLessThan(3.5);
    }
  });

  it('clone() 은 내부 상태까지 복제해 이후 수열이 일치한다', () => {
    const r = new Rng(555);
    for (let i = 0; i < 37; i++) r.next(); // 임의 지점까지 진행
    const c = r.clone();
    const seqA = Array.from({ length: 20 }, () => r.next());
    const seqB = Array.from({ length: 20 }, () => c.next());
    expect(seqA).toEqual(seqB);
  });

  it('pick() 은 빈 배열에서 던진다', () => {
    expect(() => new Rng(1).pick([])).toThrow();
  });
});
