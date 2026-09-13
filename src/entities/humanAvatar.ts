/**
 * 사람의 **몸**. 위치·말풍선은 `Human.ts` 가 맡고, 여기는 서 있는 모습과
 * 걷는 동작만 책임진다. (§24)
 *
 * 구현이 둘이다.
 *   ① `KitHumanAvatar`  — Kenney Animated Characters (CC0) 의 스킨드 모델.
 *                          얼굴 3종 중 하나를 골라 입히고 idle·run 클립을 돌린다.
 *   ② `PolyHumanAvatar` — 코드로 만든 예전 로우폴리 사람 (`humanBody.ts`).
 *                          모델을 못 받았을 때 떨어지는 자리다.
 *
 * 둘을 같은 인터페이스로 묶는 이유는 `Human.ts` 가 어느 쪽인지 몰라도 되게
 * 하려는 것이다 — 위치·회전·말풍선·그림자는 몸이 무엇이든 똑같이 다룬다.
 *
 * ## 얼굴은 왜 상태에서 오는가
 * 어떤 얼굴이 나올지는 판마다 달라야 재미있는데, 그걸 렌더 계층에서 뽑으면
 * 같은 시드가 같은 판을 만들지 않게 된다 (§0-5). 그래서 시스템이 `look` 이라는
 * 정수 하나를 시드 기반 난수로 정해 두고, **그 수를 얼굴로 바꾸는 일만** 여기서
 * 한다. 시스템은 얼굴이 몇 종류인지 알 필요가 없다 (§0-4).
 */

import * as THREE from 'three';
import { CONFIG } from '../core/GameConfig.ts';
import type { HumanState } from '../core/GameState.ts';
import {
  buildArmGeometry,
  buildBodyGeometry,
  buildLegGeometry,
  HIP_Y,
  SHOULDER_Y,
} from './humanBody.ts';
import {
  cloneKitScene,
  kitSceneLoaded,
  kitTexture,
  kitTextureLoaded,
} from '../world/modelKit.ts';

/** `public/models/human.glb` — `tools/convert-character.mjs` 가 굽는다 */
const HUMAN_MODEL = 'human';

/**
 * 얼굴 스킨. 파일은 `public/models/human-<이름>.png`.
 * `tools/convert-character.mjs` 의 `SKINS` 와 같아야 한다.
 *
 * 배포판의 `cyborgFemaleA` 는 뺐다 — 반쪽이 기계인 얼굴이라 이 집에 사는
 * 사람으로 읽히지 않는다. §24 의 인간은 괴물이 아니라 그냥 도마뱀을 귀여워하는
 * 집주인이고, 그게 이 적이 무서우면서도 우스운 이유다.
 */
const HUMAN_SKINS = [
  'human-skaterMaleA',
  'human-skaterFemaleA',
  'human-criminalMaleA',
] as const;

/**
 * 사람의 키 (world units).
 *
 * 예전 로우폴리 사람의 정수리(머리 중심 1.55 + 반지름 0.22 ≈ 1.77)에 맞춘다.
 * 여기를 바꾸면 §24 의 위압감이 바뀐다 — 도마뱀 눈높이가 0.34 라 사람의 키는
 * 곧 "올려다보는 정도" 다. 충돌은 `CONFIG.HUMAN_RADIUS` 가 따로 정한다.
 */
const HUMAN_HEIGHT = 1.8;

/** 이 정도보다 느리면 서 있는 것으로 본다 (world units/s) */
const IDLE_SPEED = 0.15;

/**
 * 모델 정면 보정 (라디안).
 *
 * `human.glb` 원본 모델은 얼굴(이목구비)과 달리기 애니메이션의 다리 스윙이
 * 로컬 +z 를 향하도록 구워져 있다.
 * 이 게임의 규약도 앞이 +z(`HumanState.facing` 을 그대로 `rotation.y` 에
 * 넣는다, 가구 키트와 로우폴리 사람도 같다)이므로, 보정 각도는 0이다.
 *
 * 내보내는 이유는 `tests/human-facing.test.ts` 가 이 값을 **에셋에서 실측한
 * 얼굴 방향과 맞춰 보기** 때문이다. 상수만 조용히 바꾸면 사람이 다시 옆걸음질
 * 치는데, 화면을 안 보면 아무도 모른다.
 */
export const KIT_MODEL_YAW = 0;

/**
 * 바인드 포즈(T 포즈) 기준 크기.
 *
 * `Box3.setFromObject()` 를 쓰면 안 된다 — 스킨드 메시에서는 그게 **현재 포즈**
 * 기준으로 계산되는데, 방금 복제한 스켈레톤은 아직 갱신 전이라 엉뚱한 값이 나온다.
 * 실제로 9000 units 가 나와서 사람이 개미만 하게 줄어든 적이 있다.
 * 지오메트리의 경계를 월드 행렬로 옮기면 포즈와 무관하게 늘 같은 값이 나온다.
 */
function bindPoseBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    box.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
  });
  return box;
}

export interface HumanAvatar {
  /** `Human.ts` 가 위치·회전을 거는 노드 */
  readonly object: THREE.Object3D;
  /** 얼굴을 고른다. `look` 은 시스템이 시드 난수로 정한 정수다. */
  setLook(look: number): void;
  /**
   * @param speed 이번 프레임에 실제로 움직인 속도 (world units/s)
   * @param dt 렌더 델타
   */
  update(state: HumanState, speed: number, dt: number): void;
  dispose(): void;
}

/** 키트 모델과 스킨이 전부 준비됐는지 */
export const humanModelReady = (): boolean =>
  kitSceneLoaded(HUMAN_MODEL) && HUMAN_SKINS.every(kitTextureLoaded);

/** 로딩 단계에 넘길 목록 */
export const humanSceneAssets = (): readonly string[] => [HUMAN_MODEL];
export const humanTextureAssets = (): readonly string[] => HUMAN_SKINS;

// ── ① 키트 스킨드 모델 ──────────────────────────────────────────────────────

class KitHumanAvatar implements HumanAvatar {
  readonly object = new THREE.Group();

  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction | null;
  private readonly run: THREE.AnimationAction | null;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly materials: THREE.MeshLambertMaterial[];
  /** 0 = 서 있음, 1 = 달림. 두 클립의 가중치를 이 값으로 섞는다. */
  private blend = 0;

  constructor() {
    const { scene, animations } = cloneKitScene(HUMAN_MODEL);

    // 모델은 원본 단위(수백 units)로 들어온다. 지오메트리도, 모델 자신의 변환도
    // 건드리지 않고 **바깥 그룹만** 줄인다 — 스킨드 메시의 지오메트리를 직접
    // 늘리면 바인드 행렬과 어긋나서 뼈가 살을 끌고 가지 못하고, 모델 루트의
    // 스케일을 덮어쓰면 FBX → glTF 변환이 거기 넣어 둔 단위 보정이 날아간다.
    const box = bindPoseBox(scene);
    const height = box.max.y - box.min.y;
    const k = height > 1e-6 ? HUMAN_HEIGHT / height : 1;
    this.object.scale.setScalar(k);
    // 바인드 포즈의 발바닥을 바닥(y = 0)에 맞춘다. 이 그룹이 이미 k 배라
    // 오프셋은 모델 단위로 적는다.
    scene.position.y -= box.min.y;
    scene.rotation.y = KIT_MODEL_YAW;
    this.object.add(scene);

    // 얼굴마다 재질을 미리 만들어 둔다. 플레이 중에 만들면 §8 의
    // "리소스 증가 0" 이 깨지고, 셰이더 컴파일로 그 프레임이 튄다.
    this.materials = HUMAN_SKINS.map(
      (skin) => new THREE.MeshLambertMaterial({ map: kitTexture(skin) }),
    );

    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      // 절두체 컬링을 끈다. 스킨드 메시의 경계는 **현재 포즈**에서 계산되는데
      // three 는 그걸 자동으로 다시 재지 않는다. 낡은 경계로 컬링하면 사람이
      // 각도에 따라 통째로 사라지고, 하필 그게 쫓기는 중이면 왜 하트가 깎였는지
      // 알 수 없게 된다. 메시 하나 1029 정점이라 늘 그리는 값이 더 싸다.
      mesh.frustumCulled = false;
      mesh.material = this.materials[0]!;
      this.meshes.push(mesh);
    });

    this.mixer = new THREE.AnimationMixer(scene);
    const clip = (name: string): THREE.AnimationAction | null => {
      const found = animations.find((c) => c.name === name);
      return found ? this.mixer.clipAction(found) : null;
    };
    this.idle = clip('idle');
    this.run = clip('run');
    // 둘 다 항상 돌리고 **가중치만** 섞는다. `crossFadeTo` 는 페이드가 진행되는
    // 중에 방향이 바뀌면(뛰다 서다 다시 뛰다) 상태가 꼬이는데, 사람은 가구에
    // 막혀 멈췄다 다시 가는 일이 잦아서 정확히 그 경우에 걸린다.
    this.idle?.play();
    this.run?.play();
    this.applyBlend();
  }

  setLook(look: number): void {
    // 시스템이 준 정수를 그대로 얼굴 수로 접는다. 음수가 들어와도 견디게 한다.
    const mat = this.materials[((look % this.materials.length) + this.materials.length) % this.materials.length]!;
    for (const mesh of this.meshes) mesh.material = mat;
  }

  private applyBlend(): void {
    this.idle?.setEffectiveWeight(1 - this.blend);
    this.run?.setEffectiveWeight(this.blend);
  }

  update(_state: HumanState, speed: number, dt: number): void {
    // 즉시 바꾸지 않고 보간한다. 멈춰 설 때마다 자세가 튀지 않게.
    const target = speed > IDLE_SPEED ? 1 : 0;
    this.blend += (target - this.blend) * Math.min(1, dt * 8);
    this.applyBlend();

    if (this.run) {
      // 걸음 속도를 실제 이동에 맞춘다. 고정 속도로 돌리면 배회할 때
      // (추격의 0.45배) 발이 바닥을 미끄러진다.
      this.run.timeScale = Math.max(0.35, speed / CONFIG.HUMAN_SPEED);
    }
    this.mixer.update(dt);
  }

  dispose(): void {
    // 지오메트리는 `cloneKitScene` 이 캐시와 **공유**한다. 여기서 dispose 하면
    // 다음 판에서 빈 사람이 나온다. 우리가 만든 재질만 정리한다.
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    for (const m of this.materials) m.dispose();
    this.meshes.length = 0;
    this.object.clear();
  }
}

// ── ② 코드로 만든 예전 사람 ─────────────────────────────────────────────────

class PolyHumanAvatar implements HumanAvatar {
  readonly object = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly material: THREE.MeshLambertMaterial;
  private readonly legs: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private walkPhase = 0;

  constructor() {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });

    const bodyGeo = buildBodyGeometry();
    const armGeo = buildArmGeometry();
    const legGeo = buildLegGeometry();
    this.geometries.push(bodyGeo, armGeo, legGeo);

    const torso = new THREE.Mesh(bodyGeo, this.material);
    torso.castShadow = true;
    this.object.add(torso);

    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.material);
      arm.position.set(side * 0.29, SHOULDER_Y, 0);
      arm.rotation.z = side * 0.14;
      arm.castShadow = true;
      this.object.add(arm);
      this.arms.push(arm);

      const leg = new THREE.Mesh(legGeo, this.material);
      leg.position.set(side * 0.13, HIP_Y, 0);
      leg.castShadow = true;
      this.object.add(leg);
      this.legs.push(leg);
    }
  }

  /** 얼굴이 한 종류뿐이라 고를 것이 없다. */
  setLook(): void {}

  update(state: HumanState, speed: number, dt: number): void {
    // 팔다리를 흔드는 속도도 실제 이동에서 뽑는다 — 키트 아바타와 같은 규칙이다.
    this.walkPhase += dt * (3 + (speed / CONFIG.HUMAN_SPEED) * 6);
    const swing = state.mode === 'chase' ? 0.6 : 0.4;
    for (let k = 0; k < this.legs.length; k++) {
      this.legs[k]!.rotation.x = Math.sin(this.walkPhase + k * Math.PI) * swing;
      // 팔은 다리와 반대로 흔든다. 같이 흔들면 걷는 게 아니라 행진처럼 보인다.
      this.arms[k]!.rotation.x = -Math.sin(this.walkPhase + k * Math.PI) * swing * 0.7;
    }
    // 추적 중에는 몸을 앞으로 기울인다 — 위협적으로 읽히게
    this.object.rotation.x = state.mode === 'chase' ? 0.12 : 0;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.material.dispose();
    this.geometries.length = 0;
    this.legs.length = 0;
    this.arms.length = 0;
    this.object.clear();
  }
}

/** 준비된 것 중 좋은 쪽으로 몸을 하나 만든다. */
export function createHumanAvatar(): HumanAvatar {
  return humanModelReady() ? new KitHumanAvatar() : new PolyHumanAvatar();
}
