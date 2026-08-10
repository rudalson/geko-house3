/**
 * 파티클 풀. (§16)
 *
 * §10 이 격자에 요구한 것과 같은 규칙을 따른다 —
 * **InstancedMesh 를 시작 시 1개만 만들고**, 살아 있는 파티클이 없는 프레임에는
 * GPU 버퍼를 건드리지 않는다. 파티클마다 Mesh 를 만들면 배변 한 번에
 * 24개의 draw call 이 늘고, dispose 대상도 그만큼 늘어난다 (R4, R5).
 *
 * 상태는 SoA(Float32Array) 로 들고 있다. 파티클 객체 배열을 쓰면 한 판에
 * 수천 개가 만들어졌다 버려지면서 GC 가 프레임을 끊는다.
 *
 * 게임 로직은 이 클래스를 모른다. Game 이 EventBus 를 구독해 호출한다. (§6-2)
 */

import * as THREE from 'three';
import { Rng } from '../core/Rng.ts';
import type { Vec2 } from '../core/types.ts';

/**
 * 동시 최대 파티클 수.
 * 배변(24) + 먹기(10) + 청소 먼지가 겹쳐도 넘치지 않는 정도.
 * 넘치면 가장 오래된 것을 재사용하므로 터지지 않고 조용히 줄어든다.
 */
const CAPACITY = 240;

export type ParticleKind = 'poop' | 'eat' | 'damage' | 'levelUp' | 'treat' | 'dust';

interface KindSpec {
  /** 기본 색 (HSL 변주의 중심) */
  color: number;
  count: number;
  /** 초기 속도 범위 (world u/s) */
  speed: [number, number];
  /** 위쪽 초기 속도 */
  lift: [number, number];
  life: [number, number];
  size: [number, number];
  /** 중력 가속도 (world u/s²). 0 이면 떠 있는다 */
  gravity: number;
  /** 초당 속도 감쇠 비율 */
  drag: number;
  /** 방출 높이 */
  y: number;
}

const KINDS: Record<ParticleKind, KindSpec> = {
  // 배변 — 아래로 떨어져 바닥에 깔린다. 영역이 늘어난 지점을 눈으로 짚어 준다.
  poop: {
    color: 0x8a5a2b,
    count: 22,
    speed: [0.6, 2.0],
    lift: [1.2, 2.6],
    life: [0.4, 0.75],
    size: [0.05, 0.11],
    gravity: -7,
    drag: 1.2,
    y: 0.14,
  },
  eat: {
    color: 0xc9e86a,
    count: 10,
    speed: [0.4, 1.2],
    lift: [1.0, 1.8],
    life: [0.3, 0.5],
    size: [0.03, 0.06],
    gravity: -4,
    drag: 2.0,
    y: 0.3,
  },
  // 피격 — 빠르고 크게. 화면 어디를 보고 있어도 알아채야 한다.
  damage: {
    color: 0xe2523f,
    count: 18,
    speed: [1.8, 4.0],
    lift: [1.0, 3.2],
    life: [0.3, 0.6],
    size: [0.05, 0.1],
    gravity: -6,
    drag: 2.2,
    y: 0.28,
  },
  // 레벨업 — 위로 솟는다. 떨어지지 않아야 "성장" 으로 읽힌다.
  levelUp: {
    color: 0xffd166,
    count: 24,
    speed: [0.5, 1.1],
    lift: [1.6, 2.8],
    life: [0.7, 1.1],
    size: [0.04, 0.09],
    gravity: 0.6,
    drag: 0.5,
    y: 0.1,
  },
  treat: {
    color: 0xff8fc7,
    count: 20,
    speed: [1.0, 2.4],
    lift: [1.4, 2.6],
    life: [0.6, 1.0],
    size: [0.04, 0.09],
    gravity: -1.5,
    drag: 1.0,
    y: 0.25,
  },
  // 청소 먼지 — 작고 조용하다. 이건 알림이 아니라 배경 질감이다.
  dust: {
    color: 0xb9ab92,
    count: 3,
    speed: [0.2, 0.7],
    lift: [0.3, 0.9],
    life: [0.25, 0.5],
    size: [0.02, 0.045],
    gravity: -1.2,
    drag: 2.5,
    y: 0.06,
  },
};

export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;

  private readonly px = new Float32Array(CAPACITY);
  private readonly py = new Float32Array(CAPACITY);
  private readonly pz = new Float32Array(CAPACITY);
  private readonly vx = new Float32Array(CAPACITY);
  private readonly vy = new Float32Array(CAPACITY);
  private readonly vz = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly maxLife = new Float32Array(CAPACITY);
  private readonly size = new Float32Array(CAPACITY);
  private readonly gravity = new Float32Array(CAPACITY);
  private readonly drag = new Float32Array(CAPACITY);

  /** 다음에 쓸 슬롯. 한 바퀴 돌면 가장 오래된 것을 덮어쓴다. */
  private cursor = 0;
  private alive = 0;
  /** 직전 프레임에 살아 있었는지 — 마지막 1프레임의 정리 기록을 위해 필요하다 */
  private wasAlive = false;

  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  /** 색·속도 변주용. `Math.random()` 은 저장소 전체에서 금지된다 (§0-5) */
  private readonly rng = new Rng(0x9e3d_7b11);

  constructor() {
    // 파티클은 작고 많다. 세그먼트를 늘려 봐야 보이지 않고 삼각형만 는다.
    this.geometry = new THREE.SphereGeometry(1, 5, 4);
    this.material = new THREE.MeshBasicMaterial({ toneMapped: false });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, CAPACITY);
    this.mesh.name = 'particles';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    const colors = new Float32Array(CAPACITY * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // 전부 스케일 0 (= 보이지 않음) 으로 시작한다.
    this.dummy.position.set(0, -10, 0);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < CAPACITY; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 지정 위치에서 한 종류를 터뜨린다. */
  emit(kind: ParticleKind, pos: Vec2, scale = 1): void {
    const spec = KINDS[kind];
    const count = Math.max(1, Math.round(spec.count * scale));

    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % CAPACITY;
      if (this.life[i]! <= 0) this.alive++;

      const angle = this.rng.next() * Math.PI * 2;
      const speed = this.rng.range(spec.speed[0], spec.speed[1]) * scale;

      this.px[i] = pos.x;
      this.py[i] = spec.y;
      this.pz[i] = pos.z;
      this.vx[i] = Math.cos(angle) * speed;
      this.vz[i] = Math.sin(angle) * speed;
      this.vy[i] = this.rng.range(spec.lift[0], spec.lift[1]);

      const life = this.rng.range(spec.life[0], spec.life[1]);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.size[i] = this.rng.range(spec.size[0], spec.size[1]) * scale;
      this.gravity[i] = spec.gravity;
      this.drag[i] = spec.drag;

      // 같은 색 덩어리로 보이지 않게 밝기만 흔든다. 색상 자체는 종류의 정보다.
      this.tmpColor.setHex(spec.color);
      const jitter = this.rng.range(0.78, 1.18);
      this.mesh.instanceColor!.setXYZ(
        i,
        Math.min(1, this.tmpColor.r * jitter),
        Math.min(1, this.tmpColor.g * jitter),
        Math.min(1, this.tmpColor.b * jitter),
      );
    }

    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** @param dt 렌더 델타 (가변). 연출 전용이라 고정 스텝이 아니어도 된다. */
  update(dt: number): void {
    // 살아 있는 게 없으면 GPU 버퍼를 건드리지 않는다. (R4)
    // 단, 방금 전부 죽은 프레임에는 한 번 더 써서 마지막 잔상을 지운다.
    if (this.alive === 0) {
      if (!this.wasAlive) return;
      this.wasAlive = false;
    } else {
      this.wasAlive = true;
    }

    // 탭 복귀처럼 크게 튄 프레임에서 파티클이 순간이동하지 않게 상한을 둔다.
    const step = Math.min(dt, 1 / 20);

    for (let i = 0; i < CAPACITY; i++) {
      const left = this.life[i]!;
      if (left <= 0) continue;

      const next = left - step;
      if (next <= 0) {
        this.life[i] = 0;
        this.alive--;
        this.dummy.position.set(0, -10, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      this.life[i] = next;

      const damp = Math.max(0, 1 - this.drag[i]! * step);
      let vx = this.vx[i]! * damp;
      let vz = this.vz[i]! * damp;
      let vy = this.vy[i]! * damp + this.gravity[i]! * step;

      const x = this.px[i]! + vx * step;
      let y = this.py[i]! + vy * step;
      const z = this.pz[i]! + vz * step;

      // 바닥을 뚫지 않게 잡아 둔다. 튕기게 하면 시선을 너무 끈다.
      if (y < 0.02) {
        y = 0.02;
        vy = 0;
        // 바닥에 닿으면 옆으로도 급히 멎는다 — 미끄러지면 벌레처럼 보인다.
        vx *= 0.4;
        vz *= 0.4;
      }

      this.px[i] = x;
      this.py[i] = y;
      this.pz[i] = z;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.vz[i] = vz;

      // 수명이 끝날수록 작아진다 — 인스턴스별 투명도는 커스텀 셰이더 없이
      // 불가능하지만, 스케일은 instanceMatrix 로 공짜다. (TerritoryGrid 와 같은 수법)
      const t = next / this.maxLife[i]!;
      this.dummy.position.set(x, y, z);
      this.dummy.scale.setScalar(this.size[i]! * Math.min(1, t * 1.8));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 디버그·테스트용 */
  get aliveCount(): number {
    return this.alive;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
    this.life.fill(0);
    this.alive = 0;
    this.wasAlive = false;
  }
}
