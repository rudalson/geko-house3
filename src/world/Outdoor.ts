/**
 * 미션 2 — 야외 캠프장의 땅·울타리·숲·모닥불. 상태를 읽어 화면에 반영만 한다. (§0-4)
 *
 * 거실의 `LivingRoom` + `Bathroom` + `Decor` 자리를 이 클래스 하나가 맡는다.
 * 충돌하는 소품(텐트·바위·통나무…)은 여기 없다 — 그건 `outdoorLayout.ts` 에서
 * 파생되어 `Furniture` 가 그린다 (§0-2). 여기 있는 것은 전부 **아무것도 막지 않는**
 * 배경이다.
 *
 * ## 벽 대신 울타리
 * 이동 범위는 거실과 같은 20 x 15 사각형이다 (`CollisionMap.bounds`). 거실에서는
 * 벽이 그 경계를 보여 줬는데, 바깥에서 벽을 세우면 방이 된다. 그래서 경계에
 * **울타리**를 두르고 그 너머를 숲으로 채운다. 눈높이(0.34)에서 울타리 높이(0.8)는
 * 넘을 수 없는 벽으로 읽히면서도 너머의 숲이 보여 "밖" 이라는 게 전해진다.
 *
 * ## 바닥에는 놓지 않는다
 * 마당 안 잔디에는 풀포기 하나 심지 않는다. 이유는 `Decor.ts` 머리말과 같다 —
 * 승패가 바닥 점유율로 갈리는 게임이라 바닥 판독을 흐리는 장식은 마당 **밖**에만 둔다.
 */

import * as THREE from 'three';
import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import { Rng } from '../core/Rng.ts';
import type { Disposable } from './Furniture.ts';
import { addKitProps, buildKitProps, type PropSpec } from './kitProps.ts';
import { FLOOR_TILE, makeGrassTexture } from './roomTextures.ts';
import type { StageDef } from './stages.ts';

/** 하늘색. 안개도 같은 색이라 들판 끝이 하늘에 녹아든다. */
export const OUTDOOR_SKY = 0xa8d8f0;

const LAWN_LIGHT = 0x88bf5c;
const LAWN_DARK = 0x679f48;
const FIELD_LIGHT = 0x6a9c48;
const FIELD_DARK = 0x4c8038;

/** 울타리 한 칸의 길이·높이 (world units) */
const FENCE_LEN = 1.0;
const FENCE_H = 0.8;
/** 울타리를 경계에서 바깥으로 띄우는 거리 — 마당 가장자리 셀을 덮지 않게 */
const FENCE_OUT = 0.08;

/** 바깥 들판의 한 변 (world units). 안개 끝(`fogFar`)보다 넉넉해야 가장자리가 안 보인다. */
const FIELD_SIZE = 160;
export const OUTDOOR_FOG_NEAR = 16;
export const OUTDOOR_FOG_FAR = 62;

/** 숲을 심는 시드. 판마다 바뀌면 같은 시드가 같은 판을 만들지 않는다 (§0-5). */
const FOREST_SEED = 0x7f3e5a11;

const TREE_MODELS = ['tree', 'tree-tall', 'tree-autumn', 'tree-autumn-tall'] as const;
/** 나무 높이 / 수관 폭. 키트 원본은 2.6~3.1 인데 조금 눌러 게코 눈높이의 하늘을 남긴다. */
export const TREE_ASPECT = 2.3;
const ROCK_MODELS = ['rock-a', 'rock-b', 'rock-c'] as const;

/**
 * 모닥불 불꽃. 원뿔을 겹쳐 세우지 않고 **혀 여러 개**로 흩어 세운다 —
 * 같은 중심에 겹치면 가장 큰 바깥 원뿔이 안쪽을 다 덮어서 주황 고깔 하나로 보인다.
 * 가운데 노란 혀를 가장 높게 둬야 바깥 주황 위로 솟는다.
 *
 * `[각도, 중심에서 거리(모닥불 폭 배수), 반지름, 높이, 색]`
 */
const FLAME_TONGUES: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0.09, 0.62, 0xffe27a],
  [0.3, 0.07, 0.11, 0.46, 0xffa733],
  [2.4, 0.07, 0.11, 0.42, 0xffa733],
  [4.4, 0.07, 0.1, 0.44, 0xffa733],
  [1.3, 0.13, 0.08, 0.3, 0xff6a1f],
  [3.5, 0.13, 0.08, 0.27, 0xff6a1f],
  [5.4, 0.12, 0.07, 0.3, 0xff6a1f],
];

/** 이 파일이 쓰는 키트 모델 전부. `preloadKit()` 에 넘긴다. */
export function outdoorDecorModelNames(): string[] {
  return ['fence', 'fence-doorway', 'grass', 'grass-large', 'rock-flat-grass', ...TREE_MODELS, ...ROCK_MODELS];
}

/** 경계를 따라 울타리 한 바퀴. 남쪽(+z) 가운데에만 쪽문을 낸다. */
function fenceProps(): PropSpec[] {
  const hw = DERIVED.ROOM_W / 2;
  const hd = DERIVED.ROOM_H / 2;
  const out: PropSpec[] = [];

  /** 한 변. `at(i)` 는 i 번째 칸의 중심 (x, z), `gate` 는 쪽문을 낼 칸 번호다. */
  const side = (count: number, at: (i: number) => [number, number], yaw: number, gate = -1): void => {
    for (let i = 0; i < count; i++) {
      const [x, z] = at(i);
      out.push({
        model: i === gate ? 'fence-doorway' : 'fence',
        at: [x, 0, z],
        // 모델은 x 로 길고 z 로 얇다. 크기는 회전 **전** 모델 축이다 (`kitProps.ts`).
        size: [FENCE_LEN, FENCE_H, 0.08],
        yaw,
      });
    }
  };

  const nx = Math.round(DERIVED.ROOM_W / FENCE_LEN);
  const nz = Math.round(DERIVED.ROOM_H / FENCE_LEN);
  side(nx, (i) => [-hw + (i + 0.5) * FENCE_LEN, -hd - FENCE_OUT], 0);
  side(nx, (i) => [-hw + (i + 0.5) * FENCE_LEN, hd + FENCE_OUT], Math.PI, Math.floor(nx / 2));
  side(nz, (i) => [-hw - FENCE_OUT, -hd + (i + 0.5) * FENCE_LEN], Math.PI / 2);
  side(nz, (i) => [hw + FENCE_OUT, -hd + (i + 0.5) * FENCE_LEN], -Math.PI / 2);
  return out;
}

/**
 * 울타리 바깥의 숲·바위·풀. 시드 고정이라 판마다 같은 숲이다.
 *
 * 울타리 바로 바깥 띠는 비워 둔다. 나무가 울타리에 붙어 있으면 수관이 마당
 * 안으로 넘어와 1인칭에서 하늘을 가리고, 울타리가 숲에 파묻혀 경계가 안 읽힌다.
 */
function forestProps(): PropSpec[] {
  const rng = new Rng(FOREST_SEED);
  const hw = DERIVED.ROOM_W / 2;
  const hd = DERIVED.ROOM_H / 2;
  const out: PropSpec[] = [];

  /** 마당 사각형 바깥으로 얼마나 떨어져 있는지 (안이면 0) */
  const outside = (x: number, z: number): number =>
    Math.hypot(Math.max(Math.abs(x) - hw, 0), Math.max(Math.abs(z) - hd, 0));

  const scatter = (count: number, minGap: number, maxGap: number, make: (x: number, z: number) => PropSpec): void => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = rng.range(-hw - maxGap, hw + maxGap);
      const z = rng.range(-hd - maxGap, hd + maxGap);
      const gap = outside(x, z);
      if (gap < minGap || gap > maxGap) continue;
      out.push(make(x, z));
      placed++;
    }
  };

  // 가까운 띠는 듬성듬성, 먼 띠는 빽빽하게 — 안개 속으로 숲이 이어지는 것처럼.
  const tree = (x: number, z: number): PropSpec => {
    const s = rng.range(0.85, 1.35);
    const spread = 2.4 * s;
    return {
      model: rng.pick(TREE_MODELS),
      at: [x, 0, z],
      // 모델 비율(높이 ≈ 폭 x 2.6)에 가깝게 둔다. 거실 가구처럼 세로로 누르면
      // 수관이 옆으로 퍼진 버섯이 된다 — 바깥에는 눌러야 할 천장이 없다.
      size: [spread, spread * TREE_ASPECT, spread],
      yaw: rng.range(0, Math.PI * 2),
    };
  };
  scatter(34, 2.2, 7, tree);
  scatter(70, 7, 24, tree);

  scatter(18, 0.9, 9, (x, z) => {
    const s = rng.range(0.6, 1.5);
    return { model: rng.pick(ROCK_MODELS), at: [x, 0, z], size: [s, s * 0.55, s], yaw: rng.range(0, 6.28) };
  });
  scatter(5, 1.5, 8, (x, z) => ({
    model: 'rock-flat-grass',
    at: [x, 0, z],
    size: [2.4, 0.3, 2.0],
    yaw: rng.range(0, 6.28),
  }));
  // 풀포기 — 울타리 바로 바깥 띠에 몰아 심어 울타리 아래가 휑하지 않게 한다.
  scatter(90, 0.25, 3.5, (x, z) => {
    const big = rng.chance(0.35);
    const s = rng.range(0.5, 0.9) * (big ? 1.6 : 1);
    return {
      model: big ? 'grass-large' : 'grass',
      at: [x, 0, z],
      size: [s, s * 0.45, s],
      yaw: rng.range(0, 6.28),
    };
  });
  return out;
}

export class Outdoor implements Disposable {
  readonly group = new THREE.Group();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly textures: THREE.Texture[] = [];

  /** 모닥불 불꽃과 불빛. 모닥불이 없는 배치면 비어 있다. */
  private readonly flames: THREE.Mesh[] = [];
  private fireLight: THREE.PointLight | null = null;
  private time = 0;

  constructor(stage: StageDef) {
    this.group.name = 'outdoor';
    const track = (x: THREE.BufferGeometry | THREE.Material): void => {
      this.disposables.push(x);
    };

    this.addGround();
    this.addCampfire(stage);

    addKitProps(this.group, buildKitProps(fenceProps()), track, { name: 'fence', castShadow: true });
    addKitProps(this.group, buildKitProps(forestProps()), track, { name: 'forest', castShadow: true });
  }

  private addGround(): void {
    const { ROOM_W, ROOM_H } = DERIVED;

    // ── 마당 잔디 ──
    // 똥 땅 격자(InstancedMesh)가 이 위에 얹히므로 살짝 아래에 둔다. (`LivingRoom` 과 같다)
    const lawnTex = this.trackTexture(makeGrassTexture(LAWN_LIGHT, LAWN_DARK, true));
    lawnTex.repeat.set(ROOM_W / FLOOR_TILE, ROOM_H / FLOOR_TILE);
    this.plane(ROOM_W, ROOM_H, new THREE.MeshLambertMaterial({ map: lawnTex }), -0.01, 'lawn');

    // ── 바깥 들판 ── 마당보다 조금 더 내려 겹치는 곳에서 지글거리지 않게 한다.
    const fieldTex = this.trackTexture(makeGrassTexture(FIELD_LIGHT, FIELD_DARK, false));
    fieldTex.repeat.set(FIELD_SIZE / FLOOR_TILE, FIELD_SIZE / FLOOR_TILE);
    this.plane(FIELD_SIZE, FIELD_SIZE, new THREE.MeshLambertMaterial({ map: fieldTex }), -0.03, 'field');

    // ── 셀 격자선 ── 거실 마루처럼 옅게. 잔디 줄무늬만으로는 셀 정렬이 안 읽힌다.
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
    const gridMat = new THREE.LineBasicMaterial({ color: 0xd9f2b0, transparent: true, opacity: 0.12 });
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.y = 0.002;
    this.group.add(grid);
    this.disposables.push(gridGeo, gridMat);
  }

  private plane(w: number, d: number, mat: THREE.Material, y: number, name: string): void {
    const geo = new THREE.PlaneGeometry(w, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    mesh.name = name;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  /**
   * 모닥불 불꽃과 불빛. 자리는 배치의 `campfire` 에서 파생시킨다 (§0-2) —
   * 모닥불을 옮기면 불도 따라간다.
   *
   * 불꽃은 키트에 없어 원뿔 세 개로 만든다. 조명을 받지 않는 재질이라 그늘에서도
   * 밝고, 크기만 흔들어 타오르는 것처럼 보이게 한다 (`update`).
   */
  private addCampfire(stage: StageDef): void {
    const fire = stage.find('campfire');
    if (!fire) return;

    const base = fire.h * 0.45;
    FLAME_TONGUES.forEach(([angle, off, r, h, color], i) => {
      const geo = new THREE.ConeGeometry(r, h, 6);
      geo.translate(0, h / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color });
      const flame = new THREE.Mesh(geo, mat);
      flame.position.set(
        fire.x + Math.cos(angle) * off * fire.w,
        base,
        fire.z + Math.sin(angle) * off * fire.w,
      );
      flame.name = `campfire-flame-${i}`;
      this.group.add(flame);
      this.flames.push(flame);
      this.disposables.push(geo, mat);
    });

    const light = new THREE.PointLight(0xffa04a, 9, 7, 2);
    light.position.set(fire.x, base + 0.6, fire.z);
    this.group.add(light);
    this.fireLight = light;
  }

  /** 불꽃이 흔들린다. 연출 전용이라 렌더 델타로 돈다. */
  update(dt: number): void {
    if (this.flames.length === 0) return;
    this.time += dt;
    const t = this.time;
    this.flames.forEach((flame, i) => {
      const k = 1 + Math.sin(t * (9 + i * 3.1) + i) * 0.16 + Math.sin(t * 23 + i * 2) * 0.06;
      flame.scale.set(1 + (k - 1) * 0.4, k, 1 + (k - 1) * 0.4);
      flame.rotation.y = t * (0.6 + i * 0.4);
    });
    if (this.fireLight) {
      this.fireLight.intensity = 9 * (0.85 + Math.sin(t * 11) * 0.08 + Math.sin(t * 27) * 0.05);
    }
  }

  private trackTexture<T extends THREE.Texture>(tex: T): T {
    this.textures.push(tex);
    return tex;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const t of this.textures) t.dispose();
    this.fireLight?.dispose();
    this.fireLight = null;
    this.disposables.length = 0;
    this.textures.length = 0;
    this.flames.length = 0;
    this.group.clear();
  }
}
