/**
 * 가구 메시. **furnitureLayout.ts 에서만 파생된다.** (§0-2)
 * 여기에 좌표를 손으로 적지 않는다. 적는 순간 충돌·격자와 어긋난다.
 *
 * 카메라와 플레이어 사이를 가리는 가구는 반투명하게 만든다 (§6).
 * 매 프레임 raycast 하지 않고, "카메라 쪽에서 봤을 때 플레이어보다 앞"인지를
 * 격자 좌표 비교로 판정한다.
 */

import * as THREE from 'three';
import { LIVING_ROOM_FURNITURE, type FurnitureDef } from './furnitureLayout.ts';
import type { Vec2 } from '../core/types.ts';
import { CAMERA_ELEVATION } from '../scenes/QuarterViewCamera.ts';

export interface Disposable {
  dispose(): void;
}

/** 이 높이 아래 가구는 캐릭터를 가리지 않으므로 반투명 대상에서 제외한다. */
const OCCLUDER_MIN_HEIGHT = 0.9;
/** 화면에서 캐릭터가 차지하는 대략적인 반폭 (world units) */
const PLAYER_SILHOUETTE = 0.45;
const FADE_OPACITY = 0.3;
const FADE_SPEED = 6; // 초당 보간 계수 — 깜빡임 방지

interface FurniturePiece {
  def: FurnitureDef;
  mesh: THREE.Mesh;
  material: THREE.Material & { opacity: number; transparent: boolean };
  /** 가려지지 않을 때의 기본 불투명도 */
  baseOpacity: number;
  targetOpacity: number;
  currentOpacity: number;
}

export class Furniture implements Disposable {
  readonly group = new THREE.Group();
  private readonly pieces: FurniturePiece[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(defs: readonly FurnitureDef[] = LIVING_ROOM_FURNITURE) {
    this.group.name = 'furniture';

    for (const def of defs) {
      const geo = this.buildGeometry(def);
      const mat = new THREE.MeshLambertMaterial({ color: def.color });
      const mesh = new THREE.Mesh(geo, mat);

      mesh.position.set(def.x, def.h / 2, def.z);
      mesh.castShadow = def.solid;
      mesh.receiveShadow = true;
      mesh.name = def.id;

      this.group.add(mesh);
      this.geometries.push(geo);
      this.pieces.push({
        def,
        mesh,
        material: mat,
        baseOpacity: 1,
        targetOpacity: 1,
        currentOpacity: 1,
      });

      // 등반 가능한 가구는 상판에 옅은 테두리를 둘러 힌트를 준다.
      if (def.climbable) {
        const edgeGeo = new THREE.BoxGeometry(def.w * 1.02, 0.03, def.d * 1.02);
        const edgeMat = new THREE.MeshBasicMaterial({
          color: 0xffe9a8,
          transparent: true,
          opacity: 0.55,
        });
        const edge = new THREE.Mesh(edgeGeo, edgeMat);
        edge.position.set(def.x, def.h + 0.015, def.z);
        this.group.add(edge);
        this.geometries.push(edgeGeo);
        this.pieces.push({
          def,
          mesh: edge,
          material: edgeMat,
          baseOpacity: 0.55,
          targetOpacity: 0.55,
          currentOpacity: 0.55,
        });
      }
    }
  }

  /** 종류별로 살짝 다른 형태를 준다. 로우폴리 유지. */
  private buildGeometry(def: FurnitureDef): THREE.BufferGeometry {
    switch (def.kind) {
      case 'plant':
        return new THREE.ConeGeometry(Math.min(def.w, def.d) / 2, def.h, 6);
      case 'lamp':
        return new THREE.CylinderGeometry(def.w / 2, def.w / 2.6, def.h, 8);
      case 'bowl':
        return new THREE.CylinderGeometry(def.w / 2, def.w / 2.4, def.h, 10);
      case 'blanket':
        // 담요는 살짝 부푼 느낌으로
        return new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(
          def.w / 2,
          def.h * 3,
          def.d / 2,
        );
      default:
        return new THREE.BoxGeometry(def.w, def.h, def.d);
    }
  }

  /**
   * 플레이어를 가리는 가구를 반투명하게 만든다.
   *
   * 매 프레임 raycast 하지 않고, 카메라 방향축으로 좌표를 분해해서 판정한다.
   *
   *   along = 카메라 → 플레이어 방향으로 가구가 얼마나 앞에 있는가
   *   perp  = 그 축에서 옆으로 얼마나 벗어나 있는가
   *
   * 높이 h 인 가구가 시야를 막는 범위는 뒤쪽으로 `h / tan(고도)` 까지다.
   * 그 뒤에 있는 플레이어는 가구 위로 보이므로 반투명하게 만들 필요가 없다.
   * (이 계산 없이 "근처면 투명" 으로 두면 실제로 가리지도 않는 가구가
   *  유령처럼 비쳐서 화면이 지저분해진다.)
   */
  updateOcclusion(playerPos: Vec2, dt: number): void {
    const inv = 1 / Math.SQRT2; // 카메라 방위각 45도 → (1,1)/√2
    const shadowDepth = 1 / Math.tan(CAMERA_ELEVATION);

    for (const piece of this.pieces) {
      const { def } = piece;

      const dx = def.x - playerPos.x;
      const dz = def.z - playerPos.z;
      // 카메라 쪽이 +along
      const along = (dx + dz) * inv;
      const perp = (dx - dz) * inv;

      const halfPerp = (def.w + def.d) * 0.5 * inv;
      const halfAlong = (def.w + def.d) * 0.5 * inv;

      const occludes =
        def.h >= OCCLUDER_MIN_HEIGHT &&
        along > 0 &&
        along < def.h * shadowDepth + halfAlong &&
        Math.abs(perp) < halfPerp + PLAYER_SILHOUETTE;

      piece.targetOpacity = occludes
        ? Math.min(FADE_OPACITY, piece.baseOpacity)
        : piece.baseOpacity;

      // 즉시 바꾸지 않고 보간해서 깜빡임을 막는다.
      const diff = piece.targetOpacity - piece.currentOpacity;
      if (Math.abs(diff) < 0.005) {
        piece.currentOpacity = piece.targetOpacity;
      } else {
        piece.currentOpacity += diff * Math.min(1, FADE_SPEED * dt);
      }

      const transparent = piece.currentOpacity < 0.995;
      if (piece.material.transparent !== transparent) {
        piece.material.transparent = transparent;
        piece.material.needsUpdate = true;
      }
      piece.material.opacity = piece.currentOpacity;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const p of this.pieces) p.material.dispose();
    this.geometries.length = 0;
    this.pieces.length = 0;
    this.group.clear();
  }
}
