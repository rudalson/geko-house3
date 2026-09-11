/**
 * 충돌과 무관한 키트 소품을 world 좌표에 바로 놓는다.
 *
 * `kitFurniture.ts` 와 나뉘어 있는 이유는 **좌표의 출처**가 다르기 때문이다.
 * 가구는 `furnitureLayout.ts` 의 AABB 에서 크기·자리가 파생되므로 여기에 좌표를
 * 적으면 §0-2 위반이다. 반면 전등·욕조처럼 아무것도 막지 않는 장식은 파생시킬
 * 원천이 없다 — 방 경계에서 상대 위치로 적는 수밖에 없고, 어긋나도 "보이지 않는
 * 벽" 이 생기지 않는다.
 *
 * 소품 전체를 **두 덩어리**(조명 받는 것 / 스스로 빛나는 것)로 합친다.
 * 장식 수십 개가 각자 draw call 을 먹으면 1인칭에서 방 전체가 한 화면에 들어올 때
 * 가장 비싼 프레임에서 그 값을 다 치르게 된다.
 */

import * as THREE from 'three';
import { fitKitModel, kitLoaded } from './modelKit.ts';
import { mergeParts, paint, paintFlat } from './vertexPaint.ts';

export interface PropSpec {
  /** `public/models/<model>.glb` */
  model: string;
  /** 놓을 자리 — x·z 는 **중심**, y 는 **바닥** (world units). 회전 **뒤**에 적용된다. */
  at: readonly [number, number, number];
  /**
   * 차지할 크기 (world units). 크기는 회전 **전에** 먹으므로 축은 **모델 기준**이다 —
   * `yaw: ±π/2` 로 세운 욕조라면 첫 값이 world z 폭이 된다. 여기서 헷갈리면
   * 욕조가 벽을 뚫고 나가는 식으로 조용히 어긋난다.
   */
  size: readonly [number, number, number];
  /** y 회전 (라디안). 0 이면 앞면이 +z 를 본다 (키트 공통 규약). */
  yaw?: number;
  /** glTF 머티리얼 이름 → 덮어쓸 색 */
  tint?: Readonly<Record<string, number>>;
  /** 조명을 받지 않아야 하는 머티리얼 이름 */
  glow?: readonly string[];
}

export interface BuiltProps {
  /** 조명을 받는 본체. 없으면 null. */
  lit: THREE.BufferGeometry | null;
  /** 스스로 빛나는 파트. 없으면 null. */
  unlit: THREE.BufferGeometry | null;
}

/**
 * 소품 목록을 최대 두 개의 지오메트리로 합친다.
 *
 * 아직 안 받아진 모델은 **조용히 건너뛴다.** 장식이라 없어도 게임이 성립하고,
 * 여기서 던지면 GLB 하나가 404 인 것만으로 방 전체가 사라진다.
 */
export function buildKitProps(specs: readonly PropSpec[]): BuiltProps {
  const lit: THREE.BufferGeometry[] = [];
  const unlit: THREE.BufferGeometry[] = [];

  for (const spec of specs) {
    if (!kitLoaded(spec.model)) continue;

    const fitted = fitKitModel(spec.model, {
      size: spec.size,
      at: spec.at,
      yaw: spec.yaw,
      tint: spec.tint,
      glowMaterials: spec.glow,
    });

    for (const part of fitted) {
      if (part.glow) {
        unlit.push(paintFlat(part.geometry, part.color));
      } else {
        // 가짜 AO 는 소품 **자신의** y 범위로 준다. 방 전체로 잡으면 천장등이
        // 통째로 검게 칠해진다 — 그건 바닥 근처를 어둡게 하려고 만든 장치다.
        lit.push(paint(part.geometry, part.color, { aoSpan: [spec.at[1], spec.at[1] + spec.size[1]] }));
      }
    }
  }

  return {
    lit: lit.length > 0 ? mergeParts(lit) : null,
    unlit: unlit.length > 0 ? mergeParts(unlit) : null,
  };
}

/** 합쳐 둔 소품을 그룹에 얹는다. 만들어진 리소스를 `track` 으로 넘겨 dispose 를 맡긴다. */
export function addKitProps(
  group: THREE.Group,
  built: BuiltProps,
  track: (x: THREE.BufferGeometry | THREE.Material) => void,
  opts: { castShadow?: boolean; name?: string } = {},
): void {
  if (built.lit) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(built.lit, mat);
    mesh.castShadow = opts.castShadow ?? false;
    mesh.receiveShadow = true;
    mesh.name = opts.name ?? 'kit-props';
    group.add(mesh);
    track(built.lit);
    track(mat);
  }
  if (built.unlit) {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(built.unlit, mat);
    mesh.name = `${opts.name ?? 'kit-props'}-glow`;
    group.add(mesh);
    track(built.unlit);
    track(mat);
  }
}
