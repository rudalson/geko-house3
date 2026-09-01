/**
 * 가구 메시. **furnitureLayout.ts 에서만 파생된다.** (§0-2)
 * 여기에 좌표를 손으로 적지 않는다. 적는 순간 충돌·격자와 어긋난다.
 *
 * 1인칭에서는 가구를 **가리지 않는다** (§25). 쿼터뷰 시절에는 카메라와 캐릭터
 * 사이에 낀 가구를 반투명하게 만들어야 했지만, 지금은 카메라가 곧 눈이라
 * 앞을 가리는 가구는 가리는 게 맞다 — 그게 이 시점의 긴장 그 자체다.
 *
 * 대신 정반대의 문제가 하나 생긴다. 담요·식기처럼 **밟고 지나갈 수 있는**
 * 소품(solid: false)은 충돌이 없어서 눈높이(0.34)가 그 안으로 들어갈 수 있고,
 * 그 순간 화면이 통째로 담요 안쪽 면으로 덮인다. 그것만 걷어낸다.
 */

import * as THREE from 'three';
import { LIVING_ROOM_FURNITURE, type FurnitureDef } from './furnitureLayout.ts';
import { buildFurniture } from './furnitureBuilders.ts';

export interface Disposable {
  dispose(): void;
}

/**
 * 눈이 이 만큼이라도 가구 부피 안에 들어와 있으면 걷어낸다 (world units).
 *
 * 0 으로 두면 담요 표면에 눈높이가 정확히 걸치는 순간 켜졌다 꺼졌다 한다.
 * near 평면(0.015)보다 넉넉히 크게 잡아 경계에서 진동하지 않게 한다.
 */
const INSIDE_MARGIN = 0.06;
const FADE_OPACITY = 0.12;
const FADE_SPEED = 10; // 초당 보간 계수 — 깜빡임 방지

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
      const built = buildFurniture(def);
      // 색은 지오메트리의 정점에 구워져 있다 (world/vertexPaint.ts).
      // 그래서 파트가 몇 개든 머티리얼은 하나, draw call 도 하나다.
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(built.geometry, mat);

      mesh.position.set(def.x, def.h / 2, def.z);
      mesh.castShadow = def.solid;
      mesh.receiveShadow = true;
      mesh.name = def.id;

      this.group.add(mesh);
      this.geometries.push(built.geometry);
      this.pieces.push({
        def,
        mesh,
        material: mat,
        baseOpacity: 1,
        targetOpacity: 1,
        currentOpacity: 1,
      });

      // 화면·전등갓은 조명을 받으면 안 된다. 따로 그리되 가림 페이드에는 같이 태운다 —
      // 본체만 투명해지고 화면이 남으면 허공에 TV 가 떠 있는 꼴이 된다.
      for (const glow of built.glow) {
        const glowMat = new THREE.MeshBasicMaterial({ color: glow.color });
        const glowMesh = new THREE.Mesh(glow.geometry, glowMat);
        glowMesh.position.copy(mesh.position);
        glowMesh.name = `${def.id}-glow`;
        this.group.add(glowMesh);
        this.geometries.push(glow.geometry);
        this.pieces.push({
          def,
          mesh: glowMesh,
          material: glowMat,
          baseOpacity: 1,
          targetOpacity: 1,
          currentOpacity: 1,
        });
      }

      // 등반 가능한 가구에 옅은 띠를 둘러 힌트를 준다.
      //
      // 쿼터뷰 시절에는 이 띠가 **상판 테두리**에 있었다. 1인칭에서는 그게
      // 보이지 않는다 — 눈높이 0.34 에서 소파 상판(0.75)은 올려다보는 면이라
      // 위에 얹힌 테두리는 각도상 완전히 가려진다. 도마뱀이 실제로 보는 높이,
      // 즉 **옆면 아래쪽**으로 내린다. (§25)
      if (def.climbable) {
        const edgeGeo = new THREE.BoxGeometry(def.w * 1.02, 0.06, def.d * 1.02);
        const edgeMat = new THREE.MeshBasicMaterial({
          color: 0xffe9a8,
          transparent: true,
          opacity: 0.55,
        });
        const edge = new THREE.Mesh(edgeGeo, edgeMat);
        // 바닥에서 0.18 — 게코 눈높이 바로 위라 다가가면 정면에 걸린다.
        edge.position.set(def.x, Math.min(0.18, def.h - 0.05), def.z);
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

  /**
   * 눈높이가 파묻힌 가구를 걷어낸다. (§25)
   *
   * 대상은 사실상 `solid: false` 소품뿐이다 — solid 가구는 CollisionMap 이
   * 애초에 들어가지 못하게 막는다. 그래도 solid 여부로 거르지 않는 이유는,
   * 가구 위에 올라간 상태(§7)에서는 눈높이가 상판 위로 올라가므로 판정 대상이
   * 자연스럽게 바뀌기 때문이다. 조건을 손으로 나눠 적으면 그 경우가 빠진다.
   *
   * @param eye 카메라 위치 (world units). y 를 함께 봐야 담요를 밟고 지나갈 때만
   *   걷어내고, 옆을 스칠 때는 그대로 둔다.
   */
  updateNearFade(eye: { x: number; y: number; z: number }, dt: number): void {
    for (const piece of this.pieces) {
      const { def } = piece;

      const inside =
        Math.abs(eye.x - def.x) < def.w / 2 + INSIDE_MARGIN &&
        Math.abs(eye.z - def.z) < def.d / 2 + INSIDE_MARGIN &&
        eye.y < def.h + INSIDE_MARGIN;

      piece.targetOpacity = inside
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
