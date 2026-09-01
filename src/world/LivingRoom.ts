/**
 * 거실 바닥과 벽. 상태를 읽어 화면에 반영만 한다. (§0-4)
 *
 * 1인칭 전환(§25)으로 이 파일의 전제가 뒤집혔다. 쿼터뷰는 남동쪽 위에서
 * 내려다보므로 남·동쪽 벽을 세우면 캐릭터가 가려져서, 그쪽은 걸레받이만
 * 두고 **일부러 뚫어 놨었다.** 1인칭에서는 그 방향을 그냥 쳐다보게 되고,
 * 그러면 벽 대신 씬 배경색(허공)이 보인다. 방을 사방으로 닫는다.
 *
 * 천장도 같은 이유로 덮는다. 눈높이 0.34 에 화각 78도라 조금만 가까이 가도
 * 벽 위쪽 끝(3.0)이 화면에 들어온다.
 */

import * as THREE from 'three';
import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import type { Disposable } from './Furniture.ts';
import { findFurniture } from './furnitureLayout.ts';
import { FLOOR_TILE, makeFloorTexture, makeRugTexture } from './roomTextures.ts';
import { mergeParts, paint } from './vertexPaint.ts';

const WALL_COLOR = 0xf2e3c4;
const BASEBOARD_COLOR = 0xcbb08a;
// 천장은 벽보다 밝게. 아래에서 올려다보면 조명을 거의 못 받아 어차피 어두워진다.
const CEILING_COLOR = 0xfff6e2;

export class LivingRoom implements Disposable {
  readonly group = new THREE.Group();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly textures: THREE.Texture[] = [];

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
    // 사방을 다 세운다. 1인칭이라 어느 쪽을 봐도 방 안이어야 한다. (§25)
    const wallMat = new THREE.MeshLambertMaterial({ color: WALL_COLOR });
    this.disposables.push(wallMat);

    /** 벽 한 장. 안쪽 면이 보이도록 두께를 방 바깥으로 뺀다. */
    const wall = (
      size: readonly [number, number, number],
      at: readonly [number, number, number],
    ): void => {
      const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.position.set(at[0], at[1], at[2]);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geo);
    };

    // 북쪽 벽만 **문간을 비워 둔다.** 화장실이 이 너머에 있어서, 통째로 막으면
    // 화장실 쪽에서 봤을 때 복도가 벽으로 끝나 버린다. 거실 쪽에서는 문짝
    // 메시(furnitureLayout 의 `bathroom-door`, z −5.85)가 이 구멍을 가린다.
    const door = findFurniture('bathroom-door');
    const doorW = door?.w ?? 1.6;
    const doorH = door?.h ?? 2.0;
    const doorX = door?.x ?? 0.5;
    const northZ = -ROOM_H / 2 - t / 2;
    const northSpan = ROOM_W + t * 2;
    const leftW = doorX - doorW / 2 - -(northSpan / 2);
    const rightW = northSpan / 2 - (doorX + doorW / 2);

    if (leftW > 0) wall([leftW, wallH, t], [-northSpan / 2 + leftW / 2, wallH / 2, northZ]);
    if (rightW > 0) wall([rightW, wallH, t], [northSpan / 2 - rightW / 2, wallH / 2, northZ]);
    // 문간 위 인방
    wall([doorW, wallH - doorH, t], [doorX, doorH + (wallH - doorH) / 2, northZ]);

    wall([ROOM_W + t * 2, wallH, t], [0, wallH / 2, ROOM_H / 2 + t / 2]); // 남
    wall([t, wallH, ROOM_H], [-ROOM_W / 2 - t / 2, wallH / 2, 0]); // 서
    wall([t, wallH, ROOM_H], [ROOM_W / 2 + t / 2, wallH / 2, 0]); // 동

    // ── 천장 ──
    // 그림자를 드리우면 안 된다 (castShadow 기본 false). 키 라이트가 위에
    // 있어서 천장이 그림자를 던지면 방 전체가 통째로 어두워진다.
    const ceilGeo = new THREE.PlaneGeometry(ROOM_W + t * 2, ROOM_H + t * 2);
    const ceilMat = new THREE.MeshLambertMaterial({ color: CEILING_COLOR });
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2; // 아래를 향한다
    ceiling.position.y = wallH;
    this.group.add(ceiling);
    this.disposables.push(ceilGeo, ceilMat);

    // ── 걸레받이 ──
    // 벽과 바닥이 만나는 선. 눈높이가 낮을수록 이 선이 거리감의 기준이 된다.
    const baseMat = new THREE.MeshLambertMaterial({ color: BASEBOARD_COLOR });
    this.disposables.push(baseMat);

    /** 걸레받이 한 줄 */
    const base = (
      size: readonly [number, number, number],
      at: readonly [number, number, number],
    ): void => {
      const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
      const mesh = new THREE.Mesh(geo, baseMat);
      mesh.position.set(at[0], at[1], at[2]);
      this.group.add(mesh);
      this.disposables.push(geo);
    };

    const bh = 0.16; // 걸레받이 높이
    base([ROOM_W, bh, 0.08], [0, bh / 2, -ROOM_H / 2 + 0.04]);
    base([ROOM_W, bh, 0.08], [0, bh / 2, ROOM_H / 2 - 0.04]);
    base([0.08, bh, ROOM_H], [-ROOM_W / 2 + 0.04, bh / 2, 0]);
    base([0.08, bh, ROOM_H], [ROOM_W / 2 - 0.04, bh / 2, 0]);

    this.addWallDecor();
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
   * 1인칭에서는 이게 장식 이상의 일을 한다. 사방이 같은 크림색 벽이면
   * 어느 쪽을 보고 있는지 알 수 없다 — 액자가 걸린 벽이 북쪽, 창이 있는
   * 벽이 서쪽이라는 것 자체가 **방향 감각의 유일한 단서**다. (§25)
   */
  private addWallDecor(): void {
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

    const zBack = ROOM_H / 2 - 0.02;
    const xBack = ROOM_W / 2 - 0.02;

    // ── 북쪽 벽: 액자 세 점 ──
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
    const artMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(artGeo, artMat);
    this.group.add(new THREE.Mesh(artGeo, artMat));

    // ── 서쪽 벽: 창 ──
    const paneGeo = new THREE.BoxGeometry(0.04, 1.3, 2.2);
    paneGeo.translate(xFace, 1.75, -1.2);
    // 유리는 조명을 받으면 안 된다 — 스스로 밝아야 바깥이 있는 것처럼 보인다.
    const paneMat = new THREE.MeshBasicMaterial({ color: 0xcfe8f5 });
    this.disposables.push(paneGeo, paneMat);
    this.group.add(new THREE.Mesh(paneGeo, paneMat));

    // ── 남쪽 벽: 벽시계 ──
    // 남쪽은 TV장 말고는 비어 있다. 뒤를 돌아봤을 때 "여긴 아까 그 벽이다" 를
    // 알려 줄 물건이 하나는 필요하다.
    const clock: THREE.BufferGeometry[] = [
      slab([0.62, 0.62, 0.05], [1.4, 1.9, zBack], 0x8a6b4a),
      slab([0.5, 0.5, 0.02], [1.4, 1.9, zBack - 0.04], 0xfdf6e6),
      slab([0.04, 0.22, 0.02], [1.4, 1.99, zBack - 0.06], 0x2b2118),
      slab([0.16, 0.04, 0.02], [1.47, 1.9, zBack - 0.06], 0x2b2118),
    ];

    // ── 동쪽 벽: 세로 배너 ──
    // 책장(x 7.5)이 이 벽을 절반쯤 가리므로 남는 위쪽에 길게 건다.
    const banner: THREE.BufferGeometry[] = [
      slab([0.05, 1.6, 0.7], [xBack, 2.0, 3.2], 0xb8734a),
      slab([0.02, 1.4, 0.54], [xBack - 0.04, 2.0, 3.2], 0xe8c37a),
    ];

    // 창틀과 나머지 벽 장식. 움직이지도 사라지지도 않으니 전부 한 덩어리로 둔다.
    const trimGeo = mergeParts([
      slab([0.06, 1.34, 0.07], [xFace + 0.03, 1.75, -1.2], 0xe8dcc0),
      slab([0.16, 0.1, 2.5], [xFace + 0.02, 1.03, -1.2], 0xe8dcc0),
      slab([0.16, 0.1, 2.5], [xFace + 0.02, 2.47, -1.2], 0xe8dcc0),
      slab([0.16, 1.5, 0.12], [xFace + 0.02, 1.75, -2.36], 0xe8dcc0),
      slab([0.16, 1.5, 0.12], [xFace + 0.02, 1.75, -0.04], 0xe8dcc0),
      ...clock,
      ...banner,
    ]);
    const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(trimGeo, trimMat);
    this.group.add(new THREE.Mesh(trimGeo, trimMat));
  }

  private trackTexture<T extends THREE.Texture>(tex: T): T {
    this.textures.push(tex);
    return tex;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const t of this.textures) t.dispose();
    this.disposables.length = 0;
    this.textures.length = 0;
    this.group.clear();
  }
}
