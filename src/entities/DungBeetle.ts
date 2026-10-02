/**
 * 쇠똥구리 — 미션 2(야외)에서 로봇청소기 자리를 맡는다. 상태를 읽어 반영만 한다. (§0-4)
 *
 * 로직은 청소기와 **완전히 같다** (`VacuumSystem` — 직선 이동, 예고 회전, 지나간
 * 자리의 똥 땅을 지움, 부딪히면 하트 -1). 바깥에 로봇청소기가 돌아다니는 건
 * 말이 안 되니 겉모습만 바꾼다. 쇠똥구리는 실제로 똥을 굴려 가져가는 벌레라
 * "내 땅을 지우는 적" 이라는 역할에 설명이 필요 없다.
 *
 * ## 똥 공이 자란다
 * 앞에 굴리는 공은 **지금까지 지운 셀 수**만큼 커진다. 청소기는 얼마나 지웠는지
 * 화면에 남기지 않았는데, 여기서는 굴러다니는 공 크기가 곧 잃은 땅이다.
 *
 * ## 읽히는 움직임은 그대로 (§12)
 * 진행 경로 데칼과 지우는 범위 링은 청소기와 같은 것을 단다. 위협은 속도가 아니라
 * "어디로 갈지 아는 것" 에서 오므로, 겉모습이 바뀌어도 그 정보는 빠지면 안 된다.
 *
 * 좌표 규약도 청소기와 같다 — 그룹을 `heading + π` 로 돌리고 **로컬 −z 가 앞**이다.
 */

import * as THREE from 'three';
import { DERIVED } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { PATH_COLOR, SLOW_COLOR } from './RobotVacuum.ts';

const SHELL = 0x2b3350;
const SHELL_SHEEN = 0x4b6a8f;
const LEG = 0x1b1d26;
const DUNG = 0x6b4a2b;
const RING = 0x8a6a3a;

/** 몸통 반길이 (world units) */
const BODY_HALF = 0.3;
/** 공 뒷면이 닿는 로컬 z — 머리(뿔) 바로 앞이다 */
const BALL_BACK = -0.2;
/** 공 반지름 — 처음과 상한 */
const BALL_MIN = 0.15;
const BALL_MAX = 0.4;
/** 지운 셀 수 → 공 반지름. 제곱근이라 초반에 빨리 자라고 나중엔 더디다 */
const BALL_GROWTH = 0.012;

/** 다리 한 쌍의 몸통 위 위치 (로컬 z) */
const LEG_ROWS = [-0.16, 0.02, 0.2] as const;

interface BeetleMesh {
  group: THREE.Group;
  body: THREE.Group;
  ball: THREE.Mesh;
  legs: THREE.Group[];
  path: THREE.Mesh;
  pathMat: THREE.MeshBasicMaterial;
  brush: THREE.Mesh;
  /** 지난 프레임 위치 — 굴러간 거리로 공을 돌리고 다리를 움직인다 */
  last: { x: number; z: number } | null;
  /** 누적 이동 거리 */
  travelled: number;
}

export class DungBeetleRenderer {
  readonly group = new THREE.Group();

  private readonly items: BeetleMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private time = 0;

  constructor(count: number) {
    this.group.name = 'dung-beetles';

    const shellMat = this.track(
      new THREE.MeshPhongMaterial({ color: SHELL, specular: SHELL_SHEEN, shininess: 60, flatShading: true }),
    );
    const legMat = this.track(new THREE.MeshLambertMaterial({ color: LEG }));
    const dungMat = this.track(new THREE.MeshLambertMaterial({ color: DUNG, flatShading: true }));

    // 등껍질 — 납작한 타원체. 가운데 이음매(딱지날개 사이)를 어두운 띠로 긋는다.
    const shellGeo = this.track(new THREE.SphereGeometry(1, 12, 8));
    shellGeo.scale(0.24, 0.15, BODY_HALF);
    const seamGeo = this.track(new THREE.BoxGeometry(0.018, 0.02, BODY_HALF * 1.5));
    const headGeo = this.track(new THREE.SphereGeometry(1, 10, 6));
    headGeo.scale(0.15, 0.07, 0.1);
    // 뿔 — 머리에서 위로 휘어 오른다. 정면에서 봤을 때 "얼굴" 이 되는 부분이다.
    const hornGeo = this.track(new THREE.ConeGeometry(0.035, 0.16, 5));
    hornGeo.rotateX(-0.5);
    const eyeGeo = this.track(new THREE.SphereGeometry(0.022, 6, 4));
    const eyeMat = this.track(new THREE.MeshBasicMaterial({ color: 0xd8c27a }));
    // 다리 — 원점이 몸통 쪽 관절이라 그대로 돌리면 휘두르는 동작이 된다.
    const legGeo = this.track(new THREE.BoxGeometry(0.2, 0.025, 0.025));
    legGeo.translate(0.1, 0, 0);
    legGeo.rotateZ(-0.6);
    const ballGeo = this.track(new THREE.IcosahedronGeometry(1, 1));

    const ringGeo = this.track(
      new THREE.RingGeometry(DERIVED.VACUUM_CLEAN_RADIUS_WORLD * 0.85, DERIVED.VACUUM_CLEAN_RADIUS_WORLD, 20),
    );
    const ringMat = this.track(new THREE.MeshBasicMaterial({ color: RING, transparent: true, opacity: 0.45 }));
    // 진행 경로 데칼 (§12) — 청소기와 같은 모양이다.
    const pathGeo = this.track(new THREE.PlaneGeometry(0.22, 2.4));
    pathGeo.translate(0, 1.35, 0);

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();

      // 몸은 공 뒤에 선다. 머리가 공에 닿아 밀고 가는 자세다.
      const body = new THREE.Group();
      body.position.z = 0.1;
      group.add(body);

      const shell = new THREE.Mesh(shellGeo, shellMat);
      shell.position.y = 0.17;
      shell.castShadow = true;
      body.add(shell);
      const seam = new THREE.Mesh(seamGeo, legMat);
      seam.position.set(0, 0.315, 0.04);
      body.add(seam);

      const head = new THREE.Mesh(headGeo, shellMat);
      head.position.set(0, 0.14, -BODY_HALF + 0.02);
      body.add(head);
      const horn = new THREE.Mesh(hornGeo, shellMat);
      horn.position.set(0, 0.24, -BODY_HALF - 0.02);
      body.add(horn);
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(side * 0.09, 0.17, -BODY_HALF - 0.04);
        body.add(eye);
      }

      const legs: THREE.Group[] = [];
      for (const z of LEG_ROWS) {
        for (const side of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set(side * 0.2, 0.13, z);
          // 왼쪽 다리는 거울상 — x 를 뒤집는다.
          pivot.scale.x = side;
          pivot.add(new THREE.Mesh(legGeo, legMat));
          body.add(pivot);
          legs.push(pivot);
        }
      }

      const ball = new THREE.Mesh(ballGeo, dungMat);
      ball.castShadow = true;
      group.add(ball);

      const brush = new THREE.Mesh(ringGeo, ringMat);
      brush.rotation.x = -Math.PI / 2;
      brush.position.y = 0.012;
      group.add(brush);

      const pathMat = this.track(
        new THREE.MeshBasicMaterial({ color: PATH_COLOR, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      const path = new THREE.Mesh(pathGeo, pathMat);
      path.rotation.x = -Math.PI / 2;
      path.position.y = 0.008;
      group.add(path);

      this.group.add(group);
      this.items.push({ group, body, ball, legs, path, pathMat, brush, last: null, travelled: 0 });
    }
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    if (x instanceof THREE.BufferGeometry) this.geometries.push(x);
    else this.materials.push(x);
    return x;
  }

  update(state: GameState, dt: number): void {
    this.time += dt;
    // 공은 판 전체에서 지운 양으로 자란다. 쇠똥구리가 한 마리라 곧 그 녀석의 몫이다.
    const r = Math.min(BALL_MAX, BALL_MIN + Math.sqrt(state.stats.erasedCells) * BALL_GROWTH);

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const v = state.vacuums[i];
      if (!v) {
        item.group.visible = false;
        item.last = null;
        continue;
      }

      item.group.visible = true;
      item.group.position.set(v.pos.x, 0, v.pos.z);
      item.group.rotation.y = v.heading + Math.PI;

      const moved = item.last ? Math.hypot(v.pos.x - item.last.x, v.pos.z - item.last.z) : 0;
      item.last = { x: v.pos.x, z: v.pos.z };
      item.travelled += moved;

      // 공 — 몸 앞에 붙어 굴러간다. 굴러간 거리 / 반지름 만큼 돈다.
      item.ball.scale.setScalar(r);
      item.ball.position.set(0, r, BALL_BACK - r);
      item.ball.rotation.x = -item.travelled / r;

      // 다리 — 세 쌍이 번갈아 젓는다 (곤충의 삼각 보행). 멈추면 다리도 멈춘다.
      const walking = moved > 1e-4;
      const phase = item.travelled * 18;
      item.legs.forEach((leg, k) => {
        const tripod = (k % 2) ^ (Math.floor(k / 2) % 2);
        leg.rotation.y = walking ? Math.sin(phase + tripod * Math.PI) * 0.45 : 0;
      });
      // 몸이 공을 미느라 살짝 들썩인다.
      item.body.position.y = walking ? Math.abs(Math.sin(phase)) * 0.015 : 0;

      // 회전 중에는 경로 데칼을 깜빡여 "방향이 바뀌는 중" 임을 알린다 (청소기와 같다).
      const turning = v.turnLeft > 0;
      item.pathMat.opacity = turning ? 0.15 + Math.abs(Math.sin(this.time * 14)) * 0.35 : 0.35;
      item.pathMat.color.setHex(v.slowLeft > 0 ? SLOW_COLOR : PATH_COLOR);
      item.brush.rotation.z = this.time * 2;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.items.length = 0;
    this.group.clear();
  }
}
