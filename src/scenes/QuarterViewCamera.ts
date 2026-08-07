/**
 * 쿼터뷰 OrthographicCamera. (§6)
 *
 * - 방위각 45도, 고도 약 40도에서 내려다본다.
 * - 플레이어를 damping 으로 부드럽게 따라간다.
 * - 집 밖을 지나치게 보여주지 않도록 추적 대상을 경계 안으로 clamp 한다.
 * - 창 크기가 바뀌면 left/right/top/bottom 을 반드시 다시 계산한다. (§20)
 */

import * as THREE from 'three';
import { DERIVED } from '../core/GameConfig.ts';
import type { Vec2 } from '../core/types.ts';

/**
 * 카메라 방위각·고도. 가구 차폐 판정(Furniture.updateOcclusion)이 같은 값을 써야
 * "실제로 가리는 가구"를 정확히 골라낼 수 있으므로 여기서 export 한다. (§0-2)
 */
export const CAMERA_AZIMUTH = Math.PI / 4; // 남동쪽 45도
export const CAMERA_ELEVATION = (40 * Math.PI) / 180;

/** 화면 세로에 담을 월드 높이. 작을수록 확대된다. */
const VIEW_HEIGHT = 10.5;
/** 카메라가 피사체에서 떨어진 거리 (직교라 원근에는 영향 없고 클리핑에만 관여) */
const DISTANCE = 30;
/** 추적 damping — 클수록 빠르게 따라붙는다 */
const FOLLOW_LAMBDA = 5;

export class QuarterViewCamera {
  readonly camera: THREE.OrthographicCamera;

  /** 카메라가 바라보는 지점 (부드럽게 따라간다) */
  private readonly target = new THREE.Vector3(0, 0, 0);
  /** 카메라 위치 오프셋 — 매 프레임 새로 만들지 않는다 (§20) */
  private readonly offset: THREE.Vector3;
  private readonly desired = new THREE.Vector3();

  private viewHeight = VIEW_HEIGHT;

  constructor(aspect: number) {
    const halfH = this.viewHeight / 2;
    const halfW = halfH * aspect;
    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200);

    this.offset = new THREE.Vector3(
      Math.sin(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION),
      Math.sin(CAMERA_ELEVATION),
      Math.cos(CAMERA_AZIMUTH) * Math.cos(CAMERA_ELEVATION),
    ).multiplyScalar(DISTANCE);

    this.camera.position.copy(this.offset);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  /**
   * 추적 대상이 방 밖을 비추지 않도록 제한하는 범위.
   * 방보다 화면이 크면 방 중앙에 고정한다.
   */
  private clampTarget(pos: Vec2, out: THREE.Vector3): void {
    const halfH = this.viewHeight / 2;
    const halfW = halfH * this.aspect;

    // 직교 쿼터뷰에서 화면 x 는 (x−z)/√2, y 는 대략 (x+z) 방향이라
    // 정확한 역변환 대신 넉넉한 여유(margin)로 근사한다. 과하게 밖이 보이는 것만 막으면 된다.
    const marginX = Math.max(0, DERIVED.ROOM_W / 2 - halfW * 0.75);
    const marginZ = Math.max(0, DERIVED.ROOM_H / 2 - halfH * 0.9);

    out.set(
      THREE.MathUtils.clamp(pos.x, -marginX, marginX),
      0,
      THREE.MathUtils.clamp(pos.z, -marginZ, marginZ),
    );
  }

  private get aspect(): number {
    return (this.camera.right - this.camera.left) / (this.camera.top - this.camera.bottom);
  }

  /** 즉시 대상 위치로 이동한다 (게임 시작·재시작 시 카메라가 날아오지 않게) */
  snapTo(pos: Vec2): void {
    this.clampTarget(pos, this.desired);
    this.target.copy(this.desired);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }

  /** @param dt 렌더 델타 (가변) */
  follow(pos: Vec2, dt: number): void {
    this.clampTarget(pos, this.desired);

    // 프레임률에 무관한 지수 damping
    const t = 1 - Math.exp(-FOLLOW_LAMBDA * dt);
    this.target.lerp(this.desired, t);

    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
  }

  /** 창 크기 변경 대응. OrthographicCamera 는 반드시 4면을 다시 계산해야 한다. (§20) */
  resize(aspect: number): void {
    const halfH = this.viewHeight / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }
}
