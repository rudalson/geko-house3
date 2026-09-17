/**
 * 특식 — 귀뚜라미. 상태를 읽어 반영만 한다. 단방향. (§0-4, §24)
 * 슬롯 수가 고정이라 메시를 미리 만들어 두고 보이기/숨기기만 한다.
 *
 * 선물상자였던 것을 귀뚜라미로 바꿨다. 게코도마뱀이 실제로 먹는 먹이라
 * "저건 먹는 것"이 한눈에 읽힌다 — 1인칭 눈높이(0.34u)에서 분홍 상자는
 * 슈퍼푸드(주황 구체)와 구별되지 않는 그냥 색 덩어리였다.
 *
 * 실루엣은 **접힌 뒷다리**가 전부 책임진다. 몸통 위로 솟은 무릎 두 개가
 * 다른 어떤 부위보다 멀리서 먼저 읽힌다. 그래서 무릎(y 0.2)을 등날개(y 0.155)
 * 보다 확실히 높게 뒀다 — 해부학이 아니라 가독성 때문이다.
 *
 * 몸은 로컬 **−z 를 앞**으로 두고 만든다. 그룹이 매 프레임 Y축으로 돌기 때문에
 * 어느 쪽을 앞으로 잡든 보이는 결과는 같지만, 다리·더듬이 부호를 한 축으로
 * 통일해 두지 않으면 나중에 손댈 때 반드시 어긋난다.
 */

import * as THREE from 'three';
import type { GameState } from '../core/GameState.ts';

/** 몸통·머리. 어두운 갈색 */
const BODY_COLOR = 0x6f4a2c;
/** 등날개. 몸통보다 밝아야 실루엣이 갈라져 보인다 */
const WING_COLOR = 0x9a7648;
/** 다리·더듬이 */
const LIMB_COLOR = 0x4a321d;
const EYE_COLOR = 0x14100c;
/**
 * 바닥 글로우. 예전 리본 색을 그대로 쓴다.
 * 미니맵의 특식 색(`Minimap.ts` 의 `treat`)과 같은 값이라 둘을 함께 바꿔야 한다.
 */
const GLOW_COLOR = 0xffd166;

/** 원기둥 지오메트리의 로컬 축 */
const UP = new THREE.Vector3(0, 1, 0);

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

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

    const bodyMat = track(new THREE.MeshLambertMaterial({ color: BODY_COLOR }));
    const wingMat = track(new THREE.MeshLambertMaterial({ color: WING_COLOR }));
    const limbMat = track(new THREE.MeshLambertMaterial({ color: LIMB_COLOR }));
    const eyeMat = track(new THREE.MeshBasicMaterial({ color: EYE_COLOR }));

    const abdomenGeo = track(new THREE.IcosahedronGeometry(0.075, 0));
    const thoraxGeo = track(new THREE.IcosahedronGeometry(0.062, 0));
    const headGeo = track(new THREE.IcosahedronGeometry(0.048, 0));
    const eyeGeo = track(new THREE.SphereGeometry(0.015, 6, 4));
    const wingGeo = track(new THREE.BoxGeometry(0.055, 0.012, 0.19));

    // 팔다리는 **길이 1** 짜리 원기둥 하나를 y 로 늘여 재사용한다.
    // 마디마다 지오메트리를 따로 만들면 8개가 넘고, 길이를 손볼 때마다
    // 지오메트리를 다시 만들어야 한다. 반지름만 세 종류 둔다.
    const thickGeo = track(new THREE.CylinderGeometry(0.018, 0.01, 1, 5));
    const thinGeo = track(new THREE.CylinderGeometry(0.008, 0.005, 1, 4));
    const antennaGeo = track(new THREE.CylinderGeometry(0.005, 0.002, 1, 4));

    const glowGeo = track(new THREE.RingGeometry(0.3, 0.42, 16));
    const glowMat = track(
      new THREE.MeshBasicMaterial({
        color: GLOW_COLOR,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      }),
    );

    /** 두 점을 잇는 마디 하나. 지오메트리 길이가 1 이라 거리를 그대로 scale.y 에 넣는다. */
    const limb = (
      geo: THREE.BufferGeometry,
      a: THREE.Vector3,
      b: THREE.Vector3,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, limbMat);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.scale.y = a.distanceTo(b);
      mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
      return mesh;
    };

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();

      // ── 몸통 ────────────────────────────────────────────────────────
      const abdomen = new THREE.Mesh(abdomenGeo, bodyMat);
      abdomen.position.set(0, 0.095, 0.07);
      abdomen.scale.set(0.95, 0.9, 1.7); // 뒤로 길쭉하게
      abdomen.castShadow = true;
      group.add(abdomen);

      const thorax = new THREE.Mesh(thoraxGeo, bodyMat);
      thorax.position.set(0, 0.095, -0.05);
      thorax.castShadow = true;
      group.add(thorax);

      const head = new THREE.Mesh(headGeo, bodyMat);
      head.position.set(0, 0.095, -0.13);
      head.castShadow = true;
      group.add(head);

      // ── 머리 부속 ───────────────────────────────────────────────────
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(side * 0.03, 0.11, -0.158);
        group.add(eye);

        group.add(
          limb(antennaGeo, v(side * 0.02, 0.115, -0.163), v(side * 0.06, 0.18, -0.28)),
        );
      }

      // ── 등날개 두 장 ────────────────────────────────────────────────
      // 바깥으로 갈수록 처지게 기울인다. 평평하면 등에 판자를 얹은 것처럼 보인다.
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.position.set(side * 0.033, 0.155, 0.06);
        wing.rotation.z = side * -0.35;
        wing.castShadow = true;
        group.add(wing);
      }

      // ── 다리 ────────────────────────────────────────────────────────
      for (const side of [-1, 1]) {
        // 뒷다리: 고관절 → 무릎(몸통 위로 솟음) → 발. 귀뚜라미의 그 'Z' 자다.
        const hip = v(side * 0.055, 0.1, -0.01);
        const knee = v(side * 0.062, 0.2, 0.08);
        const foot = v(side * 0.07, 0.03, 0.15);
        group.add(limb(thickGeo, hip, knee));
        group.add(limb(thinGeo, knee, foot));

        // 가운뎃다리·앞다리는 몸을 받치는 역할만 한다. 가늘고 짧게.
        group.add(limb(thinGeo, v(side * 0.05, 0.09, -0.04), v(side * 0.11, 0.015, -0.02)));
        group.add(limb(thinGeo, v(side * 0.045, 0.09, -0.1), v(side * 0.1, 0.015, -0.14)));
      }

      // ── 바닥 글로우 ─────────────────────────────────────────────────
      // 넓은 방에서 특식을 **찾을 수 있게** 하는 유일한 단서다. 지우지 말 것.
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
