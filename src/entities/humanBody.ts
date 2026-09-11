/**
 * 코드로 만든 로우폴리 사람. **키트 모델이 없을 때의 대비책**이다. (§24)
 *
 * `humanAvatar.ts` 가 `public/models/human.glb` 를 받아 왔으면 그쪽을 쓰고,
 * 못 받았으면 여기로 떨어진다. 사람은 장식이 아니라 **적**이라 (§24) 화면에서
 * 사라지면 왜 하트가 깎였는지 알 수 없게 된다 — 가구와 달리 없어도 되는
 * 물건이 아니라서 예전 조립을 지우지 않고 남겨 둔다.
 *
 * 파트마다 메시를 두면 사람 하나에 열 개가 넘는다. 색을 정점에 굽고 합치면
 * 재질 하나로 끝나고, 움직여야 하는 건 팔다리뿐이다. (world/vertexPaint.ts)
 */

import * as THREE from 'three';
import { mergeParts, paint, shade } from '../world/vertexPaint.ts';

const SKIN = 0xf2c9a0;
const SHIRT = 0x6f7fd6;
const PANTS = 0x40485c;
const HAIR = 0x3a2a20;
const SHOE = 0x373d4a;
const EYE = 0x2b2118;
const MOUTH = 0xb4645e;

/**
 * 어깨·엉덩이 높이. 팔다리 지오메트리는 **관절이 원점**이 되도록 만들고 이 높이에 놓는다.
 * 캡슐 한가운데를 원점으로 두면 회전할 때 허벅지가 엉덩이 밖으로 빠져나간다.
 */
export const HIP_Y = 0.735;
export const SHOULDER_Y = 1.28;

/**
 * 몸통·머리·얼굴을 한 덩어리로 만든다.
 *
 * 파트마다 메시를 두면 사람 하나에 열 개가 넘는다. 색을 정점에 굽고 합치면
 * 재질 하나로 끝나고, 움직여야 하는 건 팔다리뿐이다. (world/vertexPaint.ts)
 */
export function buildBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, color: number) => {
    g.translate(x, y, z);
    parts.push(paint(g, color));
  };

  // ── 몸통 ──
  at(new THREE.CapsuleGeometry(0.26, 0.42, 4, 10), 0, 1.06, 0, SHIRT);
  // 허리띠 — 셔츠와 바지의 경계가 있어야 옷을 입은 것으로 읽힌다.
  at(new THREE.CylinderGeometry(0.252, 0.248, 0.08, 12), 0, 0.72, 0, shade(PANTS, -0.06));
  // 옷깃
  at(new THREE.CylinderGeometry(0.15, 0.2, 0.07, 12), 0, 1.37, 0, shade(SHIRT, 0.1));
  // 목
  at(new THREE.CylinderGeometry(0.085, 0.095, 0.14, 8), 0, 1.4, 0, shade(SKIN, -0.04));

  // ── 머리 ──
  at(new THREE.SphereGeometry(0.22, 12, 10), 0, 1.55, 0, SKIN);

  // 머리카락은 **앞쪽을 비워 둔다.** 카메라가 40도 위에서 내려다보므로 눈에 들어오는
  // 건 머리 윗면이다. 반구를 통째로 씌우면 화면에 보이는 건 죄다 머리카락이고
  // 얼굴은 실루엣 아래로 숨는다.
  const hair = new THREE.SphereGeometry(
    0.234,
    14,
    8,
    Math.PI / 2 + 0.85,
    Math.PI * 2 - 1.7,
    0,
    Math.PI / 2,
  );
  hair.scale(1, 1.05, 1);
  at(hair, 0, 1.55, 0, HAIR);

  // 뒤통수 — 반구가 덮지 못하는 적도 아래를 채운다.
  const backHair = new THREE.SphereGeometry(0.2, 10, 8);
  backHair.scale(1, 1, 0.8);
  at(backHair, 0, 1.55, -0.06, HAIR);

  // 앞머리 — 비워 둔 이마 위쪽에만 얹는다.
  const fringe = new THREE.SphereGeometry(0.21, 10, 6);
  fringe.scale(1.02, 0.3, 0.62);
  at(fringe, 0, 1.7, 0.05, HAIR);

  // 뒤로 묶은 머리
  at(new THREE.SphereGeometry(0.105, 8, 8), 0, 1.53, -0.24, shade(HAIR, 0.04));

  // ── 얼굴 ──
  // 정면은 +Z 다 (body.rotation.y = facing 을 그대로 쓴다).
  //
  // 눈은 얼굴에 그린 점이 아니라 **머리 밖으로 튀어나온 구**다. 이 카메라 각도에서
  // 구면에 붙인 이목구비는 거의 옆에서 보는 꼴이라 사라진다. 도마뱀의 큰 눈이
  // 어느 각도에서나 읽히는 것도 같은 이유다.
  for (const side of [-1, 1]) {
    const white = new THREE.SphereGeometry(0.054, 10, 8);
    at(white, side * 0.088, 1.6, 0.168, 0xfdfbf5);

    const pupil = new THREE.SphereGeometry(0.028, 8, 6);
    at(pupil, side * 0.094, 1.598, 0.212, EYE);
  }

  const mouth = new THREE.SphereGeometry(0.055, 8, 6);
  mouth.scale(1.15, 0.45, 0.35);
  at(mouth, 0, 1.472, 0.196, MOUTH);

  return mergeParts(parts);
}

/** 팔 하나. 어깨가 원점이고 아래로 뻗는다. 소매와 손을 함께 굽는다. */
export function buildArmGeometry(): THREE.BufferGeometry {
  const arm = new THREE.CapsuleGeometry(0.075, 0.34, 3, 6);
  arm.translate(0, -0.245, 0);

  const sleeve = new THREE.CylinderGeometry(0.115, 0.1, 0.17, 8);
  sleeve.translate(0, -0.07, 0);

  const hand = new THREE.SphereGeometry(0.088, 8, 6);
  hand.translate(0, -0.45, 0);

  return mergeParts([
    paint(arm, SKIN),
    paint(sleeve, SHIRT),
    paint(hand, shade(SKIN, -0.03)),
  ]);
}

/** 다리 하나. 엉덩이가 원점이고 아래로 뻗는다. 신발까지 함께 굽는다. */
export function buildLegGeometry(): THREE.BufferGeometry {
  const leg = new THREE.CapsuleGeometry(0.095, 0.44, 3, 6);
  leg.translate(0, -0.315, 0);

  const shoe = new THREE.BoxGeometry(0.16, 0.09, 0.26);
  shoe.translate(0, -0.63, 0.04);

  return mergeParts([paint(leg, PANTS), paint(shoe, SHOE)]);
}
