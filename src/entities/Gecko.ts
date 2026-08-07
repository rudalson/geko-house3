/**
 * 도마뱀 캐릭터. GameState 를 **읽어서** 메시에 반영만 한다. 단방향. (§0-4)
 *
 * 스켈레탈 애니메이션 대신 부위별 회전·위치 변화로 처리한다 (§5).
 * 머리 / 몸통 / 네 다리 / 꼬리 / 큰 눈 을 각각 별도 오브젝트로 들고 있어야
 * 걷기·먹기·배변·피격 모션을 코드로 만들 수 있다.
 */

import * as THREE from 'three';
import type { GameState } from '../core/GameState.ts';
import { CONFIG } from '../core/GameConfig.ts';
import { Stance } from '../core/types.ts';

const BODY_COLOR = 0x7cc86a;
const BELLY_COLOR = 0xd8f0b0;
const EYE_WHITE = 0xffffff;
const PUPIL = 0x1a1a1a;

/**
 * 도마뱀 기본 크기 배율.
 * 실제 도마뱀 비율로 두면 16x12m 거실에서 너무 작아 화면에서 읽히지 않는다.
 * 카툰 비율로 키운다.
 */
const BASE_SCALE = 1.4;

export type GeckoMotion = 'idle' | 'walk' | 'eat' | 'poop' | 'hurt' | 'hide';

export class Gecko {
  readonly group = new THREE.Group();

  private readonly body: THREE.Mesh;
  private readonly head: THREE.Group;
  private readonly tail: THREE.Group;
  private readonly legs: THREE.Mesh[] = [];
  private readonly eyes: THREE.Group[] = [];
  private readonly pupils: THREE.Mesh[] = [];

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  /** 걷기 위상. 실제로 움직인 거리에 비례해 증가시켜 발이 미끄러지지 않게 한다. */
  private walkPhase = 0;
  private motionTime = 0;
  private motion: GeckoMotion = 'idle';

  constructor() {
    this.group.name = 'gecko';

    const bodyMat = this.track(new THREE.MeshLambertMaterial({ color: BODY_COLOR }));
    const bellyMat = this.track(new THREE.MeshLambertMaterial({ color: BELLY_COLOR }));

    // ── 몸통 ──
    const bodyGeo = this.track(new THREE.SphereGeometry(0.28, 10, 8));
    bodyGeo.scale(1.0, 0.62, 1.45);
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.position.y = 0.17;
    this.body.castShadow = true;
    this.group.add(this.body);

    const bellyGeo = this.track(new THREE.SphereGeometry(0.24, 10, 6));
    bellyGeo.scale(1.0, 0.4, 1.35);
    const belly = new THREE.Mesh(bellyGeo, bellyMat);
    belly.position.set(0, 0.11, 0.02);
    this.group.add(belly);

    // ── 머리 ──
    this.head = new THREE.Group();
    this.head.position.set(0, 0.2, -0.36);
    this.group.add(this.head);

    const headGeo = this.track(new THREE.SphereGeometry(0.2, 10, 8));
    headGeo.scale(1.0, 0.82, 1.15);
    const headMesh = new THREE.Mesh(headGeo, bodyMat);
    headMesh.castShadow = true;
    this.head.add(headMesh);

    const snoutGeo = this.track(new THREE.SphereGeometry(0.11, 8, 6));
    snoutGeo.scale(1.0, 0.7, 1.2);
    const snout = new THREE.Mesh(snoutGeo, bodyMat);
    snout.position.set(0, -0.03, -0.17);
    this.head.add(snout);

    // ── 큰 눈 (좌/우) ──
    const eyeWhiteGeo = this.track(new THREE.SphereGeometry(0.085, 10, 8));
    const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: EYE_WHITE }));
    const pupilGeo = this.track(new THREE.SphereGeometry(0.045, 8, 6));
    const pupilMat = this.track(new THREE.MeshBasicMaterial({ color: PUPIL }));

    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.115, 0.06, -0.08);
      this.head.add(eye);

      const white = new THREE.Mesh(eyeWhiteGeo, eyeMat);
      eye.add(white);

      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(side * 0.015, 0, -0.055);
      eye.add(pupil);

      this.eyes.push(eye);
      this.pupils.push(pupil);
    }

    // ── 다리 4개 ──
    const legGeo = this.track(new THREE.CapsuleGeometry(0.045, 0.12, 3, 6));
    for (const [ix, iz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(ix * 0.24, 0.09, iz * 0.22);
      leg.rotation.z = ix * 0.5;
      leg.castShadow = true;
      this.group.add(leg);
      this.legs.push(leg);
    }

    // ── 꼬리 (마디 4개로 흔들림 표현) ──
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0.16, 0.36);
    this.group.add(this.tail);

    let parent: THREE.Object3D = this.tail;
    for (let i = 0; i < 4; i++) {
      const r = 0.11 - i * 0.022;
      const segGeo = this.track(new THREE.SphereGeometry(r, 8, 6));
      segGeo.scale(1, 0.8, 1.5);
      const seg = new THREE.Mesh(segGeo, bodyMat);
      seg.position.z = i === 0 ? 0.06 : 0.13;
      seg.castShadow = true;
      parent.add(seg);
      parent = seg;
    }
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    if (x instanceof THREE.BufferGeometry) this.geometries.push(x);
    else this.materials.push(x);
    return x;
  }

  setMotion(motion: GeckoMotion): void {
    if (this.motion === motion) return;
    this.motion = motion;
    this.motionTime = 0;
  }

  /**
   * @param movedDistance 이번 프레임에 실제로 움직인 거리 (world units)
   * @param dt 렌더 델타 (가변). 연출용이므로 고정 스텝이 아니어도 된다.
   */
  update(state: GameState, movedDistance: number, dt: number): void {
    const p = state.player;
    this.motionTime += dt;

    // ── 위치·방향 ──
    this.group.position.set(p.pos.x, 0, p.pos.z);
    this.group.rotation.y = p.facing;

    const scale = BASE_SCALE * CONFIG.LEVEL_SCALE[p.levelIndex]!;
    this.group.scale.setScalar(scale);

    // ── 모션 선택 ──
    if (p.stance === Stance.HIDDEN) this.setMotion('hide');
    else if (p.poopAnimLeft > 0) this.setMotion('poop');
    else if (movedDistance > 1e-4) this.setMotion('walk');
    else this.setMotion('idle');

    // ── 걷기: 실제 이동 거리로 위상을 돌려 발이 미끄러지지 않게 한다 ──
    this.walkPhase += movedDistance * 9;
    const walking = this.motion === 'walk';

    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i]!;
      // 대각선 다리쌍이 함께 움직이는 4족 보행 패턴
      const offset = (i === 0 || i === 3 ? 0 : Math.PI);
      const swing = walking ? Math.sin(this.walkPhase + offset) * 0.5 : 0;
      leg.rotation.x = swing;
      leg.position.y = 0.09 + (walking ? Math.abs(Math.cos(this.walkPhase + offset)) * 0.02 : 0);
    }

    // ── 몸통 상하 흔들림 ──
    const bob = walking ? Math.sin(this.walkPhase * 2) * 0.012 : Math.sin(this.motionTime * 2) * 0.006;
    this.body.position.y = 0.17 + bob;

    // ── 꼬리 흔들기 ──
    const tailSway = walking
      ? Math.sin(this.walkPhase * 0.9) * 0.35
      : Math.sin(this.motionTime * 1.6) * 0.12;
    this.tail.rotation.y = tailSway;

    // ── 머리 ──
    if (this.motion === 'poop') {
      // 배변 중에는 몸을 웅크리고 고개를 든다
      const t = Math.min(1, this.motionTime / CONFIG.POOP_ANIM_TIME);
      this.head.rotation.x = -0.35 - Math.sin(t * Math.PI) * 0.2;
      this.group.position.y = -0.03 * Math.sin(t * Math.PI);
    } else {
      this.head.rotation.x = walking ? Math.sin(this.walkPhase * 2) * 0.06 : 0;
      this.group.position.y = 0;
    }

    // ── 눈: 두리번거리기 ──
    const look = Math.sin(this.motionTime * 0.8) * 0.02;
    for (const pupil of this.pupils) pupil.position.x += (look - pupil.position.x) * 0.1;

    // ── 무적 중 깜빡임 (§9-1) ──
    const blinking = p.invulnTimer > 0 && Math.floor(p.invulnTimer * 12) % 2 === 0;
    this.group.visible = p.stance !== Stance.HIDDEN && !blinking;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.group.clear();
  }
}
