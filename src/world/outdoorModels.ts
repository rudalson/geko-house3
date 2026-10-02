/**
 * 야외 캠프장(미션 2) 소품의 조립 지시서. 형식과 규약은 `furnitureModels.ts` 와 같다.
 *
 * 모델은 Kenney Survival Kit 이다. 원본은 색을 텍스처 아틀라스에 담고 있어서
 * `tools/bake-survival.mjs` 가 **색별 머티리얼**로 다시 구운 것을 쓴다. 그래서
 * 머티리얼 이름이 `wood` 같은 말이 아니라 색 그 자체(`c6b4a2f`)다. 키트 색이
 * 이미 자연스러워 여기서는 색을 거의 갈아끼우지 않는다.
 *
 * ## 길쭉한 모델과 `yaw`
 * 통나무·침낭·큰 상자는 모델이 **z 축으로** 길다. 조립 프레임은 긴 변이 x(bw)라
 * (`frameOf()`), 파트를 π/2 돌려 눕혀야 한다. 크기는 회전 **전** 모델 축에
 * 먹으므로 w 와 d 의 비율이 서로 바뀐 값이 들어간다 — 예를 들어 bw 2.2 x bd 0.7
 * 통나무는 `w: 0.7/2.2, d: 2.2/0.7` 이다. 헷갈리면 통나무가 세로로 선다.
 *
 * Three.js 를 import 하지 않는다. 여기는 데이터일 뿐이다. (§0-4)
 */

import type { FurnitureRecipe, KitPartSpec } from './furnitureModels.ts';

const QUARTER = Math.PI / 2;

/** 모델이 z 로 긴데 프레임이 bw x bd 일 때 눕히는 파트 */
function lying(model: string, bw: number, bd: number, extra: Partial<KitPartSpec> = {}): KitPartSpec {
  return { model, w: bd / bw, d: bw / bd, h: 1, yaw: QUARTER, ...extra };
}

/**
 * 나무. AABB 는 줄기 둘레(0.8)뿐이고 수관은 그 몇 배로 퍼진다 (`outdoorLayout.ts`).
 * `w`·`d` 가 1 보다 큰 건 그래서다 — 상자 밖으로 넘치는 건 **눈높이 한참 위**의
 * 잎뿐이라 "보이지 않는 벽" 이 생기지 않는다.
 */
const tree = (model: string, spread = 2.9, yaw = 0): FurnitureRecipe => ({
  parts: [{ model, w: spread, d: spread, h: 1, yaw }],
});
// 높이는 배치(`outdoorLayout.ts` 의 h)가 정한다. 수관 폭(0.8 x spread)의 2.3배 안팎이라야
// 버섯처럼 눌려 보이지 않는다 — `Outdoor.ts` 의 TREE_ASPECT 와 같은 비율이다.

export const OUTDOOR_MODELS: Readonly<Record<string, FurnitureRecipe>> = {
  // ── 텐트 2.8 x 2.4 x 2.2 ────────────────────────────────────────────────
  'camp-tent': {
    parts: [{ model: 'tent-canvas', w: 1, d: 1, h: 1 }],
  },
  // ── 침낭 2.2 x 1.1 (밟고 지나가는 은신처) ──────────────────────────────
  'camp-bedroll': {
    parts: [lying('bedroll', 2.2, 1.1)],
  },

  // ── 모닥불 1.5 x 1.5 x 0.35 — 불꽃은 `Outdoor.ts` 가 따로 피운다 ──────────
  campfire: {
    parts: [{ model: 'campfire-pit', w: 1, d: 1, h: 1 }],
  },
  'log-seat-n': { parts: [lying('tree-log', 2.2, 0.7)] },
  'log-seat-w': { parts: [lying('tree-log', 2.0, 0.7)] },

  // ── 작업장 ───────────────────────────────────────────────────────────────
  workbench: {
    parts: [
      { model: 'workbench', w: 1, d: 1, h: 1 },
      { model: 'bucket', x: 0.36, z: 0.1, y: 1, w: 0.12, d: 0.24, h: 0.32 },
    ],
    // 다리 사이로 지나갈 수 있어 보이면 안 된다 (`furnitureModels.ts` 머리말).
    fills: [{ w: 0.84, d: 0.7, h: 0.5, color: 0x5a3f28 }],
  },
  'barrel-a': { parts: [{ model: 'barrel', w: 1, d: 1, h: 1 }] },
  'barrel-b': { parts: [{ model: 'barrel', w: 1, d: 1, h: 1, yaw: 0.8 }] },
  // 장작더미 1.4 x 0.8 — 작은 통나무 셋을 두 단으로 쌓는다.
  'wood-pile': {
    parts: [
      lying('tree-log-small', 1.4, 0.8, { z: -0.24, w: (0.8 * 0.5) / 1.4, h: 0.5 }),
      lying('tree-log-small', 1.4, 0.8, { z: 0.24, w: (0.8 * 0.5) / 1.4, h: 0.5 }),
      lying('tree-log-small', 1.4, 0.8, { y: 0.5, w: (0.8 * 0.5) / 1.4, h: 0.5 }),
    ],
  },
  crate: { parts: [lying('box-large', 1.7, 1.0)] },

  // ── 나무 ─────────────────────────────────────────────────────────────────
  'yard-tree-ne': tree('tree'),
  'yard-tree-se': tree('tree-autumn-tall', 3.0, 0.7),
  'yard-tree-w': tree('tree-tall', 3.0, 2.1),
  'yard-tree-s': tree('tree', 2.7, 1.3),
  // 그루터기에 도끼 한 자루를 꽂아 둔다 — 등반 지점이라는 걸 멀리서도 알아보게.
  stump: {
    parts: [
      { model: 'tree-trunk', w: 1, d: 1, h: 1 },
      { model: 'tool-axe', x: 0.12, y: 0.82, w: 0.3, d: 0.08, h: 0.9, yaw: 0.5 },
    ],
  },

  // ── 바위·보물상자·표지판 ────────────────────────────────────────────────
  'rock-big': { parts: [{ model: 'rock-a', w: 1, d: 1, h: 1 }] },
  'rock-mid': { parts: [{ model: 'rock-b', w: 1, d: 1, h: 1 }] },
  'rock-small': { parts: [{ model: 'rock-c', w: 1, d: 1, h: 1, yaw: 0.4 }] },
  'rock-east': { parts: [{ model: 'rock-a', w: 1, d: 1, h: 1, yaw: Math.PI }] },
  chest: { parts: [{ model: 'chest', w: 1, d: 1, h: 1 }] },
  signpost: { parts: [{ model: 'signpost', w: 1, d: 0.6, h: 1 }] },
};

/** 이 파일이 쓰는 모델 전부. `preloadKit()` 에 넘긴다. */
export function outdoorModelNames(): string[] {
  const names = new Set<string>();
  for (const recipe of Object.values(OUTDOOR_MODELS)) {
    for (const p of recipe.parts) names.add(p.model);
  }
  return [...names];
}
