/**
 * 도마뱀 캐릭터. GameState 를 **읽어서** 메시에 반영만 한다. 단방향. (§0-4)
 *
 * 스켈레탈 애니메이션 대신 부위별 회전·위치 변화로 처리한다 (§5).
 * 머리 / 몸통 / 네 다리 / 꼬리 / 큰 눈 / 눈꺼풀 / 입 을 각각 별도 오브젝트로
 * 들고 있어야 걷기·먹기·배변·피격 모션과 **표정**을 코드로 만들 수 있다.
 *
 * 표정은 장식이 아니라 정보 채널이다. HUD 를 보지 않아도 도마뱀의 얼굴만으로
 * "배고프다 / 위협이 가깝다 / 힘주는 중이다" 를 읽을 수 있어야 한다. (§17)
 */

import * as THREE from 'three';
import type { GameState } from '../core/GameState.ts';
import { CONFIG } from '../core/GameConfig.ts';
import { Stance, dist } from '../core/types.ts';
import { CLIMB_TIME, climbedHeight } from '../systems/ShelterSystem.ts';
import { buildMarkings, makeIrisGeometry } from './geckoSkin.ts';

const BODY_COLOR = 0x7cc86a;
const BELLY_COLOR = 0xd8f0b0;
const EYE_WHITE = 0xffffff;
const PUPIL = 0x1a1a1a;
const IRIS = 0xe8b23c;
const MOUTH_COLOR = 0x5a2b30;
/** 등 무늬 — 몸 색보다 진한 초록과 능선의 노란 기 */
const SPOT_COLOR = 0x4f9840;
const CREST_COLOR = 0xa8d97a;

/**
 * 도마뱀 기본 크기 배율.
 * 실제 도마뱀 비율로 두면 16x12m 거실에서 너무 작아 화면에서 읽히지 않는다.
 * 카툰 비율로 키운다.
 */
const BASE_SCALE = 1.4;

/** 이 거리(world u) 안에 청소기나 인간이 있으면 겁먹은 표정이 된다. */
const THREAT_RANGE = 2.6;

/** 피격 리액션 지속 시간 (초) */
const HURT_TIME = 0.55;

/**
 * 몸통 중심 높이.
 *
 * 생성자와 `updatePose` 두 곳에서 쓰인다. 예전에는 양쪽에 `0.17` 을 각각
 * 적어 두어서, 몸통 비율을 손보면 걷기 상하 흔들림의 기준선만 옛날 값에
 * 남아 도마뱀이 바닥에 파묻히거나 떠 있었다.
 */
const BODY_Y = 0.155;

/**
 * 모델 정면 보정 (라디안).
 *
 * 이 도마뱀은 **머리가 로컬 −Z 를 향하도록** 만들어져 있다 (머리 z −0.36,
 * 꼬리 z +0.36). 그런데 `player.facing = atan2(dirX, dirZ)` 는 로컬 **+Z** 를
 * 진행 방향에 맞추는 값이라, 그대로 넣으면 꼬리가 앞장서서 뒷걸음질친다.
 *
 * 모델을 +Z 정면으로 다시 만드는 방법도 있지만 머리·주둥이·입·눈·동공·꼬리
 * 마디의 z 좌표와 고개 숙임(`head.rotation.x`) 부호를 전부 뒤집어야 해서,
 * 이미 맞춰 둔 표정·모션이 함께 흔들린다. 여기서 반 바퀴 돌리는 편이 안전하다.
 *
 * `facing` 자체의 의미(= 진행 방향)는 건드리지 않는다. 이건 순수하게
 * "이 메시가 어느 축을 정면으로 그려졌는가" 라는 렌더 쪽 사정이다.
 */
const MODEL_YAW = Math.PI;

export type GeckoMotion = 'idle' | 'walk' | 'eat' | 'poop' | 'hurt' | 'hide';

/**
 * 표정. 각 항목은 아래 EXPRESSIONS 표의 한 줄에 대응한다.
 * 우선순위는 update() 에서 정한다 — 위협이 배고픔을 이긴다.
 */
export type GeckoExpression = 'calm' | 'hungry' | 'scared' | 'strain' | 'chew' | 'hurt';

interface FaceSpec {
  /** 눈꺼풀이 눈을 덮는 정도 [0, 1] */
  lid: number;
  /** 눈알 크기 배율 */
  eye: number;
  /** 동공 크기 배율 — 겁먹으면 줄어든다 */
  pupil: number;
  /** 입이 벌어진 정도 [0, 1] */
  mouth: number;
}

const EXPRESSIONS: Record<GeckoExpression, FaceSpec> = {
  calm: { lid: 0.16, eye: 1.0, pupil: 1.0, mouth: 0.05 },
  // 배고픔은 축 처진 눈으로. 색이 아니라 형태로 알린다 (§17 색맹 대응과 같은 이유)
  hungry: { lid: 0.52, eye: 0.95, pupil: 1.05, mouth: 0.3 },
  scared: { lid: 0.0, eye: 1.3, pupil: 0.55, mouth: 0.55 },
  strain: { lid: 0.72, eye: 0.9, pupil: 1.0, mouth: 0.2 },
  chew: { lid: 0.4, eye: 1.0, pupil: 1.0, mouth: 0.7 },
  hurt: { lid: 0.9, eye: 0.85, pupil: 1.0, mouth: 0.95 },
};

export class Gecko {
  readonly group = new THREE.Group();

  private readonly body: THREE.Mesh;
  private readonly head: THREE.Group;
  private readonly tail: THREE.Group;
  private readonly legs: THREE.Mesh[] = [];
  private readonly eyes: THREE.Group[] = [];
  private readonly eyeballs: THREE.Mesh[] = [];
  private readonly pupils: THREE.Mesh[] = [];
  private readonly lids: THREE.Mesh[] = [];
  private readonly mouth: THREE.Mesh;

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  /** 걷기 위상. 실제로 움직인 거리에 비례해 증가시켜 발이 미끄러지지 않게 한다. */
  private walkPhase = 0;
  private motionTime = 0;
  private motion: GeckoMotion = 'idle';
  /** 현재 높이 — 가구 위/아래 보간용 */
  private height = 0;

  /** 표정 보간 상태. 목표값으로 부드럽게 따라간다 — 즉시 바꾸면 얼굴이 튄다. */
  private readonly face: FaceSpec = { ...EXPRESSIONS.calm };
  private expression: GeckoExpression = 'calm';

  /** 피격 리액션. 하트가 줄어든 것을 보고 스스로 시작한다. */
  private hurtLeft = 0;
  private lastHearts = -1;

  /** 눈 깜빡임. 다음 깜빡임까지 남은 시간과 진행 중인 깜빡임의 잔여 시간 */
  private blinkIn = 2.4;
  private blinkLeft = 0;

  constructor() {
    this.group.name = 'gecko';

    const bodyMat = this.track(new THREE.MeshLambertMaterial({ color: BODY_COLOR }));
    const bellyMat = this.track(new THREE.MeshLambertMaterial({ color: BELLY_COLOR }));

    // ── 몸통 ──
    //
    // 길이/폭 비율이 도마뱀과 악어를 가른다. 예전 비율은 1.45 (폭 0.56 x 길이 0.81)
    // 라 위에서 내려다보면 악어처럼 보였다. 쿼터뷰는 등을 보는 각도라
    // **폭이 실루엣의 거의 전부**다. 폭을 줄이고 길이를 늘려 2.18 로 올렸다.
    const bodyGeo = this.track(new THREE.SphereGeometry(0.28, 10, 8));
    bodyGeo.scale(0.78, 0.55, 1.7);
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.body.position.y = BODY_Y;
    this.body.castShadow = true;
    this.group.add(this.body);

    const bellyGeo = this.track(new THREE.SphereGeometry(0.24, 10, 6));
    bellyGeo.scale(0.76, 0.34, 1.55);
    const belly = new THREE.Mesh(bellyGeo, bellyMat);
    belly.position.set(0, 0.105, 0.02);
    this.group.add(belly);

    // ── 등 무늬 ──
    // 몸통이 단색이면 위에서 봤을 때 색종이처럼 보인다. 반점과 능선이 등의 방향을
    // 알려 주기도 한다 — 어느 쪽이 머리인지 실루엣만으로 읽힌다.
    const markingGeo = this.track(
      buildMarkings(
        { x: 0.28 * 0.78, y: 0.28 * 0.55, z: 0.28 * 1.7, centerY: BODY_Y },
        { spot: SPOT_COLOR, crest: CREST_COLOR },
      ),
    );
    const markingMat = this.track(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.group.add(new THREE.Mesh(markingGeo, markingMat));

    // ── 머리 ──
    this.head = new THREE.Group();
    this.head.name = 'gecko-head';
    this.head.position.set(0, 0.19, -0.4);
    this.group.add(this.head);

    // 머리 폭이 몸통 폭을 넘으면 악어 인상이 남는다. 몸통(반폭 0.218)보다
    // 좁게 두고, 대신 눈을 바깥으로 내밀어 도마뱀 특유의 튀어나온 눈을 만든다.
    const headGeo = this.track(new THREE.SphereGeometry(0.175, 10, 8));
    headGeo.scale(0.86, 0.88, 1.22);
    const headMesh = new THREE.Mesh(headGeo, bodyMat);
    headMesh.castShadow = true;
    this.head.add(headMesh);

    // 넓고 긴 주둥이가 악어로 보이던 두 번째 이유다. 좁고 짧게 줄인다.
    const snoutGeo = this.track(new THREE.SphereGeometry(0.095, 8, 6));
    snoutGeo.scale(0.8, 0.68, 1.3);
    const snout = new THREE.Mesh(snoutGeo, bodyMat);
    snout.position.set(0, -0.028, -0.165);
    this.head.add(snout);

    // ── 입 ──
    // 스케일 y 로 여닫는다. 기본 지오메트리를 납작하게 두고 늘리는 쪽이
    // 회전 관절을 만드는 것보다 단순하고, 다물었을 때 선 하나로 보인다.
    const mouthGeo = this.track(new THREE.SphereGeometry(0.065, 8, 6));
    mouthGeo.scale(1.0, 1.0, 0.5);
    const mouthMat = this.track(new THREE.MeshBasicMaterial({ color: MOUTH_COLOR }));
    this.mouth = new THREE.Mesh(mouthGeo, mouthMat);
    this.mouth.position.set(0, -0.068, -0.222);
    this.head.add(this.mouth);

    // ── 큰 눈 (좌/우) ──
    const eyeWhiteGeo = this.track(new THREE.SphereGeometry(0.078, 10, 8));
    const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: EYE_WHITE }));
    const irisGeo = this.track(makeIrisGeometry(0.062));
    const irisMat = this.track(new THREE.MeshBasicMaterial({ color: IRIS }));
    const pupilGeo = this.track(new THREE.SphereGeometry(0.042, 8, 6));
    const pupilMat = this.track(new THREE.MeshBasicMaterial({ color: PUPIL }));
    // 눈꺼풀은 몸 색과 같아야 "감았다" 로 읽힌다. 눈알보다 아주 조금 크게.
    const lidGeo = this.track(new THREE.SphereGeometry(0.086, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));

    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.105, 0.055, -0.075);
      this.head.add(eye);

      const white = new THREE.Mesh(eyeWhiteGeo, eyeMat);
      eye.add(white);

      // 홍채는 눈알과 함께 커지고 작아져야 한다 — 눈 그룹의 자식으로 붙인다.
      const iris = new THREE.Mesh(irisGeo, irisMat);
      iris.position.set(side * 0.01, 0, -0.036);
      eye.add(iris);

      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.name = side < 0 ? 'gecko-pupil-l' : 'gecko-pupil-r';
      pupil.position.set(side * 0.014, 0, -0.05);
      eye.add(pupil);

      // 위에서 내려오는 반구. lid=0 이면 눈 위로 완전히 비켜나 있다.
      const lid = new THREE.Mesh(lidGeo, bodyMat);
      eye.add(lid);

      this.eyes.push(eye);
      this.eyeballs.push(white);
      this.pupils.push(pupil);
      this.lids.push(lid);
    }

    // ── 다리 4개 ──
    const legGeo = this.track(new THREE.CapsuleGeometry(0.04, 0.13, 3, 6));
    for (const [ix, iz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      const leg = new THREE.Mesh(legGeo, bodyMat);
      leg.position.set(ix * 0.215, 0.085, iz * 0.26);
      leg.rotation.z = ix * 0.5;
      leg.castShadow = true;
      this.group.add(leg);
      this.legs.push(leg);
    }

    // ── 꼬리 (마디 4개로 흔들림 표현) ──
    this.tail = new THREE.Group();
    this.tail.name = 'gecko-tail';
    this.tail.position.set(0, 0.145, 0.42);
    this.group.add(this.tail);

    let parent: THREE.Object3D = this.tail;
    for (let i = 0; i < 4; i++) {
      // 꼬리도 가늘게 — 몸통만 줄이면 꼬리가 상대적으로 굵어 보인다.
      const r = 0.095 - i * 0.019;
      const segGeo = this.track(new THREE.SphereGeometry(r, 8, 6));
      segGeo.scale(0.82, 0.78, 1.7);
      const seg = new THREE.Mesh(segGeo, bodyMat);
      seg.position.z = i === 0 ? 0.07 : 0.145;
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

  /** 디버그·테스트에서 현재 표정을 확인할 수 있게 노출한다. */
  get currentExpression(): GeckoExpression {
    return this.expression;
  }

  /**
   * @param movedDistance 이번 프레임에 실제로 움직인 거리 (world units)
   * @param dt 렌더 델타 (가변). 연출용이므로 고정 스텝이 아니어도 된다.
   */
  update(state: GameState, movedDistance: number, dt: number): void {
    const p = state.player;
    this.motionTime += dt;

    // ── 피격 감지 ──
    // DamageSystem 이 이벤트를 쏘지만, 여기서 구독하면 씬이 다시 만들어질 때마다
    // 해제를 챙겨야 한다. 하트 수를 보고 스스로 알아채는 편이 누수가 없다.
    if (this.lastHearts >= 0 && p.hearts < this.lastHearts) this.hurtLeft = HURT_TIME;
    this.lastHearts = p.hearts;
    if (this.hurtLeft > 0) this.hurtLeft = Math.max(0, this.hurtLeft - dt);

    // ── 위치·방향 ──
    // 가구 위에 올라가면 상판 높이로 올린다. 오르내림은 짧게 보간해서
    // 순간이동처럼 보이지 않게 한다. (§7)
    const targetY = climbedHeight(state);
    const climbT =
      p.climbAnimLeft > 0 ? 1 - p.climbAnimLeft / CLIMB_TIME : 1;
    this.height += (targetY - this.height) * Math.min(1, climbT * 0.35 + dt * 6);

    this.group.position.set(p.pos.x, this.height, p.pos.z);
    this.group.rotation.y = p.facing + MODEL_YAW;

    const scale = BASE_SCALE * CONFIG.LEVEL_SCALE[p.levelIndex]!;
    this.group.scale.setScalar(scale);

    // ── 모션 선택 ──
    if (p.stance === Stance.HIDDEN) this.setMotion('hide');
    else if (this.hurtLeft > 0) this.setMotion('hurt');
    else if (p.poopAnimLeft > 0) this.setMotion('poop');
    else if (p.eatAnimLeft > 0) this.setMotion('eat');
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
    this.body.position.y = BODY_Y + bob;

    // ── 꼬리 흔들기 ──
    // 겁먹었을 때는 빠르고 좁게 떤다. 여유로울 때는 느리고 넓게 흔든다.
    const scared = this.expression === 'scared';
    const tailSway = walking
      ? Math.sin(this.walkPhase * 0.9) * 0.35
      : scared
        ? Math.sin(this.motionTime * 11) * 0.09
        : Math.sin(this.motionTime * 1.6) * 0.12;
    this.tail.rotation.y = tailSway;

    this.updatePose(state, walking);
    this.updateFace(state, dt);
  }

  /** 모션별 몸·머리 자세 */
  private updatePose(state: GameState, walking: boolean): void {
    const p = state.player;
    let headPitch = walking ? Math.sin(this.walkPhase * 2) * 0.06 : 0;
    let y = this.height;
    let roll = 0;
    let squash = 1;

    if (this.motion === 'poop') {
      // 배변 중에는 몸을 웅크리고 고개를 든다
      const t = Math.min(1, this.motionTime / CONFIG.POOP_ANIM_TIME);
      headPitch = -0.35 - Math.sin(t * Math.PI) * 0.2;
      y = this.height - 0.03 * Math.sin(t * Math.PI);
      squash = 1 + Math.sin(t * Math.PI) * 0.08;
    } else if (this.motion === 'eat') {
      // 먹기: 고개를 바닥으로 내렸다가 씹으면서 위아래로 짧게 흔든다.
      const t = Math.min(1, this.motionTime / CONFIG.FOOD_EAT_TIME);
      headPitch = 0.5 * Math.sin(t * Math.PI) + Math.sin(this.motionTime * 26) * 0.09;
      y = this.height - 0.02 * Math.sin(t * Math.PI);
    } else if (this.motion === 'hurt') {
      // 피격: 튕겨 오르며 옆으로 기운다. 짧고 크게 — 놓치면 안 되는 정보다.
      const t = 1 - this.hurtLeft / HURT_TIME;
      y = this.height + Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.12;
      roll = Math.sin(this.hurtLeft * 42) * 0.28 * this.hurtLeft;
      squash = 1 - Math.sin(Math.min(1, t * 2) * Math.PI) * 0.12;
      headPitch = -0.3;
    }

    this.head.rotation.x = headPitch;
    this.group.position.y = y;
    this.group.rotation.z = roll;
    this.body.scale.set(1, squash, 1);

    // 달리는 중에는 몸을 앞으로 살짝 눕힌다.
    this.group.rotation.x = p.runLeft > 0 && walking ? -0.1 : 0;
  }

  /** 표정 선택과 보간 */
  private updateFace(state: GameState, dt: number): void {
    const p = state.player;

    // 우선순위: 아픔 > 힘주기 > 씹기 > 위협 > 배고픔 > 평온.
    // 위협이 배고픔을 이겨야 한다 — 둘 다일 때 알려야 할 것은 위협 쪽이다.
    if (this.hurtLeft > 0) this.expression = 'hurt';
    else if (p.poopAnimLeft > 0) this.expression = 'strain';
    else if (p.eatAnimLeft > 0) this.expression = 'chew';
    else if (this.threatNear(state)) this.expression = 'scared';
    else if (p.hunger < 30) this.expression = 'hungry';
    else this.expression = 'calm';

    const goal = EXPRESSIONS[this.expression];

    // 깜빡임. 겁먹었거나 아플 때는 깜빡이지 않는다 (그쪽 표정이 더 중요하다).
    if (this.expression === 'scared' || this.expression === 'hurt') {
      this.blinkLeft = 0;
    } else if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
    } else {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) {
        this.blinkLeft = 0.12;
        // 규칙적으로 깜빡이면 기계처럼 보인다. 주기를 조금씩 흔든다.
        this.blinkIn = 2.2 + (Math.sin(this.motionTime * 1.7) + 1) * 1.1;
      }
    }

    // 표정 전환은 0.12초 안에 끝난다. 더 느리면 반응이 아니라 여운으로 읽힌다.
    const k = Math.min(1, dt / 0.12);
    this.face.lid += (goal.lid - this.face.lid) * k;
    this.face.eye += (goal.eye - this.face.eye) * k;
    this.face.pupil += (goal.pupil - this.face.pupil) * k;
    this.face.mouth += (goal.mouth - this.face.mouth) * k;

    const lid = this.blinkLeft > 0 ? 1 : this.face.lid;

    for (let i = 0; i < this.eyes.length; i++) {
      this.eyeballs[i]!.scale.setScalar(this.face.eye);
      this.pupils[i]!.scale.setScalar(this.face.pupil);

      // 눈꺼풀 반구를 눈 위로 밀어 올렸다가 내린다.
      const lidMesh = this.lids[i]!;
      lidMesh.position.y = 0.085 * (1 - lid) + 0.008;
      lidMesh.scale.setScalar(this.face.eye);
    }

    // 입 — 다물었을 때 완전히 사라지지 않게 최소 두께를 남긴다.
    this.mouth.scale.set(1, 0.12 + this.face.mouth * 1.15, 1);

    // ── 눈: 두리번거리기 ──
    // 겁먹었을 때는 위협 쪽을 본다. 그게 "무엇을 무서워하는지" 를 알려 준다.
    const look =
      this.expression === 'scared'
        ? this.threatSide(state) * 0.03
        : Math.sin(this.motionTime * 0.8) * 0.02;
    for (const pupil of this.pupils) pupil.position.x += (look - pupil.position.x) * 0.1;

    // ── 무적 중 깜빡임 (§9-1) ──
    const blinking = p.invulnTimer > 0 && Math.floor(p.invulnTimer * 12) % 2 === 0;
    this.group.visible = p.stance !== Stance.HIDDEN && !blinking;
  }

  /** 청소기나 인간이 코앞에 있는지. 가구 위·담요 밑에서는 판정 대상이 아니다. */
  private threatNear(state: GameState): boolean {
    if (state.player.stance !== Stance.GROUND) return false;
    return this.nearestThreat(state) !== null;
  }

  /** 가장 가까운 위협. 없으면 null */
  private nearestThreat(state: GameState): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestD = THREAT_RANGE;

    for (const v of state.vacuums) {
      const d = dist(v.pos, state.player.pos);
      if (d < bestD) {
        bestD = d;
        best = v.pos;
      }
    }
    for (const h of state.humans) {
      const d = dist(h.pos, state.player.pos);
      if (d < bestD) {
        bestD = d;
        best = h.pos;
      }
    }
    return best;
  }

  /** 위협이 도마뱀 기준 왼쪽(-1)인지 오른쪽(+1)인지 */
  private threatSide(state: GameState): number {
    const threat = this.nearestThreat(state);
    if (!threat) return 0;
    const p = state.player;
    const dx = threat.x - p.pos.x;
    const dz = threat.z - p.pos.z;

    // 위협을 **모델 로컬 좌표**로 옮겨 x 부호만 본다.
    //
    // MODEL_YAW 보정까지 넣으면 로컬 +X 축의 월드 방향은 (−cos f, +sin f) 이고,
    // 이게 도마뱀이 보는 기준의 오른쪽이다. 그래서 로컬 x = −dx·cos f + dz·sin f.
    //
    // 예전 식(`dx·cos f + dz·sin f`)은 역회전 부호가 뒤집혀 있어서, 정면(+z)을
    // 보고 있을 때 오른쪽 위협을 왼쪽이라고 답했다. 눈동자가 반대로 돌아간 것을
    // 알아채기 어려워 그대로 남아 있었다.
    const cos = Math.cos(p.facing);
    const sin = Math.sin(p.facing);
    return Math.sign(dz * sin - dx * cos);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.group.clear();
  }
}
