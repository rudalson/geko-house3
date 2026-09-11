/**
 * 가구 배치의 **유일한 정의 위치**. §0-2
 *
 * 이 배열 하나에서 세 가지가 모두 파생된다.
 *   ① 렌더링 메시   → world/Furniture.ts
 *   ② 충돌 AABB     → world/CollisionMap.ts
 *   ③ BLOCKED 셀    → world/CollisionMap.ts → TerritorySystem
 *
 * 셋을 각각 손으로 적으면 반드시 어긋나고 "보이지 않는 벽" 버그가 생긴다.
 * 가구를 옮기려면 여기만 고친다.
 *
 * 좌표계: 거실 중심이 원점. x ∈ [-8, 8], z ∈ [-6, 6] (16 x 12 world units)
 * 각 항목의 (x, z) 는 **중심** 좌표이고 (w, d) 는 전체 너비·깊이다.
 *
 * Three.js 를 import 하지 않는다. (§0-4)
 */

export type FurnitureKind =
  | 'sofa'
  | 'table'
  | 'shelf'
  | 'cabinet'
  | 'chair'
  | 'plant'
  | 'lamp'
  | 'box'
  | 'tv'
  | 'blanket'
  | 'bowl'
  | 'ball'
  | 'books'
  | 'door';

export interface FurnitureDef {
  id: string;
  kind: FurnitureKind;
  /** 중심 좌표 (world units) */
  x: number;
  z: number;
  /** 전체 너비(x축) / 깊이(z축) */
  w: number;
  d: number;
  /** 높이. 렌더링과 카메라 가림 판정에만 쓴다. */
  h: number;
  /** 로우폴리 기본 색 */
  color: number;
  /**
   * true 면 통과 불가 + 격자에서 BLOCKED 로 제외된다.
   * 담요·식기처럼 밟고 지나갈 수 있는 소품은 false.
   */
  solid: boolean;
  /** `E` 로 올라갈 수 있는 낮은 가구인지 (§7 등반 규칙) */
  climbable?: boolean;
  /** 상호작용 안내에 쓸 이름 */
  label?: string;
}

/**
 * 거실 가구.
 *
 * ⚠️ BLOCKED 비율은 반드시 10~15% 를 유지해야 한다 (CONFIG.BLOCKED_RATIO_RANGE).
 *    벗어나면 ROADMAP §3 의 밸런스 계산이 무너진다. (위험요소 R1)
 *    현재 배치의 solid 면적 합 = 22.16 sq units ≈ 88.6셀 ≈ 11.5%
 *    tests/collision.test.ts 가 이를 검증한다.
 */
export const LIVING_ROOM_FURNITURE: readonly FurnitureDef[] = [
  // ── 서쪽: 소파 구역 ──────────────────────────────────────────────────
  {
    id: 'sofa',
    kind: 'sofa',
    x: -4.5,
    z: -5.2,
    w: 4.0,
    d: 1.6,
    h: 0.75,
    color: 0xd96f4e,
    solid: true,
    climbable: true,
    label: '소파',
  },
  {
    id: 'coffee-table',
    kind: 'table',
    x: -4.5,
    z: -2.2,
    w: 2.0,
    d: 1.2,
    h: 0.45,
    color: 0xa9723f,
    solid: true,
    climbable: true,
    label: '탁자',
  },
  {
    id: 'floor-lamp',
    kind: 'lamp',
    x: -7.7,
    z: -5.7,
    w: 0.6,
    d: 0.6,
    h: 1.7,
    color: 0xf2d06b,
    solid: true,
  },

  // ── 남쪽: TV 구역 ────────────────────────────────────────────────────
  {
    id: 'tv-stand',
    kind: 'tv',
    x: 4.8,
    z: -5.6,
    w: 3.0,
    d: 0.8,
    h: 1.1,
    color: 0x3f4a52,
    solid: true,
  },

  // ── 동쪽: 책장·의자 구역 ─────────────────────────────────────────────
  {
    id: 'bookshelf',
    kind: 'shelf',
    x: 7.5,
    z: -1.0,
    w: 1.0,
    d: 3.0,
    h: 1.9,
    color: 0x8a5a34,
    solid: true,
  },
  {
    id: 'armchair',
    kind: 'chair',
    x: 5.5,
    z: 1.2,
    w: 1.4,
    d: 1.4,
    h: 0.8,
    color: 0xc9556d,
    solid: true,
    climbable: true,
    label: '안락의자',
  },
  {
    id: 'side-table',
    kind: 'table',
    x: 3.6,
    z: 2.6,
    w: 1.0,
    d: 1.0,
    h: 0.55,
    color: 0xa9723f,
    solid: true,
    climbable: true,
    label: '협탁',
  },

  // ── 북쪽: 수납 구역 ──────────────────────────────────────────────────
  {
    id: 'cabinet',
    kind: 'cabinet',
    x: -1.0,
    z: 5.55,
    w: 2.4,
    d: 0.9,
    h: 1.0,
    color: 0x6b7f5c,
    solid: true,
  },
  {
    id: 'toy-box',
    kind: 'box',
    x: 0.5,
    z: 2.0,
    w: 1.2,
    d: 1.0,
    h: 0.5,
    color: 0x4f8fc0,
    solid: true,
    climbable: true,
    label: '장난감 상자',
  },

  // ── 화분 ─────────────────────────────────────────────────────────────
  { id: 'plant-w', kind: 'plant', x: -7.6, z: 0.5, w: 0.8, d: 0.8, h: 1.2, color: 0x5aa84f, solid: true },
  { id: 'plant-e', kind: 'plant', x: 7.6, z: 4.8, w: 0.8, d: 0.8, h: 1.2, color: 0x5aa84f, solid: true },

  // ── 밟고 지나갈 수 있는 소품 (solid: false → BLOCKED 아님) ───────────
  {
    id: 'blanket',
    kind: 'blanket',
    x: -5.8,
    z: 3.4,
    w: 2.2,
    d: 1.8,
    h: 0.08,
    color: 0xe8b4c8,
    solid: false,
    label: '강아지 담요',
  },
  {
    id: 'food-bowl',
    kind: 'bowl',
    x: 2.0,
    z: -2.0,
    w: 0.7,
    d: 0.7,
    h: 0.15,
    color: 0xdcdcdc,
    solid: false,
    label: '식기',
  },
  // 순수 장식. 밟고 지나갈 수 있어야 하므로 solid 는 반드시 false 다 —
  // true 로 두면 BLOCKED 비율(10~15%)이 흔들려 §3 의 밸런스 계산이 무너진다.
  {
    id: 'toy-ball',
    kind: 'ball',
    x: 1.9,
    z: 2.7,
    w: 0.34,
    d: 0.34,
    h: 0.34,
    color: 0xe05a5a,
    solid: false,
  },
  {
    id: 'book-stack',
    kind: 'books',
    // 수납장 옆에 두면 쿼터뷰에서 장 위에 얹힌 것처럼 보인다. 빈 바닥 한가운데로 뺀다.
    x: 2.6,
    z: 4.6,
    w: 0.5,
    d: 0.4,
    h: 0.22,
    color: 0x5f8fb4,
    solid: false,
  },
  {
    // 카메라가 남동쪽(+x, +z)에서 내려다보므로 남·동쪽에는 벽을 세우지 않는다.
    // 문을 그쪽에 두면 허공에 문짝만 서 있는 꼴이 되므로 북쪽 벽에 붙인다.
    // 북쪽 벽에서 소파(x −6.5~−2.5)와 TV장(x 3.3~6.3) 사이의 빈 구간.
    id: 'bathroom-door',
    kind: 'door',
    x: 0.5,
    z: -5.85,
    w: 1.6,
    d: 0.3,
    h: 2.0,
    color: 0x9a6b45,
    solid: false,
    label: '화장실 문',
  },
] as const;

// 배치는 모듈 상수라 결과가 변하지 않는다. 한 번만 걸러 두고 같은 배열을 돌려준다.
//
// `climbableFurniture()` 는 `findInteraction()` 안에서 불리고, 그건 HUD 안내를
// 갱신하려고 **매 렌더 프레임** 호출된다. 매번 filter 하면 초당 60개 이상의
// 배열이 만들어졌다 버려진다 — 한 판이면 2만 개가 넘는다. 프레임을 끊을 만한
// 양은 아니지만, 값이 절대 안 변하는데 계속 만들 이유도 없다.
const SOLID = LIVING_ROOM_FURNITURE.filter((f) => f.solid);
const CLIMBABLE = LIVING_ROOM_FURNITURE.filter((f) => f.climbable === true);

/** 통과 불가 가구만 (충돌·BLOCKED 계산용) */
export const solidFurniture = (): readonly FurnitureDef[] => SOLID;

/** 올라갈 수 있는 가구만 (§7) */
export const climbableFurniture = (): readonly FurnitureDef[] => CLIMBABLE;

export const findFurniture = (id: string): FurnitureDef | undefined =>
  LIVING_ROOM_FURNITURE.find((f) => f.id === id);

/** solid 가구가 차지하는 총 면적 (sq world units). BLOCKED 비율 검산용. */
export function solidArea(): number {
  return solidFurniture().reduce((sum, f) => sum + f.w * f.d, 0);
}

/** 거실 경계. `GameConfig.DERIVED` 와 같은 값이지만 이 파일은 순수해야 한다. */
const HALF_W = 8;
const HALF_D = 6;

/**
 * 가구를 조립하는 프레임과 세울 방향.
 *
 * ## 왜 방향을 여기서 정하는가
 * 쿼터뷰 시절에는 "앞면을 카메라(남동쪽)로 돌린다" 가 규칙이었다. 카메라가 방
 * 바깥에 있었으니 그게 곧 "잘 보이는 면" 이었다. 1인칭(§25)에서는 카메라가 방
 * **안**이라 그 규칙이 뒤집힌다 — 그대로 두면 동쪽 벽의 책장은 앞면을 벽에 처박고
 * 등판을 방 쪽으로 내밀며, 북쪽 수납장도 마찬가지다. 실제로 그런 상태였다.
 *
 * 1인칭에서 맞는 규칙은 하나다. **등을 가장 가까운 벽으로 돌린다.**
 *
 * ## 왜 축을 마음대로 고르지 못하는가
 * 회전각이 90°의 홀수 배면 메시의 x·z 범위가 맞바뀐다. AABB(def.w x def.d)는
 * 고정이므로, 어느 축으로 돌릴지는 **이미 정해져 있다** — 긴 변이 벽을 따라가야
 * 한다. 남은 자유는 "앞이냐 뒤냐" 하나뿐이라, 마주 보는 두 벽 중 가까운 쪽을 고른다.
 * 이 제약을 무시하고 가장 가까운 벽을 그냥 고르면 담요처럼 정사각형에 가까운
 * 소품에서 메시와 충돌 상자가 어긋난다.
 */
export interface FurnitureFrame {
  /** 벽을 따라가는 폭 (조립 시 x 축) */
  bw: number;
  /** 벽에서 나오는 깊이 (조립 시 z 축) */
  bd: number;
  /** 조립을 마친 뒤 걸 y 회전 (라디안) */
  yaw: number;
}

export function frameOf(def: FurnitureDef): FurnitureFrame {
  const swapped = def.w < def.d;
  const bd = swapped ? def.w : def.d;

  // 조립 프레임에서 등은 −z 다. 깊이 축이 회전 뒤 어디로 가는지에 따라
  // 등이 닿을 수 있는 벽이 둘로 좁혀지고, 그중 가까운 쪽을 고른다.
  const yaw = swapped
    ? // 깊이가 x 축으로 간다 → 등은 서쪽(+π/2) 아니면 동쪽(−π/2)
      def.x - bd / 2 + HALF_W <= HALF_W - (def.x + bd / 2)
      ? Math.PI / 2
      : -Math.PI / 2
    : // 깊이가 z 축에 남는다 → 등은 남쪽(0) 아니면 북쪽(π)
      def.z - bd / 2 + HALF_D <= HALF_D - (def.z + bd / 2)
      ? 0
      : Math.PI;

  return { bw: swapped ? def.d : def.w, bd, yaw };
}
