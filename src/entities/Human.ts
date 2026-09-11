/**
 * 인간 적. 상태를 읽어 반영만 한다. 단방향. (§0-4, §24)
 *
 * 이 파일이 맡는 것은 **사람이 어디에 서서 어디를 보고 무슨 말을 하는가** 다.
 * 몸 자체(모델이냐 코드로 만든 것이냐, 걷는 동작)는 `humanAvatar.ts` 가 맡는다 —
 * 둘 중 어느 몸이 오든 여기 코드는 같다.
 *
 * 말풍선은 CanvasTexture 로 그려 스프라이트에 올린다 — 폰트 에셋이 필요 없다.
 */

import * as THREE from 'three';
import type { GameState, HumanState } from '../core/GameState.ts';
import { createHumanAvatar, type HumanAvatar } from './humanAvatar.ts';

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
  avatar: HumanAvatar;
  speech: THREE.Sprite;
  /** 지난 프레임 위치 — 실제 이동 속도를 여기서 뽑는다 */
  lastPos: { x: number; z: number } | null;
  /** 지금 입고 있는 얼굴. 바뀔 때만 재질을 건드린다. */
  look: number;
}

export class HumanRenderer {
  readonly group = new THREE.Group();

  private readonly items: HumanMesh[] = [];
  private readonly speechTex: THREE.CanvasTexture;
  private readonly speechMat: THREE.SpriteMaterial;

  constructor(count: number) {
    this.group.name = 'humans';

    this.speechTex = makeSpeechTexture('귀여워!');
    this.speechMat = new THREE.SpriteMaterial({
      map: this.speechTex,
      transparent: true,
      depthTest: false,
    });

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      const avatar = createHumanAvatar();
      group.add(avatar.object);

      const speech = new THREE.Sprite(this.speechMat);
      speech.scale.set(1.4, 0.7, 1);
      speech.position.y = 2.15;
      speech.visible = false;
      speech.renderOrder = 10;
      group.add(speech);

      this.group.add(group);
      this.items.push({ group, avatar, speech, lastPos: null, look: -1 });
    }
  }

  update(state: GameState, dt: number): void {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const h = state.humans[i];

      if (!h) {
        item.group.visible = false;
        // 다음에 등장할 때 순간이동을 이동으로 오해하지 않게 끊어 둔다.
        item.lastPos = null;
        continue;
      }

      item.group.visible = true;
      item.group.position.set(h.pos.x, 0, h.pos.z);
      item.avatar.object.rotation.y = h.facing;

      if (item.look !== h.look) {
        item.look = h.look;
        item.avatar.setLook(h.look);
      }

      item.avatar.update(h, this.measureSpeed(item, h, dt), dt);
      item.speech.visible = h.speechLeft > 0;
    }
  }

  /**
   * 이번 프레임에 실제로 움직인 속도 (world units/s).
   *
   * `CONFIG.HUMAN_SPEED` 를 그대로 쓰지 않는 이유는, 사람이 가구에 막히거나
   * 목적지에 닿아 멈춘 프레임이 꽤 있기 때문이다 (`HumanSystem.moveHuman` 은
   * 방향이 0 이면 그냥 돌아간다). 상수를 믿으면 제자리에서 계속 달리는 꼴이 된다.
   */
  private measureSpeed(item: HumanMesh, h: HumanState, dt: number): number {
    const last = item.lastPos;
    item.lastPos = { x: h.pos.x, z: h.pos.z };
    if (!last || dt <= 0) return 0;
    return Math.hypot(h.pos.x - last.x, h.pos.z - last.z) / dt;
  }

  dispose(): void {
    for (const item of this.items) item.avatar.dispose();
    this.speechMat.dispose();
    this.speechTex.dispose();
    this.items.length = 0;
    this.group.clear();
  }
}

/** 씬에 미리 만들어 둘 인간 수 — 현재는 1명 (§24) */
export const MAX_HUMANS = 1;
