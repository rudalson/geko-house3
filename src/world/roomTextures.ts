/**
 * 거실 바닥과 러그의 절차 텍스처. (world/noise.ts 의 값 노이즈를 쓴다)
 *
 * 바닥이 단색이면 방이 아무리 채워져도 도화지처럼 보인다. 나뭇결은 거리감과
 * 이동 속도를 읽게 해 주는 정보이기도 하다 — 격자선만으로는 약하다.
 */

import * as THREE from 'three';
import { Rng } from '../core/Rng.ts';
import { clamp01, fbm, makeFbm, mix } from './noise.ts';

/** 바닥 텍스처 한 장이 덮는 월드 크기 (units). 방 크기(16x12)의 약수여야 이음매가 맞는다. */
export const FLOOR_TILE = 4;
const FLOOR_SIZE = 256;
/** 한 타일에 들어가는 널 개수 → 널 하나의 폭은 FLOOR_TILE / PLANKS 월드 단위 */
const PLANKS = 8;

const FLOOR_SEED = 0x0f100721;
const RUG_SEED = 0x2b09e551;
const GRASS_SEED = 0x6a55e3d1;

/** 마루 색 — 밝은 오크. 똥 땅(갈색)과 구분되도록 노랗고 밝은 쪽으로 둔다. */
const PLANK_LIGHT: RGB = [236, 214, 172];
const PLANK_DARK: RGB = [214, 186, 138];
const SEAM: RGB = [176, 148, 106];

type RGB = readonly [number, number, number];

const lerpRGB = (a: RGB, b: RGB, t: number): RGB => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** 반복 횟수는 쓰는 쪽에서 정한다 — 바닥은 방 크기만큼, 러그는 한 장이면 된다. */
function toTexture(data: ImageData): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 셀 인덱스 → [0,1). 널마다 고정된 색 변주를 주려고 쓴다. */
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * 마루 텍스처. x 방향으로 널이 뻗는다.
 *
 * 널 이음매(가로 줄)와 널 끝(세로 줄)을 모두 그린다. 끝 위치는 줄마다 어긋내야
 * 바둑판처럼 보이지 않는다.
 */
export function makeFloorTexture(): THREE.CanvasTexture {
  const rng = new Rng(FLOOR_SEED);
  const grain = makeFbm(rng, [4, 16, 32]);

  const ctx = document.createElement('canvas').getContext('2d')!;
  const img = ctx.createImageData(FLOOR_SIZE, FLOOR_SIZE);
  const rowPx = FLOOR_SIZE / PLANKS;

  for (let y = 0; y < FLOOR_SIZE; y++) {
    const v = y / FLOOR_SIZE;
    const row = Math.floor(y / rowPx);
    const inRow = (y % rowPx) / rowPx;
    // 널마다 밝기를 조금씩 다르게 — 같은 색 널이 나란히 놓이면 인쇄물처럼 보인다.
    const rowTone = 0.25 + hash01(row) * 0.75;
    // 널 끝 위치. 줄마다 어긋난다.
    const joint = (hash01(row * 31 + 7) + row * 0.37) % 1;

    for (let x = 0; x < FLOOR_SIZE; x++) {
      const u = x / FLOOR_SIZE;
      // 결은 널을 따라 길게 늘인다 — v 를 4배로 감아 가로로 늘어진 무늬를 만든다.
      const g = fbm(grain, u, (v * 4) % 1);
      const t = clamp01(rowTone * 0.75 + (g - 0.5) * 0.8);

      let c = lerpRGB(PLANK_DARK, PLANK_LIGHT, t);

      // 이음매 — 널 사이(가로)와 널 끝(세로)
      const edge = Math.min(inRow, 1 - inRow) * rowPx;
      const du = Math.abs(((u - joint + 1.5) % 1) - 0.5) * FLOOR_SIZE;
      if (edge < 1.2) c = lerpRGB(c, SEAM, 1 - edge / 1.2);
      else if (du < 1.2) c = lerpRGB(c, SEAM, (1 - du / 1.2) * 0.7);

      const i = (y * FLOOR_SIZE + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }

  return toTexture(img);
}

const RUG_SIZE = 128;

/**
 * 러그 텍스처. 한 장을 러그 전체에 한 번만 입히므로 타일링을 신경 쓰지 않는다.
 * 테두리 두 겹 + 안쪽 줄무늬 — 방에 한 군데라도 무늬가 있으면 바닥이 넓어 보인다.
 */
export function makeRugTexture(field: number, border: number, stripe: number): THREE.CanvasTexture {
  const rng = new Rng(RUG_SEED);
  const fuzz = makeFbm(rng, [16, 32]);

  const fieldRGB = colorToRGB(field);
  const borderRGB = colorToRGB(border);
  const stripeRGB = colorToRGB(stripe);

  const ctx = document.createElement('canvas').getContext('2d')!;
  const img = ctx.createImageData(RUG_SIZE, RUG_SIZE);

  for (let y = 0; y < RUG_SIZE; y++) {
    const v = y / RUG_SIZE;
    for (let x = 0; x < RUG_SIZE; x++) {
      const u = x / RUG_SIZE;
      // 가장자리로부터의 거리 [0, 0.5]
      const d = Math.min(u, 1 - u, v, 1 - v);

      let c: RGB;
      if (d < 0.035) c = borderRGB;
      else if (d < 0.055) c = stripeRGB;
      else if (d < 0.075) c = borderRGB;
      else {
        // 안쪽은 바탕 + 마름모 무늬. 줄무늬로 두면 마룻바닥의 널과 헷갈린다.
        const dx = Math.abs(((u * 7) % 1) - 0.5);
        const dy = Math.abs(((v * 5) % 1) - 0.5);
        c = dx + dy < 0.24 ? lerpRGB(fieldRGB, stripeRGB, 0.5) : fieldRGB;
      }

      // 보풀 — 평평한 색면에 결을 준다
      const f = 0.88 + fbm(fuzz, u, v) * 0.24;
      const i = (y * RUG_SIZE + x) * 4;
      img.data[i] = c[0] * f;
      img.data[i + 1] = c[1] * f;
      img.data[i + 2] = c[2] * f;
      img.data[i + 3] = 255;
    }
  }

  return toTexture(img);
}

const GRASS_SIZE = 256;

/**
 * 잔디 텍스처 (미션 2 야외). 바닥 텍스처처럼 FLOOR_TILE 마다 반복된다.
 *
 * `mown` 이면 잔디깎이가 지나간 줄무늬를 넣는다 — 울타리 안 마당이다. 줄무늬는
 * 한 타일에 두 줄이라 폭이 2 units 로, 똥 땅 셀(0.5)보다 훨씬 굵어서 격자로
 * 오인되지 않는다. 울타리 밖 들판은 줄무늬 없이 어둡게 깔아 경계가 읽히게 한다.
 *
 * 색은 **초록 쪽으로만** 흔든다. 똥 땅은 갈색이라, 잔디에 흙빛이 섞이면
 * "여기가 내 땅인가" 판독이 흐려진다 (`Decor.ts` 머리말과 같은 이유).
 */
export function makeGrassTexture(light: number, dark: number, mown: boolean): THREE.CanvasTexture {
  const rng = new Rng(GRASS_SEED);
  const blotch = makeFbm(rng, [4, 8]);
  const blades = makeFbm(rng, [32, 64]);

  const lightRGB = colorToRGB(light);
  const darkRGB = colorToRGB(dark);

  const ctx = document.createElement('canvas').getContext('2d')!;
  const img = ctx.createImageData(GRASS_SIZE, GRASS_SIZE);

  for (let y = 0; y < GRASS_SIZE; y++) {
    const v = y / GRASS_SIZE;
    for (let x = 0; x < GRASS_SIZE; x++) {
      const u = x / GRASS_SIZE;
      let t = clamp01(0.5 + (fbm(blotch, u, v) - 0.5) * 1.4);
      if (mown) {
        // 부드러운 사인 줄무늬. 경계가 칼같으면 바닥에 선을 그은 것처럼 보인다.
        t = clamp01(t * 0.6 + (0.5 + 0.5 * Math.sin(u * Math.PI * 4)) * 0.4);
      }
      const c = lerpRGB(darkRGB, lightRGB, t);
      // 풀잎 결 — 고주파 노이즈로 밝기만 흔든다.
      const f = 0.86 + fbm(blades, u, v) * 0.28;

      const i = (y * GRASS_SIZE + x) * 4;
      img.data[i] = c[0] * f;
      img.data[i + 1] = c[1] * f;
      img.data[i + 2] = c[2] * f;
      img.data[i + 3] = 255;
    }
  }

  return toTexture(img);
}

function colorToRGB(hex: number): RGB {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}
