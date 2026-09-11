/**
 * 가구 하나를 어떤 Kenney 모델로 채울지 적은 **조립 지시서**. §0-2
 *
 * `furnitureLayout.ts` 의 AABB 는 손대지 않는다. 충돌·BLOCKED 비율·밸런스(§3)가
 * 전부 거기서 파생되므로, 겉모습을 바꾸겠다고 상자 크기를 건드리면 도달 시간
 * 계산이 통째로 무너진다. 여기서는 **그 상자를 무엇으로 채울지**만 정한다.
 *
 * ## 좌표 규약 — `furnitureBuilders.ts` 와 같다
 * 바닥이 y = 0, x 는 bw(벽을 따라가는 폭), z 는 bd(벽에서 나오는 깊이),
 * **앞면은 +z**. 값은 전부 bw·bd·h 에 대한 **비율**이다. 절대 좌표를 적지 않는다.
 * Kenney 키트도 앞면이 +z 라서 (등받이·물탱크가 −z 쪽에 있다) 그대로 맞는다.
 *
 * ## 왜 축마다 배율이 다른가
 * 이 게임의 거실은 16 x 12 인데 소파 높이는 0.75 다 — 바닥 넓이가 승패를
 * 가르는 게임(§3, 똥 땅 44%)이라 **가로로 늘어난 좌표계**를 쓴다. 그래서 어떤
 * 모델을 갖다 놔도 세로로 절반쯤 눌린다. 이건 버그가 아니라 이 게임의 비례다.
 * 눈에 거슬리는 건 세로 눌림이 아니라 **x 와 z 의 배율 차이**(가로로만 늘어난
 * 소파)이므로, 모델은 목표 상자와 xz 비율이 비슷한 것으로 고른다.
 *   예) 소파 4.0 x 1.6 (2.50) ← loungeDesignSofa 1.12 x 0.41 (2.73)
 *
 * ## `fills` 가 필요한 이유
 * 충돌은 AABB **전체**다 (`CollisionMap.ts`). 다리만 있는 탁자를 그대로 쓰면
 * 다리 사이가 뻥 뚫려 보이는데 실제로는 못 지나간다 — `furnitureBuilders.ts`
 * 머리말이 경고하는 "보이지 않는 벽"이 그대로 돌아온다. 키트 모델 아래의 빈
 * 공간은 어두운 굽으로 메운다. 예전 빌더가 하던 것과 같은 처리다.
 *
 * Three.js 를 import 하지 않는다. 여기는 데이터일 뿐이다. (§0-4)
 */

/**
 * 색 지정. 숫자면 그 색 그대로, 문자열이면 `FurnitureDef.color` 에서 파생한다.
 * 키트 고유색(나무·금속)은 그대로 두고 **그 가구의 정체성 색**만 갈아끼우려고 둔다 —
 * 소파는 주황, 안락의자는 자주, 장난감 상자는 파랑이어야 미니맵·기억과 맞는다.
 */
export type Tint = number | 'body' | 'bodyLight' | 'bodyDark' | 'plinth';

/** 키트 모델 하나를 상자 안 어디에 놓을지 */
export interface KitPartSpec {
  /** `public/models/<model>.glb` */
  model: string;
  /** 발판 중심에서의 x·z 오프셋 (bw·bd 배수). 기본 0 = 한가운데 */
  x?: number;
  z?: number;
  /** **바닥** 높이 (h 배수). 기본 0 = 바닥에 놓는다 */
  y?: number;
  /** 차지할 크기 (bw·bd·h 배수) */
  w: number;
  d: number;
  h: number;
  /** 조립 프레임 기준 y 회전 (라디안). 기본 0 = 앞면이 +z */
  yaw?: number;
  /** glTF 머티리얼 이름 → 덮어쓸 색 */
  tint?: Readonly<Record<string, Tint>>;
  /** 조명을 받지 않고 스스로 빛나야 하는 머티리얼 이름 */
  glow?: readonly string[];
}

/** 모델로는 못 막는 빈 곳을 메우는 상자 (파일 머리말 참고) */
export interface FillSpec {
  x?: number;
  z?: number;
  y?: number;
  w: number;
  d: number;
  h: number;
  color: Tint;
}

export interface FurnitureRecipe {
  parts: readonly KitPartSpec[];
  fills?: readonly FillSpec[];
}

/** 바닥에 닿는 굽. 예전 빌더의 `WOOD_DARK` 와 같은 의도다. */
const PLINTH: FillSpec = { w: 0.97, d: 0.97, h: 0.12, color: 'plinth' };

/** 키트 금속 — 다리·손잡이는 가구 색을 따라가면 안 된다 */
const METAL = 0x8f949c;

/**
 * 가구 id → 조립 지시서.
 *
 * **id 로 건다.** kind 로 걸면 `coffee-table` 과 `side-table` 이 같은 모델을 쓰게
 * 되는데, 둘은 크기도 역할도 달라서 같은 모델을 늘리면 한쪽이 반드시 어색해진다.
 * 여기 없는 id 는 `furnitureBuilders.ts` 의 예전 조립으로 떨어진다 —
 * 담요·식기·공처럼 키트에 대응물이 없는 소품이 그렇다.
 */
export const FURNITURE_MODELS: Readonly<Record<string, FurnitureRecipe>> = {
  // ── 소파 4.0 x 1.6 x 0.75 ────────────────────────────────────────────────
  // 등받이 없는 3인용. 쿠션 두 장을 등받이에 기대 세워 폭을 읽기 쉽게 한다.
  sofa: {
    parts: [
      {
        model: 'loungeDesignSofa',
        w: 1,
        d: 1,
        h: 1,
        tint: { carpetBlue: 'body', metal: METAL },
      },
      {
        model: 'pillow',
        x: -0.28,
        z: -0.18,
        y: 0.46,
        w: 0.11,
        d: 0.1,
        h: 0.38,
        tint: { carpet: 'bodyLight' },
      },
      {
        model: 'pillow',
        x: 0.28,
        z: -0.18,
        y: 0.46,
        w: 0.11,
        d: 0.1,
        h: 0.38,
        tint: { carpet: 'bodyLight' },
      },
    ],
    fills: [PLINTH],
  },

  // ── 탁자 2.0 x 1.2 x 0.45 ────────────────────────────────────────────────
  // 다리 사이가 뚫린 모델이라 굽을 눈높이(0.34)까지 올려 막는다. 파일 머리말 참고.
  'coffee-table': {
    parts: [
      { model: 'tableCoffee', w: 1, d: 1, h: 1, tint: { wood: 'body' } },
      {
        model: 'books',
        x: 0.2,
        z: 0.06,
        y: 1.0,
        w: 0.22,
        d: 0.3,
        h: 0.34,
        yaw: 0.4,
      },
    ],
    fills: [{ w: 0.88, d: 0.86, h: 0.78, color: 'bodyDark' }],
  },

  // ── 스탠드 0.6 x 0.6 x 1.7 ───────────────────────────────────────────────
  'floor-lamp': {
    parts: [
      {
        model: 'lampRoundFloor',
        w: 1,
        d: 1,
        h: 1,
        tint: { lamp: 'body', metal: METAL },
        glow: ['lamp'],
      },
    ],
  },

  // ── TV 장 3.0 x 0.8 x 1.1 ────────────────────────────────────────────────
  // 아래는 장, 위는 TV. 화면은 `glow` 로 빼서 조명과 무관하게 빛나게 한다.
  'tv-stand': {
    parts: [
      {
        model: 'cabinetTelevisionDoors',
        w: 1,
        d: 1,
        h: 0.46,
        tint: { wood: 'body', metal: METAL },
      },
      {
        model: 'televisionModern',
        z: -0.06,
        y: 0.46,
        w: 0.62,
        d: 0.5,
        h: 0.54,
        tint: { metal: 0x9ad4e6, metalDark: 0x23282d },
        glow: ['metal'],
      },
    ],
    fills: [PLINTH],
  },

  // ── 책장 (눕혀서 bw 3.0 x bd 1.0) x 1.9 ──────────────────────────────────
  // 뒤가 막힌 모델이라 예전 빌더처럼 뒤판을 따로 붙이지 않아도 된다.
  bookshelf: {
    parts: [
      { model: 'bookcaseClosedWide', w: 1, d: 1, h: 1, tint: { wood: 'body' } },
      // 선반 세 칸(y 0.12 / 0.37 / 0.62)에 책을 흩어 놓는다. 한 칸에 몰아 두면
      // 나머지 두 칸이 빈 서랍처럼 보여서 책장이 아니라 수납장으로 읽힌다.
      { model: 'books', x: -0.34, z: 0.04, y: 0.12, w: 0.12, d: 0.42, h: 0.16 },
      { model: 'books', x: -0.18, z: 0.04, y: 0.12, w: 0.1, d: 0.4, h: 0.13, yaw: 0.15 },
      { model: 'books', x: -0.05, z: 0.04, y: 0.37, w: 0.12, d: 0.42, h: 0.16, yaw: 0.2 },
      { model: 'books', x: 0.2, z: 0.04, y: 0.37, w: 0.11, d: 0.4, h: 0.14 },
      { model: 'books', x: 0.28, z: 0.04, y: 0.62, w: 0.12, d: 0.42, h: 0.16 },
      { model: 'books', x: -0.24, z: 0.04, y: 0.62, w: 0.1, d: 0.4, h: 0.13, yaw: -0.18 },
      { model: 'plantSmall1', x: 0.3, z: 0.02, y: 0.12, w: 0.09, d: 0.28, h: 0.17 },
    ],
    fills: [PLINTH],
  },

  // ── 안락의자 1.4 x 1.4 x 0.8 ─────────────────────────────────────────────
  armchair: {
    parts: [
      { model: 'loungeChair', w: 1, d: 1, h: 1, tint: { carpet: 'body' } },
    ],
    fills: [PLINTH],
  },

  // ── 협탁 1.0 x 1.0 x 0.55 ────────────────────────────────────────────────
  // 키트에서 세로 눌림이 가장 적은 조합이라 탁상등을 올려 실루엣을 세운다.
  'side-table': {
    parts: [
      { model: 'tableCoffeeSquare', w: 1, d: 1, h: 1, tint: { wood: 'body' } },
      {
        model: 'lampRoundTable',
        y: 1.0,
        w: 0.5,
        d: 0.5,
        h: 0.85,
        tint: { lamp: 0xffe6a8, metal: METAL },
        glow: ['lamp'],
      },
    ],
    fills: [{ w: 0.84, d: 0.84, h: 0.74, color: 'bodyDark' }],
  },

  // ── 수납장 2.4 x 0.9 x 1.0 ───────────────────────────────────────────────
  cabinet: {
    parts: [
      {
        model: 'cabinetTelevisionDoors',
        w: 1,
        d: 1,
        h: 1,
        tint: { wood: 'body', metal: METAL },
      },
      { model: 'plantSmall2', x: -0.3, y: 1.0, w: 0.1, d: 0.3, h: 0.3 },
      { model: 'books', x: 0.26, y: 1.0, w: 0.14, d: 0.36, h: 0.24, yaw: -0.3 },
    ],
    fills: [PLINTH],
  },

  // ── 장난감 상자 1.2 x 1.0 x 0.5 ──────────────────────────────────────────
  'toy-box': {
    parts: [
      {
        model: 'cardboardBoxClosed',
        w: 1,
        d: 1,
        h: 1,
        tint: { wood: 'body', woodDark: 'bodyDark' },
      },
    ],
  },

  // ── 화분 0.8 x 0.8 x 1.2 ─────────────────────────────────────────────────
  'plant-w': {
    parts: [{ model: 'pottedPlant', w: 0.86, d: 0.86, h: 1, tint: { plant: 'body' } }],
  },
  'plant-e': {
    parts: [
      { model: 'pottedPlant', w: 0.86, d: 0.86, h: 1, yaw: 1.1, tint: { plant: 'body' } },
    ],
  },

  // ── 책 더미 0.5 x 0.4 x 0.22 (밟고 지나가는 소품) ────────────────────────
  // 키트의 알록달록한 표지를 그대로 쓴다. 여기까지 가구 색을 강요하면 바닥이 죽는다.
  'book-stack': {
    parts: [{ model: 'books', w: 1, d: 1, h: 1, yaw: 0.35 }],
  },

  // ── 화장실 문 1.6 x 0.3 x 2.0 ────────────────────────────────────────────
  // 문짝이 아니라 **문틀**이다. 실제로 통과하는 자리(solid: false)라 가운데를
  // 막으면 안 된다 — 벽의 구멍과 정확히 겹쳐야 복도가 이어져 보인다.
  'bathroom-door': {
    parts: [{ model: 'doorwayOpen', w: 1, d: 1, h: 1, tint: { wood: 'body' } }],
  },
};

/** 이 파일이 쓰는 모델 전부. `preloadKit()` 에 넘긴다. */
export function furnitureModelNames(): string[] {
  const names = new Set<string>();
  for (const recipe of Object.values(FURNITURE_MODELS)) {
    for (const p of recipe.parts) names.add(p.model);
  }
  return [...names];
}
