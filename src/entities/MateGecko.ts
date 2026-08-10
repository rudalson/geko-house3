/**
 * 짝 도마뱀. 상태를 읽어 반영만 한다. 단방향. (§0-4, §24)
 *
 * 메시는 시작 시 **한 번만** 만들고 보이기/숨기기만 한다. 등장할 때마다
 * 새로 만들면 한 판에 대여섯 번 geometry 가 생겼다 사라져 R5 감시에 걸린다.
 *
 * 플레이어와 같은 실루엣이되 색만 다르게 한다. 형태가 같아야 "같은 종"으로
 * 읽히고, 색이 달라야 인간·청소기처럼 **위협이 아니라는 것**이 한눈에 보인다.
 * 하트 링을 바닥에 깔아 "가도 되는 곳"임을 더 분명히 한다. (§17)
 */

import * as THREE from 'three';
import type { GameState } from '../core/GameState.ts';

const BODY_COLOR = 0xe58fb0;
const BELLY_COLOR = 0xffd9e6;
const EYE_WHITE = 0xffffff;
const PUPIL = 0x1a1a1a;
/** 플레이어와 같은 카툰 비율 */
const BASE_SCALE = 1.4;

export class MateGecko {
  readonly group = new THREE.Group();

  private readonly body: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly heart: THREE.Mesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private time = 0;

  constructor() {
    this.group.name = 'mate';
    this.group.visible = false;
    this.group.scale.setScalar(BASE_SCALE);

    const bodyMat = this.track(new THREE.MeshLambertMaterial({ color: BODY_COLOR }));
    const bellyMat = this.track(new THREE.MeshLambertMaterial({ color: BELLY_COLOR }));

    // 플레이어와 같은 비율을 쓴다. 여기만 통통하면 같은 종으로 안 읽힌다.
    const bodyGeo = this.track(new THREE.SphereGeometry(0.26, 10, 8));
    bodyGeo.scale(0.78, 0.55, 1.68);
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.position.y = 0.15;
    this.body.castShadow = true;
    this.group.add(this.body);

    const bellyGeo = this.track(new THREE.SphereGeometry(0.22, 10, 6));
    bellyGeo.scale(0.76, 0.34, 1.55);
    const belly = new THREE.Mesh(bellyGeo, bellyMat);
    belly.position.set(0, 0.1, 0.02);
    this.group.add(belly);

    // ── 머리 ── 플레이어와 같은 규약으로 −Z 를 정면으로 둔다.
    const head = new THREE.Group();
    head.position.set(0, 0.185, -0.38);
    this.group.add(head);

    const headGeo = this.track(new THREE.SphereGeometry(0.168, 10, 8));
    headGeo.scale(0.86, 0.88, 1.22);
    const headMesh = new THREE.Mesh(headGeo, bodyMat);
    headMesh.castShadow = true;
    head.add(headMesh);

    const eyeGeo = this.track(new THREE.SphereGeometry(0.075, 10, 8));
    const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: EYE_WHITE }));
    const pupilGeo = this.track(new THREE.SphereGeometry(0.04, 8, 6));
    const pupilMat = this.track(new THREE.MeshBasicMaterial({ color: PUPIL }));
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.102, 0.052, -0.072);
      head.add(eye);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(side * 0.107, 0.052, -0.13);
      head.add(pupil);
    }

    // ── 다리 ──
    const legGeo = this.track(new THREE.CapsuleGeometry(0.038, 0.12, 3, 6));
    for (const [ix, iz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(ix * 0.205, 0.08, iz * 0.25);
      leg.rotation.z = ix * 0.5;
      this.group.add(leg);
    }

    // ── 꼬리 ──
    const tailGeo = this.track(new THREE.SphereGeometry(0.088, 8, 6));
    tailGeo.scale(0.82, 0.78, 3.0);
    const tail = new THREE.Mesh(tailGeo, bodyMat);
    tail.position.set(0, 0.14, 0.48);
    tail.castShadow = true;
    this.group.add(tail);

    // ── 바닥 하트 링 — "여기 뭔가 있다" 를 멀리서도 알린다 ──
    const ringGeo = this.track(new THREE.RingGeometry(0.42, 0.56, 20));
    const ringMat = this.track(
      new THREE.MeshBasicMaterial({
        color: BODY_COLOR,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      }),
    );
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.012;
    this.group.add(this.ring);

    // 머리 위로 떠오르는 하트. 판판한 원뿔 두 개를 겹쳐 하트처럼 보이게 한다 —
    // 텍스처를 쓰지 않는 이 프로젝트에서 가장 싼 방법이다.
    const heartGeo = this.track(new THREE.SphereGeometry(0.09, 8, 6));
    heartGeo.scale(1.3, 1.1, 0.5);
    const heartMat = this.track(new THREE.MeshBasicMaterial({ color: 0xff5f8d }));
    this.heart = new THREE.Mesh(heartGeo, heartMat);
    this.heart.position.set(0, 0.62, -0.2);
    this.heart.rotation.z = Math.PI / 4;
    this.group.add(this.heart);
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    if (x instanceof THREE.BufferGeometry) this.geometries.push(x);
    else this.materials.push(x);
    return x;
  }

  update(state: GameState, dt: number): void {
    const mate = state.mate;
    if (!mate.active) {
      this.group.visible = false;
      return;
    }

    this.time += dt;
    this.group.visible = true;
    this.group.position.set(mate.pos.x, 0, mate.pos.z);

    // 플레이어 쪽을 바라본다. 등을 돌리고 있으면 상호작용 대상으로 안 읽힌다.
    // 머리가 로컬 −Z 라 반 바퀴 보정한다 (Gecko.MODEL_YAW 와 같은 사정).
    const dx = state.player.pos.x - mate.pos.x;
    const dz = state.player.pos.z - mate.pos.z;
    if (dx * dx + dz * dz > 1e-4) {
      this.group.rotation.y = Math.atan2(dx, dz) + Math.PI;
    }

    // 등장 직후 잠깐 커지며 나타난다 — 소리 없이 생겨나면 놓친다.
    const since = state.elapsed - mate.spawnedAt;
    const pop = Math.min(1, since / 0.35);
    this.group.scale.setScalar(BASE_SCALE * (0.4 + 0.6 * pop));

    // 숨쉬기와 하트 두둥실
    this.body.position.y = 0.15 + Math.sin(this.time * 2.4) * 0.008;
    this.heart.position.y = 0.62 + Math.sin(this.time * 2.0) * 0.06;
    this.heart.rotation.z = Math.PI / 4 + Math.sin(this.time * 1.5) * 0.15;

    const s = 1 + Math.sin(this.time * 3.4) * 0.12;
    this.ring.scale.set(s, s, 1);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.group.clear();
  }
}
