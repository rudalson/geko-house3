import { describe, expect, it } from 'vitest';
import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import { effectiveCells as modelEffectiveCells } from '../src/core/BalanceModel.ts';
import { Cell } from '../src/core/types.ts';
import { CollisionMap, aabbOf, circleIntersectsAabb, circlesOverlap } from '../src/world/CollisionMap.ts';
import {
  LIVING_ROOM_FURNITURE,
  climbableFurniture,
  solidArea,
  solidFurniture,
} from '../src/world/furnitureLayout.ts';

const map = new CollisionMap();
const R = CONFIG.PLAYER_RADIUS;

describe('BLOCKED 비율 (위험요소 R1)', () => {
  it('실측 BLOCKED 비율이 허용 범위(10~15%) 안에 있다', () => {
    const [lo, hi] = CONFIG.BLOCKED_RATIO_RANGE;
    expect(map.blockedRatio, map.describe()).toBeGreaterThanOrEqual(lo);
    expect(map.blockedRatio, map.describe()).toBeLessThanOrEqual(hi);
  });

  it('밸런스 모델이 가정한 유효 셀 수와 실측이 크게 어긋나지 않는다', () => {
    // 5% 이상 벌어지면 ROADMAP §3 의 도달 시간 계산이 무의미해진다.
    const drift = Math.abs(map.effectiveCells - modelEffectiveCells()) / modelEffectiveCells();
    expect(
      drift,
      `실측 유효 셀 ${map.effectiveCells} vs 모델 가정 ${modelEffectiveCells()}. ` +
        `ASSUMPTIONS.BLOCKED_RATIO 를 ${map.blockedRatio.toFixed(3)} 으로 갱신할 것`,
    ).toBeLessThan(0.05);
  });

  it('BLOCKED 셀 수가 solid 가구 면적과 대체로 일치한다 (파생이 제대로 됐다는 증거)', () => {
    const cellArea = CONFIG.CELL_SIZE * CONFIG.CELL_SIZE;
    const expectedCells = solidArea() / cellArea;
    // 셀 중심 판정이라 ±20% 오차는 정상
    expect(map.blockedCells).toBeGreaterThan(expectedCells * 0.8);
    expect(map.blockedCells).toBeLessThan(expectedCells * 1.2);
  });
});

describe('단일 진실 원천 파생 (§0-2)', () => {
  it('solid 가구만 충돌 AABB 로 파생된다', () => {
    expect(map.solids).toHaveLength(solidFurniture().length);
    const ids = new Set(map.solids.map((s) => s.id));
    for (const f of LIVING_ROOM_FURNITURE) {
      expect(ids.has(f.id), `${f.id} (solid=${f.solid})`).toBe(f.solid);
    }
  });

  it('담요·식기·문은 밟고 지나갈 수 있다 — BLOCKED 가 아니다', () => {
    for (const id of ['blanket', 'food-bowl', 'bathroom-door']) {
      const f = LIVING_ROOM_FURNITURE.find((x) => x.id === id)!;
      expect(map.isSolidAt({ x: f.x, z: f.z }), id).toBe(false);
    }
  });

  it('격자 초기 상태의 BLOCKED 개수가 충돌맵과 일치한다', () => {
    const grid = map.createCellGrid();
    let blocked = 0;
    let empty = 0;
    for (const v of grid) {
      if (v === Cell.BLOCKED) blocked++;
      else if (v === Cell.EMPTY) empty++;
    }
    expect(blocked).toBe(map.blockedCells);
    expect(empty).toBe(map.effectiveCells);
    expect(blocked + empty).toBe(DERIVED.TOTAL_CELLS);
  });

  it('모든 가구의 AABB 가 거실 안에 들어간다', () => {
    for (const f of LIVING_ROOM_FURNITURE) {
      const b = aabbOf(f);
      expect(b.minX, f.id).toBeGreaterThanOrEqual(-DERIVED.ROOM_W / 2);
      expect(b.maxX, f.id).toBeLessThanOrEqual(DERIVED.ROOM_W / 2);
      expect(b.minZ, f.id).toBeGreaterThanOrEqual(-DERIVED.ROOM_H / 2);
      expect(b.maxZ, f.id).toBeLessThanOrEqual(DERIVED.ROOM_H / 2);
    }
  });

  it('solid 가구끼리 겹치지 않는다', () => {
    const solids = map.solids;
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i]!;
        const b = solids[j]!;
        const overlap =
          a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
        expect(overlap, `${a.id} 와 ${b.id} 가 겹친다`).toBe(false);
      }
    }
  });

  it('올라갈 수 있는 가구가 최소 3개 있다 (§6 거실 요구사항)', () => {
    expect(climbableFurniture().length).toBeGreaterThanOrEqual(3);
    // 등반 가능한 가구는 모두 solid 여야 한다 (올라설 상판이 있어야 하므로)
    for (const f of climbableFurniture()) expect(f.solid, f.id).toBe(true);
  });
});

describe('원 vs AABB 판정 (§0-3)', () => {
  const box = { id: 'test', minX: -1, maxX: 1, minZ: -1, maxZ: 1 };

  it('중심이 안에 있으면 겹친다', () => {
    expect(circleIntersectsAabb({ x: 0, z: 0 }, 0.2, box)).toBe(true);
  });

  it('모서리 근처를 정확히 판정한다 — 대각선 거리를 쓴다', () => {
    // 모서리 (1,1) 에서 대각으로 0.28 떨어진 점. 반지름 0.3 이면 닿고 0.2 면 안 닿는다.
    const p = { x: 1 + 0.2, z: 1 + 0.2 }; // 대각 거리 ≈ 0.283
    expect(circleIntersectsAabb(p, 0.3, box)).toBe(true);
    expect(circleIntersectsAabb(p, 0.2, box)).toBe(false);
  });

  it('면 방향은 수직 거리로 판정한다', () => {
    expect(circleIntersectsAabb({ x: 1.25, z: 0 }, 0.3, box)).toBe(true);
    expect(circleIntersectsAabb({ x: 1.35, z: 0 }, 0.3, box)).toBe(false);
  });

  it('원 vs 원', () => {
    expect(circlesOverlap({ x: 0, z: 0 }, 0.5, { x: 0.9, z: 0 }, 0.5)).toBe(true);
    expect(circlesOverlap({ x: 0, z: 0 }, 0.5, { x: 1.1, z: 0 }, 0.5)).toBe(false);
  });
});

describe('이동 보정', () => {
  it('벽을 통과하지 못한다', () => {
    const from = { x: DERIVED.ROOM_W / 2 - R - 0.1, z: 0 };
    const to = { x: DERIVED.ROOM_W / 2 + 5, z: 0 };
    const out = map.resolveMove(from, to, R);
    expect(out.x).toBeLessThanOrEqual(DERIVED.ROOM_W / 2 - R + 1e-9);
  });

  it('가구를 통과하지 못한다', () => {
    const sofa = aabbOf(LIVING_ROOM_FURNITURE.find((f) => f.id === 'sofa')!);
    const from = { x: sofa.minX + 1.0, z: sofa.maxZ + R + 0.2 };
    expect(map.canStand(from, R)).toBe(true);

    const to = { x: from.x, z: sofa.minZ }; // 소파 한복판으로 돌진
    const out = map.resolveMove(from, to, R);
    expect(map.canStand(out, R)).toBe(true);
    expect(out.z).toBeGreaterThan(sofa.maxZ); // 소파 앞에서 멈춘다
  });

  it('벽에 비스듬히 부딪히면 벽을 따라 미끄러진다 — 완전히 멈추지 않는다', () => {
    // 동쪽 벽에서 가구가 없는 구간 (책장 z≤0.5, 화분 z≥4.4 사이)
    const wallX = DERIVED.ROOM_W / 2 - R;
    const from = { x: wallX - 0.01, z: 3.0 };
    expect(map.canStand(from, R)).toBe(true);

    const to = { x: wallX + 1, z: 3.5 }; // 오른쪽 벽으로 밀면서 위로
    const out = map.resolveMove(from, to, R);
    expect(out.z).toBeCloseTo(3.5, 5); // z 이동은 살아남는다
    expect(out.x).toBeLessThanOrEqual(wallX + 1e-9);
  });

  it('가구와 벽 사이에 플레이어가 못 들어가는 죽은 틈이 없다', () => {
    // 폭이 플레이어 지름(2R)보다 좁은 틈은 시각적으로는 통로처럼 보이지만
    // 실제로는 들어갈 수 없어 "보이지 않는 벽"으로 느껴진다. 벽에 밀착시켜 없앤다.
    const minGap = R * 2;
    const { minX, maxX, minZ, maxZ } = map.bounds;
    const offenders: string[] = [];

    for (const b of map.solids) {
      const gaps: [string, number][] = [
        ['서쪽 벽', b.minX - minX],
        ['동쪽 벽', maxX - b.maxX],
        ['남쪽 벽', b.minZ - minZ],
        ['북쪽 벽', maxZ - b.maxZ],
      ];
      for (const [side, gap] of gaps) {
        if (gap > 1e-9 && gap < minGap) {
          offenders.push(`${b.id} ↔ ${side}: 틈 ${gap.toFixed(2)} < 필요 ${minGap.toFixed(2)}`);
        }
      }
    }

    expect(offenders, `벽에 밀착시키거나 통과 가능한 폭으로 벌릴 것:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('모든 유효 셀 중심에서 플레이어가 설 수 있는 위치가 대부분이다', () => {
    // 가구 바로 옆 셀은 반지름 때문에 설 수 없을 수 있으나, 대다수는 가능해야 한다.
    let standable = 0;
    let free = 0;
    for (let cz = 0; cz < CONFIG.GRID_H; cz++) {
      for (let cx = 0; cx < CONFIG.GRID_W; cx++) {
        if (map.isBlockedCell(cx, cz)) continue;
        free++;
        const p = {
          x: (cx + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_W / 2,
          z: (cz + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_H / 2,
        };
        if (map.canStand(p, R)) standable++;
      }
    }
    expect(standable / free).toBeGreaterThan(0.7);
  });
});

describe('밀어내기와 넉백', () => {
  it('가구 안에 낀 원을 바깥으로 밀어낸다', () => {
    const sofa = LIVING_ROOM_FURNITURE.find((f) => f.id === 'sofa')!;
    const stuck = { x: sofa.x, z: sofa.z };
    expect(map.canStand(stuck, R)).toBe(false);
    const out = map.pushOut(stuck, R);
    expect(map.canStand(out, R)).toBe(true);
  });

  it('벽 밖으로 나간 원을 안으로 되돌린다', () => {
    const out = map.pushOut({ x: 100, z: -100 }, R);
    expect(map.canStand(out, R)).toBe(true);
  });

  it('넉백은 벽을 통과하지 않는다 (§12)', () => {
    const from = { x: DERIVED.ROOM_W / 2 - R - 0.05, z: 3.0 };
    expect(map.canStand(from, R)).toBe(true);
    const out = map.sweep(from, { x: 1, z: 0 }, CONFIG.KNOCKBACK_DISTANCE, R);
    expect(map.canStand(out, R)).toBe(true);
    expect(out.x).toBeLessThanOrEqual(DERIVED.ROOM_W / 2 - R + 1e-9);
  });

  it('넉백은 막히지 않으면 지정 거리만큼 이동한다', () => {
    const from = { x: 0, z: 0 };
    const out = map.sweep(from, { x: 0, z: -1 }, 1.0, R);
    expect(Math.hypot(out.x - from.x, out.z - from.z)).toBeCloseTo(1.0, 2);
  });

  it('방향이 0 이면 제자리를 돌려준다', () => {
    const out = map.sweep({ x: 1, z: 2 }, { x: 0, z: 0 }, 1, R);
    expect(out).toEqual({ x: 1, z: 2 });
  });
});
