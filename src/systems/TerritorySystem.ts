/**
 * 똥 땅 격자. 순수 로직. (§0-4, §10)
 *
 * 달성률은 **화면 색상 분석이 아니라 논리 격자 데이터**로 계산한다. (§26)
 * 분모(유효 셀)는 시작 시 1회 캐싱하고, 분자(점유 셀)는 셀이 바뀔 때마다
 * 증분 갱신한다. 매 프레임 768칸을 순회하지 않는다.
 */

import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { Cell, type Vec2 } from '../core/types.ts';

/** 셀 인덱스 → 월드 중심 좌표 */
export function cellCenter(index: number): Vec2 {
  const cx = index % CONFIG.GRID_W;
  const cz = Math.floor(index / CONFIG.GRID_W);
  return {
    x: (cx + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_W / 2,
    z: (cz + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_H / 2,
  };
}

/** 셀 상태를 바꾸고 점유 카운트와 변경 목록을 갱신한다. 실제로 바뀌었으면 true. */
function setCell(state: GameState, index: number, next: number): boolean {
  const prev = state.grid[index];
  if (prev === undefined || prev === next || prev === Cell.BLOCKED) return false;

  state.grid[index] = next;
  if (next === Cell.POOP_TERRITORY) state.ownedCells++;
  else if (prev === Cell.POOP_TERRITORY) state.ownedCells--;

  // 렌더러가 소비할 변경 목록. 변경이 있는 프레임에만 GPU 버퍼를 갱신하기 위함.
  state.dirtyCells.push(index);
  return true;
}

/**
 * 중심에서 반경 안의 EMPTY 셀을 POOP_TERRITORY 로 바꾼다.
 * BLOCKED 는 제외하고, 이미 확보한 셀은 중복 계산하지 않는다.
 *
 * @returns 새로 확보한 셀 수 (중첩분 제외)
 */
export function applyPoop(state: GameState, center: Vec2, radiusCells: number): number {
  const radiusWorld = radiusCells * CONFIG.CELL_SIZE;
  return fillCircle(state, center, radiusWorld, Cell.POOP_TERRITORY);
}

/**
 * 반경 안의 POOP_TERRITORY 를 EMPTY 로 되돌린다 (로봇청소기 청소).
 * @returns 지워진 셀 수
 */
export function eraseCircle(state: GameState, center: Vec2, radiusWorld: number): number {
  return fillCircle(state, center, radiusWorld, Cell.EMPTY);
}

function fillCircle(state: GameState, center: Vec2, radiusWorld: number, next: number): number {
  const half = { x: DERIVED.ROOM_W / 2, z: DERIVED.ROOM_H / 2 };
  const cs = CONFIG.CELL_SIZE;

  // 원의 경계 상자에 해당하는 셀 범위만 훑는다.
  const minCx = Math.max(0, Math.floor((center.x - radiusWorld + half.x) / cs));
  const maxCx = Math.min(CONFIG.GRID_W - 1, Math.floor((center.x + radiusWorld + half.x) / cs));
  const minCz = Math.max(0, Math.floor((center.z - radiusWorld + half.z) / cs));
  const maxCz = Math.min(CONFIG.GRID_H - 1, Math.floor((center.z + radiusWorld + half.z) / cs));

  const r2 = radiusWorld * radiusWorld;
  let changed = 0;

  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const wx = (cx + 0.5) * cs - half.x;
      const wz = (cz + 0.5) * cs - half.z;
      const dx = wx - center.x;
      const dz = wz - center.z;
      if (dx * dx + dz * dz > r2) continue;
      if (setCell(state, cz * CONFIG.GRID_W + cx, next)) changed++;
    }
  }

  return changed;
}

/**
 * 기존 영역과 **인접한** EMPTY 셀부터 BFS 로 확장한다. (§14 변기 보너스)
 *
 * 무작위로 흩뿌리면 고립된 셀이 생겨 청소기에 금방 지워진다.
 * 덩어리로 붙여야 실제로 유리하다.
 *
 * @param count 확보할 셀 수
 * @returns 실제로 확보한 셀 수
 */
export function expandFromTerritory(state: GameState, count: number): number {
  if (count <= 0) return 0;

  const { GRID_W, GRID_H } = CONFIG;
  const visited = new Uint8Array(state.grid.length);
  const queue: number[] = [];

  // 시드: 이미 확보한 셀에 인접한 EMPTY 셀
  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i] !== Cell.POOP_TERRITORY) continue;
    for (const n of neighbors(i, GRID_W, GRID_H)) {
      if (state.grid[n] === Cell.EMPTY && visited[n] === 0) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }

  // 확보한 영역이 하나도 없으면(첫 배변 전 변기 사용) 플레이어 주변에서 시작한다.
  if (queue.length === 0) {
    const start = state.collision.cellIndexAt(state.player.pos);
    const seed = start >= 0 && state.grid[start] === Cell.EMPTY ? start : firstEmpty(state);
    if (seed < 0) return 0;
    visited[seed] = 1;
    queue.push(seed);
  }

  let gained = 0;
  for (let head = 0; head < queue.length && gained < count; head++) {
    const index = queue[head]!;
    if (!setCell(state, index, Cell.POOP_TERRITORY)) continue;
    gained++;

    for (const n of neighbors(index, GRID_W, GRID_H)) {
      if (state.grid[n] === Cell.EMPTY && visited[n] === 0) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }

  return gained;
}

function firstEmpty(state: GameState): number {
  for (let i = 0; i < state.grid.length; i++) if (state.grid[i] === Cell.EMPTY) return i;
  return -1;
}

/** 상하좌우 이웃 인덱스 */
function* neighbors(index: number, w: number, h: number): Generator<number> {
  const cx = index % w;
  const cz = Math.floor(index / w);
  if (cx > 0) yield index - 1;
  if (cx < w - 1) yield index + 1;
  if (cz > 0) yield index - w;
  if (cz < h - 1) yield index + w;
}

/** 격자 전체를 훑어 점유 수를 다시 센다. 테스트·검증 전용. 게임 루프에서 쓰지 않는다. */
export function recountOwned(state: GameState): number {
  let n = 0;
  for (const v of state.grid) if (v === Cell.POOP_TERRITORY) n++;
  return n;
}
