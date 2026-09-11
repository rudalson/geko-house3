/**
 * Kenney 키트 모델로 가구 하나를 조립한다. `furnitureBuilders.ts` 와 **같은 계약**이다 —
 * `FurnitureDef` 를 받아 `BuiltFurniture`(병합 지오메트리 1개 + 발광 파트)를 돌려준다.
 *
 * 두 경로가 같은 모양의 결과를 내는 게 중요하다. 그래야 `Furniture.ts` 가
 * "모델이 있으면 이쪽, 없으면 저쪽" 한 줄로 고를 수 있고, 가림 페이드(§25)와
 * dispose(§8)가 어느 쪽이든 똑같이 동작한다.
 *
 * 모델이 없거나(레시피 미정) 아직 안 받아졌으면 `null` 을 돌려준다. 부르는 쪽이
 * 예전 조립으로 떨어지므로, GLB 하나가 404 가 나도 그 가구만 상자로 보일 뿐
 * 게임은 멀쩡히 돈다.
 */

import * as THREE from 'three';
import type { BuiltFurniture, GlowPart } from './furnitureBuilders.ts';
import { frameOf, type FurnitureDef } from './furnitureLayout.ts';
import { FURNITURE_MODELS, type FillSpec, type Tint } from './furnitureModels.ts';
import { fitKitModel, kitLoaded } from './modelKit.ts';
import { mergeParts, paint, shade } from './vertexPaint.ts';

/** 바닥에 닿는 굽. `furnitureBuilders.ts` 의 `WOOD_DARK` 와 같은 값이다. */
const PLINTH_COLOR = 0x5a3f28;

function resolveTint(tint: Tint, body: number): number {
  if (typeof tint === 'number') return tint;
  switch (tint) {
    case 'body':
      return body;
    case 'bodyLight':
      return shade(body, 0.12);
    case 'bodyDark':
      return shade(body, -0.14);
    case 'plinth':
      return PLINTH_COLOR;
  }
}

/** 지시서의 색 표를 실제 색 표로 바꾼다. */
function resolveTints(
  tints: Readonly<Record<string, Tint>> | undefined,
  body: number,
): Record<string, number> | undefined {
  if (!tints) return undefined;
  const out: Record<string, number> = {};
  for (const [name, t] of Object.entries(tints)) out[name] = resolveTint(t, body);
  return out;
}

/** 빈 곳을 메우는 상자 하나. 비율 → world units 변환만 한다. */
function fillBox(
  spec: FillSpec,
  bw: number,
  bd: number,
  h: number,
  body: number,
): THREE.BufferGeometry {
  const sx = bw * spec.w;
  const sy = h * spec.h;
  const sz = bd * spec.d;
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(bw * (spec.x ?? 0), h * (spec.y ?? 0) + sy / 2, bd * (spec.z ?? 0));
  // 키트 조각은 `modelKit` 이 uv 를 떼고 온다. 속성 집합이 다르면 `mergeParts` 가
  // 통째로 실패하므로 여기서도 맞춰 떼어 낸다 — 어차피 텍스처를 쓰지 않는다.
  g.deleteAttribute('uv');
  return paint(g, resolveTint(spec.color, body), { aoSpan: [0, h] });
}

/**
 * 레시피가 있고 모델이 전부 준비됐으면 조립하고, 아니면 `null`.
 *
 * 가짜 AO(`paint` 의 `aoSpan`)는 가구 **전체 높이**를 기준으로 준다. 파트마다
 * 제 높이로 주면 탁자 위의 책이 바닥에 놓인 책처럼 어두워진다.
 */
export function buildKitFurniture(def: FurnitureDef): BuiltFurniture | null {
  const recipe = FURNITURE_MODELS[def.id];
  if (!recipe) return null;
  if (!recipe.parts.every((p) => kitLoaded(p.model))) return null;

  const { bw, bd, yaw } = frameOf(def);
  const h = def.h;
  const span: readonly [number, number] = [0, h];

  const parts: THREE.BufferGeometry[] = [];
  const glow: GlowPart[] = [];

  for (const spec of recipe.parts) {
    const fitted = fitKitModel(spec.model, {
      size: [bw * spec.w, h * spec.h, bd * spec.d],
      at: [bw * (spec.x ?? 0), h * (spec.y ?? 0), bd * (spec.z ?? 0)],
      yaw: spec.yaw,
      tint: resolveTints(spec.tint, def.color),
      glowMaterials: spec.glow,
    });

    for (const p of fitted) {
      if (p.glow) {
        // 발광 파트는 정점 색을 쓰지 않는다 (`MeshBasicMaterial` + 단색). 명암을
        // 구워 넣으면 "빛나는" 느낌이 죽는다.
        glow.push({ geometry: p.geometry, color: p.color });
      } else {
        parts.push(paint(p.geometry, p.color, { aoSpan: span }));
      }
    }
  }

  for (const spec of recipe.fills ?? []) {
    parts.push(fillBox(spec, bw, bd, h, def.color));
  }

  const geometry = mergeParts(parts);

  // 메시는 y = def.h/2 에 놓이므로 바닥 원점 조립을 절반만큼 내린다.
  // `furnitureBuilders.buildFurniture()` 의 마지막과 같은 처리다.
  for (const g of [geometry, ...glow.map((p) => p.geometry)]) {
    if (yaw !== 0) g.rotateY(yaw);
    g.translate(0, -h / 2, 0);
  }
  return { geometry, glow };
}
