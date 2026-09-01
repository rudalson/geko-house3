/**
 * 화장실 구역 메시. 배치는 `bathroomLayout.ts` 에서만 파생된다. (§0-2)
 *
 * 거실과 물리적으로 이어진 별도 구역이라 씬에 항상 올려둔다.
 *
 * 1인칭(§25)이라 사방 벽과 천장을 모두 세운다. 거실과 같은 이유다 —
 * 쿼터뷰 시절에는 카메라 쪽 두 면을 뚫어 캐릭터를 보이게 했지만, 지금은
 * 그 방향을 그냥 쳐다보게 되고 그러면 벽 대신 허공이 보인다.
 *
 * 남쪽 벽에는 **문간을 낸다.** 거실로 돌아가는 출구가 어디인지 벽으로 보여야
 * 한다 — 미니맵만으로 찾게 하면 좁은 방에서 방향을 잃는다.
 */

import * as THREE from 'three';
import {
  BATHROOM_BOUNDS,
  BATHROOM_EXIT,
  SINK_POS,
  TOILET_POS,
} from './bathroomLayout.ts';
import type { Disposable } from './Furniture.ts';
import { DERIVED } from '../core/GameConfig.ts';

/**
 * 거실 북쪽 벽의 **바깥면** z 좌표. 복도가 여기서 끝난다.
 * LivingRoom 이 벽을 `-ROOM_H/2 - t/2` 에 두께 t 로 세우므로 바깥면은 −ROOM_H/2 − t 다.
 * 두 파일이 같은 값을 각자 적으면 반드시 어긋나므로 여기서 파생시킨다. (§0-2)
 */
const LIVING_WALL_T = 0.3;
const LIVING_NORTH_WALL_Z = -DERIVED.ROOM_H / 2 - LIVING_WALL_T;

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

    // ── 벽 ──
    // 사방을 다 세우되, 거실로 나가는 남쪽만 문간을 비워 둔다. (§25)
    const wallMat = track(new THREE.MeshLambertMaterial({ color: WALL_COLOR }));

    /** 벽 한 장 */
    const wall = (
      size: readonly [number, number, number],
      at: readonly [number, number, number],
    ): void => {
      const geo = track(new THREE.BoxGeometry(size[0], size[1], size[2]));
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(at[0], at[1], at[2]);
      this.group.add(mesh);
    };

    wall([w + t * 2, wallH, t], [cx, wallH / 2, b.minZ - t / 2]); // 북 (변기 쪽)
    wall([t, wallH, d], [b.minX - t / 2, wallH / 2, cz]); // 서
    wall([t, wallH, d], [b.maxX + t / 2, wallH / 2, cz]); // 동

    // 남쪽 — 출구 문간(폭 DOORWAY)을 사이에 두고 좌우로 나눠 세운다.
    // 문간 위쪽은 인방(lintel)으로 막아야 벽이 끊긴 것처럼 보이지 않는다.
    const DOORWAY = 1.6;
    const doorH = 1.6;
    const gapL = BATHROOM_EXIT.x - DOORWAY / 2;
    const gapR = BATHROOM_EXIT.x + DOORWAY / 2;
    const leftW = gapL - (b.minX - t);
    const rightW = b.maxX + t - gapR;

    if (leftW > 0) {
      wall([leftW, wallH, t], [b.minX - t + leftW / 2, wallH / 2, b.maxZ + t / 2]);
    }
    if (rightW > 0) {
      wall([rightW, wallH, t], [gapR + rightW / 2, wallH / 2, b.maxZ + t / 2]);
    }
    wall(
      [DOORWAY, wallH - doorH, t],
      [BATHROOM_EXIT.x, doorH + (wallH - doorH) / 2, b.maxZ + t / 2],
    );

    // ── 거실과 잇는 짧은 복도 ──
    //
    // 화장실(z ≤ −7.0)과 거실(z ≥ −6.0) 사이에는 1 units 의 빈 구간이 있다.
    // 쿼터뷰에서는 위에서 내려다보므로 아무도 눈치채지 못했지만, 1인칭으로
    // 화장실에서 출구 쪽을 보면 **바닥이 없는 검은 틈**이 정면에 뜬다.
    // 바닥·양옆 벽·천장을 깔아 통로로 만든다. (§25)
    //
    // 이동 자체는 여전히 `E` 로 순간이동한다 (§6) — 여기를 걸어서 지나가지는
    // 않는다. 그래서 충돌을 두지 않고 보이는 것만 만든다.
    const corrZ0 = b.maxZ; // 화장실 남쪽 끝
    const corrZ1 = LIVING_NORTH_WALL_Z; // 거실 북쪽 벽 바깥면
    const corrD = corrZ1 - corrZ0;
    const corrCZ = (corrZ0 + corrZ1) / 2;
    const corrW = 1.6;
    const corrH = 2.0;

    // 바닥만 벽 두께만큼 더 뻗어 거실 바닥과 맞닿게 한다. 벽은 바깥면(−6.3)에서
    // 끝나지만 바닥이 거기서 끊기면 문턱 아래에 검은 실선이 남는다.
    const floorD = corrD + LIVING_WALL_T;
    const corrFloorGeo = track(new THREE.PlaneGeometry(corrW, floorD));
    const corrFloor = new THREE.Mesh(corrFloorGeo, floorMat);
    corrFloor.rotation.x = -Math.PI / 2;
    corrFloor.position.set(BATHROOM_EXIT.x, 0, corrCZ + LIVING_WALL_T / 2);
    corrFloor.receiveShadow = true;
    this.group.add(corrFloor);

    wall([t, corrH, corrD], [BATHROOM_EXIT.x - corrW / 2 - t / 2, corrH / 2, corrCZ]);
    wall([t, corrH, corrD], [BATHROOM_EXIT.x + corrW / 2 + t / 2, corrH / 2, corrCZ]);

    const corrCeilGeo = track(new THREE.PlaneGeometry(corrW + t * 2, corrD));
    const corrCeilMat = track(new THREE.MeshLambertMaterial({ color: WALL_COLOR }));
    const corrCeil = new THREE.Mesh(corrCeilGeo, corrCeilMat);
    corrCeil.rotation.x = Math.PI / 2;
    corrCeil.position.set(BATHROOM_EXIT.x, corrH, corrCZ);
    this.group.add(corrCeil);

    // ── 천장 ──
    // 거실과 같은 이유로 덮는다. 그림자는 던지지 않는다 (castShadow 기본 false).
    const ceilGeo = track(new THREE.PlaneGeometry(w + t * 2, d + t * 2));
    const ceilMat = track(new THREE.MeshLambertMaterial({ color: WALL_COLOR }));
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2; // 아래를 향한다
    ceiling.position.set(cx, wallH, cz);
    this.group.add(ceiling);

    // ── 걸레받이 ──
    // 벽과 바닥이 만나는 선. 눈높이가 낮을수록 이 선이 거리감의 기준이 된다.
    const baseMat = track(new THREE.MeshLambertMaterial({ color: GROUT_COLOR }));
    const bh = 0.14;

    /** 걸레받이 한 줄 */
    const base = (
      size: readonly [number, number, number],
      at: readonly [number, number, number],
    ): void => {
      const geo = track(new THREE.BoxGeometry(size[0], size[1], size[2]));
      const mesh = new THREE.Mesh(geo, baseMat);
      mesh.position.set(at[0], at[1], at[2]);
      this.group.add(mesh);
    };

    base([w, bh, 0.07], [cx, bh / 2, b.minZ + 0.035]);
    base([0.07, bh, d], [b.minX + 0.035, bh / 2, cz]);
    base([0.07, bh, d], [b.maxX - 0.035, bh / 2, cz]);

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
