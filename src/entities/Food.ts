/**
 * 슈퍼푸드. 상태를 읽어 반영만 한다. 단방향. (§0-4)
 *
 * 슬롯 수가 고정(FOOD_MAX_CONCURRENT)이므로 메시를 미리 만들어 두고
 * 보이기/숨기기만 한다. 매 프레임 Geometry 를 만들지 않는다. (§20)
 */

import * as THREE from 'three';
import type { GameState } from '../core/GameState.ts';
import { isSparkling } from '../systems/InteractionSystem.ts';

const FOOD_COLOR = 0xff8c42;
const SPARK_COLOR = 0xffe066;

interface FoodMesh {
  group: THREE.Group;
  sparkle: THREE.Mesh;
}

export class FoodRenderer {
  readonly group = new THREE.Group();

  private readonly items: FoodMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private time = 0;

  constructor(count: number) {
    this.group.name = 'foods';

    const bodyGeo = this.track(new THREE.IcosahedronGeometry(0.17, 0));
    const bodyMat = this.track(new THREE.MeshLambertMaterial({ color: FOOD_COLOR }));
    const stemGeo = this.track(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 5));
    const stemMat = this.track(new THREE.MeshLambertMaterial({ color: 0x6b8f3a }));
    const sparkGeo = this.track(new THREE.RingGeometry(0.24, 0.3, 12));
    const sparkMat = this.track(
      new THREE.MeshBasicMaterial({
        color: SPARK_COLOR,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      }),
    );

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();

      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.18;
      body.castShadow = true;
      group.add(body);

      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.y = 0.36;
      group.add(stem);

      // 가까이 가면 나타나는 반짝임 링 (§15)
      const sparkle = new THREE.Mesh(sparkGeo, sparkMat);
      sparkle.rotation.x = -Math.PI / 2;
      sparkle.position.y = 0.02;
      sparkle.visible = false;
      group.add(sparkle);

      this.group.add(group);
      this.items.push({ group, sparkle });
    }
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    if (x instanceof THREE.BufferGeometry) this.geometries.push(x);
    else this.materials.push(x);
    return x;
  }

  update(state: GameState, dt: number): void {
    this.time += dt;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const food = state.foods[i];

      if (!food || !food.active) {
        item.group.visible = false;
        continue;
      }

      item.group.visible = true;
      item.group.position.set(food.pos.x, 0, food.pos.z);

      // 스폰 직후 튀어오르는 연출 + 상시 둥둥
      const age = state.elapsed - food.spawnedAt;
      const pop = age < 0.3 ? Math.min(1, age / 0.3) : 1;
      item.group.scale.setScalar(pop);
      item.group.position.y = Math.sin(this.time * 2.5 + i) * 0.05;
      item.group.rotation.y = this.time * 1.1 + i;

      const sparkling = isSparkling(state, food);
      item.sparkle.visible = sparkling;
      if (sparkling) {
        const s = 1 + Math.sin(this.time * 6) * 0.12;
        item.sparkle.scale.set(s, s, 1);
      }
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.items.length = 0;
    this.group.clear();
  }
}
