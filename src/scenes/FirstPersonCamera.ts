/**
 * 게코 시점 1인칭 PerspectiveCamera. (§6, §25)
 *
 * 카메라를 **도마뱀 눈높이**(바닥에서 0.34 world units)에 둔다. 그 한 줄이
 * 이 게임의 인상을 통째로 바꾼다 — 16x12m 거실이 갑자기 협곡이 되고, 높이
 * 0.8 짜리 안락의자가 올려다봐야 하는 절벽이 되고, 로봇청소기가 굴러오는
 * 소리는 "화면 구석의 점"이 아니라 지평선에서 커지는 덩어리가 된다.
 *
 * 쿼터뷰 시절의 OrthographicCamera 와 달리 여기서는 **추적 대상을 방 안으로
 * clamp 하지 않는다.** 카메라가 곧 플레이어라서 clamp 할 여지가 없다.
 * 대신 벽을 사방으로 세워(world/LivingRoom.ts) 방 밖이 보이지 않게 한다.
 *
 * 창 크기가 바뀌면 aspect 를 반드시 다시 계산한다. (§20)
 */

import * as THREE from 'three';
import type { Vec2 } from '../core/types.ts';

/**
 * 눈높이 (world units, 바닥 기준).
 *
 * entities/Gecko.ts 의 머리 위치에서 나온 값이다: 머리 그룹 y 0.19 + 눈 y 0.055
 * 를 모델 배율 BASE_SCALE(1.4) 로 키우면 0.343. 이 숫자가 어긋나면 미니맵의
 * 내 위치와 화면이 보여주는 위치가 미묘하게 다른, 설명하기 어려운 이질감이 된다.
 */
export const EYE_HEIGHT = 0.343;

/**
 * 시야각. 도마뱀은 눈이 머리 옆에 붙어 시야가 넓다 —
 * 그리고 실용적으로도, 눈높이가 낮을수록 좁은 화각은 답답해서 못 쓴다.
 */
const FOV = 78;

/**
 * near 를 아주 작게 잡아야 한다. 눈앞 0.1 에 있는 의자 다리가 잘려 보이면
 * "가까이 있다"가 아니라 "렌더가 깨졌다"로 읽힌다.
 */
const NEAR = 0.015;
const FAR = 80;

/** 시선 회전 damping — 클수록 즉각적이다. 낮추면 1인칭에서 멀미가 난다 */
const YAW_LAMBDA = 18;
/** 눈높이 보간 (가구를 오르내릴 때) */
const HEIGHT_LAMBDA = 9;

/** 걸을 때 상하 흔들림의 진폭(world units)과 주기(이동 거리 기준) */
const BOB_AMPLITUDE = 0.012;
const BOB_FREQUENCY = 9;
/** 좌우 흔들림. 상하의 절반 주기로 흔들려야 걸음처럼 읽힌다 */
const SWAY_AMPLITUDE = 0.008;

/**
 * 각도 보간. 최단 호로 돈다.
 * 단순 lerp 를 쓰면 −179° → +179° 로 갈 때 반대로 358° 를 돌아간다.
 */
function lerpAngle(from: number, to: number, t: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

export class FirstPersonCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** 현재 시선 각도. player.facing 을 damping 으로 따라간다 */
  private yaw = 0;
  /** 현재 눈높이 (가구 상판 높이가 더해진다) */
  private height = EYE_HEIGHT;
  /** 걷기 위상. 실제 이동 거리로 돌려 발과 화면이 어긋나지 않게 한다 */
  private bobPhase = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV, aspect, NEAR, FAR);
    this.camera.rotation.order = 'YXZ';
  }

  /**
   * 즉시 대상 위치·방향으로 이동한다 (게임 시작·재시작 시 카메라가 휘돌지 않게).
   * @param floorY 발밑 높이 — 가구 위에 올라가 있으면 상판 높이
   */
  snapTo(pos: Vec2, facing: number, floorY = 0): void {
    this.yaw = facing;
    this.height = floorY + EYE_HEIGHT;
    this.bobPhase = 0;
    this.apply(pos, 0);
  }

  /**
   * @param movedDistance 이번 프레임에 실제로 움직인 거리 (world units)
   * @param dt 렌더 델타 (가변)
   */
  follow(pos: Vec2, facing: number, floorY: number, movedDistance: number, dt: number): void {
    // 프레임률에 무관한 지수 damping
    this.yaw = lerpAngle(this.yaw, facing, 1 - Math.exp(-YAW_LAMBDA * dt));
    this.height +=
      (floorY + EYE_HEIGHT - this.height) * (1 - Math.exp(-HEIGHT_LAMBDA * dt));

    this.bobPhase += movedDistance * BOB_FREQUENCY;
    this.apply(pos, movedDistance);
  }

  /**
   * 걷기 흔들림까지 얹어 실제 카메라 변환을 만든다.
   *
   * 멈춰 있을 때 흔들림을 0 으로 두지 않고 위상을 그대로 유지하는 이유는,
   * 걷다 멈추는 순간 화면이 툭 하고 제자리로 튀는 것을 막기 위해서다.
   * 대신 진폭에 이동량을 곱해서 서 있으면 자연스럽게 잦아든다.
   */
  private apply(pos: Vec2, movedDistance: number): void {
    const gait = Math.min(1, movedDistance * 60);
    const bob = Math.sin(this.bobPhase * 2) * BOB_AMPLITUDE * gait;
    const sway = Math.sin(this.bobPhase) * SWAY_AMPLITUDE * gait;

    // 시선 기준 오른쪽 방향 — facing 규약이 atan2(x, z) 이므로 (cos, −sin) 이다.
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    this.camera.position.set(
      pos.x + rightX * sway,
      this.height + bob,
      pos.z + rightZ * sway,
    );

    // 카메라 기본 정면은 −Z 인데 facing 은 +Z 기준이라 반 바퀴 돌려 맞춘다.
    this.camera.rotation.set(0, this.yaw + Math.PI, 0);
  }

  /** 창 크기 변경 대응. (§20) */
  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
