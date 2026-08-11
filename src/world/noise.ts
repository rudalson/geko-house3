/**
 * 타일 가능한 값 노이즈. 절차 텍스처의 공용 재료다.
 *
 * 바닥 나뭇결·소파 패브릭·똥 땅 표면·도마뱀 반점이 전부 이걸 쓴다.
 * 각자 캔버스에 노이즈를 다시 구현하면 "이음매가 보인다"는 같은 버그를 네 번 만나게 된다.
 *
 * **타일 가능**이 핵심이다. 격자 주기로 좌표를 감기 때문에, 주기를 텍스처 폭의
 * 약수로만 잡으면 오른쪽 끝과 왼쪽 끝이 같은 격자점을 보고 경계가 사라진다.
 *
 * Three.js 를 import 하지 않는다 — 여기서 다루는 건 숫자뿐이다.
 */

import { Rng } from '../core/Rng.ts';

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface Octave {
  readonly lat: Float32Array;
  readonly p: number;
  readonly amp: number;
}

/** 주기 `p` 로 감기는 값 노이즈 격자 */
function lattice(rng: Rng, p: number): Float32Array {
  const v = new Float32Array(p * p);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  return v;
}

/** `u`,`v` ∈ [0,1) 를 격자에서 이중선형 보간한다. 좌표를 주기로 감아 이음매를 없앤다. */
export function noise(lat: Float32Array, p: number, u: number, v: number): number {
  const fx = u * p;
  const fy = v * p;
  const x0 = Math.floor(fx) % p;
  const y0 = Math.floor(fy) % p;
  const x1 = (x0 + 1) % p;
  const y1 = (y0 + 1) % p;
  const tx = smoothstep(fx - Math.floor(fx));
  const ty = smoothstep(fy - Math.floor(fy));

  const top = mix(lat[y0 * p + x0]!, lat[y0 * p + x1]!, tx);
  const bottom = mix(lat[y1 * p + x0]!, lat[y1 * p + x1]!, tx);
  return mix(top, bottom, ty);
}

/** 주기가 작은 층부터 진폭을 반씩 줄여 쌓는다. 합이 [0,1] 이 되도록 정규화해 둔다. */
export function makeFbm(rng: Rng, periods: readonly number[]): Octave[] {
  let amp = 1;
  let total = 0;
  const octaves = periods.map((p) => {
    const o = { lat: lattice(rng, p), p, amp };
    total += amp;
    amp *= 0.5;
    return o;
  });
  return octaves.map((o) => ({ ...o, amp: o.amp / total }));
}

export function fbm(octaves: readonly Octave[], u: number, v: number): number {
  let sum = 0;
  for (const o of octaves) sum += noise(o.lat, o.p, u, v) * o.amp;
  return sum;
}
