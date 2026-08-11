/**
 * 가구 조립. `furnitureLayout.ts` 의 정의(위치·크기·색)만 읽어서 파트를 쌓는다.
 * 좌표를 새로 적지 않는다 — 크기는 전부 def 의 w·d·h 에 대한 비율로 표현한다. (§0-2)
 *
 * ## 로컬 좌표 규약
 * 빌더는 **바닥이 y = 0** 인 공간에서 조립한다. x ∈ [−bw/2, bw/2], z ∈ [−bd/2, bd/2] 이고
 * **등(뒤)은 항상 −z 를 향한다.** 마지막에 `buildFurniture()` 가 벽 쪽으로 돌려 세우고,
 * 메시 원점(= def.h/2)에 맞춰 아래로 내린다. 빌더마다 방향을 따지지 않게 하려는 규약이다.
 *
 * ## 바닥 근처를 비우지 않는다
 * 충돌은 def 의 AABB 박스 **전체**다 (`CollisionMap.ts`). 탁자를 상판과 가는 다리로만
 * 만들면 다리 사이로 지나가려던 도마뱀이 허공에 막힌다 — §0-2 가 경고하는 "보이지 않는
 * 벽"이 눈에 보이는 형태로 되살아난다. 그래서 낮은 높이는 몸통·굽으로 채우고,
 * 뚫린 느낌이 필요한 책장은 뒤판으로 막는다.
 */

import * as THREE from 'three';
import type { FurnitureDef, FurnitureKind } from './furnitureLayout.ts';
import { mergeParts, paint, shade } from './vertexPaint.ts';

/** 굽·받침 공통색 — 가구 색과 무관하게 바닥에 닿는 부분은 어두운 나무로 둔다 */
const WOOD_DARK = 0x5a3f28;
const METAL = 0x8f949c;

/** 책·블록처럼 알록달록해야 하는 소품의 색 */
const BOOK_COLORS = [0xd4685a, 0xe3b45a, 0x5f8fb4, 0x86a95f, 0xb47ab4, 0xcf7f4a];
const BLOCK_COLORS = [0xe6595b, 0xf2b544, 0x4f9ad6, 0x6fc06a];

/** TV 화면 · 램프 갓처럼 스스로 빛나 보여야 하는 파트 */
export interface GlowPart {
  geometry: THREE.BufferGeometry;
  color: number;
}

export interface BuiltFurniture {
  /** 병합된 본체. 가구 하나당 draw call 하나. */
  geometry: THREE.BufferGeometry;
  /** 발광 파트. 조명을 받지 않는 재질로 따로 그린다. */
  glow: GlowPart[];
}

/** 조립 중인 가구의 치수. bw 는 벽을 따라가는 폭, bd 는 벽에서 나오는 깊이다. */
interface Frame {
  bw: number;
  bd: number;
  h: number;
  color: number;
  /** 가짜 AO 기준 — 조형물 전체의 y 범위 */
  span: readonly [number, number];
}

/** 상자 하나. `at` 은 (x 중심, y **바닥**, z 중심). */
function box(
  f: Frame,
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  color: number,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  g.translate(at[0], at[1] + size[1] / 2, at[2]);
  return paint(g, color, { aoSpan: f.span });
}

/** 원기둥 하나. `at` 은 (x 중심, y 바닥, z 중심). */
function cyl(
  f: Frame,
  rTop: number,
  rBottom: number,
  height: number,
  at: readonly [number, number, number],
  color: number,
  seg = 12,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, seg);
  g.translate(at[0], at[1] + height / 2, at[2]);
  return paint(g, color, { aoSpan: f.span });
}

/**
 * 손잡이. z 축으로 튀어나온 짧은 원기둥이다.
 *
 * 앞면에 붙는 장식은 면과 **정확히 같은 높이에 두지 않는다.** 겹치면 z-fighting 으로
 * 지글거리고, 안쪽에 넣으면 아예 안 보인다. 항상 아주 조금 앞으로 내민다.
 */
function knob(
  f: Frame,
  radius: number,
  len: number,
  at: readonly [number, number, number],
  color: number,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, len, 8);
  g.rotateX(Math.PI / 2);
  g.translate(at[0], at[1], at[2]);
  return paint(g, color, { aoSpan: f.span });
}

// ── kind 별 조립 ────────────────────────────────────────────────────────────

function buildSofa(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  const light = shade(color, 0.06);
  const cushion = shade(color, 0.18);

  return [
    // 굽 — 바닥에 닿는 부분을 어둡게 해서 떠 보이지 않게 한다.
    box(f, [bw * 0.96, h * 0.12, bd * 0.96], [0, 0, 0], WOOD_DARK),
    // 좌판
    box(f, [bw, h * 0.4, bd], [0, h * 0.12, 0], color),
    // 등받이
    box(f, [bw, h * 0.48, bd * 0.28], [0, h * 0.52, -bd * 0.36], light),
    // 팔걸이
    box(f, [bw * 0.08, h * 0.32, bd], [-bw * 0.46, h * 0.52, 0], light),
    box(f, [bw * 0.08, h * 0.32, bd], [bw * 0.46, h * 0.52, 0], light),
    // 쿠션 두 장
    box(f, [bw * 0.38, h * 0.16, bd * 0.62], [-bw * 0.2, h * 0.52, bd * 0.08], cushion),
    box(f, [bw * 0.38, h * 0.16, bd * 0.62], [bw * 0.2, h * 0.52, bd * 0.08], cushion),
  ];
}

function buildChair(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  const light = shade(color, 0.07);

  return [
    box(f, [bw * 0.9, h * 0.1, bd * 0.9], [0, 0, 0], WOOD_DARK),
    box(f, [bw, h * 0.42, bd], [0, h * 0.1, 0], color),
    box(f, [bw, h * 0.48, bd * 0.3], [0, h * 0.52, -bd * 0.35], light),
    box(f, [bw * 0.12, h * 0.3, bd * 0.9], [-bw * 0.44, h * 0.52, bd * 0.05], light),
    box(f, [bw * 0.12, h * 0.3, bd * 0.9], [bw * 0.44, h * 0.52, bd * 0.05], light),
    box(f, [bw * 0.52, h * 0.14, bd * 0.5], [0, h * 0.52, bd * 0.12], shade(color, 0.18)),
  ];
}

function buildTable(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  const light = shade(color, 0.08);
  const parts = [
    // 굽 → 몸통 → 상판. 다리 대신 통짜 몸통을 쓰는 이유는 파일 머리말 참고.
    box(f, [bw * 0.98, h * 0.06, bd * 0.98], [0, 0, 0], WOOD_DARK),
    box(f, [bw * 0.86, h * 0.72, bd * 0.86], [0, h * 0.06, 0], shade(color, -0.06)),
    box(f, [bw, h * 0.14, bd], [0, h * 0.78, 0], light),
    // 서랍 — 앞면(+z)에 결만 넣는다. 몸통이 안쪽으로 들어가 있어 여기가 앞면이다.
    box(f, [bw * 0.66, h * 0.3, bd * 0.05], [0, h * 0.34, bd * 0.43], light),
  ];
  parts.push(knob(f, bw * 0.03, bd * 0.08, [0, h * 0.49, bd * 0.46], METAL));
  return parts;
}

function buildShelf(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  const light = shade(color, 0.08);
  const parts = [
    // 뒤판 — 이게 없으면 선반 사이로 방이 비쳐서 "지나갈 수 있는 가구" 로 보인다.
    box(f, [bw, h, bd * 0.12], [0, 0, -bd * 0.44], shade(color, -0.14)),
    box(f, [bw, h * 0.07, bd], [0, 0, 0], shade(color, -0.08)),
    box(f, [bw, h * 0.05, bd], [0, h * 0.95, 0], light),
    box(f, [bw * 0.06, h, bd], [-bw * 0.47, 0, 0], light),
    box(f, [bw * 0.06, h, bd], [bw * 0.47, 0, 0], light),
  ];

  // 선반 3장 + 그 위의 책
  for (let s = 1; s <= 3; s++) {
    const y = h * (0.07 + s * 0.22);
    parts.push(box(f, [bw * 0.88, h * 0.025, bd * 0.9], [0, y, 0], light));

    const count = 6;
    for (let i = 0; i < count; i++) {
      const bwBook = bw * 0.07;
      const gap = bw * 0.022;
      const startX = -bw * 0.4 + s * bw * 0.04;
      const tall = h * (0.16 + ((i + s) % 3) * 0.018);
      parts.push(
        box(
          f,
          [bwBook, tall, bd * 0.5],
          [startX + i * (bwBook + gap), y + h * 0.025, bd * 0.02],
          BOOK_COLORS[(i + s * 2) % BOOK_COLORS.length]!,
        ),
      );
    }
  }
  return parts;
}

function buildCabinet(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  const light = shade(color, 0.08);
  const parts = [
    box(f, [bw * 0.94, h * 0.08, bd * 0.94], [0, 0, 0], WOOD_DARK),
    box(f, [bw, h * 0.84, bd], [0, h * 0.08, 0], color),
    box(f, [bw, h * 0.08, bd], [0, h * 0.92, 0], light),
    // 문 두 짝
    box(f, [bw * 0.46, h * 0.68, bd * 0.06], [-bw * 0.24, h * 0.16, bd * 0.48], light),
    box(f, [bw * 0.46, h * 0.68, bd * 0.06], [bw * 0.24, h * 0.16, bd * 0.48], light),
  ];
  for (const side of [-1, 1]) {
    parts.push(knob(f, bw * 0.018, bd * 0.12, [side * bw * 0.04, h * 0.5, bd * 0.54], METAL));
  }
  return parts;
}

function buildTv(f: Frame): { parts: THREE.BufferGeometry[]; glow: GlowPart[] } {
  const { bw, bd, h, color } = f;
  const light = shade(color, 0.1);
  const parts = [
    box(f, [bw * 0.94, h * 0.06, bd * 0.94], [0, 0, 0], WOOD_DARK),
    box(f, [bw, h * 0.34, bd], [0, h * 0.06, 0], color),
    box(f, [bw, h * 0.05, bd], [0, h * 0.4, 0], light),
    // 받침대 목
    box(f, [bw * 0.08, h * 0.08, bd * 0.24], [0, h * 0.45, 0], shade(color, -0.16)),
    // 화면 테두리
    box(f, [bw * 0.66, h * 0.46, bd * 0.14], [0, h * 0.53, -bd * 0.04], 0x23282d),
  ];
  // 열린 수납칸 (어두운 홈) — 정면에 깊이감을 준다
  for (const side of [-1, 1]) {
    parts.push(
      box(f, [bw * 0.4, h * 0.22, bd * 0.04], [side * bw * 0.23, h * 0.12, bd * 0.49], 0x2b3036),
    );
  }

  const screen = new THREE.BoxGeometry(bw * 0.58, h * 0.38, bd * 0.02);
  screen.translate(0, h * 0.57 + (h * 0.38) / 2, bd * 0.04);
  return { parts, glow: [{ geometry: screen, color: 0x9ad4e6 }] };
}

function buildBox(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  const parts = [
    box(f, [bw, h * 0.86, bd], [0, 0, 0], color),
    // 뚜껑은 위가 평평해야 한다 — 등반 가능한 가구라 도마뱀이 여기 올라선다.
    box(f, [bw, h * 0.14, bd], [0, h * 0.86, 0], shade(color, 0.1)),
    // 허리띠는 몸통보다 아주 조금 크게 — 같은 크기로 두면 옆면이 겹쳐 지글거린다.
    box(f, [bw * 1.02, h * 0.08, bd * 1.02], [0, h * 0.36, 0], shade(color, -0.12)),
  ];
  // 앞면 블록 무늬
  for (let i = 0; i < BLOCK_COLORS.length; i++) {
    parts.push(
      box(
        f,
        [bw * 0.12, h * 0.12, bd * 0.04],
        [-bw * 0.3 + i * bw * 0.2, h * 0.6, bd * 0.5],
        BLOCK_COLORS[i]!,
      ),
    );
  }
  return parts;
}

function buildPlant(f: Frame): THREE.BufferGeometry[] {
  const { bw, h, color } = f;
  const r = bw / 2;
  const parts = [
    cyl(f, r * 0.78, r * 0.58, h * 0.3, [0, 0, 0], 0xb4735a),
    cyl(f, r * 0.82, r * 0.8, h * 0.05, [0, h * 0.28, 0], 0xc98a6c),
    cyl(f, r * 0.7, r * 0.7, h * 0.03, [0, h * 0.31, 0], 0x4a3624),
    cyl(f, r * 0.06, r * 0.08, h * 0.4, [0, h * 0.32, 0], 0x6f8f4a, 6),
  ];

  // 잎 — 원뿔을 기울여 사방으로 편다. 화분 반경 밖으로 나가지 않게 길이를 잡는다.
  const leaves = 5;
  for (let i = 0; i < leaves; i++) {
    const angle = (i / leaves) * Math.PI * 2;
    const tilt = 0.5 + (i % 2) * 0.25;
    const len = h * (0.4 - (i % 2) * 0.06);
    const g = new THREE.ConeGeometry(r * 0.3, len, 5);
    g.translate(0, len / 2, 0);
    g.rotateX(-tilt);
    g.rotateY(angle);
    g.translate(0, h * (0.62 - (i % 2) * 0.06), 0);
    parts.push(paint(g, i % 2 === 0 ? color : shade(color, -0.08), { aoSpan: f.span }));
  }
  return parts;
}

function buildLamp(f: Frame): { parts: THREE.BufferGeometry[]; glow: GlowPart[] } {
  const { bw, h } = f;
  const r = bw / 2;
  const parts = [
    cyl(f, r * 0.7, r * 0.85, h * 0.03, [0, 0, 0], WOOD_DARK),
    cyl(f, r * 0.08, r * 0.08, h * 0.78, [0, h * 0.03, 0], METAL, 8),
  ];

  const shadeH = h * 0.19;
  const shadeGeo = new THREE.CylinderGeometry(r * 0.55, r * 0.95, shadeH, 12, 1, true);
  shadeGeo.translate(0, h * 0.81 + shadeH / 2, 0);
  return { parts, glow: [{ geometry: shadeGeo, color: 0xffe6a8 }] };
}

function buildBowl(f: Frame): THREE.BufferGeometry[] {
  const { bw, h, color } = f;
  const r = bw / 2;
  return [
    cyl(f, r, r * 0.8, h, [0, 0, 0], color, 14),
    // 안쪽을 어둡게 파 보이게 한다
    cyl(f, r * 0.78, r * 0.7, h * 0.12, [0, h * 0.9, 0], shade(color, -0.22), 14),
  ];
}

function buildBlanket(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  // 담요는 부푼 반구. 도마뱀이 밑에 숨는 은신처라 실루엣이 낮고 둥글어야 한다.
  const dome = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(bw / 2, h * 4, bd / 2);

  // 바닥에 펼쳐진 자락. 똥 땅(y 0.006)보다 위에 둬야 담요가 덮여 보인다.
  // 부푼 부분보다 **작아야** 한다 — 더 크면 자락이 봉우리를 덮어 팬케이크가 된다.
  const spread = new THREE.CircleGeometry(1, 18);
  spread.rotateX(-Math.PI / 2);
  spread.scale(bw * 0.46, 1, bd * 0.46);
  spread.translate(0, h * 0.5 + 0.012, 0);

  return [
    paint(dome, color, { aoSpan: f.span }),
    paint(spread, shade(color, -0.1), { aoSpan: f.span, flat: true }),
  ];
}

function buildBall(f: Frame): THREE.BufferGeometry[] {
  const { bw, h, color } = f;
  const r = Math.min(bw, h) / 2;

  const ball = new THREE.SphereGeometry(r, 12, 10);
  ball.translate(0, r, 0);

  // 흰 띠 하나로 공이라는 걸 알린다. 구를 반쪽씩 칠할 수 없으니 얇은 고리를 두른다.
  const band = new THREE.TorusGeometry(r * 0.99, r * 0.16, 6, 16);
  band.rotateY(Math.PI / 6);
  band.translate(0, r, 0);

  return [
    paint(ball, color, { aoSpan: f.span }),
    paint(band, 0xf6f1e4, { aoSpan: f.span }),
  ];
}

function buildBooks(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  const covers = [color, shade(color, 0.14), 0xd4685a];
  const parts: THREE.BufferGeometry[] = [];

  // 세 권을 조금씩 어긋나게 쌓는다. 각도가 같으면 벽돌처럼 보인다.
  for (let i = 0; i < 3; i++) {
    const g = new THREE.BoxGeometry(bw * (1 - i * 0.08), h / 3, bd * (1 - i * 0.06));
    g.rotateY((i - 1) * 0.22);
    g.translate(0, (i + 0.5) * (h / 3), 0);
    parts.push(paint(g, covers[i]!, { aoSpan: f.span }));
  }
  return parts;
}

function buildDoor(f: Frame): THREE.BufferGeometry[] {
  const { bw, bd, h, color } = f;
  const frameColor = shade(color, 0.12);
  return [
    box(f, [bw, h, bd * 0.5], [0, 0, -bd * 0.1], frameColor),
    box(f, [bw * 0.78, h * 0.94, bd * 0.6], [0, 0, bd * 0.06], color),
    // 문살
    box(f, [bw * 0.5, h * 0.34, bd * 0.06], [0, h * 0.14, bd * 0.36], shade(color, -0.1)),
    box(f, [bw * 0.5, h * 0.34, bd * 0.06], [0, h * 0.54, bd * 0.36], shade(color, -0.1)),
    knob(f, bw * 0.045, bd * 0.2, [bw * 0.28, h * 0.5, bd * 0.42], METAL),
  ];
}

// ── 조립 진입점 ─────────────────────────────────────────────────────────────

/**
 * 앞면이 카메라를 향하도록 돌리는 각도.
 *
 * 벽 쪽으로 등을 돌리는 게 자연스러워 보이지만, 이 방은 **먼 쪽(−x·−z)에만 벽이 있고**
 * 카메라는 항상 남동쪽(+x, +z)에서 내려다본다. 그래서 벽 기준으로 돌리면 남쪽·동쪽
 * 가구는 등만 보인다 — 책장에 책을 꽂아 넣고 뒤판만 보게 되는 식이다.
 * 앞면을 카메라로 돌리면 북·서쪽 가구는 등이 자연스럽게 벽에 붙고, 남·동쪽 가구도
 * 정면을 보여 준다.
 *
 * 폭이 긴 축을 벽을 따라가는 축으로 본다. 90° 회전은 x·z 범위를 맞바꾸므로
 * 그때는 조립 치수(bw·bd)를 미리 바꿔 둔다 — 그러지 않으면 AABB 와 메시가 어긋난다.
 */
function frontYaw(def: FurnitureDef): number {
  return def.w >= def.d ? 0 : Math.PI / 2;
}

const SYMMETRIC: ReadonlySet<FurnitureKind> = new Set([
  'table',
  'plant',
  'lamp',
  'bowl',
  'box',
  'ball',
  'books',
]);

export function buildFurniture(def: FurnitureDef): BuiltFurniture {
  const swapped = def.w < def.d;
  const f: Frame = {
    bw: swapped ? def.d : def.w,
    bd: swapped ? def.w : def.d,
    h: def.h,
    color: def.color,
    span: [0, def.h],
  };

  let parts: THREE.BufferGeometry[];
  let glow: GlowPart[] = [];

  switch (def.kind) {
    case 'sofa':
      parts = buildSofa(f);
      break;
    case 'chair':
      parts = buildChair(f);
      break;
    case 'table':
      parts = buildTable(f);
      break;
    case 'shelf':
      parts = buildShelf(f);
      break;
    case 'cabinet':
      parts = buildCabinet(f);
      break;
    case 'tv': {
      const built = buildTv(f);
      parts = built.parts;
      glow = built.glow;
      break;
    }
    case 'box':
      parts = buildBox(f);
      break;
    case 'plant':
      parts = buildPlant(f);
      break;
    case 'lamp': {
      const built = buildLamp(f);
      parts = built.parts;
      glow = built.glow;
      break;
    }
    case 'bowl':
      parts = buildBowl(f);
      break;
    case 'blanket':
      parts = buildBlanket(f);
      break;
    case 'ball':
      parts = buildBall(f);
      break;
    case 'books':
      parts = buildBooks(f);
      break;
    case 'door':
      parts = buildDoor(f);
      break;
  }

  const geometry = mergeParts(parts);

  // 대칭인 소품은 돌릴 이유가 없다. 회전은 앞뒤가 있는 가구에만 적용한다.
  const yaw = SYMMETRIC.has(def.kind) ? 0 : frontYaw(def);
  // 메시는 y = def.h/2 에 놓이므로, 바닥 원점으로 조립한 것을 절반만큼 내린다.
  for (const g of [geometry, ...glow.map((p) => p.geometry)]) {
    if (yaw !== 0) g.rotateY(yaw);
    g.translate(0, -def.h / 2, 0);
  }
  return { geometry, glow };
}
