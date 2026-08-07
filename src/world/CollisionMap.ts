/**
 * 충돌 판정. §0-3 — 외부 물리 엔진을 쓰지 않는다.
 *
 * 이 게임에 필요한 건 중력도 관절도 강체 시뮬레이션도 아니고
 * **원(캐릭터) vs AABB(가구)** 와 **원 vs 원** 두 가지뿐이다.
 * Rapier/cannon-es 를 붙이면 물리 콜라이더와 논리 격자가 이중 진실 원천이 되어
 * 동기화 버그가 생기고, WASM 로딩·디버그 렌더러 세팅 비용이 재미 검증보다 커진다.
 *
 * Three.js 를 import 하지 않는다. (§0-4)
 */

import { CONFIG, DERIVED, worldToCellX, worldToCellZ } from '../core/GameConfig.ts';
import { Cell, type CellState, type Vec2 } from '../core/types.ts';
import { LIVING_ROOM_FURNITURE, type FurnitureDef } from './furnitureLayout.ts';

/** 축 정렬 경계 상자 */
export interface Aabb {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function aabbOf(f: FurnitureDef): Aabb {
  return {
    id: f.id,
    minX: f.x - f.w / 2,
    maxX: f.x + f.w / 2,
    minZ: f.z - f.d / 2,
    maxZ: f.z + f.d / 2,
  };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 점이 AABB 안에 있는지 */
export function pointInAabb(p: Vec2, b: Aabb): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
}

/** 원과 AABB 가 겹치는지 */
export function circleIntersectsAabb(c: Vec2, r: number, b: Aabb): boolean {
  const nx = clamp(c.x, b.minX, b.maxX);
  const nz = clamp(c.z, b.minZ, b.maxZ);
  const dx = c.x - nx;
  const dz = c.z - nz;
  return dx * dx + dz * dz < r * r;
}

/** 원 vs 원 */
export function circlesOverlap(a: Vec2, ra: number, b: Vec2, rb: number): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const rr = ra + rb;
  return dx * dx + dz * dz < rr * rr;
}

export class CollisionMap {
  /** 통과 불가 가구의 AABB */
  readonly solids: readonly Aabb[];
  /** 벽 안쪽 이동 가능 범위 */
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  private readonly blocked: Uint8Array;
  private readonly blockedCount: number;

  constructor(furniture: readonly FurnitureDef[] = LIVING_ROOM_FURNITURE) {
    this.solids = furniture.filter((f) => f.solid).map(aabbOf);

    const halfW = DERIVED.ROOM_W / 2;
    const halfH = DERIVED.ROOM_H / 2;
    this.bounds = { minX: -halfW, maxX: halfW, minZ: -halfH, maxZ: halfH };

    // ── BLOCKED 셀 파생 (§0-2) ──
    // 셀 중심이 solid AABB 안에 들어가면 BLOCKED. 면적을 잘 근사한다.
    this.blocked = new Uint8Array(DERIVED.TOTAL_CELLS);
    let count = 0;
    for (let cz = 0; cz < CONFIG.GRID_H; cz++) {
      for (let cx = 0; cx < CONFIG.GRID_W; cx++) {
        const wx = (cx + 0.5) * CONFIG.CELL_SIZE - halfW;
        const wz = (cz + 0.5) * CONFIG.CELL_SIZE - halfH;
        for (const b of this.solids) {
          if (wx >= b.minX && wx <= b.maxX && wz >= b.minZ && wz <= b.maxZ) {
            this.blocked[cz * CONFIG.GRID_W + cx] = 1;
            count++;
            break;
          }
        }
      }
    }
    this.blockedCount = count;
  }

  /** 격자 초기 상태를 만든다. BLOCKED 는 여기서만 결정된다. */
  createCellGrid(): Uint8Array {
    const grid = new Uint8Array(DERIVED.TOTAL_CELLS);
    for (let i = 0; i < grid.length; i++) {
      grid[i] = this.blocked[i] === 1 ? Cell.BLOCKED : (Cell.EMPTY as CellState);
    }
    return grid;
  }

  isBlockedCell(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= CONFIG.GRID_W || cz >= CONFIG.GRID_H) return true;
    return this.blocked[cz * CONFIG.GRID_W + cx] === 1;
  }

  /** BLOCKED 셀 수 */
  get blockedCells(): number {
    return this.blockedCount;
  }

  /** 영역 계산의 분모가 되는 유효 셀 수 */
  get effectiveCells(): number {
    return DERIVED.TOTAL_CELLS - this.blockedCount;
  }

  get blockedRatio(): number {
    return this.blockedCount / DERIVED.TOTAL_CELLS;
  }

  /** 해당 월드 좌표가 가구에 막혀 있는지 */
  isSolidAt(p: Vec2): boolean {
    for (const b of this.solids) if (pointInAabb(p, b)) return true;
    return false;
  }

  /** 반지름 r 인 원이 그 자리에 설 수 있는지 (벽·가구 모두 고려) */
  canStand(p: Vec2, r: number): boolean {
    if (
      p.x - r < this.bounds.minX ||
      p.x + r > this.bounds.maxX ||
      p.z - r < this.bounds.minZ ||
      p.z + r > this.bounds.maxZ
    ) {
      return false;
    }
    for (const b of this.solids) if (circleIntersectsAabb(p, r, b)) return false;
    return true;
  }

  /**
   * `from` 에서 `to` 로 이동시키되 벽·가구를 통과하지 않게 보정한다.
   *
   * 축별로 따로 시도해서, 벽에 비스듬히 부딪혔을 때 완전히 멈추지 않고
   * 벽을 따라 미끄러지게 만든다 (움직임이 답답해지지 않게).
   */
  resolveMove(from: Vec2, to: Vec2, radius: number): Vec2 {
    // 이미 낀 상태(레벨업으로 히트박스가 커진 경우 등)라면 밀어낸다.
    const start = this.canStand(from, radius) ? from : this.pushOut(from, radius);

    const result = { x: start.x, z: start.z };

    const tryX = { x: to.x, z: result.z };
    if (this.canStand(tryX, radius)) result.x = to.x;

    const tryZ = { x: result.x, z: to.z };
    if (this.canStand(tryZ, radius)) result.z = to.z;

    return result;
  }

  /**
   * 가구 안에 끼어버린 원을 가장 가까운 바깥으로 밀어낸다.
   * 넉백으로 벽에 박히거나 레벨업으로 히트박스가 커질 때 필요하다.
   */
  pushOut(p: Vec2, radius: number, maxIterations = 8): Vec2 {
    const out = { x: p.x, z: p.z };

    for (let i = 0; i < maxIterations; i++) {
      let moved = false;

      out.x = clamp(out.x, this.bounds.minX + radius, this.bounds.maxX - radius);
      out.z = clamp(out.z, this.bounds.minZ + radius, this.bounds.maxZ - radius);

      for (const b of this.solids) {
        if (!circleIntersectsAabb(out, radius, b)) continue;

        // 네 방향 탈출 후보. 가구가 벽에 밀착돼 있으면 벽 쪽 후보는 범위를 벗어나므로,
        // 반드시 "벽 안에 남는" 후보 중에서만 고른다.
        // (그러지 않으면 다음 반복의 clamp 가 도로 가구 안으로 되돌려 무한히 낀다.)
        const candidates: Vec2[] = [
          { x: b.minX - radius, z: out.z },
          { x: b.maxX + radius, z: out.z },
          { x: out.x, z: b.minZ - radius },
          { x: out.x, z: b.maxZ + radius },
        ];

        let best: Vec2 | null = null;
        let bestDist = Infinity;
        for (const c of candidates) {
          const inBounds =
            c.x - radius >= this.bounds.minX &&
            c.x + radius <= this.bounds.maxX &&
            c.z - radius >= this.bounds.minZ &&
            c.z + radius <= this.bounds.maxZ;
          if (!inBounds) continue;
          const d = Math.hypot(c.x - out.x, c.z - out.z);
          if (d < bestDist) {
            bestDist = d;
            best = c;
          }
        }

        // 네 방향 모두 벽 밖이면(가구가 통로를 완전히 막은 경우) 가장 얕은 쪽으로 민다.
        best ??= candidates.reduce((a, c) =>
          Math.hypot(c.x - out.x, c.z - out.z) < Math.hypot(a.x - out.x, a.z - out.z) ? c : a,
        );

        out.x = best.x;
        out.z = best.z;
        moved = true;
      }

      if (!moved) break;
    }

    return out;
  }

  /**
   * `from` 에서 방향 `dir` 로 최대 `distance` 만큼 밀어낸다 (넉백).
   * 벽·가구에 막히면 막히기 직전까지만 이동한다. (§12)
   */
  sweep(from: Vec2, dir: Vec2, distance: number, radius: number, steps = 8): Vec2 {
    const len = Math.hypot(dir.x, dir.z);
    if (len === 0) return { x: from.x, z: from.z };

    const nx = dir.x / len;
    const nz = dir.z / len;
    let last = { x: from.x, z: from.z };

    for (let i = 1; i <= steps; i++) {
      const t = (distance * i) / steps;
      const probe = { x: from.x + nx * t, z: from.z + nz * t };
      if (!this.canStand(probe, radius)) break;
      last = probe;
    }
    return last;
  }

  /** 월드 좌표 → 격자 인덱스. 범위 밖이면 -1 */
  cellIndexAt(p: Vec2): number {
    const cx = worldToCellX(p.x);
    const cz = worldToCellZ(p.z);
    if (cx < 0 || cz < 0 || cx >= CONFIG.GRID_W || cz >= CONFIG.GRID_H) return -1;
    return cz * CONFIG.GRID_W + cx;
  }

  /** 진단용 요약. 시작 시 콘솔에 출력해 R1 을 감시한다. */
  describe(): string {
    const [lo, hi] = CONFIG.BLOCKED_RATIO_RANGE;
    const pct = (this.blockedRatio * 100).toFixed(1);
    const ok = this.blockedRatio >= lo && this.blockedRatio <= hi;
    return (
      `[collision] BLOCKED ${this.blockedCells}/${DERIVED.TOTAL_CELLS}셀 (${pct}%) ` +
      `/ 유효 ${this.effectiveCells}셀 / 목표 ${Math.round(this.effectiveCells * CONFIG.TARGET_RATIO)}셀 ` +
      `— 허용 ${lo * 100}~${hi * 100}% ${ok ? '✅' : '❌ 밸런스 재계산 필요'}`
    );
  }
}
