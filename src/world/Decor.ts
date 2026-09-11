/**
 * 아무것도 막지 않는 배경 장식. 거실과 화장실 양쪽을 맡는다. (§25)
 *
 * ## 왜 바닥에는 거의 놓지 않는가
 * 이 게임의 화면은 **바닥이 대부분**이다 — 눈높이가 0.34 고 승패가 바닥 점유율로
 * 갈린다 (§3). 그래서 바닥에 러그를 깔면 방은 예뻐지지만 "여기가 내 땅인가" 가
 * 한 겹 흐려진다. 똥 땅은 갈색 텍스처 한 종류뿐이라 밑에 무늬가 깔리는 순간
 * 경계를 눈으로 따라가기 어려워진다. 장식은 **눈높이 위**로 올린다 —
 * 벽등·천장등은 아무리 늘려도 바닥 판독을 건드리지 않는다.
 * (화장실 바닥은 격자에서 빠져 있어 발매트를 깔아도 된다. §14)
 *
 * ## 좌표
 * 방 경계에서 파생시킨다. 충돌이 없으니 조금 어긋나도 "보이지 않는 벽"이 되지
 * 않지만, 벽 높이를 바꿨을 때 전등만 허공에 남는 건 막아야 한다.
 */

import * as THREE from 'three';
import { DERIVED } from '../core/GameConfig.ts';
import { BATHROOM_BOUNDS, BATHROOM_EXIT, SINK_POS } from './bathroomLayout.ts';
import { BATHROOM_WALL_H } from './Bathroom.ts';
import type { Disposable } from './Furniture.ts';
import { addKitProps, buildKitProps, type PropSpec } from './kitProps.ts';
import { LIVING_WALL_H } from './LivingRoom.ts';

/** 전구색 — `HouseScene` 의 스탠드 포인트 라이트와 같은 계열로 맞춘다 */
const BULB = 0xffe6a8;
const METAL = 0x9aa0a8;
const PORCELAIN = 0xf4f7f8;

/** 벽에 거는 물건을 벽면에서 이만큼 띄운다. 0 이면 벽과 겹쳐 지글거린다. */
const WALL_GAP = 0.04;

/** 화장실 거울의 두께 */
const MIRROR_D = 0.16;

/**
 * 벽면 이름.
 *
 * 동서남북을 쓰지 않는다. 이 저장소는 −z 를 `furnitureLayout.ts` 가 "남쪽",
 * `LivingRoom.ts`·`Bathroom.ts` 가 "북쪽" 이라고 부른다 — 이미 서로 반대다.
 * 새 코드가 어느 한쪽 편을 들면 읽는 사람이 매번 어느 규약인지 되짚어야 하므로
 * 축으로 적는다. 기존 파일의 표기는 그 파일 안에서는 일관되므로 건드리지 않는다.
 */
type Wall = '-x' | '+x' | '-z' | '+z';

/**
 * 벽등 하나. `along` 은 벽을 따라가는 좌표, `y` 는 등의 **아래쪽** 높이다.
 *
 * ⚠️ `lampWall` 은 키트에서 **혼자 앞뒤가 반대다.** 다른 모델은 앞면이 +z 인데
 * 이 모델만 갓이 −z 로 열리고 벽에 붙는 판이 +z 쪽에 있다. 그래서 회전값이
 * 다른 소품과 정확히 180도 어긋난다 — 그냥 맞춰 적으면 전부 벽을 향해 열린다
 * (실제로 그렇게 붙어서 종잇조각처럼 보였다).
 */
function sconce(wall: Wall, along: number, y: number): PropSpec {
  const hw = DERIVED.ROOM_W / 2;
  const hd = DERIVED.ROOM_H / 2;
  /** 벽에서 튀어나오는 깊이. 모델 비율(0.15 / 0.227)을 그대로 지킨다. */
  const out = 0.34;
  // 모델은 중심 기준으로 놓이므로, 벽에 붙는 판이 벽면에 닿으려면 절반만큼 띄운다.
  const off = out / 2 + WALL_GAP;

  const at: Record<Wall, readonly [number, number, number]> = {
    '-z': [along, y, -hd + off],
    '+z': [along, y, hd - off],
    '-x': [-hw + off, y, along],
    '+x': [hw - off, y, along],
  };
  // 갓이 방 안쪽으로 열리게 하는 각도 (위 경고 참고: 다른 소품의 반대다).
  const yaw: Record<Wall, number> = {
    '-z': Math.PI,
    '+z': 0,
    '-x': -Math.PI / 2,
    '+x': Math.PI / 2,
  };

  return {
    model: 'lampWall',
    at: at[wall],
    size: [0.52, 0.22, out],
    yaw: yaw[wall],
    tint: { lamp: BULB, metal: METAL },
    glow: ['lamp'],
  };
}

/**
 * 천장에 매다는 전등 하나. `drop` 은 천장에서 내려오는 길이다.
 *
 * 실제 광원을 달지는 않는다. 이 씬의 포인트 라이트는 스탠드 하나뿐이고
 * (`HouseScene`), 방마다 하나씩 늘리면 Lambert 머티리얼 전부가 재컴파일된다.
 * 갓을 발광 재질로 두는 것만으로 "켜져 있다" 는 읽힌다.
 */
function pendant(x: number, z: number, ceiling: number, drop: number): PropSpec {
  return {
    model: 'lampSquareCeiling',
    at: [x, ceiling - drop, z],
    size: [drop * 0.55, drop, drop * 0.55],
    tint: { lamp: BULB, metal: METAL },
    glow: ['lamp'],
  };
}

function livingRoomProps(): PropSpec[] {
  const ceiling = LIVING_WALL_H;
  return [
    pendant(-4, 0, ceiling, 1.1),
    pendant(4, 0, ceiling, 1.1),
    // 자리는 `LivingRoom.addWallDecor()` 가 이미 쓰고 있는 곳을 **비켜서** 잡는다.
    // 액자(x −2.6 / −1.3 / 2.8)·문(x 0.5)·창(z −1.2)·배너(z 3.2)·벽시계(x 1.4).
    // 겹치면 등이 액자를 뚫고 나오는데, 벽 장식은 §25 가 말하는 방향 감각의
    // 유일한 단서라 그게 망가지면 길을 잃는다.
    sconce('-z', -5.0, 1.6),
    sconce('-z', 4.6, 1.6),
    sconce('+z', -4.6, 1.6),
    sconce('-x', 2.6, 1.6),
    sconce('+x', 1.6, 1.6),
  ];
}

function bathroomProps(): PropSpec[] {
  const b = BATHROOM_BOUNDS;
  const ceiling = BATHROOM_WALL_H;

  return [
    // 욕조 — 동쪽 벽에 길게 붙인다. 변기(§6)로 가는 길목(남 → 북)을 비켜야
    // 도마뱀이 욕조를 관통해 지나가는 꼴을 보지 않는다. 화장실에는 가구 충돌이
    // 없다 (`bathroomLayout.insideBathroom` 은 경계만 본다).
    //
    // ⚠️ size 는 회전 **전** 모델 축이다. yaw −π/2 라 첫 값이 world z 폭이 된다.
    {
      model: 'bathtub',
      at: [b.maxX - 0.62, 0, -9.6],
      size: [2.4, 0.55, 1.1],
      yaw: -Math.PI / 2,
      // 욕조 바깥 판은 키트에서 `metalDark` 다. 이름만 보고 어둡게 두면 하얀
      // 욕조에 검은 치마를 두른 꼴이 된다 — 도기 계열로 끌어올린다.
      tint: { carpetWhite: PORCELAIN, metalLight: 0xdfe5e8, metalDark: 0xc3ccd1 },
    },
    // 거울 — 세면대(SINK_POS.x)와 같은 x 로 벽에 건다.
    // 모델은 중심 기준이라 두께의 절반만큼 벽에서 띄워야 벽 속에 반쯤 파묻히지 않는다.
    {
      model: 'bathroomMirror',
      at: [SINK_POS.x, 1.05, b.minZ + MIRROR_D / 2 + 0.01],
      size: [0.6, 0.72, MIRROR_D],
      tint: { glass: 0xcfe6ef, metal: METAL },
    },
    { model: 'trashcan', at: [-2.5, 0, -11.2], size: [0.34, 0.5, 0.34], tint: { metal: METAL } },
    // 발매트 — 화장실 바닥은 똥 땅 격자에서 빠져 있어 깔아도 판독을 해치지 않는다.
    {
      model: 'rugDoormat',
      at: [BATHROOM_EXIT.x, 0.004, b.maxZ - 0.55],
      size: [1.3, 0.02, 0.72],
    },
    // 천장등. 거실(3.0)보다 천장이 낮아(2.6) 덜 내려온다.
    pendant(BATHROOM_EXIT.x, (b.minZ + b.maxZ) / 2, ceiling, 0.8),
  ];
}

export class Decor implements Disposable {
  readonly group = new THREE.Group();
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor() {
    this.group.name = 'decor';
    const track = (x: THREE.BufferGeometry | THREE.Material): void => {
      this.disposables.push(x);
    };

    // 거실과 화장실을 따로 합친다. 하나로 합치면 복도 너머 화장실 장식 때문에
    // 거실에서도 절두체 컬링이 절대 걸리지 않는 큰 덩어리가 된다.
    addKitProps(this.group, buildKitProps(livingRoomProps()), track, {
      name: 'decor-living',
    });
    addKitProps(this.group, buildKitProps(bathroomProps()), track, {
      name: 'decor-bathroom',
      castShadow: true,
    });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.clear();
  }
}

/** 이 파일이 쓰는 모델 전부. `preloadKit()` 에 넘긴다. */
export function decorModelNames(): string[] {
  const names = new Set<string>();
  for (const p of [...livingRoomProps(), ...bathroomProps()]) names.add(p.model);
  return [...names];
}
