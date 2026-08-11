/**
 * 집 내부 씬 조립. 상태를 읽어 화면에 반영만 한다. (§0-4)
 */

import * as THREE from 'three';
import { Gecko } from '../entities/Gecko.ts';
import { TerritoryGrid } from '../entities/TerritoryGrid.ts';
import { FoodRenderer } from '../entities/Food.ts';
import { RobotVacuumRenderer } from '../entities/RobotVacuum.ts';
import { HumanRenderer, MAX_HUMANS } from '../entities/Human.ts';
import { TreatRenderer } from '../entities/Treat.ts';
import { MateGecko } from '../entities/MateGecko.ts';
import { ParticlePool } from '../entities/ParticlePool.ts';
import { CONFIG } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { Furniture } from '../world/Furniture.ts';
import { findFurniture } from '../world/furnitureLayout.ts';
import { LivingRoom } from '../world/LivingRoom.ts';
import { Bathroom } from '../world/Bathroom.ts';

export class HouseScene {
  readonly scene = new THREE.Scene();
  readonly gecko = new Gecko();
  readonly territory: TerritoryGrid;
  readonly foods = new FoodRenderer(CONFIG.FOOD_MAX_CONCURRENT);
  readonly vacuums = new RobotVacuumRenderer(CONFIG.VACUUM_COUNT);
  readonly humans = new HumanRenderer(MAX_HUMANS);
  readonly treats = new TreatRenderer(CONFIG.TREAT_MAX_CONCURRENT);
  readonly mate = new MateGecko();
  readonly particles = new ParticlePool();

  private readonly room = new LivingRoom();
  private readonly bathroom = new Bathroom();
  private readonly furniture = new Furniture();
  private readonly lights: THREE.Light[] = [];

  constructor(state: GameState) {
    this.scene.background = new THREE.Color(0x1a1410);
    this.territory = new TerritoryGrid(state);

    this.scene.add(this.room.group);
    this.scene.add(this.bathroom.group);
    this.scene.add(this.territory.mesh);
    this.scene.add(this.foods.group);
    this.scene.add(this.vacuums.group);
    this.scene.add(this.humans.group);
    this.scene.add(this.treats.group);
    this.scene.add(this.mate.group);
    this.scene.add(this.furniture.group);
    this.scene.add(this.gecko.group);
    this.scene.add(this.particles.mesh);

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
    const lampDef = findFurniture('floor-lamp');
    if (lampDef) {
      const lamp = new THREE.PointLight(0xffd9a0, 12, 6.5, 2);
      lamp.position.set(lampDef.x, lampDef.h * 0.9, lampDef.z);
      this.scene.add(lamp);
      this.lights.push(lamp);
    }
  }

  /** @param dt 렌더 델타 (가변). 연출 전용. */
  update(state: GameState, movedDistance: number, dt: number): void {
    this.territory.sync(state);
    this.territory.update(dt);
    this.foods.update(state, dt);
    this.vacuums.update(state, dt);
    this.humans.update(state, dt);
    this.treats.update(state, dt);
    this.mate.update(state, dt);
    this.gecko.update(state, movedDistance, dt);
    this.particles.update(dt);
    this.furniture.updateOcclusion(state.player.pos, dt);
    this.room.setNorthWallHidden(state.player.stance === 'BATHROOM', dt);
  }

  /** §8 재시작 요구사항 — GPU 리소스를 전부 해제한다. */
  dispose(): void {
    this.gecko.dispose();
    this.territory.dispose();
    this.foods.dispose();
    this.vacuums.dispose();
    this.humans.dispose();
    this.treats.dispose();
    this.mate.dispose();
    this.particles.dispose();
    this.furniture.dispose();
    this.room.dispose();
    this.bathroom.dispose();
    for (const l of this.lights) {
      l.dispose();
      this.scene.remove(l);
    }
    this.lights.length = 0;
    this.scene.clear();
  }
}
