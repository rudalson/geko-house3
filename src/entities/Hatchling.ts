/**
 * 새끼 도마뱀. 상태를 읽어 반영만 한다. 단방향. (§0-4, §24)
 *
 * 메시는 시작 시 `HATCHLING_MAX` 개를 **미리 만들고** 보이기/숨기기만 한다.
 * 태어날 때마다 만들면 한 판에 대여섯 번 geometry 가 생겼다 사라져 §8 의
 * "플레이 중 리소스 증가 0" 이 깨진다 (소크 테스트가 감시한다).
 *
 * 부모(초록)와 짝(분홍)의 중간 색으로 칠한다. 형태는 어른과 같은 실루엣이되
 * 몸통 대비 머리와 눈이 크다 — 새끼로 읽히는 건 크기가 아니라 이 비율이다.
 * 작아서 표정이 보이지 않으므로 색을 정점에 굽고 **메시 하나**로 합친다.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { mergeParts, paint, shade } from '../world/vertexPaint.ts';

/** 부모 초록(0x7cc86a)과 짝 분홍(0xe58fb0)을 섞은 연둣빛 */
const BODY_COLOR = 0xa9d288;
const BELLY_COLOR = 0xf2e6bd;
/** 등 반점은 짝을 닮은 분홍 — 누구 새끼인지 색으로 말한다 */
const SPOT_COLOR = 0xdba0b8;
const EYE_WHITE = 0xfdfbf5;
const PUPIL = 0x1a1a1a;

/**
 * 어른(1.4)의 절반. 이 비율이 "아직 새끼" 를 만든다.
 * 더 줄이면 쿼터뷰 40도에서 바닥 얼룩과 구분되지 않는다 — 실제로 0.62 에서
 * 부모 실루엣에 묻혀 보이지 않았다.
 */
const BASE_SCALE = 0.72;

/** 남은 수명이 이보다 적으면 깜빡인다 — 곧 떠난다는 걸 형태로 알린다 (§17) */
const FAREWELL_SEC = 5;

/**
 * 새끼 한 마리를 지오메트리 하나로 굽는다.
 *
 * 어른은 표정·부위별 모션이 있어 파트마다 메시를 들고 있지만, 새끼는 화면에서
 * 손가락 한 마디 크기라 부위를 따로 움직여도 보이지 않는다. 합쳐서 draw call 을
 * 아끼고, 흔들림은 그룹 전체로 준다.
 */
function buildGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, color: number) => {
    g.translate(x, y, z);
    parts.push(paint(g, color));
  };

  // ── 몸통 ── 어른과 같은 비율(폭 0.78 / 길이 1.7)을 쓴다. 종이 같아 보여야 한다.
  const body = new THREE.SphereGeometry(0.26, 10, 8);
  body.scale(0.78, 0.58, 1.55);
  at(body, 0, 0.16, 0, BODY_COLOR);

  const belly = new THREE.SphereGeometry(0.22, 10, 6);
  belly.scale(0.76, 0.34, 1.4);
  at(belly, 0, 0.11, 0.02, BELLY_COLOR);

  // 등 반점 3개 — 어른의 buildMarkings 를 쓰기엔 너무 작다. 납작한 구로 충분하다.
  for (const [sx, sz] of [
    [-0.06, -0.1],
    [0.07, 0.06],
    [-0.05, 0.22],
  ] as const) {
    const spot = new THREE.SphereGeometry(0.055, 6, 5);
    spot.scale(1, 0.3, 1.3);
    at(spot, sx, 0.3, sz, SPOT_COLOR);
  }

  // ── 머리 ── 어른보다 크게 잡는다. 새끼 비율의 핵심이다. 정면은 −Z (어른과 같은 규약)
  const head = new THREE.SphereGeometry(0.2, 10, 8);
  head.scale(0.9, 0.9, 1.1);
  at(head, 0, 0.22, -0.34, BODY_COLOR);

  const snout = new THREE.SphereGeometry(0.1, 8, 6);
  snout.scale(0.82, 0.7, 1.2);
  at(snout, 0, 0.19, -0.47, BODY_COLOR);

  // ── 눈 ── 이 크기에서 읽히는 건 실루엣과 눈뿐이다. 얼굴 밖으로 내밀어 크게.
  for (const side of [-1, 1]) {
    const white = new THREE.SphereGeometry(0.088, 8, 6);
    at(white, side * 0.105, 0.27, -0.4, EYE_WHITE);

    const pupil = new THREE.SphereGeometry(0.048, 8, 6);
    at(pupil, side * 0.115, 0.27, -0.455, PUPIL);
  }

  // ── 다리 4개 ── 새끼는 다리를 따로 흔들지 않는다. 몸 전체가 뒤뚱거린다.
  for (const [ix, iz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const leg = new THREE.CapsuleGeometry(0.042, 0.09, 3, 6);
    leg.rotateZ(ix * 0.5);
    at(leg, ix * 0.19, 0.08, iz * 0.22, shade(BODY_COLOR, -0.05));
  }

  // ── 꼬리 ── 어른보다 짧고 뭉툭하다
  const tail = new THREE.SphereGeometry(0.095, 8, 6);
  tail.scale(0.8, 0.75, 2.4);
  at(tail, 0, 0.15, 0.44, BODY_COLOR);

  return mergeParts(parts);
}

interface Item {
  group: THREE.Group;
  /** 뒤뚱거림 위상. 실제 이동 거리로 돌려 발이 미끄러지지 않게 한다 */
  phase: number;
  lastX: number;
  lastZ: number;
}

export class HatchlingRenderer {
  readonly group = new THREE.Group();

  private readonly items: Item[] = [];
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.Material;
  private time = 0;

  constructor(count: number = CONFIG.HATCHLING_MAX) {
    this.group.name = 'hatchlings';

    this.geometry = buildGeometry();
    // 색이 정점에 굽혀 있으므로 머티리얼은 하나면 된다.
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      group.visible = false;
      group.scale.setScalar(BASE_SCALE);

      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.castShadow = true;
      group.add(mesh);

      this.group.add(group);
      this.items.push({ group, phase: 0, lastX: 0, lastZ: 0 });
    }
  }

  /** @param dt 렌더 델타 (가변). 연출 전용. */
  update(state: GameState, dt: number): void {
    this.time += dt;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const h = state.hatchlings[i];

      if (!h) {
        item.group.visible = false;
        continue;
      }

      // 남은 수명이 얼마 없으면 깜빡인다. 갑자기 사라지면 "버그인가" 로 읽힌다.
      const farewell = h.lifeLeft < FAREWELL_SEC && Math.floor(this.time * 6) % 2 === 0;
      item.group.visible = !farewell;

      const moved = Math.hypot(h.pos.x - item.lastX, h.pos.z - item.lastZ);
      item.lastX = h.pos.x;
      item.lastZ = h.pos.z;
      // 순간이동(새로 태어난 슬롯 재사용)에서 위상이 튀지 않게 상한을 둔다.
      item.phase += Math.min(moved, 0.2) * 14;

      item.group.position.set(h.pos.x, 0, h.pos.z);
      // 머리가 로컬 −Z 라 반 바퀴 보정한다 (Gecko.MODEL_YAW 와 같은 사정).
      item.group.rotation.y = h.facing + Math.PI;

      // 태어날 때 알에서 튀어나오듯 커진다.
      const age = CONFIG.HATCHLING_LIFETIME_SEC - h.lifeLeft;
      const pop = Math.min(1, age / 0.4);
      item.group.scale.setScalar(BASE_SCALE * (0.25 + 0.75 * pop));

      // 뒤뚱거림 — 걸을 때는 좌우로 기울고, 멈춰 있으면 숨만 쉰다.
      const walking = moved > 1e-4;
      item.group.rotation.z = walking ? Math.sin(item.phase) * 0.16 : 0;
      item.group.position.y = walking
        ? Math.abs(Math.sin(item.phase)) * 0.03
        : Math.sin(this.time * 2.6 + i) * 0.008;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.items.length = 0;
    this.group.clear();
  }
}
