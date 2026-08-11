/**
 * 똥 땅 표면 무늬를 절차적으로 만든다. (§10 시각화)
 *
 * 이미지 에셋을 늘리지 않으려고 캔버스에 직접 그린다 — Human.ts 말풍선과 같은 방식이다.
 *
 * 셀 한 칸이 텍스처 한 장을 그대로 덮으므로 **타일이 붙어도 이음매가 보이면 안 된다.**
 * 그래서 값 노이즈 격자의 주기를 텍스처 폭의 약수(2·4·8·16)로만 잡고 좌표를 그 주기로
 * 감는다. 오른쪽 끝 픽셀과 왼쪽 끝 픽셀이 같은 격자점을 보게 되어 경계선이 사라지고,
 * 확보한 셀들이 격자가 아니라 하나의 덩어리로 읽힌다.
 *
 * 색은 텍스처에 구워 넣는다. InstancedMesh 의 인스턴스 색은 여기에 곱해지기만 하므로,
 * 색을 인스턴스 쪽에 두면 요산(밝은 흰 점) 같은 밝은 디테일이 살아남지 못한다.
 * 인스턴스 색은 셀마다의 미세한 밝기 차이와 등장 연출에만 쓴다. (TerritoryGrid 참고)
 */

import * as THREE from 'three';
import { Rng } from '../core/Rng.ts';
import { clamp01, fbm, makeFbm, mix, smoothstep } from '../world/noise.ts';

/** 셀 한 칸에 들어가는 텍스처 해상도 */
const SIZE = 128;

/**
 * 무늬 시드. 고정해 둬야 실행마다 같은 화면이 나온다 (§0-5).
 * 게임 로직의 Rng 와는 별개다 — 이건 로딩 시점에 한 번 도는 장식이다.
 */
const TEXTURE_SEED = 0x5eed9a11;

/** 배설물 색 램프. 그늘진 골 → 중간 갈색 → 마른 겉면 */
const DEEP: RGB = [62, 41, 24];
const MID: RGB = [112, 76, 43];
const CRUST: RGB = [158, 118, 70];
/** 요산 — 도마뱀 똥 끝에 붙는 흰 덩어리. 이게 있어야 "똥"으로 읽힌다 */
const URATE: RGB = [236, 228, 206];

/** 요산 덩어리 / 어두운 알갱이 개수 (한 타일당) */
const URATE_SPECKS = 3;
const DARK_SPECKS = 7;

type RGB = readonly [number, number, number];

export interface PoopTextures {
  /** 색 지도 */
  readonly map: THREE.CanvasTexture;
  /** 요철 지도. 스펙큘러가 알갱이마다 끊겨서 축축하고 울퉁불퉁해 보인다 */
  readonly bump: THREE.CanvasTexture;
}

/**
 * 알갱이 하나를 찍는다. 타일 경계를 넘어가면 반대쪽으로 감아서 그린다 —
 * 그러지 않으면 알갱이가 셀 경계에서 잘려 격자가 다시 드러난다.
 */
function stamp(
  color: ImageData,
  height: ImageData,
  cx: number,
  cy: number,
  radius: number,
  tint: RGB,
  lift: number,
): void {
  const r2 = radius * radius;
  const from = Math.floor(-radius);
  const to = Math.ceil(radius);

  for (let dy = from; dy <= to; dy++) {
    for (let dx = from; dx <= to; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;

      const x = (((Math.round(cx) + dx) % SIZE) + SIZE) % SIZE;
      const y = (((Math.round(cy) + dy) % SIZE) + SIZE) % SIZE;
      const i = (y * SIZE + x) * 4;

      // 가운데가 진하고 가장자리는 부드럽게 풀린다.
      const a = smoothstep(1 - Math.sqrt(d2) / radius);

      color.data[i] = mix(color.data[i]!, tint[0], a);
      color.data[i + 1] = mix(color.data[i + 1]!, tint[1], a);
      color.data[i + 2] = mix(color.data[i + 2]!, tint[2], a);

      const h = clamp01(height.data[i]! / 255 + lift * a) * 255;
      height.data[i] = h;
      height.data[i + 1] = h;
      height.data[i + 2] = h;
    }
  }
}

/** 색 램프. `t` 0 → 그늘진 골, 1 → 마른 겉면 */
function ramp(t: number): RGB {
  return t < 0.5
    ? [
        mix(DEEP[0], MID[0], t * 2),
        mix(DEEP[1], MID[1], t * 2),
        mix(DEEP[2], MID[2], t * 2),
      ]
    : [
        mix(MID[0], CRUST[0], (t - 0.5) * 2),
        mix(MID[1], CRUST[1], (t - 0.5) * 2),
        mix(MID[2], CRUST[2], (t - 0.5) * 2),
      ];
}

function toTexture(data: ImageData, colorSpace: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  canvas.getContext('2d')!.putImageData(data, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  // 이웃 셀과 이어지는 무늬라 가장자리도 반대편으로 감아야 밉맵에서 이음매가 안 생긴다.
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // 바닥을 비스듬히 내려다보므로 이방성 필터가 없으면 멀리서 죽처럼 뭉갠다.
  // 하드웨어 상한은 three 가 업로드 시점에 알아서 잘라 준다.
  tex.anisotropy = 4;
  tex.colorSpace = colorSpace;
  return tex;
}

export function makePoopTextures(): PoopTextures {
  const rng = new Rng(TEXTURE_SEED);
  // 주기는 전부 SIZE 의 약수여야 감았을 때 이어진다.
  //
  // 큰 주기(2 같은)를 넣으면 타일마다 큼직한 무늬 하나가 생기고, 셀이 늘어설수록
  // 그게 똑같이 반복돼서 "도장 찍은 격자"로 보인다. 한 셀은 화면에서 30px 남짓이라
  // 어차피 큰 무늬가 들어갈 자리도 없다. 그래서 잔결 위주로 쌓는다.
  const lumps = makeFbm(rng, [4, 8]);
  const grain = makeFbm(rng, [16]);

  const ctx = document.createElement('canvas').getContext('2d')!;
  const color = ctx.createImageData(SIZE, SIZE);
  const height = ctx.createImageData(SIZE, SIZE);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const v = y / SIZE;

      // 대비를 세게 줘서 흐린 노이즈가 아니라 뭉친 알갱이로 보이게 한다.
      const lump = smoothstep(clamp01((fbm(lumps, u, v) - 0.28) / 0.44));
      const t = clamp01(0.12 + lump * 0.8 + (fbm(grain, u, v) - 0.5) * 0.3);
      const [r, g, b] = ramp(t);
      const i = (y * SIZE + x) * 4;

      color.data[i] = r;
      color.data[i + 1] = g;
      color.data[i + 2] = b;
      color.data[i + 3] = 255;

      const h = t * 255;
      height.data[i] = h;
      height.data[i + 1] = h;
      height.data[i + 2] = h;
      height.data[i + 3] = 255;
    }
  }

  // 소화 안 된 알갱이 — 겉면을 지저분하게 만든다.
  for (let i = 0; i < DARK_SPECKS; i++) {
    stamp(color, height, rng.next() * SIZE, rng.next() * SIZE, rng.range(3, 6), DEEP, -0.25);
  }
  // 요산 덩어리 — 밝아서 제일 먼저 눈에 들어온다. 마지막에 얹는다.
  for (let i = 0; i < URATE_SPECKS; i++) {
    stamp(color, height, rng.next() * SIZE, rng.next() * SIZE, rng.range(5, 9), URATE, 0.4);
  }

  return {
    map: toTexture(color, THREE.SRGBColorSpace),
    bump: toTexture(height, THREE.NoColorSpace),
  };
}
