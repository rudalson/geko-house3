/**
 * 1인칭 화면 아래에 걸리는 **자기 주둥이**. (§25)
 *
 * 카메라의 자식이라 시선을 따라 함께 움직인다. 무엇을 하는지 알려주는 물건이
 * 아니라 **누가 보고 있는지** 알려주는 물건이다 — 이게 없으면 1인칭 화면은
 * 그냥 떠다니는 카메라고, 눈높이가 바닥에서 34cm 라는 사실이 몸으로 읽히지 않는다.
 *
 * 상태를 읽어 반영만 한다. 단방향. (§0-4)
 *
 * 왜 Gecko 의 머리를 재사용하지 않았나: 저쪽은 **바깥에서 보는** 얼굴이라
 * 눈·눈꺼풀·입이 전부 앞을 향해 있다. 여기서 필요한 건 눈 사이로 내려다본
 * 주둥이 윗면뿐이라 같은 지오메트리로는 안 된다.
 *
 * 시야 양옆에 안구를 볼록하게 걸어 보기도 했다 (도마뱀 눈은 머리 옆에 붙어
 * 있으니까). **버렸다.** 눈 사이에서 내다보는 각도라 화면에 보이는 건 안구의
 * 뒤통수뿐이고, 홍채는 어떻게 돌려도 눈두덩에 가린다. 결과는 주둥이 양옆에
 * 초록 언덕 두 개가 놓인 그림이었다 — 눈으로 읽히지 않았다.
 */

import * as THREE from 'three';
import type { GameState } from '../core/GameState.ts';
import { CONFIG } from '../core/GameConfig.ts';
import { Stance } from '../core/types.ts';
import { GECKO_PALETTE } from './geckoSkin.ts';

/**
 * 카메라 앞 배치 (카메라 로컬 좌표, 카메라는 −Z 를 본다).
 *
 * 이 값들은 **화면을 보고 맞췄다.** FOV 78 기준으로 거리 d 에서 시야 반높이는
 * `d · tan(39°) ≈ 0.81d` 다. 즉 가까이 둘수록 같은 크기가 화면을 훨씬 많이
 * 먹는다 — 처음에 0.075 앞에 두었더니 주둥이 하나가 화면 아래 3분의 1을
 * 초록 언덕처럼 덮었다.
 *
 * 두 번째 시도에서는 크기를 줄였지만 **머리와 주둥이가 서로 떨어져** 초록
 * 덩어리로 흩어져 보였다. 자기 얼굴은 연결돼 있어야 얼굴로 읽힌다. 그래서
 * 화면 아래를 채우는 머리 덩어리를 먼저 두고, 거기서 주둥이가 **겹치게**
 * 뻗어 나오도록 배치한다.
 *
 * 카메라의 FOV 나 near 를 건드리면 이 값들을 다시 맞춰야 한다.
 */
/** 머리 덩어리 — 대부분 화면 밖이고 아래 가장자리만 채운다 */
const HEAD_Z = -0.14;
const HEAD_Y = -0.166;
/** 주둥이 — 머리에서 앞으로 뻗어 나온다 */
const SNOUT_Z = -0.245;
const SNOUT_Y = -0.152;

/** 피격 리액션 지속 시간 (초). Gecko 쪽과 같은 값이다 */
const HURT_TIME = 0.55;

export class GeckoSnout {
  readonly group = new THREE.Group();

  private readonly jaw: THREE.Group;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];

  private motionTime = 0;
  /** 입이 벌어진 정도 [0, 1] — 목표값으로 보간한다 */
  private mouthOpen = 0;
  private hurtLeft = 0;
  private lastHearts = -1;

  constructor() {
    this.group.name = 'gecko-snout';

    const skin = this.track(
      new THREE.MeshLambertMaterial({ color: GECKO_PALETTE.body }),
    );

    // ── 머리 덩어리 ──
    // 화면 아래 가장자리를 채운다. 이게 없으면 주둥이와 눈이 허공에 뜬
    // 초록 덩어리 세 개로 보인다. 대부분 화면 밖이라 형태는 거칠어도 된다.
    const headGeo = this.track(new THREE.SphereGeometry(0.1, 14, 10));
    headGeo.scale(2.2, 0.7, 1.0);
    const head = new THREE.Mesh(headGeo, skin);
    head.position.set(0, HEAD_Y, HEAD_Z);
    this.group.add(head);

    // ── 주둥이 윗면 ──
    // 머리와 z 로 겹치게 둬서 하나로 이어져 보이게 한다.
    const upperGeo = this.track(new THREE.SphereGeometry(0.052, 12, 8));
    upperGeo.scale(0.9, 0.5, 2.0);
    const upper = new THREE.Mesh(upperGeo, skin);
    upper.position.set(0, SNOUT_Y, SNOUT_Z);
    this.group.add(upper);

    // 콧구멍 두 점. 주둥이가 어느 쪽을 향하는지 즉시 읽히게 한다.
    const nostrilGeo = this.track(new THREE.SphereGeometry(0.005, 6, 4));
    const nostrilMat = this.track(
      new THREE.MeshBasicMaterial({ color: GECKO_PALETTE.mouth }),
    );
    for (const side of [-1, 1]) {
      const n = new THREE.Mesh(nostrilGeo, nostrilMat);
      n.position.set(side * 0.014, SNOUT_Y + 0.021, SNOUT_Z - 0.082);
      this.group.add(n);
    }

    // ── 아래턱 ──
    // 회전축을 목 쪽(뒤)에 두고 그 앞에 턱을 매단다. 그래야 벌릴 때
    // 턱 끝이 아래로 열리지, 통째로 내려가지 않는다.
    this.jaw = new THREE.Group();
    this.jaw.position.set(0, SNOUT_Y - 0.016, SNOUT_Z + 0.1);
    this.group.add(this.jaw);

    const jawGeo = this.track(new THREE.SphereGeometry(0.047, 10, 6));
    jawGeo.scale(0.82, 0.38, 2.0);
    const jaw = new THREE.Mesh(jawGeo, skin);
    jaw.position.z = -0.1;
    this.jaw.add(jaw);

    // 입 안. 벌렸을 때 몸 색이 그대로 보이면 턱이 아니라 혹처럼 보인다.
    const mawGeo = this.track(new THREE.SphereGeometry(0.042, 8, 6));
    mawGeo.scale(0.8, 0.3, 1.8);
    const mawMat = this.track(
      new THREE.MeshBasicMaterial({ color: GECKO_PALETTE.mouth }),
    );
    const maw = new THREE.Mesh(mawGeo, mawMat);
    maw.position.set(0, 0.013, -0.1);
    this.jaw.add(maw);

  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    if (x instanceof THREE.BufferGeometry) this.geometries.push(x);
    else this.materials.push(x);
    return x;
  }

  /**
   * @param movedDistance 이번 프레임에 실제로 움직인 거리 (world units)
   * @param dt 렌더 델타 (가변)
   */
  update(state: GameState, movedDistance: number, dt: number): void {
    const p = state.player;
    this.motionTime += dt;

    // 피격은 하트 수 변화로 스스로 알아챈다 — 이벤트를 구독하면 씬이 다시
    // 만들어질 때마다 해제를 챙겨야 한다. (Gecko 와 같은 방식)
    if (this.lastHearts >= 0 && p.hearts < this.lastHearts) this.hurtLeft = HURT_TIME;
    this.lastHearts = p.hearts;
    if (this.hurtLeft > 0) this.hurtLeft = Math.max(0, this.hurtLeft - dt);

    // 담요 밑에서는 아무것도 안 보인다. 주둥이도 같이 감춘다.
    this.group.visible = p.stance !== Stance.HIDDEN;
    if (!this.group.visible) return;

    // ── 입 ──
    // 먹는 중에는 씹고, 힘주는 중에는 살짝 벌린다.
    let targetOpen = 0.06;
    if (p.eatAnimLeft > 0) targetOpen = 0.5 + Math.sin(this.motionTime * 26) * 0.32;
    else if (p.poopAnimLeft > 0) targetOpen = 0.3;
    else if (this.hurtLeft > 0) targetOpen = 0.85;
    this.mouthOpen += (targetOpen - this.mouthOpen) * Math.min(1, dt * 16);
    this.jaw.rotation.x = -this.mouthOpen * 0.5;

    // ── 자세 ──
    // 걸을 때 카메라와 **반대 위상**으로 흔든다. 같은 위상으로 흔들면 주둥이가
    // 화면에 못 박힌 것처럼 보여서 흔들림 자체가 사라진다.
    const gait = Math.min(1, movedDistance * 60);
    const breath = Math.sin(this.motionTime * 2.2) * 0.0012;
    let pitch = Math.sin(this.motionTime * 9) * 0.03 * gait;
    let lift = breath;

    if (p.poopAnimLeft > 0) {
      // 힘주기: 고개를 든다. 그동안 바닥이 안 보이는 게 무방비의 실감이다.
      const t = 1 - p.poopAnimLeft / CONFIG.POOP_ANIM_TIME;
      pitch -= Math.sin(t * Math.PI) * 0.16;
      lift += Math.sin(t * Math.PI) * 0.004;
    } else if (p.eatAnimLeft > 0) {
      // 먹기: 바닥으로 고개를 박는다.
      const t = 1 - p.eatAnimLeft / CONFIG.FOOD_EAT_TIME;
      pitch += Math.sin(t * Math.PI) * 0.22;
    } else if (this.hurtLeft > 0) {
      pitch -= 0.12;
      lift += Math.sin(this.hurtLeft * 42) * 0.006 * this.hurtLeft;
    }

    this.group.rotation.x = pitch;
    this.group.position.y = lift;
    // 피격 시 옆으로 기울어진다. 화면 전체가 아니라 주둥이만 흔들려야
    // "맞았다" 가 되고, 조작 방향은 흐트러지지 않는다.
    this.group.rotation.z =
      this.hurtLeft > 0 ? Math.sin(this.hurtLeft * 38) * 0.22 * this.hurtLeft : 0;
  }

  /** §8 재시작 요구사항 — GPU 리소스를 전부 해제한다. */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.group.clear();
  }
}
