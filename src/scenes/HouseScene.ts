/**
 * 미션 씬 조립. 상태를 읽어 화면에 반영만 한다. (§0-4)
 *
 * 이름은 집이지만 미션 2(야외 캠프장)도 여기서 짓는다. 캐릭터·똥 땅·파티클은
 * 두 미션이 똑같고, 바뀌는 것은 **환경**(거실+화장실 ↔ 마당+숲)과 조명뿐이다.
 * 어느 쪽인지는 `state.stage` 가 정한다.
 */

import * as THREE from 'three';
import { Gecko } from '../entities/Gecko.ts';
import { GeckoSnout } from '../entities/GeckoSnout.ts';
import { TerritoryGrid } from '../entities/TerritoryGrid.ts';
import { FoodRenderer } from '../entities/Food.ts';
import { RobotVacuumRenderer } from '../entities/RobotVacuum.ts';
import { HumanRenderer, MAX_HUMANS } from '../entities/Human.ts';
import { TreatRenderer } from '../entities/Treat.ts';
import { MateGecko } from '../entities/MateGecko.ts';
import { HatchlingRenderer } from '../entities/Hatchling.ts';
import { ParticlePool } from '../entities/ParticlePool.ts';
import { CONFIG } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { Furniture } from '../world/Furniture.ts';
import { furnitureModelNames } from '../world/furnitureModels.ts';
import { outdoorModelNames } from '../world/outdoorModels.ts';
import {
  OUTDOOR_FOG_FAR,
  OUTDOOR_FOG_NEAR,
  OUTDOOR_SKY,
  Outdoor,
  outdoorDecorModelNames,
} from '../world/Outdoor.ts';
import type { StageDef } from '../world/stages.ts';
import { LivingRoom } from '../world/LivingRoom.ts';
import { Bathroom, BATHROOM_FIXTURE_MODELS } from '../world/Bathroom.ts';
import { Decor, decorModelNames } from '../world/Decor.ts';
import { humanSceneAssets, humanTextureAssets } from '../entities/humanAvatar.ts';
import type { KitAssets } from '../world/modelKit.ts';

/**
 * 이 씬이 쓰는 Kenney 에셋 전부. 로딩 단계가 이 목록을 미리 받아 둔다 (§16).
 *
 * 미션 2(야외)의 모델도 **처음 부팅할 때** 같이 받는다. 미션을 넘어가는 순간에
 * 받으면 클리어 화면 뒤에서 네트워크를 기다리게 되고, 받기 전에 씬을 지으면
 * 야외 소품이 전부 예전 상자로 나온다. 서바이벌 키트 모델은 개당 수십 kB 다.
 *
 * 목록을 손으로 적지 않고 각 모듈에서 모아 온다 — 손으로 적으면 레시피에 모델을
 * 하나 추가한 날 그 가구만 조용히 예전 상자로 되돌아간다. 그건 화면을 보기 전에는
 * 눈치채기 어려운 종류의 퇴행이다.
 */
export function houseAssets(): KitAssets {
  return {
    baked: [
      ...new Set([
        ...furnitureModelNames(),
        ...decorModelNames(),
        ...BATHROOM_FIXTURE_MODELS,
        ...outdoorModelNames(),
        ...outdoorDecorModelNames(),
      ]),
    ],
    scenes: humanSceneAssets(),
    textures: humanTextureAssets(),
  };
}

export class HouseScene {
  readonly scene = new THREE.Scene();
  readonly gecko = new Gecko();
  /**
   * 1인칭 주둥이. 카메라의 자식이라 씬이 아니라 **카메라에** 붙는다 (§25) —
   * Game 이 `snout.group` 을 카메라에 add 한다. 여기서 소유하는 이유는
   * 생명주기(재시작 시 dispose)가 씬의 다른 연출과 정확히 같기 때문이다.
   */
  readonly snout = new GeckoSnout();
  readonly territory: TerritoryGrid;
  readonly foods = new FoodRenderer(CONFIG.FOOD_MAX_CONCURRENT);
  readonly vacuums: RobotVacuumRenderer;
  /** 키트 에셋에 기대는 연출. `buildKitDependents()` 한 곳에서만 만든다. */
  private humans!: HumanRenderer;
  readonly treats = new TreatRenderer(CONFIG.TREAT_MAX_CONCURRENT);
  readonly mate = new MateGecko();
  readonly hatchlings = new HatchlingRenderer();
  readonly particles = new ParticlePool();

  private readonly stage: StageDef;
  /** 거실 바닥·벽. 야외에서는 없다 */
  private readonly room: LivingRoom | null;
  private furniture!: Furniture;
  /** 거실(미션 1)에서만 */
  private bathroom: Bathroom | null = null;
  private decor: Decor | null = null;
  /** 야외(미션 2)에서만 */
  private outdoor: Outdoor | null = null;
  private readonly lights: THREE.Light[] = [];

  constructor(state: GameState) {
    this.stage = state.stage;
    const outdoor = !this.stage.hasBathroom;
    this.territory = new TerritoryGrid(state);
    // 야외에서는 청소기 대신 잔디깎이다. 하는 일은 같고 겉모습만 다르다.
    this.vacuums = new RobotVacuumRenderer(CONFIG.VACUUM_COUNT, outdoor ? 'mower' : 'vacuum');

    this.room = outdoor ? null : new LivingRoom();
    if (this.room) this.scene.add(this.room.group);
    this.scene.add(this.territory.mesh);
    this.scene.add(this.foods.group);
    this.scene.add(this.vacuums.group);
    this.scene.add(this.treats.group);
    this.scene.add(this.mate.group);
    this.scene.add(this.hatchlings.group);
    this.scene.add(this.gecko.group);
    this.buildKitDependents();
    // 1인칭이라 자기 몸은 화면에 나오지 않는다. 이유는 Gecko 클래스 주석 참고. (§25)
    this.gecko.setFirstPerson(true);
    this.scene.add(this.particles.mesh);

    if (outdoor) this.addOutdoorLights();
    else this.addHouseLights();
  }

  private addHouseLights(): void {
    this.scene.background = new THREE.Color(0x1a1410);

    // ── 조명 ──
    // 로우폴리 + 카툰 분위기라 그림자는 부드럽게, 대비는 약하게.
    const ambient = new THREE.AmbientLight(0xfff2d8, 1.5);
    this.scene.add(ambient);
    this.lights.push(ambient);

    const key = new THREE.DirectionalLight(0xffe9c4, 1.9);
    key.position.set(6, 12, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.0015;
    this.scene.add(key);
    this.lights.push(key);

    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.45);
    fill.position.set(-8, 6, -6);
    this.scene.add(fill);
    this.lights.push(fill);

    // 스탠드 주변의 따뜻한 웅덩이. 방향광만 있으면 어디를 봐도 밝기가 같아서
    // 넓은 바닥이 평평해 보인다. 위치는 가구 정의에서 파생시킨다 (§0-2).
    const lampDef = this.stage.find('floor-lamp');
    if (lampDef) {
      const lamp = new THREE.PointLight(0xffd9a0, 12, 6.5, 2);
      lamp.position.set(lampDef.x, lampDef.h * 0.9, lampDef.z);
      this.scene.add(lamp);
      this.lights.push(lamp);
    }
  }

  /**
   * 한낮의 햇빛. 거실보다 밝고 그림자가 또렷하다.
   *
   * 반구광을 쓰는 이유: 바깥에서는 아래쪽이 **잔디의 초록 반사광**을 받는다.
   * 앰비언트 한 색으로 채우면 바위·통나무의 그늘진 면이 거실처럼 크림색으로 떠서
   * 실내 조명을 밖에 들고 나온 것처럼 보인다.
   */
  private addOutdoorLights(): void {
    this.scene.background = new THREE.Color(OUTDOOR_SKY);
    // 들판 끝이 하늘로 녹아들게 한다. 안개가 없으면 160 x 160 들판의 모서리가 보인다.
    this.scene.fog = new THREE.Fog(OUTDOOR_SKY, OUTDOOR_FOG_NEAR, OUTDOOR_FOG_FAR);

    const hemi = new THREE.HemisphereLight(0xdff1ff, 0x5f8a3c, 1.4);
    this.scene.add(hemi);
    this.lights.push(hemi);

    const sun = new THREE.DirectionalLight(0xfff0d0, 2.3);
    sun.position.set(-8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // 울타리 바로 바깥 나무의 그림자까지 마당에 떨어지도록 거실보다 넓게 잡는다.
    sun.shadow.camera.left = -15;
    sun.shadow.camera.right = 15;
    sun.shadow.camera.top = 13;
    sun.shadow.camera.bottom = -13;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 45;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun);
    this.lights.push(sun);
  }

  /**
   * Kenney 키트에 기대는 연출을 전부 만든다.
   *
   * ⚠️ 키트 에셋을 쓰는 것은 **반드시 여기서만** 만든다. 생성자와 `applyModelKit()`
   *    두 군데에 나눠 적으면 한쪽에 빠뜨리기 쉽고, 그러면 그것만 조용히 예전
   *    모습으로 첫 판을 난다 — 실제로 사람(§24)을 빠뜨려서 모델은 멀쩡히 받아
   *    놓고 화면에는 예전 캡슐 사람이 나왔다. 만드는 자리를 하나로 두면
   *    애초에 빠뜨릴 자리가 없다.
   */
  private buildKitDependents(): void {
    this.furniture = new Furniture(this.stage.layout);
    if (this.stage.hasBathroom) {
      this.bathroom = new Bathroom();
      this.decor = new Decor();
    } else {
      this.outdoor = new Outdoor(this.stage);
    }
    this.humans = new HumanRenderer(MAX_HUMANS);
    for (const part of this.kitDependents()) this.scene.add(part.group);
  }

  private kitDependents(): readonly { group: THREE.Group; dispose(): void }[] {
    return [this.furniture, this.bathroom, this.decor, this.outdoor, this.humans].filter(
      (p): p is NonNullable<typeof p> => p !== null,
    );
  }

  private disposeKitDependents(): void {
    for (const part of this.kitDependents()) {
      this.scene.remove(part.group);
      part.dispose();
    }
  }

  /**
   * 키트 에셋이 다 받아진 뒤 다시 짓는다. 로딩 단계에서 한 번 부른다 (§16).
   *
   * 생성자를 async 로 만들지 않으려고 이렇게 나눴다. `HouseScene` 은 `Game` 의
   * 생성자에서 만들어지는데, 거기서 await 를 하려면 게임 전체의 기동 순서가
   * 비동기로 바뀐다 — 로딩 화면도 입력도 그 뒤로 밀린다. 대신 첫 판만 예전
   * 조립으로 한 번 지었다가 갈아엎는다. 화면에 나오기 전이라 보이지 않고,
   * 재시작부터는 캐시가 따뜻해서 생성자가 처음부터 모델로 짓는다.
   */
  applyModelKit(): void {
    this.disposeKitDependents();
    this.buildKitDependents();
  }

  /**
   * @param movedDistance 이번 프레임에 실제로 움직인 거리 (world units)
   * @param dt 렌더 델타 (가변). 연출 전용.
   * @param eye 카메라 위치. 눈이 파묻힌 소품을 걷어내는 데만 쓴다. (§25)
   */
  update(
    state: GameState,
    movedDistance: number,
    dt: number,
    eye: { x: number; y: number; z: number },
  ): void {
    this.territory.sync(state);
    this.territory.update(dt);
    this.foods.update(state, dt);
    this.vacuums.update(state, dt);
    this.humans.update(state, dt);
    this.treats.update(state, dt);
    this.mate.update(state, dt);
    this.hatchlings.update(state, dt);
    this.gecko.update(state, movedDistance, dt);
    this.snout.update(state, movedDistance, dt);
    this.particles.update(dt);
    this.furniture.updateNearFade(eye, dt);
    this.outdoor?.update(dt);
  }

  /** §8 재시작 요구사항 — GPU 리소스를 전부 해제한다. */
  dispose(): void {
    this.gecko.dispose();
    this.snout.dispose();
    this.territory.dispose();
    this.foods.dispose();
    this.vacuums.dispose();
    // 사람은 `disposeKitDependents()` 가 맡는다 — 여기서 또 부르면 두 번 해제된다.
    this.treats.dispose();
    this.mate.dispose();
    this.hatchlings.dispose();
    this.particles.dispose();
    this.disposeKitDependents();
    this.room?.dispose();
    for (const l of this.lights) {
      l.dispose();
      this.scene.remove(l);
    }
    this.lights.length = 0;
    this.scene.clear();
  }
}
