/**
 * 거실 바닥과 벽. 상태를 읽어 화면에 반영만 한다. (§0-4)
 */

import * as THREE from 'three';
import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import type { Disposable } from './Furniture.ts';
import { findFurniture } from './furnitureLayout.ts';
import { FLOOR_TILE, makeFloorTexture, makeRugTexture } from './roomTextures.ts';
import { mergeParts, paint } from './vertexPaint.ts';

const WALL_COLOR = 0xf2e3c4;
const BASEBOARD_COLOR = 0xcbb08a;

export class LivingRoom implements Disposable {
  readonly group = new THREE.Group();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly northWallMat: THREE.MeshLambertMaterial;
  /** 북쪽 벽에 붙은 장식. 벽이 투명해질 때 같이 사라져야 허공에 액자만 남지 않는다. */
  private readonly northDecorMats: THREE.Material[] = [];
  private northOpacity = 1;

  constructor() {
    this.group.name = 'living-room';

    const { ROOM_W, ROOM_H } = DERIVED;
    const wallH = 3.0;
    const t = 0.3; // 벽 두께

    // ── 바닥 ──
    // 똥 땅 격자(InstancedMesh)가 이 위에 얹히므로 살짝 아래에 둔다.
    const floorGeo = new THREE.PlaneGeometry(ROOM_W, ROOM_H);
    const floorTex = this.trackTexture(makeFloorTexture());
    // 텍스처 한 장이 FLOOR_TILE(4 units) 을 덮는다. 방이 16x12 라 딱 4x3 번 반복된다.
    floorTex.repeat.set(ROOM_W / FLOOR_TILE, ROOM_H / FLOOR_TILE);
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
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
      // 마루 결이 생긴 뒤로는 선이 진하면 방안지처럼 보인다. 셀 정렬을 읽을 만큼만 남긴다.
      opacity: 0.16,
    });
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.y = 0.002;
    this.group.add(grid);
    this.disposables.push(gridGeo, gridMat);

    this.addRug();

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

    this.addWallDecor(t);
  }

  /**
   * 소파 앞 러그.
   *
   * 충돌도 격자도 없는 순수 장식이라 가구 정의(§0-2)에 넣지 않는다. 대신 위치를
   * **소파 정의에서 파생**시킨다 — 소파를 옮기면 러그도 따라간다.
   *
   * 높이는 똥 땅 격자(y 0.006)보다 낮게 둔다. 러그가 위에 있으면 그 위에 싼 똥이
   * 가려져서 "쌌는데 아무 일도 안 일어난" 것처럼 보인다.
   */
  private addRug(): void {
    const sofa = findFurniture('sofa');
    if (!sofa) return;

    const w = sofa.w * 1.25;
    const d = 3.0;
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    // 마룻바닥보다 살짝 진하되 똥 땅만큼 어둡지는 않게. 러그가 어두우면 바닥에
    // 구멍이 뚫린 것처럼 보이고, 똥 땅과도 헷갈린다.
    const tex = this.trackTexture(makeRugTexture(0xdba97a, 0xb37f56, 0xf4e3c6));
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const rug = new THREE.Mesh(geo, mat);
    rug.position.set(sofa.x, 0.004, sofa.z + sofa.d / 2 + d / 2 + 0.4);
    rug.receiveShadow = true;
    rug.name = 'rug';
    this.group.add(rug);
    this.disposables.push(geo, mat);
  }

  /**
   * 벽 장식. 벽면이 비어 있으면 방이 세트장처럼 보인다.
   *
   * 북쪽 벽에 붙는 것은 벽이 투명해질 때 같이 사라져야 한다 (§6).
   */
  private addWallDecor(t: number): void {
    const { ROOM_W, ROOM_H } = DERIVED;
    // 벽의 안쪽 면. 장식은 여기서 조금씩 앞으로 띄운다.
    const zFace = -ROOM_H / 2 + 0.02;
    const xFace = -ROOM_W / 2 + 0.02;

    /** 벽에 붙이는 판때기 하나. 색은 정점에 굽는다 — 가구와 같은 방식이다. */
    const slab = (
      size: readonly [number, number, number],
      at: readonly [number, number, number],
      color: number,
    ): THREE.BufferGeometry => {
      const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
      g.translate(at[0], at[1], at[2]);
      return paint(g, color, { flat: true });
    };

    // ── 북쪽 벽: 액자 ──
    // 세 액자를 하나로 합친다. 어차피 벽과 함께 통째로 사라지므로 나눠 둘 이유가 없다.
    const pictures = [
      { x: -2.6, y: 1.85, w: 1.0, h: 0.75, color: 0x6f9ac4 },
      { x: -1.3, y: 2.0, w: 0.6, h: 0.8, color: 0xd98f6a },
      { x: 2.8, y: 1.9, w: 0.9, h: 0.9, color: 0x86a95f },
    ];
    const artParts: THREE.BufferGeometry[] = [];
    for (const p of pictures) {
      artParts.push(slab([p.w, p.h, 0.06], [p.x, p.y, zFace], 0x8a6b4a));
      artParts.push(slab([p.w * 0.82, p.h * 0.78, 0.02], [p.x, p.y, zFace + 0.04], p.color));
    }
    const artGeo = mergeParts(artParts);
    const artMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true });
    this.disposables.push(artGeo, artMat);
    this.northDecorMats.push(artMat);
    this.group.add(new THREE.Mesh(artGeo, artMat));

    // ── 서쪽 벽: 창 ──
    // 이쪽 벽은 투명해지지 않으므로 페이드에 엮지 않는다.
    const paneGeo = new THREE.BoxGeometry(0.04, 1.3, 2.2);
    paneGeo.translate(xFace, 1.75, -1.2);
    // 유리는 조명을 받으면 안 된다 — 스스로 밝아야 바깥이 있는 것처럼 보인다.
    const paneMat = new THREE.MeshBasicMaterial({ color: 0xcfe8f5 });
    this.disposables.push(paneGeo, paneMat);
    this.group.add(new THREE.Mesh(paneGeo, paneMat));

    // 창틀과 걸레받이. 움직이지도, 사라지지도 않으니 전부 한 덩어리로 둔다.
    const trimGeo = mergeParts([
      slab([0.06, 1.34, 0.07], [xFace + 0.03, 1.75, -1.2], 0xe8dcc0),
      slab([0.16, 0.1, 2.5], [xFace + 0.02, 1.03, -1.2], 0xe8dcc0),
      slab([0.16, 0.1, 2.5], [xFace + 0.02, 2.47, -1.2], 0xe8dcc0),
      slab([0.16, 1.5, 0.12], [xFace + 0.02, 1.75, -2.36], 0xe8dcc0),
      slab([0.16, 1.5, 0.12], [xFace + 0.02, 1.75, -0.04], 0xe8dcc0),
      slab([0.06, 0.16, ROOM_H], [xFace + 0.01, 0.08, 0], BASEBOARD_COLOR),
      slab([ROOM_W + t * 2, 0.16, 0.06], [0, 0.08, zFace + 0.01], BASEBOARD_COLOR),
    ]);
    const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(trimGeo, trimMat);
    this.group.add(new THREE.Mesh(trimGeo, trimMat));
  }

  private trackTexture<T extends THREE.Texture>(tex: T): T {
    this.textures.push(tex);
    return tex;
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
    // 액자만 남아 허공에 떠 있으면 벽이 사라졌다는 게 아니라 버그로 보인다.
    for (const m of this.northDecorMats) m.opacity = this.northOpacity;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const t of this.textures) t.dispose();
    this.disposables.length = 0;
    this.textures.length = 0;
    this.northDecorMats.length = 0;
    this.group.clear();
  }
}
