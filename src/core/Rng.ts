/**
 * 시드 기반 PRNG (mulberry32). §0-5
 *
 * `Math.random()` 은 게임 로직 어디에서도 호출하지 않는다.
 * 이 객체를 GameState 에 주입해서 로봇청소기 AI·음식 스폰을 재현 가능하게 만든다.
 * tests/architecture.test.ts 가 Math.random 사용을 막는다.
 */
export class Rng {
  readonly seed: number;
  private state: number;

  // 파라미터 프로퍼티(`constructor(public readonly seed: number)`)를 쓰지 않는다.
  // Node 의 타입 스트리핑이 지원하지 않아 `node tools/*.ts` 로 순수 로직을
  // 직접 돌릴 수 없게 된다. (tools/cycle-probe.ts 가 그걸로 밸런스를 실측한다)
  constructor(seed: number) {
    this.seed = seed;
    this.state = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min, max) */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** [min, max] 정수 */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: 빈 배열');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 현재 내부 상태를 복제한다 (디버그 스냅샷·재현용) */
  clone(): Rng {
    const r = new Rng(this.seed);
    r.state = this.state;
    return r;
  }
}
