/**
 * S8 연출 레이어 단위 테스트.
 *
 * 화면 요소(HUD·타이틀·튜토리얼)는 DOM 이 필요해 여기서 다루지 않는다 — E2E 담당이다.
 * 여기서는 **DOM 없이 검증할 수 있는 것**만 본다:
 * 파티클 풀의 수명 관리(누수가 나면 곧 풀이 말라 연출이 조용히 사라진다)와
 * 설정 저장의 방어 로직.
 *
 * ParticlePool 은 Three.js 를 쓰지만 WebGLRenderer 를 만들지 않으므로
 * WebGL 컨텍스트 없이 node 에서 그대로 돈다.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { ParticlePool } from '../src/entities/ParticlePool.ts';
import { loadPrefs, savePrefs } from '../src/ui/Prefs.ts';

describe('ParticlePool (§16)', () => {
  it('emit 하면 살아나고, 수명이 다하면 스스로 돌아온다', () => {
    const pool = new ParticlePool();
    expect(pool.aliveCount).toBe(0);

    pool.emit('poop', { x: 0, z: 0 });
    expect(pool.aliveCount).toBeGreaterThan(0);

    // poop 의 최대 수명은 0.75초. 넉넉히 돌리면 전부 회수돼야 한다.
    for (let i = 0; i < 120; i++) pool.update(1 / 60);
    expect(pool.aliveCount, '수명이 끝난 파티클이 풀로 돌아오지 않는다').toBe(0);

    pool.dispose();
  });

  it('용량을 넘겨 쏟아부어도 터지지 않고 상한에서 멈춘다', () => {
    const pool = new ParticlePool();

    // 배변 22개 × 40회 = 880개. 용량(240)보다 훨씬 많다.
    for (let i = 0; i < 40; i++) pool.emit('poop', { x: 0, z: 0 });

    expect(pool.aliveCount).toBeGreaterThan(0);
    expect(pool.aliveCount, '용량을 넘어서면 안 된다').toBeLessThanOrEqual(240);

    for (let i = 0; i < 120; i++) pool.update(1 / 60);
    expect(pool.aliveCount).toBe(0);

    pool.dispose();
  });

  it('살아 있는 파티클이 없으면 GPU 버퍼를 건드리지 않는다 (R4)', () => {
    const pool = new ParticlePool();
    // `needsUpdate` 는 값을 읽을 수 없는 setter 다. 대신 version 증가로 확인한다.
    const version = (): number => pool.mesh.instanceMatrix.version;

    pool.update(1 / 60);
    const idle = version();

    // 아무도 살아 있지 않은 프레임은 버퍼를 건드리지 않아야 한다.
    for (let i = 0; i < 10; i++) pool.update(1 / 60);
    expect(version(), '빈 프레임에서 GPU 버퍼를 갱신하고 있다').toBe(idle);

    pool.emit('eat', { x: 1, z: 1 });
    pool.update(1 / 60);
    expect(version()).toBeGreaterThan(idle);

    // 전부 죽고 나면 정리 프레임 한 번만 더 쓰고 다시 조용해진다.
    for (let i = 0; i < 120; i++) pool.update(1 / 60);
    const settled = version();
    for (let i = 0; i < 10; i++) pool.update(1 / 60);
    expect(version()).toBe(settled);

    pool.dispose();
  });

  it('탭 복귀처럼 크게 튄 프레임에서도 좌표가 발산하지 않는다', () => {
    const pool = new ParticlePool();
    pool.emit('damage', { x: 0, z: 0 });

    // 5초짜리 프레임. 상한이 없으면 파티클이 방 밖으로 날아간다.
    pool.update(5);

    const m = pool.mesh.instanceMatrix.array;
    for (let i = 0; i < m.length; i++) {
      expect(Number.isFinite(m[i]!), `행렬 성분 ${i} 가 유한하지 않다`).toBe(true);
    }

    pool.dispose();
  });
});

describe('Prefs (§16 타이틀 옵션)', () => {
  beforeEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('localStorage 가 없는 환경에서도 기본값을 돌려준다', () => {
    expect(loadPrefs()).toEqual({ sound: true, tutorial: true });
    // 던지지 않아야 한다 — 오디오 설정 때문에 게임이 죽으면 안 된다.
    expect(() => savePrefs({ sound: false, tutorial: false })).not.toThrow();
  });

  it('저장한 값을 다시 읽는다', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };

    savePrefs({ sound: false, tutorial: false });
    expect(loadPrefs()).toEqual({ sound: false, tutorial: false });
  });

  it('깨진 값이 들어 있으면 기본값으로 되돌린다', () => {
    const store = new Map<string, string>([['gecko-house.prefs.v1', '{ 이건 JSON 이']]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };

    expect(loadPrefs()).toEqual({ sound: true, tutorial: true });
  });
});
