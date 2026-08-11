/**
 * 도마뱀의 무늬. 플레이어와 짝이 **같은 코드**로 만든다.
 *
 * 두 파일(Gecko.ts / MateGecko.ts)은 이미 실루엣 수치를 각자 적고 있다 — 같은 종으로
 * 보이려면 그래야 했다. 무늬까지 양쪽에 복제하면 한쪽만 고쳐질 게 뻔하므로 여기 모은다.
 *
 * UV 텍스처를 쓰지 않는 이유: 몸통은 z 로 길게 늘인 구라 구면 UV 의 극점이 등 한가운데와
 * 배 한가운데에 온다. 반점을 그리면 등 위에서 소용돌이처럼 뭉친다 — 하필 쿼터뷰에서
 * 가장 잘 보이는 자리다. 작은 덩어리를 표면에 얹는 편이 정확하고 손도 덜 간다.
 */

import * as THREE from 'three';
import { mergeParts, paint } from '../world/vertexPaint.ts';

/** 몸통 타원체의 반지름 (x, y, z) 과 중심 높이 */
export interface BodyShape {
  x: number;
  y: number;
  z: number;
  centerY: number;
}

export interface MarkingColors {
  /** 등 반점 */
  spot: number;
  /** 등 능선 */
  crest: number;
}

/**
 * 반점 배치. `t` 는 몸통 길이 방향 위치 [-1, 1], `a` 는 등마루에서 옆으로 벌어진 각도.
 * 표범도마뱀붙이처럼 좌우 비대칭으로 흩어 놓아야 자연스럽다.
 */
const SPOTS: readonly { t: number; a: number; r: number }[] = [
  { t: -0.62, a: 0.0, r: 0.9 },
  { t: -0.42, a: 0.62, r: 1.0 },
  { t: -0.36, a: -0.7, r: 0.8 },
  { t: -0.12, a: -0.2, r: 1.1 },
  { t: 0.02, a: 0.72, r: 0.9 },
  { t: 0.12, a: -0.78, r: 1.0 },
  { t: 0.3, a: 0.24, r: 1.0 },
  { t: 0.46, a: -0.55, r: 0.8 },
  { t: 0.58, a: 0.5, r: 0.7 },
];

/** 능선 마디 수 */
const CREST_SEGMENTS = 7;

/**
 * 등 무늬 한 덩어리를 만든다. 색은 정점에 구워져 있으므로 재질은
 * `MeshLambertMaterial({ vertexColors: true })` 하나면 된다.
 */
export function buildMarkings(body: BodyShape, colors: MarkingColors): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  for (const s of SPOTS) {
    // 그 단면에서의 반지름. 끝으로 갈수록 가늘어진다.
    const k = Math.sqrt(Math.max(0, 1 - s.t * s.t));
    const sx = body.x * k;
    const sy = body.y * k;

    const g = new THREE.SphereGeometry(1, 8, 6);
    g.scale(0.055 * s.r, 0.02, 0.075 * s.r);
    // 표면에 눕힌다. 각도만큼 굴려야 옆구리 반점이 떠 보이지 않는다.
    g.rotateZ(-s.a);
    g.translate(
      sx * Math.sin(s.a) * 0.93,
      body.centerY + sy * Math.cos(s.a) * 0.93,
      s.t * body.z,
    );
    parts.push(paint(g, colors.spot, { flat: true }));
  }

  // 등 능선 — 목덜미에서 꼬리 쪽으로 낮아진다.
  for (let i = 0; i < CREST_SEGMENTS; i++) {
    const t = -0.6 + (i / (CREST_SEGMENTS - 1)) * 1.3;
    const k = Math.sqrt(Math.max(0, 1 - t * t));
    const scale = 1 - Math.abs(t) * 0.35;

    const g = new THREE.ConeGeometry(0.016 * scale, 0.05 * scale, 5);
    g.translate(0, body.centerY + body.y * k * 0.9 + 0.02 * scale, t * body.z);
    parts.push(paint(g, colors.crest, { flat: true }));
  }

  return mergeParts(parts);
}

/**
 * 눈의 홍채. 흰자와 동공 사이에 색 고리를 하나 넣으면 눈이 살아난다 —
 * 흑백만 있으면 단추처럼 보인다.
 */
export function makeIrisGeometry(radius: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(radius, 10, 6);
  g.scale(1, 1, 0.55);
  return g;
}
