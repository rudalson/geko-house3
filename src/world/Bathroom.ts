/**
 * 화장실 구역 메시. 배치는 `bathroomLayout.ts` 에서만 파생된다. (§0-2)
 *
 * 거실과 물리적으로 이어진 별도 구역이라 씬에 항상 올려둔다.
 * 플레이어가 들어가면 카메라 경계만 이쪽으로 옮긴다. (§6)
 */

import * as THREE from 'three';
import {
  BATHROOM_BOUNDS,
  BATHROOM_EXIT,
  SINK_POS,
  TOILET_POS,
} from './bathroomLayout.ts';
import type { Disposable } from './Furniture.ts';

const TILE_COLOR = 0xcfe3ea;
const GROUT_COLOR = 0xa9c4cf;
const WALL_COLOR = 0xe6f1f5;
const PORCELAIN = 0xffffff;

export class Bathroom implements Disposable {
  readonly group = new THREE.Group();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor() {
    this.group.name = 'bathroom';

    const b = BATHROOM_BOUNDS;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const wallH = 2.6;
    const t = 0.3;

    const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
      this.disposables.push(x);
      return x;
    };

    // ── 타일 바닥 ──
    const floorGeo = track(new THREE.PlaneGeometry(w, d));
    const floorMat = track(new THREE.MeshLambertMaterial({ color: TILE_COLOR }));
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    // 타일 줄눈 — 거실보다 촘촘하게 해서 다른 공간임을 알린다
    const pts: number[] = [];
    const tile = 0.7;
    for (let x = b.minX; x <= b.maxX + 1e-6; x += tile) pts.push(x, 0, b.minZ, x, 0, b.maxZ);
    for (let z = b.minZ; z <= b.maxZ + 1e-6; z += tile) pts.push(b.minX, 0, z, b.maxX, 0, z);
    const gridGeo = track(new THREE.BufferGeometry());
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const gridMat = track(
      new THREE.LineBasicMaterial({ color: GROUT_COLOR, transparent: true, opacity: 0.5 }),
    );
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.y = 0.003;
    this.group.add(grid);

    // ── 벽 (카메라 반대쪽 두 면만) ──
    const wallMat = track(new THREE.MeshLambertMaterial({ color: WALL_COLOR }));

    const northGeo = track(new THREE.BoxGeometry(w + t * 2, wallH, t));
    const north = new THREE.Mesh(northGeo, wallMat);
    north.position.set(cx, wallH / 2, b.minZ - t / 2);
    this.group.add(north);

    const westGeo = track(new THREE.BoxGeometry(t, wallH, d));
    const west = new THREE.Mesh(westGeo, wallMat);
    west.position.set(b.minX - t / 2, wallH / 2, cz);
    this.group.add(west);

    // 남·동쪽은 낮은 턱만 (시야 확보)
    const baseMat = track(new THREE.MeshLambertMaterial({ color: GROUT_COLOR }));
    const southGeo = track(new THREE.BoxGeometry(w + t * 2, 0.12, t));
    const south = new THREE.Mesh(southGeo, baseMat);
    south.position.set(cx, 0.06, b.maxZ + t / 2);
    this.group.add(south);

    const eastGeo = track(new THREE.BoxGeometry(t, 0.12, d));
    const east = new THREE.Mesh(eastGeo, baseMat);
    east.position.set(b.maxX + t / 2, 0.06, cz);
    this.group.add(east);

    // ── 변기 ──
    const porcelain = track(new THREE.MeshLambertMaterial({ color: PORCELAIN }));

    const bowlGeo = track(new THREE.CylinderGeometry(0.32, 0.26, 0.42, 14));
    const bowl = new THREE.Mesh(bowlGeo, porcelain);
    bowl.position.set(TOILET_POS.x, 0.21, TOILET_POS.z);
    bowl.castShadow = true;
    this.group.add(bowl);

    const seatGeo = track(new THREE.TorusGeometry(0.28, 0.06, 8, 16));
    const seat = new THREE.Mesh(seatGeo, porcelain);
    seat.rotation.x = -Math.PI / 2;
    seat.position.set(TOILET_POS.x, 0.44, TOILET_POS.z);
    this.group.add(seat);

    const tankGeo = track(new THREE.BoxGeometry(0.5, 0.55, 0.22));
    const tank = new THREE.Mesh(tankGeo, porcelain);
    tank.position.set(TOILET_POS.x, 0.5, TOILET_POS.z - 0.34);
    tank.castShadow = true;
    this.group.add(tank);

    // ── 세면대 ──
    const basinGeo = track(new THREE.CylinderGeometry(0.34, 0.24, 0.22, 14));
    const basin = new THREE.Mesh(basinGeo, porcelain);
    basin.position.set(SINK_POS.x, 0.72, SINK_POS.z);
    basin.castShadow = true;
    this.group.add(basin);

    const pedestalGeo = track(new THREE.CylinderGeometry(0.12, 0.16, 0.62, 10));
    const pedestal = new THREE.Mesh(pedestalGeo, porcelain);
    pedestal.position.set(SINK_POS.x, 0.31, SINK_POS.z);
    this.group.add(pedestal);

    // ── 거실로 돌아가는 문 표시 ──
    const doorGeo = track(new THREE.PlaneGeometry(1.4, 1.0));
    const doorMat = track(
      new THREE.MeshBasicMaterial({
        color: 0x9a6b45,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    const doorMark = new THREE.Mesh(doorGeo, doorMat);
    doorMark.rotation.x = -Math.PI / 2;
    doorMark.position.set(BATHROOM_EXIT.x, 0.006, BATHROOM_EXIT.z + 0.3);
    this.group.add(doorMark);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.clear();
  }
}
