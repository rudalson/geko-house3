/**
 * 미션 2 — 야외 캠프장 배치의 **유일한 정의 위치**. (§0-2)
 *
 * 거실(`furnitureLayout.ts`)과 같은 규칙을 그대로 따른다. 이 배열 하나에서
 * 렌더 메시 · 충돌 AABB · BLOCKED 셀이 모두 파생된다.
 *
 * ## 크기는 거실과 같다
 * 격자(40x30, 20 x 15 world units)를 그대로 쓴다. 바깥이라고 넓히면
 * `GameConfig` 의 밸런스 상수(§3)가 전부 다시 계산돼야 한다 — 방 크기는 도달
 * 시간에 제곱으로 들어간다. 대신 울타리로 경계를 긋고 그 너머를 숲으로 채워
 * "갇힌 방" 이 아니라 "울타리 친 마당" 으로 읽히게 한다 (`Outdoor.ts`).
 *
 * ## BLOCKED 비율도 거실에 맞춘다
 * `BalanceModel.ASSUMPTIONS.BLOCKED_RATIO` 는 거실 실측(126/1200)이다. 야외도
 * 그 근처(±5%)에 있어야 같은 상수로 같은 도달 시간이 나온다.
 * `tests/stages.test.ts` 가 이를 검증한다.
 *
 * ## 거실과 무엇이 다른가
 *   - 화장실이 없다. 변기(§14)는 선택지였을 뿐 클리어에 필요하지 않다.
 *   - 담요 대신 **침낭**이다 (kind 가 `blanket` 이라 은신 규칙이 그대로 붙는다).
 *   - 가운데가 비어 있는 건 같다 — 플레이어가 (0, 0) 에서 시작한다.
 *
 * 좌표계: 마당 중심이 원점. x ∈ [-10, 10], z ∈ [-7.5, 7.5].
 * id 는 거실과 겹치면 안 된다 — 키트 조립 지시서(`outdoorModels.ts`)를 id 로 찾는다.
 *
 * Three.js 를 import 하지 않는다. (§0-4)
 */

import type { FurnitureDef } from './furnitureLayout.ts';

// 울타리 가까이 놓는 소품은 **울타리에 붙인다.** 플레이어 지름(0.56)보다 좁은 틈을
// 남기면 통로처럼 보이는데 들어갈 수 없는 "보이지 않는 벽" 이 된다
// (`tests/stages.test.ts` — 거실의 같은 규칙과 같은 검사).

export const OUTDOOR_LAYOUT: readonly FurnitureDef[] = [
  // ── 서북쪽: 텐트와 침낭 ───────────────────────────────────────────────
  {
    id: 'camp-tent',
    kind: 'tent',
    x: -7.0,
    z: -6.3,
    w: 2.8,
    d: 2.4,
    h: 2.2,
    color: 0xe0874a,
    solid: true,
  },
  {
    // 은신처. kind 가 `blanket` 이라 ShelterSystem 이 담요와 똑같이 다룬다.
    // 텐트 입구 앞에 펼쳐 둔다 — 밟고 지나갈 수 있어야 하므로 solid: false.
    id: 'camp-bedroll',
    kind: 'blanket',
    x: -7.0,
    z: -3.55,
    w: 2.2,
    d: 1.1,
    h: 0.14,
    color: 0xd0583e,
    solid: false,
    label: '침낭',
  },

  // ── 서쪽: 모닥불과 통나무 의자 ─────────────────────────────────────────
  {
    id: 'campfire',
    kind: 'campfire',
    x: -5.2,
    z: 1.2,
    w: 1.5,
    d: 1.5,
    h: 0.35,
    color: 0x7a6a5c,
    solid: true,
  },
  {
    id: 'log-seat-n',
    kind: 'log',
    x: -5.2,
    z: -0.75,
    w: 2.2,
    d: 0.7,
    h: 0.45,
    color: 0x8a5a34,
    solid: true,
    climbable: true,
    label: '통나무',
  },
  {
    id: 'log-seat-w',
    kind: 'log',
    x: -7.35,
    z: 1.4,
    w: 0.7,
    d: 2.0,
    h: 0.45,
    color: 0x8a5a34,
    solid: true,
  },

  // ── 동북쪽: 작업장 ─────────────────────────────────────────────────────
  {
    id: 'workbench',
    kind: 'workbench',
    x: 6.4,
    z: -7.0,
    w: 2.0,
    d: 1.0,
    h: 0.85,
    color: 0x9c6f3e,
    solid: true,
    climbable: true,
    label: '작업대',
  },
  {
    id: 'barrel-a',
    kind: 'barrel',
    x: 9.6,
    z: -7.1,
    w: 0.8,
    d: 0.8,
    h: 1.1,
    color: 0x8a5a34,
    solid: true,
  },
  {
    id: 'barrel-b',
    kind: 'barrel',
    x: 9.6,
    z: -6.25,
    w: 0.8,
    d: 0.8,
    h: 1.1,
    color: 0x8a5a34,
    solid: true,
  },
  {
    id: 'wood-pile',
    kind: 'log',
    x: 3.9,
    z: -7.1,
    w: 1.4,
    d: 0.8,
    h: 0.4,
    color: 0xa9723f,
    solid: true,
  },
  {
    id: 'crate',
    kind: 'crate',
    x: 9.5,
    z: -2.4,
    w: 1.0,
    d: 1.7,
    h: 0.8,
    color: 0xb08850,
    solid: true,
    climbable: true,
    label: '나무 상자',
  },

  // ── 마당 안의 나무 ─────────────────────────────────────────────────────
  // AABB 는 **줄기 둘레**만 잡는다. 수관은 눈높이(0.34)보다 한참 위라 지나다닐
  // 수 있어야 하고, 수관 크기로 막으면 BLOCKED 비율이 통째로 무너진다.
  {
    id: 'yard-tree-ne',
    kind: 'tree',
    x: 1.2,
    z: -6.5,
    w: 0.8,
    d: 0.8,
    h: 5.4,
    color: 0x3f8f4a,
    solid: true,
  },
  {
    id: 'yard-tree-se',
    kind: 'tree',
    x: 6.4,
    z: 6.4,
    w: 0.8,
    d: 0.8,
    h: 5.6,
    color: 0xd9822b,
    solid: true,
  },
  {
    id: 'yard-tree-w',
    kind: 'tree',
    x: -9.6,
    z: -1.6,
    w: 0.8,
    d: 0.8,
    h: 5.6,
    color: 0x3f8f4a,
    solid: true,
  },
  {
    id: 'yard-tree-s',
    kind: 'tree',
    x: -4.4,
    z: 7.1,
    w: 0.8,
    d: 0.8,
    h: 5.0,
    color: 0x3f8f4a,
    solid: true,
  },
  {
    id: 'stump',
    kind: 'log',
    x: 3.4,
    z: -3.0,
    w: 0.9,
    d: 0.9,
    h: 0.55,
    color: 0x8a5a34,
    solid: true,
    climbable: true,
    label: '그루터기',
  },

  // ── 남쪽: 바위와 보물상자 ───────────────────────────────────────────────
  {
    id: 'rock-big',
    kind: 'rock',
    x: -8.6,
    z: 5.8,
    w: 1.6,
    d: 1.6,
    h: 0.9,
    color: 0x8d949a,
    solid: true,
    climbable: true,
    label: '바위',
  },
  {
    id: 'rock-mid',
    kind: 'rock',
    x: 2.4,
    z: 6.85,
    w: 1.7,
    d: 1.3,
    h: 0.8,
    color: 0x8d949a,
    solid: true,
  },
  {
    id: 'rock-small',
    kind: 'rock',
    x: -2.6,
    z: 4.6,
    w: 1.4,
    d: 1.2,
    h: 0.6,
    color: 0x8d949a,
    solid: true,
  },
  {
    id: 'rock-east',
    kind: 'rock',
    x: 9.5,
    z: 0.4,
    w: 1.0,
    d: 1.3,
    h: 0.7,
    color: 0x8d949a,
    solid: true,
  },
  {
    id: 'chest',
    kind: 'crate',
    x: 9.45,
    z: 3.4,
    w: 1.1,
    d: 1.0,
    h: 0.7,
    color: 0x9c6f3e,
    solid: true,
    climbable: true,
    label: '보물상자',
  },
  {
    id: 'signpost',
    kind: 'sign',
    x: -1.6,
    z: -7.35,
    w: 0.9,
    d: 0.3,
    h: 1.4,
    color: 0x9c6f3e,
    solid: true,
  },
] as const;
