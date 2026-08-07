/**
 * 똥 땅 시각화. GameState 를 읽어 반영만 한다. 단방향. (§0-4)
 *
 * §10 시각화 요구사항:
 * - InstancedMesh 를 시작 시 1회 생성한다. 매 프레임 Geometry/Material 을 만들지 않는다.
 * - 셀이 바뀐 프레임에만 GPU 버퍼를 갱신한다. 매 프레임 needsUpdate = true 로 두지 않는다.
 * - 색 전환은 즉시 바꾸지 않고 짧게 보간한다.
 *
 * 보간에 스케일도 함께 쓴다. 빈 셀은 스케일 0 이라 보이지 않고,
 * 확보되면 살짝 튀어나오며 커진다 — 인스턴스별 투명도는 커스텀 셰이더 없이는
 * 불가능하지만, 스케일은 instanceMatrix 로 공짜다.
 */

import * as THREE from 'three';
import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { Cell } from '../core/types.ts';

/** 색·스케일 전환 시간 (초) */
const FADE_TIME = 0.15;
/** 확보 순간의 오버슈트 (통통 튀는 느낌) */
const OVERSHOOT = 0.18;

const POOP_COLOR = new THREE.Color(0x6cc24a);
const POOP_COLOR_DARK = new THREE.Color(0x4e9c34);

export class TerritoryGrid {
  readonly mesh: THREE.InstancedMesh;

  /** 셀 인덱스 → 인스턴스 인덱스. BLOCKED 셀은 -1 */
  private readonly cellToInstance: Int32Array;
  /** 인스턴스 인덱스 → 셀 인덱스 */
  private readonly instanceToCell: Int32Array;

  /** 인스턴스별 전환 진행도 [0, 1]. 0 = 빈 바닥, 1 = 똥 땅 */
  private readonly progress: Float32Array;
  private readonly target: Float32Array;
  /** 아직 전환 중인 인스턴스. 여기가 비면 GPU 버퍼를 건드리지 않는다. */
  private readonly animating = new Set<number>();

  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  constructor(state: GameState) {
    const total = DERIVED.TOTAL_CELLS;
    this.cellToInstance = new Int32Array(total).fill(-1);

    // BLOCKED 셀은 영원히 바뀌지 않으므로 인스턴스를 만들지 않는다.
    const cells: number[] = [];
    for (let i = 0; i < total; i++) {
      if (state.grid[i] !== Cell.BLOCKED) {
        this.cellToInstance[i] = cells.length;
        cells.push(i);
      }
    }
    this.instanceToCell = Int32Array.from(cells);

    const count = cells.length;
    this.progress = new Float32Array(count);
    this.target = new Float32Array(count);

    // 바닥에 눕힌 평면. 회전을 지오메트리에 구워두면 인스턴스마다 회전할 필요가 없다.
    this.geometry = new THREE.PlaneGeometry(CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
    this.geometry.rotateX(-Math.PI / 2);

    this.material = new THREE.MeshLambertMaterial({
      // 바닥 격자선 위에 겹치므로 z-fighting 을 폴리곤 오프셋으로 막는다.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, count);
    this.mesh.name = 'territory';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    const colors = new Float32Array(count * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // 전부 "빈 셀"(스케일 0) 로 초기화
    for (let i = 0; i < count; i++) {
      this.writeInstance(i, 0);
      this.tmpColor.copy(POOP_COLOR);
      this.mesh.instanceColor.setXYZ(i, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  /** 상태의 변경 목록을 읽어 전환을 예약하고 목록을 비운다. */
  sync(state: GameState): void {
    const dirty = state.dirtyCells;
    if (dirty.length === 0) return;

    for (const cellIndex of dirty) {
      const inst = this.cellToInstance[cellIndex];
      if (inst === undefined || inst < 0) continue;
      this.target[inst] = state.grid[cellIndex] === Cell.POOP_TERRITORY ? 1 : 0;
      this.animating.add(inst);
    }
    dirty.length = 0;
  }

  /** @param dt 렌더 델타 (가변) */
  update(dt: number): void {
    if (this.animating.size === 0) return;

    const step = dt / FADE_TIME;
    const done: number[] = [];

    for (const inst of this.animating) {
      const goal = this.target[inst]!;
      let p = this.progress[inst]!;

      if (p < goal) p = Math.min(goal, p + step);
      else p = Math.max(goal, p - step);

      this.progress[inst] = p;
      this.writeInstance(inst, p);

      // 가장자리를 살짝 어둡게 해서 덩어리 경계가 보이게 한다.
      this.tmpColor.copy(p > 0.5 ? POOP_COLOR : POOP_COLOR_DARK);
      this.mesh.instanceColor!.setXYZ(inst, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b);

      if (p === goal) done.push(inst);
    }

    for (const inst of done) this.animating.delete(inst);

    // 변경이 있는 프레임에만 갱신한다.
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** 진행도에 따라 위치·스케일을 기록한다. */
  private writeInstance(inst: number, p: number): void {
    const cellIndex = this.instanceToCell[inst]!;
    const cx = cellIndex % CONFIG.GRID_W;
    const cz = Math.floor(cellIndex / CONFIG.GRID_W);

    // 0 → 1 로 갈 때만 살짝 오버슈트시킨다 (사라질 때는 그냥 줄어든다).
    const scale = p <= 0 ? 0 : p + Math.sin(p * Math.PI) * OVERSHOOT;

    this.dummy.position.set(
      (cx + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_W / 2,
      0.006,
      (cz + 0.5) * CONFIG.CELL_SIZE - DERIVED.ROOM_H / 2,
    );
    this.dummy.scale.set(scale, 1, scale);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(inst, this.dummy.matrix);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    this.animating.clear();
  }
}
