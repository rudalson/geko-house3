/**
 * Kenney Furniture Kit (CC0) 로더. `public/models/*.glb` 를 읽어
 * **정점에 색이 구워진 지오메트리 조각**으로 바꿔 준다.
 *
 * ## 왜 메시를 그대로 쓰지 않는가
 * `GLTFLoader` 가 돌려주는 씬을 통째로 `scene.add()` 하면 가장 쉽지만,
 * 이 저장소의 두 가지 전제가 무너진다.
 *   ① `Furniture.ts` 의 가림 페이드는 "가구 1개 = 메시 1개 + 머티리얼 1개" 를
 *      전제로 짜여 있다 (`vertexPaint.ts` 머리말과 같은 이유다).
 *   ② 모델 하나가 머티리얼 2~4개로 쪼개져 있어 draw call 이 가구 수의 몇 배가 된다.
 *
 * 그래서 glTF 머티리얼의 **색만 뽑아 정점에 굽고** 지오메트리를 합친다.
 * 결과물은 기존 `furnitureBuilders.ts` 가 만들던 것과 정확히 같은 모양이라
 * 그 아래(병합·페이드·dispose)를 하나도 고치지 않아도 된다.
 *
 * ## 캐시가 들고 있는 것
 * 파싱한 **원본** 조각이다. 가구를 조립할 때마다 `clone()` 해서 나눠 주므로,
 * 재시작(§8)이 가구 지오메트리를 전부 dispose 해도 캐시는 멀쩡하다 —
 * 두 번째 판은 네트워크를 다시 타지 않는다.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** `public/models/` 안의 파일 이름 (확장자 제외) */
export type KitModelName = string;

/**
 * 모델 한 덩어리를 이루는 조각 하나. glTF 머티리얼 하나가 조각 하나다.
 *
 * `material` 은 Kenney 키트가 쓰는 의미 있는 이름이다 — `wood`, `woodDark`,
 * `carpet`, `metal`, `lamp`, `plant` … 키트 전체가 이 몇 개를 돌려쓰기 때문에,
 * 이름만 보고 "이 조각이 천인가 나무인가" 를 알 수 있다. 가구별 색을 입힐 때
 * (§ `furnitureModels.ts` 의 `tint`) 이 이름을 열쇠로 쓴다.
 */
export interface KitPart {
  geometry: THREE.BufferGeometry;
  material: string;
  /** glTF baseColorFactor 를 sRGB 16진수로 바꾼 값 */
  color: number;
}

/** 파싱해 둔 모델. 조각과 전체 크기를 함께 들고 있다. */
interface CachedModel {
  parts: readonly KitPart[];
  /** 모델 원본 크기 (world units). 목표 AABB 로 맞출 때 분모가 된다. */
  size: THREE.Vector3;
  /** 모델 원본 bbox 의 최소점. 바닥·중심을 원점으로 옮길 때 쓴다. */
  min: THREE.Vector3;
}

const cache = new Map<KitModelName, CachedModel>();
let loader: GLTFLoader | null = null;

/**
 * 모델 파일 URL.
 *
 * `vite.config.ts` 가 `base: './'` 라 절대경로(`/models/…`)로 적으면 하위 경로에
 * 배포했을 때 404 가 난다. BASE_URL 을 거쳐야 dev·build·preview 가 모두 맞는다.
 */
const urlOf = (name: KitModelName): string => `${import.meta.env.BASE_URL}models/${name}.glb`;

/**
 * glTF 머티리얼에서 색을 뽑는다.
 *
 * `Color.getHex()` 는 기본이 sRGB 변환이고 `new THREE.Color(hex)` 가 그 역변환이라
 * `vertexPaint.paint()` 로 넘기면 정확히 되돌아온다. 여기서 직접 선형 값을 꺼내면
 * 키트 전체가 한 단계 밝게 나온다.
 */
function colorOf(material: THREE.Material): number {
  const m = material as Partial<THREE.MeshStandardMaterial>;
  return m.color ? m.color.getHex() : 0xffffff;
}

/**
 * GLB 하나를 파싱해 캐시에 넣는다. 이미 있으면 아무것도 하지 않는다.
 *
 * 노드 변환(`matrixWorld`)을 지오메트리에 구워 넣는다 — Kenney 모델 일부는
 * 루트 노드에 scale 2 를 걸고 자식을 0.5 로 되돌리는 식이라, 변환을 무시하면
 * 화분 같은 모델이 절반 크기로 나온다.
 */
async function loadOne(name: KitModelName): Promise<void> {
  if (cache.has(name)) return;

  loader ??= new GLTFLoader();
  const gltf = await loader.loadAsync(urlOf(name));

  gltf.scene.updateMatrixWorld(true);

  const parts: KitPart[] = [];
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    // 합칠 때 속성 집합이 같아야 한다 (`vertexPaint.mergeParts`). uv 는 이 키트에서
    // 아무도 쓰지 않는데(텍스처가 없다) 모델마다 있고 없고가 달라 병합을 깨뜨린다.
    geo.deleteAttribute('uv');
    geo.deleteAttribute('uv1');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();

    const mat = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
    parts.push({ geometry: geo, material: mat.name || 'default', color: colorOf(mat) });

    // 파싱 결과는 우리가 복제해서 쓴다. 원본은 GPU 에 올라간 적이 없지만
    // three 가 만든 머티리얼은 남으므로 여기서 정리한다.
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    mesh.geometry.dispose();
  });

  if (parts.length === 0) throw new Error(`modelKit: ${name}.glb 에 메시가 없다`);

  const bbox = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    bbox.union(tmp.copy(p.geometry.boundingBox!));
  }

  cache.set(name, {
    parts,
    size: bbox.getSize(new THREE.Vector3()),
    min: bbox.min.clone(),
  });
}

/**
 * 쓸 모델을 전부 미리 받아 둔다. 로딩 화면의 한 단계로 부른다 (§16).
 *
 * 플레이 중에 처음 필요해진 모델을 그때 받으면 그 프레임이 통째로 멈춘다.
 * 게다가 §8 의 "플레이 중 리소스 증가 0" 도 깨진다.
 */
export async function preloadKit(names: readonly KitModelName[]): Promise<void> {
  await Promise.all(names.map(loadOne));
}

/** 로드된 모델인지 */
export const kitLoaded = (name: KitModelName): boolean => cache.has(name);

/** 모델 하나를 목표 상자에 맞춰 놓을 때 쓰는 지시서 */
export interface FitSpec {
  /** 목표 상자 크기 (world units). 축마다 따로 늘린다. */
  size: readonly [number, number, number];
  /** 목표 상자 중심의 x·z 와 **바닥** y (world units) */
  at: readonly [number, number, number];
  //
  // `| undefined` 를 명시하는 이유: 이 저장소는 `exactOptionalPropertyTypes` 라
  // 부르는 쪽에서 `yaw: spec.yaw` 처럼 그대로 넘기려면 undefined 가 허용돼야 한다.
  // 없애면 호출부마다 조건부 스프레드를 쓰게 되고 읽기만 나빠진다.
  /** y 축 회전 (라디안). 크기를 맞춘 **뒤** 돌린다. */
  yaw?: number | undefined;
  /** 머티리얼 이름 → 덮어쓸 색. 없는 이름은 키트 색 그대로 둔다. */
  tint?: Readonly<Record<string, number>> | undefined;
  /** 조명을 받지 않고 스스로 빛나야 하는 머티리얼 이름 */
  glowMaterials?: readonly string[] | undefined;
}

/** `fitKitModel()` 의 결과. `paint()` 전 상태다. */
export interface FittedPart {
  geometry: THREE.BufferGeometry;
  color: number;
  /** true 면 `MeshBasicMaterial` 로 따로 그린다 (전구·화면) */
  glow: boolean;
}

/**
 * 모델을 목표 상자에 맞춘 조각들로 바꾼다.
 *
 * 모델 원본은 제각각인 자리에 놓여 있다 (x 는 0 에서 시작하고 z 는 음수로 뻗는 식).
 * 그걸 **x·z 는 중심, y 는 바닥** 이 원점에 오도록 옮긴 뒤 상자에 맞춰 늘린다.
 * 축마다 배율이 다른 건 의도다 — 이 게임의 방은 바닥 넓이가 중요해서 가로로
 * 늘어난 좌표계를 쓰고(거실 16x12 에 소파 폭 4.0, 높이 0.75), 가구를 등비로
 * 맞추면 충돌 상자만 크고 메시는 작은 "보이지 않는 벽" 이 된다.
 * 대신 x·z 사이의 비율 차이는 `furnitureModels.ts` 에서 모델을 고를 때 줄인다.
 */
export function fitKitModel(name: KitModelName, spec: FitSpec): FittedPart[] {
  const model = cache.get(name);
  if (!model) throw new Error(`modelKit: ${name} 이 아직 로드되지 않았다 — preloadKit 에 넣을 것`);

  const [sx, sy, sz] = spec.size;
  const [ax, ay, az] = spec.at;
  // 두께가 0 인 축(러그의 y)이 있으면 0 으로 나눈다. 1 로 두면 원본 그대로 남는다.
  const kx = model.size.x > 1e-6 ? sx / model.size.x : 1;
  const ky = model.size.y > 1e-6 ? sy / model.size.y : 1;
  const kz = model.size.z > 1e-6 ? sz / model.size.z : 1;

  const glowSet = new Set(spec.glowMaterials ?? []);
  const out: FittedPart[] = [];

  for (const part of model.parts) {
    const geo = part.geometry.clone();
    // ① 원본 bbox 기준으로 x·z 중심, y 바닥을 원점에 맞춘다
    geo.translate(
      -(model.min.x + model.size.x / 2),
      -model.min.y,
      -(model.min.z + model.size.z / 2),
    );
    // ② 목표 상자로 늘린다
    geo.scale(kx, ky, kz);
    // ③ 돌리고 제자리로 옮긴다
    if (spec.yaw) geo.rotateY(spec.yaw);
    geo.translate(ax, ay, az);
    // 축마다 배율이 다르면 법선이 어긋난다. 다시 계산하지 않으면 늘어난 면이
    // 엉뚱한 밝기로 칠해진다 — `paint()` 가 법선으로 명암을 만들기 때문이다.
    geo.computeVertexNormals();

    out.push({
      geometry: geo,
      color: spec.tint?.[part.material] ?? part.color,
      glow: glowSet.has(part.material),
    });
  }
  return out;
}
