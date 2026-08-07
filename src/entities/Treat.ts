/**
 * 특식 상자. 상태를 읽어 반영만 한다. 단방향. (§0-4, §24)
 * 슬롯 수가 고정이라 메시를 미리 만들어 두고 보이기/숨기기만 한다.
 */

import * as THREE from 'three';
import type { GameState } from '../core/GameState.ts';

const BOX_COLOR = 0xc9557d;
const RIBBON_COLOR = 0xffd166;

interface TreatMesh {
  group: THREE.Group;
  glow: THREE.Mesh;
}

export class TreatRenderer {
  readonly group = new THREE.Group();

  private readonly items: TreatMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private time = 0;

  constructor(count: number) {
    this.group.name = 'treats';

    const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
      if (x instanceof THREE.BufferGeometry) this.geometries.push(x);
      else this.materials.push(x);
      return x;
    };

    const boxGeo = track(new THREE.BoxGeometry(0.34, 0.3, 0.34));
    const boxMat = track(new THREE.MeshLambertMaterial({ color: BOX_COLOR }));
    const ribbonGeo = track(new THREE.BoxGeometry(0.38, 0.06, 0.08));
    const ribbonMat = track(new THREE.MeshLambertMaterial({ color: RIBBON_COLOR }));
    const glowGeo = track(new THREE.RingGeometry(0.3, 0.42, 16));
    const glowMat = track(
      new THREE.MeshBasicMaterial({
        color: RIBBON_COLOR,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    );

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();

      const box = new THREE.Mesh(boxGeo, boxMat);
      box.position.y = 0.16;
      box.castShadow = true;
      group.add(box);

      // 리본 두 줄
      for (const rot of [0, Math.PI / 2]) {
        const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
        ribbon.position.y = 0.16;
        ribbon.rotation.y = rot;
        group.add(ribbon);
      }

      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.015;
      group.add(glow);

      this.group.add(group);
      this.items.push({ group, glow });
    }
  }

  update(state: GameState, dt: number): void {
    this.time += dt;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const t = state.treats[i];

      if (!t || !t.active) {
        item.group.visible = false;
        continue;
      }

      item.group.visible = true;
      item.group.position.set(t.pos.x, 0, t.pos.z);
      // 특식은 희귀하므로 눈에 띄게 — 둥둥 뜨고 계속 돈다
      item.group.position.y = 0.08 + Math.sin(this.time * 2.2) * 0.07;
      item.group.rotation.y = this.time * 0.9;

      const s = 1 + Math.sin(this.time * 4) * 0.15;
      item.glow.scale.set(s, s, 1);
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
