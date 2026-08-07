/**
 * 격자 기반 경로 탐색. 순수 로직. (§0-4)
 *
 * §24 는 인간 적에게 "복잡한 내비게이션 메시를 만들지 말고 격자 기반 A* 또는
 * 단순 웨이포인트를 쓰되 경로 재계산을 0.5초에 1회로 제한"하라고 요구한다.
 *
 * 32x24 = 768칸짜리 격자에서는 BFS 한 번이 A* 보다 단순하면서 충분히 빠르다.
 * (최악의 경우도 768칸 방문) 휴리스틱 없이도 최단 경로가 보장된다.
 *
 * 쓰임새:
 *   - tools/cycle-probe.ts 의 밸런스 측정 봇
 *   - S7 의 인간 적 추적
 */

import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import type { CollisionMap } from '../world/CollisionMap.ts';
import type { Vec2 } from '../core/types.ts';

const { GRID_W, GRID_H } = CONFIG;

/** 셀 인덱스 → 월드 중심 좌표 */
function centerOf(index: number): Vec2 {
  return {
    x: ((index % GRID_W) + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_W / 2,
    z: (Math.floor(index / GRID_W) + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_H / 2,
  };
}

function indexOf(p: Vec2): number {
  const cx = Math.floor((p.x + DERIVED.ROOM_W / 2) / CONFIG.CELL_SIZE);
  const cz = Math.floor((p.z + DERIVED.ROOM_H / 2) / CONFIG.CELL_SIZE);
  if (cx < 0 || cz < 0 || cx >= GRID_W || cz >= GRID_H) return -1;
  return cz * GRID_W + cx;
}

/** 걸을 수 없는 칸에 있으면 가장 가까운 걸을 수 있는 칸으로 스냅한다. */
function snapToWalkable(mask: Uint8Array, index: number): number {
  if (index < 0) return -1;
  if (mask[index] === 1) return index;

  // 반경을 넓혀가며 탐색
  const cx0 = index % GRID_W;
  const cz0 = Math.floor(index / GRID_W);
  for (let r = 1; r <= 6; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= GRID_W || cz >= GRID_H) continue;
        const i = cz * GRID_W + cx;
        if (mask[i] === 1) return i;
      }
    }
  }
  return -1;
}

/**
 * `from` 에서 `to` 까지의 경로를 셀 중심 좌표 배열로 돌려준다.
 * 도달할 수 없으면 빈 배열.
 *
 * 대각 이동을 허용하되, 두 직교 이웃이 모두 막혀 있으면 통과시키지 않는다
 * (가구 모서리를 뚫고 지나가는 경로를 막는다).
 */
export function findPath(
  collision: CollisionMap,
  radius: number,
  from: Vec2,
  to: Vec2,
): Vec2[] {
  const mask = collision.walkableMask(radius);
  const start = snapToWalkable(mask, indexOf(from));
  const goal = snapToWalkable(mask, indexOf(to));
  if (start < 0 || goal < 0) return [];
  if (start === goal) return [centerOf(goal)];

  const prev = new Int32Array(mask.length).fill(-1);
  const seen = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;

  queue[tail++] = start;
  seen[start] = 1;

  while (head < tail) {
    const cur = queue[head++]!;
    if (cur === goal) break;

    const cx = cur % GRID_W;
    const cz = Math.floor(cur / GRID_W);

    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= GRID_W || nz >= GRID_H) continue;

        const ni = nz * GRID_W + nx;
        if (seen[ni] === 1 || mask[ni] !== 1) continue;

        // 대각선은 양옆이 뚫려 있을 때만 — 모서리를 뚫고 가지 않게
        if (dx !== 0 && dz !== 0) {
          if (mask[cz * GRID_W + nx] !== 1 || mask[nz * GRID_W + cx] !== 1) continue;
        }

        seen[ni] = 1;
        prev[ni] = cur;
        queue[tail++] = ni;
      }
    }
  }

  if (seen[goal] !== 1) return [];

  const path: Vec2[] = [];
  for (let at = goal; at !== -1; at = prev[at]!) {
    path.push(centerOf(at));
    if (at === start) break;
  }
  path.reverse();
  return path;
}

/**
 * 다음으로 향할 지점. 경로의 첫 칸은 현재 위치이므로 건너뛴다.
 * 경로가 없으면 목표를 그대로 돌려준다 (직진 시도).
 *
 * **반드시 바로 다음 칸을 돌려준다.** 지그재그를 줄이려고 두세 칸 앞을 보면
 * 그 사이의 모서리를 가로지르는 직선이 되어 가구에 처박힌다.
 * (실제로 봇이 TV장 모서리에 끼어 20초 넘게 제자리걸음했다)
 */
export function nextWaypoint(
  collision: CollisionMap,
  radius: number,
  from: Vec2,
  to: Vec2,
): Vec2 {
  const mask = collision.walkableMask(radius);
  const cur = indexOf(from);

  // 캐릭터의 연속 좌표는 "설 수 있는" 자리인데 그 칸의 중심은 걸을 수 없는 경우가 있다.
  // (셀 0.5 vs 지름 0.56 — 가구 옆 칸은 중심에 설 수 없다)
  // 이때 경로는 스냅된 다른 칸에서 시작하므로, 그 경로의 두 번째 칸으로 직진하면
  // 사이의 가구를 뚫고 가려다 끼인다. 먼저 격자 위로 복귀시킨다.
  if (cur < 0 || mask[cur] !== 1) {
    const snapped = snapToWalkable(mask, cur);
    if (snapped >= 0) return centerOf(snapped);
  }

  const path = findPath(collision, radius, from, to);
  if (path.length === 0) return to;
  return path[Math.min(1, path.length - 1)] ?? to;
}
