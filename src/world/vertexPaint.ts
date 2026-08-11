/**
 * 파트를 색칠해서 하나로 합치는 도구. 가구·소품 조립의 공용 바닥이다.
 *
 * 조형물 하나를 여러 프리미티브로 만들면 파트마다 머티리얼이 필요해 보이지만,
 * 그러면 두 가지가 무너진다.
 *   ① draw call 이 파트 수만큼 늘어난다.
 *   ② `Furniture.ts` 의 반투명 가림 로직이 "가구 1개 = 메시 1개 + 머티리얼 1개" 를
 *      전제로 짜여 있다 (pieces 배열).
 *
 * 그래서 색을 **정점에 굽고** 파트를 하나의 지오메트리로 합친다. 머티리얼은
 * `vertexColors: true` 하나면 되고, 위 두 가지를 건드리지 않아도 된다.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 윗면을 밝게 하는 정도 */
const TOP_LIFT = 0.1;
/** 아랫면을 어둡게 하는 정도 */
const BOTTOM_DROP = 0.28;
/** 조형물 바닥 쪽을 어둡게 하는 가짜 AO 의 세기 */
const FLOOR_AO = 0.26;
/** 정점마다 흔드는 밝기 폭 — 평평한 면이 죽지 않게 아주 조금만 */
const JITTER = 0.03;

export interface PaintOptions {
  /**
   * 이 파트가 속한 조형물 전체의 y 범위 (바닥, 천장).
   * 낮은 정점일수록 어두워진다 — 다리·굽이 상판보다 어두워야 바닥에 붙어 보인다.
   */
  aoSpan?: readonly [number, number];
  /** 밝기 변주를 끄고 싶을 때 (유리·화면처럼 균일해야 하는 파트) */
  flat?: boolean;
}

/** 정점 좌표에서 뽑는 고정 난수 [0,1). 같은 자리는 항상 같은 값이라 화면이 떨리지 않는다. */
function jitterAt(x: number, y: number, z: number): number {
  let h = Math.imul((x * 733 + y * 947 + z * 1259) | 0, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * 지오메트리에 정점 색을 굽는다. **지오메트리를 그 자리에서 고치고 돌려준다.**
 *
 * 법선 방향과 높이로 밝기를 흔들어, 단색 Lambert 로는 나오지 않는 면 구분과
 * 접지감을 만든다. 조명이 아니라 색이라 각도가 바뀌어도 그대로 남는다.
 */
export function paint(
  geo: THREE.BufferGeometry,
  color: number,
  opts: PaintOptions = {},
): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const base = new THREE.Color(color);
  const out = new Float32Array(pos.count * 3);
  const [aoLow, aoHigh] = opts.aoSpan ?? [0, 0];
  const aoRange = aoHigh - aoLow;

  for (let i = 0; i < pos.count; i++) {
    const ny = nor ? nor.getY(i) : 0;
    let f = 1 + TOP_LIFT * Math.max(0, ny) - BOTTOM_DROP * Math.max(0, -ny);

    if (aoRange > 0) {
      const t = (pos.getY(i) - aoLow) / aoRange;
      f *= 1 - FLOOR_AO * (1 - Math.min(1, Math.max(0, t)));
    }
    if (!opts.flat) {
      f += (jitterAt(pos.getX(i), pos.getY(i), pos.getZ(i)) - 0.5) * JITTER;
    }

    out[i * 3] = base.r * f;
    out[i * 3 + 1] = base.g * f;
    out[i * 3 + 2] = base.b * f;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

/**
 * 파트를 하나의 지오메트리로 합친다. 원본은 합친 뒤 버린다.
 *
 * 모든 파트가 같은 속성 집합을 가져야 한다 — three 의 기본 프리미티브는
 * position/normal/uv 를 모두 갖고, `paint()` 가 color 를 더해 주므로 조건이 맞는다.
 */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('mergeParts: 속성이 서로 다른 파트를 합칠 수 없다');
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** 색을 밝게/어둡게 민 값. `amount` > 0 이면 밝아진다. */
export function shade(color: number, amount: number): number {
  return new THREE.Color(color).offsetHSL(0, 0, amount).getHex();
}
