/**
 * 인간 적. 상태를 읽어 반영만 한다. 단방향. (§0-4, §24)
 *
 * 로우폴리 사람 하나. 추적 중에는 `귀여워!` 말풍선이 뜬다.
 * 말풍선은 CanvasTexture 로 그려 스프라이트에 올린다 — 폰트 에셋이 필요 없다.
 */

import * as THREE from 'three';
import type { GameState } from '../core/GameState.ts';

const SKIN = 0xf2c9a0;
const SHIRT = 0x6f7fd6;
const PANTS = 0x40485c;
const HAIR = 0x3a2a20;

/** 말풍선 텍스처를 코드로 그린다 (§5 — 자체 제작 에셋) */
function makeSpeechTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fffdf5';
  ctx.strokeStyle = '#2b2118';
  ctx.lineWidth = 6;
  const r = 24;
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 88, r);
  ctx.fill();
  ctx.stroke();

  // 꼬리
  ctx.beginPath();
  ctx.moveTo(112, 94);
  ctx.lineTo(128, 122);
  ctx.lineTo(148, 94);
  ctx.closePath();
  ctx.fillStyle = '#fffdf5';
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#2b2118';
  ctx.font = 'bold 46px "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 52);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface HumanMesh {
  group: THREE.Group;
  body: THREE.Group;
  speech: THREE.Sprite;
  legs: THREE.Mesh[];
}

export class HumanRenderer {
  readonly group = new THREE.Group();

  private readonly items: HumanMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private walkPhase = 0;

  constructor(count: number) {
    this.group.name = 'humans';

    const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
      if (x instanceof THREE.BufferGeometry) this.geometries.push(x);
      else this.materials.push(x);
      return x;
    };

    const skinMat = track(new THREE.MeshLambertMaterial({ color: SKIN }));
    const shirtMat = track(new THREE.MeshLambertMaterial({ color: SHIRT }));
    const pantsMat = track(new THREE.MeshLambertMaterial({ color: PANTS }));
    const hairMat = track(new THREE.MeshLambertMaterial({ color: HAIR }));

    const torsoGeo = track(new THREE.CapsuleGeometry(0.26, 0.42, 4, 10));
    const headGeo = track(new THREE.SphereGeometry(0.22, 12, 10));
    const hairGeo = track(new THREE.SphereGeometry(0.235, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.9));
    const armGeo = track(new THREE.CapsuleGeometry(0.075, 0.34, 3, 6));
    const legGeo = track(new THREE.CapsuleGeometry(0.095, 0.44, 3, 6));

    const speechTex = makeSpeechTexture('귀여워!');
    this.textures.push(speechTex);
    const speechMat = track(
      new THREE.SpriteMaterial({ map: speechTex, transparent: true, depthTest: false }),
    );

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const body = new THREE.Group();
      group.add(body);

      const torso = new THREE.Mesh(torsoGeo, shirtMat);
      torso.position.y = 1.06;
      torso.castShadow = true;
      body.add(torso);

      const head = new THREE.Mesh(headGeo, skinMat);
      head.position.y = 1.52;
      head.castShadow = true;
      body.add(head);

      const hair = new THREE.Mesh(hairGeo, hairMat);
      hair.position.y = 1.55;
      body.add(hair);

      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(armGeo, skinMat);
        arm.position.set(side * 0.3, 1.04, 0);
        arm.rotation.z = side * 0.18;
        body.add(arm);
      }

      const legs: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, pantsMat);
        leg.position.set(side * 0.13, 0.42, 0);
        leg.castShadow = true;
        body.add(leg);
        legs.push(leg);
      }

      const speech = new THREE.Sprite(speechMat);
      speech.scale.set(1.4, 0.7, 1);
      speech.position.y = 2.15;
      speech.visible = false;
      speech.renderOrder = 10;
      group.add(speech);

      this.group.add(group);
      this.items.push({ group, body, speech, legs });
    }
  }

  update(state: GameState, dt: number): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const h = state.humans[i];

      if (!h) {
        item.group.visible = false;
        continue;
      }

      item.group.visible = true;
      item.group.position.set(h.pos.x, 0, h.pos.z);
      item.body.rotation.y = h.facing;

      // 추적 중에는 성큼성큼, 배회 중에는 느긋하게
      const speed = h.mode === 'chase' ? 9 : 3;
      this.walkPhase += dt * speed;
      for (let k = 0; k < item.legs.length; k++) {
        item.legs[k]!.rotation.x = Math.sin(this.walkPhase + k * Math.PI) * 0.5;
      }
      // 추적 중에는 몸을 앞으로 기울인다 — 위협적으로 읽히게
      item.body.rotation.x = h.mode === 'chase' ? 0.12 : 0;

      item.speech.visible = h.speechLeft > 0;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
    this.items.length = 0;
    this.group.clear();
  }
}

/** 씬에 미리 만들어 둘 인간 수 — 현재는 1명 (§24) */
export const MAX_HUMANS = 1;
