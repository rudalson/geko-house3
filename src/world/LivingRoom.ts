/**
 * 거실 바닥과 벽. 상태를 읽어 화면에 반영만 한다. (§0-4)
 */

import * as THREE from 'three';
import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import type { Disposable } from './Furniture.ts';

const FLOOR_COLOR = 0xe8d5ac;
const WALL_COLOR = 0xf2e3c4;
const BASEBOARD_COLOR = 0xd9c49a;

export class LivingRoom implements Disposable {
  readonly group = new THREE.Group();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly northWallMat: THREE.MeshLambertMaterial;
  private northOpacity = 1;

  constructor() {
    this.group.name = 'living-room';

    const { ROOM_W, ROOM_H } = DERIVED;
    const wallH = 3.0;
    const t = 0.3; // 벽 두께

    // ── 바닥 ──
    // 똥 땅 격자(InstancedMesh)가 이 위에 얹히므로 살짝 아래에 둔다.
    const floorGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_H);
    const floorMat = new THREE.MeshLambertMaterial({ color: FLOOR_COLOR });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.group.add(floor);
    this.disposables.push(floorGeo, floorMat);

    // 바닥 타일 격자선 — 거리감과 이동 속도를 읽기 쉽게 해준다.
    // GridHelper 는 정사각형만 만들 수 있어 16x12 방 밖으로 삐져나온다.
    // 논리 격자(CELL_SIZE)와 정확히 같은 선을 직접 만든다.
    const pts: number[] = [];
    const hw = ROOM_W / 2;
    const hh = ROOM_H / 2;
    for (let i = 0; i <= CONFIG.GRID_W; i++) {
      const x = -hw + i * CONFIG.CELL_SIZE;
      pts.push(x, 0, -hh, x, 0, hh);
    }
    for (let i = 0; i <= CONFIG.GRID_H; i++) {
      const z = -hh + i * CONFIG.CELL_SIZE;
      pts.push(-hw, 0, z, hw, 0, z);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const gridMat = new THREE.LineBasicMaterial({
      color: 0xd0bb92,
      transparent: true,
      opacity: 0.3,
    });
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.y = 0.002;
    this.group.add(grid);
    this.disposables.push(gridGeo, gridMat);

    // ── 벽 ──
    // 카메라가 남동쪽에서 내려다보므로 북(-z)·서(-x) 벽만 세운다.
    // 앞쪽 벽을 세우면 캐릭터를 가려서 쿼터뷰의 의미가 사라진다.
    const wallMat = new THREE.MeshLambertMaterial({ color: WALL_COLOR });
    this.disposables.push(wallMat);

    // 북쪽 벽은 화장실 쪽 시야를 완전히 막는다. 화장실은 이 벽 너머에 있고
    // 카메라는 남동쪽에서 보므로, 들어가 있는 동안에는 벽이 항상 캐릭터를 가린다.
    // 그래서 재질을 따로 두고 화장실 체류 중에는 투명하게 만든다. (§6)
    this.northWallMat = new THREE.MeshLambertMaterial({
      color: WALL_COLOR,
      transparent: true,
      opacity: 1,
    });
    this.disposables.push(this.northWallMat);

    const northGeo = new THREE.BoxGeometry(ROOM_W + t * 2, wallH, t);
    const north = new THREE.Mesh(northGeo, this.northWallMat);
    north.position.set(0, wallH / 2, -ROOM_H / 2 - t / 2);
    north.receiveShadow = true;
    this.group.add(north);
    this.disposables.push(northGeo);

    const westGeo = new THREE.BoxGeometry(t, wallH, ROOM_H);
    const west = new THREE.Mesh(westGeo, wallMat);
    west.position.set(-ROOM_W / 2 - t / 2, wallH / 2, 0);
    west.receiveShadow = true;
    this.group.add(west);
    this.disposables.push(westGeo);

    // ── 걸레받이 ──
    // 남·동쪽은 벽 대신 낮은 턱만 둬서 방 경계를 알 수 있게 한다.
    const baseMat = new THREE.MeshLambertMaterial({ color: BASEBOARD_COLOR });
    this.disposables.push(baseMat);

    const southGeo = new THREE.BoxGeometry(ROOM_W + t * 2, 0.12, t);
    const south = new THREE.Mesh(southGeo, baseMat);
    south.position.set(0, 0.06, ROOM_H / 2 + t / 2);
    this.group.add(south);
    this.disposables.push(southGeo);

    const eastGeo = new THREE.BoxGeometry(t, 0.12, ROOM_H);
    const east = new THREE.Mesh(eastGeo, baseMat);
    east.position.set(ROOM_W / 2 + t / 2, 0.06, 0);
    this.group.add(east);
    this.disposables.push(eastGeo);
  }

  /**
   * 화장실 체류 중에는 북쪽 벽을 비운다. 즉시 껐다 켜면 눈에 거슬리므로 보간한다.
   * @param dt 렌더 델타
   */
  setNorthWallHidden(hidden: boolean, dt: number): void {
    const target = hidden ? 0.08 : 1;
    const diff = target - this.northOpacity;
    this.northOpacity += Math.abs(diff) < 0.005 ? diff : diff * Math.min(1, dt * 8);
    this.northWallMat.opacity = this.northOpacity;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.clear();
  }
}
