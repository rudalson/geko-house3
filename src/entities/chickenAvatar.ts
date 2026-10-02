/**
 * 닭 — 미션 2(야외)에서 인간 적 자리를 맡는다. (§24)
 *
 * 로직은 인간과 **완전히 같다** (`HumanSystem` — 어슬렁거리다 발견하면 격자 경로로
 * 쫓아오고, 잠깐 쫓다가 포기한다). 캠프장 마당에 집주인이 쫓아오는 것보다
 * 닭이 쫓아오는 게 자연스럽다 — 닭은 실제로 도마뱀을 쪼아 먹는다. 사냥/휴식
 * 주기도 "모이를 쪼다가 문득 고개를 드는" 닭의 리듬으로 그대로 읽힌다.
 *
 * `HumanAvatar` 와 같은 인터페이스라 `Human.ts` 가 위치·회전·말풍선을 그대로 맡는다.
 * 여기는 몸과 동작만 책임진다. 앞은 사람과 같이 로컬 +z 다.
 *
 * 키트에 닭이 없어서 로우폴리로 직접 만든다. 키는 1.1 쯤 — 게코 눈높이(0.34)에서
 * 올려다보는 거대한 새가 된다.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/GameConfig.ts';
import type { HumanState } from '../core/GameState.ts';
import type { HumanAvatar } from './humanAvatar.ts';

/**
 * 깃털 색. 시스템이 시드 난수로 정한 `look` 을 여기서 접는다 —
 * 사람이 얼굴 3종을 고르는 것과 같은 규칙이다 (`humanAvatar.ts` 머리말).
 */
const PLUMAGE = [0xf3eee2, 0xb8692f, 0x3c3634] as const;
const COMB = 0xd8322b;
const BEAK = 0xf2b33d;
const LEG = 0xe8973a;

/** 이 정도보다 느리면 서 있는 것으로 본다 (world units/s) */
const IDLE_SPEED = 0.15;

export class ChickenAvatar implements HumanAvatar {
  readonly object = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /** 깃털 색별 재질. 플레이 중에 만들지 않도록 미리 만들어 둔다 (§8) */
  private readonly plumage: THREE.MeshLambertMaterial[];
  private readonly feathered: THREE.Mesh[] = [];

  /** 다리 위 전부 — 걸을 때 들썩이고 쫓을 때 앞으로 기운다 */
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly wings: THREE.Group[] = [];

  private phase = 0;
  private time = 0;

  constructor() {
    this.plumage = PLUMAGE.map((c) => this.mat(new THREE.MeshLambertMaterial({ color: c, flatShading: true })));
    const comb = this.mat(new THREE.MeshLambertMaterial({ color: COMB, flatShading: true }));
    const beak = this.mat(new THREE.MeshLambertMaterial({ color: BEAK, flatShading: true }));
    const leg = this.mat(new THREE.MeshLambertMaterial({ color: LEG }));
    const eye = this.mat(new THREE.MeshBasicMaterial({ color: 0x141414 }));

    const feather = (geo: THREE.BufferGeometry, parent: THREE.Object3D, at: readonly [number, number, number]): THREE.Mesh => {
      const m = new THREE.Mesh(geo, this.plumage[0]);
      m.position.set(...at);
      m.castShadow = true;
      parent.add(m);
      this.feathered.push(m);
      return m;
    };
    const part = (
      geo: THREE.BufferGeometry,
      material: THREE.Material,
      parent: THREE.Object3D,
      at: readonly [number, number, number],
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(...at);
      parent.add(m);
      return m;
    };

    // ── 다리 ── 원점이 엉덩이 관절이라 그대로 돌리면 걷는 동작이 된다.
    const shinGeo = this.geo(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 5));
    shinGeo.translate(0, -0.18, 0);
    const footGeo = this.geo(new THREE.BoxGeometry(0.12, 0.02, 0.16));
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, 0.36, 0);
      part(shinGeo, leg, hip, [0, 0, 0]);
      part(footGeo, leg, hip, [0, -0.35, 0.04]);
      this.object.add(hip);
      this.legs.push(hip);
    }

    // ── 몸통 ──
    this.torso.position.y = 0.36;
    this.object.add(this.torso);

    const bodyGeo = this.geo(new THREE.SphereGeometry(1, 10, 8));
    bodyGeo.scale(0.3, 0.27, 0.38);
    feather(bodyGeo, this.torso, [0, 0.24, 0]).rotation.x = -0.15;

    // 꽁지 — 뒤로 치켜든 깃털 다발
    const tailGeo = this.geo(new THREE.ConeGeometry(0.17, 0.36, 5));
    tailGeo.rotateX(-2.4);
    feather(tailGeo, this.torso, [0, 0.42, -0.36]);

    // 날개 — 몸통 옆에 붙인다. 원점이 어깨라 z 축으로 돌리면 퍼덕인다.
    const wingGeo = this.geo(new THREE.SphereGeometry(1, 8, 6));
    wingGeo.scale(0.05, 0.17, 0.27);
    wingGeo.translate(0, -0.12, 0);
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.28, 0.36, -0.02);
      shoulder.scale.x = side;
      feather(wingGeo, shoulder, [0, 0, 0]);
      this.torso.add(shoulder);
      this.wings.push(shoulder);
    }

    // ── 머리 ── 목 위에 얹는다. 걸을 때 앞뒤로 까딱인다 (닭 특유의 고개질).
    this.head.position.set(0, 0.58, 0.26);
    this.torso.add(this.head);

    const neckGeo = this.geo(new THREE.CylinderGeometry(0.1, 0.14, 0.26, 7));
    feather(neckGeo, this.head, [0, -0.1, -0.02]).rotation.x = 0.3;
    const headGeo = this.geo(new THREE.SphereGeometry(0.14, 8, 6));
    feather(headGeo, this.head, [0, 0.08, 0.02]);

    const beakGeo = this.geo(new THREE.ConeGeometry(0.05, 0.13, 4));
    beakGeo.rotateX(Math.PI / 2);
    part(beakGeo, beak, this.head, [0, 0.05, 0.19]);

    // 볏과 육수 — 정면에서 봤을 때 "닭" 으로 읽히는 건 거의 이 빨간 조각들이다.
    const combGeo = this.geo(new THREE.SphereGeometry(0.05, 6, 4));
    for (const [z, y] of [
      [-0.04, 0.22],
      [0.03, 0.24],
      [0.09, 0.21],
    ] as const) {
      part(combGeo, comb, this.head, [0, y, z]).scale.set(0.6, 1, 1);
    }
    const wattleGeo = this.geo(new THREE.SphereGeometry(0.04, 6, 4));
    part(wattleGeo, comb, this.head, [0, -0.04, 0.15]).scale.set(0.7, 1.4, 0.7);

    const eyeGeo = this.geo(new THREE.SphereGeometry(0.022, 6, 4));
    for (const side of [-1, 1]) part(eyeGeo, eye, this.head, [side * 0.11, 0.11, 0.08]);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  setLook(look: number): void {
    const n = this.plumage.length;
    const mat = this.plumage[((look % n) + n) % n]!;
    for (const m of this.feathered) m.material = mat;
  }

  update(state: HumanState, speed: number, dt: number): void {
    this.time += dt;
    const walking = speed > IDLE_SPEED;
    const chasing = state.mode === 'chase';

    // 걸음 — 실제 이동 속도에 맞춘다 (사람 아바타와 같은 규칙: 미끄러지지 않게).
    if (walking) this.phase += dt * (4 + (speed / CONFIG.HUMAN_SPEED) * 10);
    const stride = walking ? (chasing ? 0.7 : 0.45) : 0;
    this.legs.forEach((hip, k) => {
      hip.rotation.x = Math.sin(this.phase + k * Math.PI) * stride;
    });
    this.torso.position.y = 0.36 + (walking ? Math.abs(Math.sin(this.phase)) * 0.035 : 0);

    // 고개질 — 걸을 땐 걸음에 맞춰 까딱이고, 서 있으면 가끔 땅을 쫀다.
    let peck = 0;
    if (walking) {
      peck = Math.max(0, Math.sin(this.phase * 2)) * 0.06;
    } else {
      const cycle = this.time % 2.6;
      if (cycle < 0.35) peck = Math.sin((cycle / 0.35) * Math.PI) * 0.3;
    }
    this.head.position.z = 0.26 + peck;
    this.head.position.y = 0.58 - peck * 1.2;

    // 쫓을 때는 앞으로 숙이고 날개를 퍼덕인다 — 추격 중임이 멀리서도 읽혀야 한다.
    this.torso.rotation.x = chasing ? 0.28 : 0;
    const flap = chasing ? 0.35 + Math.abs(Math.sin(this.time * 22)) * 0.7 : 0.05;
    // 왼쪽 날개는 거울상(scale.x = −1)이라 같은 각을 주면 한쪽은 안으로 접힌다.
    for (const w of this.wings) w.rotation.z = flap * w.scale.x;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.feathered.length = 0;
    this.legs.length = 0;
    this.wings.length = 0;
    this.object.clear();
  }
}
