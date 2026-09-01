/**
 * `facing` 규약이 **모델과 카메라에서 같은 방향을 가리키는지** 검증한다.
 *
 * 이건 눈으로만 잡히던 종류의 버그다. 모델은 머리를 로컬 −Z 에 두고 만들었는데
 * `facing` 은 로컬 **+Z** 를 진행 방향에 맞추는 값이라, 꼬리가 앞장서고
 * 도마뱀이 뒷걸음질쳤다. 상태값(`facing`)만 보면 정상으로 보인다.
 *
 * 1인칭 전환(§25) 이후 이 테스트의 값어치가 오히려 올라갔다. 도마뱀 모델은
 * 화면에 나오지 않지만, **같은 규약을 카메라가 그대로 쓴다.** 부호가 뒤집히면
 * W 를 눌렀을 때 화면이 뒷걸음질치는, 게임을 못 하는 버그가 된다.
 * 모델 쪽은 그 규약의 살아 있는 문서로 남겨 함께 검사한다.
 *
 * Three.js 의 Object3D 계산은 WebGL 없이 node 에서 그대로 돌아가므로
 * 여기서 확인할 수 있다.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Gecko } from '../src/entities/Gecko.ts';
import { FirstPersonCamera } from '../src/scenes/FirstPersonCamera.ts';
import { GameState } from '../src/core/GameState.ts';
import { Phase } from '../src/core/types.ts';
import { updateMovement } from '../src/systems/MovementSystem.ts';
import { initVacuums } from '../src/systems/VacuumSystem.ts';

const DT = 1 / 60;

/** 시선을 `facing` 으로 맞추고 한 스텝 전진시킨 상태를 만든다. */
function walked(facing: number): { state: GameState; moved: number } {
  const state = new GameState(1234);
  state.setPhase(Phase.PLAYING);
  state.player.facing = facing;
  const moved = updateMovement(state, { forward: 1, turn: 0, run: false }, DT);
  expect(moved, '이동 자체가 일어나지 않았다 — 테스트 전제가 깨졌다').toBeGreaterThan(0);
  return { state, moved };
}

/** 실제로 이동시킨 뒤, 머리가 몸 중심보다 진행 방향 쪽에 있는지 본다. */
function headLead(facing: number): number {
  const { state, moved } = walked(facing);

  const gecko = new Gecko();
  gecko.update(state, moved, DT);
  gecko.group.updateMatrixWorld(true);

  const head = gecko.group.getObjectByName('gecko-head');
  expect(head, '머리 오브젝트를 찾지 못했다').toBeDefined();

  const headWorld = new THREE.Vector3();
  head!.getWorldPosition(headWorld);

  // 몸 중심(그룹 원점) 기준으로 머리가 얼마나 앞에 있는지.
  // 양수 = 머리가 앞장선다, 음수 = 뒷걸음질.
  const rel = headWorld.clone().sub(new THREE.Vector3(state.player.pos.x, 0, state.player.pos.z));
  gecko.dispose();
  return rel.x * Math.sin(facing) + rel.z * Math.cos(facing);
}

// 8방향 전부 본다. 한 축만 보면 부호 하나가 틀려도 통과한다.
const DIRS: [string, number][] = [
  ['북 (−z)', Math.PI],
  ['남 (+z)', 0],
  ['서 (−x)', -Math.PI / 2],
  ['동 (+x)', Math.PI / 2],
  ['북서', (-3 * Math.PI) / 4],
  ['북동', (3 * Math.PI) / 4],
  ['남서', -Math.PI / 4],
  ['남동', Math.PI / 4],
];

describe('도마뱀 모델 방향', () => {
  for (const [name, facing] of DIRS) {
    it(`${name} 으로 갈 때 머리가 앞장선다`, () => {
      const lead = headLead(facing);
      expect(lead, `머리가 진행 방향 반대쪽에 있다 (투영 ${lead.toFixed(3)}) — 뒷걸음질`)
        .toBeGreaterThan(0);
    });
  }

  it('꼬리는 머리 반대쪽에 있다', () => {
    const { state, moved } = walked(Math.PI / 2); // 동쪽
    const gecko = new Gecko();
    gecko.update(state, moved, DT);
    gecko.group.updateMatrixWorld(true);

    const origin = new THREE.Vector3(state.player.pos.x, 0, state.player.pos.z);
    const head = new THREE.Vector3();
    const tail = new THREE.Vector3();
    gecko.group.getObjectByName('gecko-head')!.getWorldPosition(head);
    gecko.group.getObjectByName('gecko-tail')!.getWorldPosition(tail);

    expect(head.clone().sub(origin).x, '머리가 동쪽(+x)을 향해야 한다').toBeGreaterThan(0);
    expect(tail.clone().sub(origin).x, '꼬리가 서쪽(−x)에 있어야 한다').toBeLessThan(0);

    gecko.dispose();
  });

  /**
   * 눈동자가 위협 쪽을 보는지. (§17 — 표정은 정보 채널이다)
   *
   * 진행 방향과 같은 회전 규약을 쓰므로 여기서 함께 본다. 실제로 방향 버그를
   * 고치면서 이쪽 역회전 부호도 뒤집혀 있던 것이 드러났다 — 정면을 보고 있을 때
   * 오른쪽 위협을 왼쪽이라고 답하고 있었다.
   */
  it('겁먹으면 눈동자가 위협 쪽으로 돌아간다', () => {
    // +z 를 향해 걷는다. 이때 도마뱀의 오른쪽은 월드 −x 다.
    const { state, moved } = walked(0);

    // 오른쪽(월드 −x)에 청소기를 붙인다. THREAT_RANGE(2.6) 안이어야 겁먹는다.
    initVacuums(state);
    const v = state.vacuums[0];
    expect(v, '청소기가 없으면 이 테스트는 성립하지 않는다').toBeDefined();
    v!.pos.x = state.player.pos.x - 1.0;
    v!.pos.z = state.player.pos.z;

    const gecko = new Gecko();
    // 표정은 0.12초에 걸쳐 보간되고 눈동자는 매 호출 10% 씩 따라간다. 여러 번 돌린다.
    for (let i = 0; i < 30; i++) gecko.update(state, moved, DT);

    const pupil = gecko.group.getObjectByName('gecko-pupil-r');
    expect(pupil, '동공을 찾지 못했다').toBeDefined();
    // 로컬 +x = 도마뱀의 오른쪽. 오른쪽 위협을 보면 양수여야 한다.
    expect(pupil!.position.x, '눈동자가 위협 반대쪽을 본다').toBeGreaterThan(0);

    gecko.dispose();
  });

  it('1인칭에서는 자기 몸이 화면에 나오지 않는다 (§25)', () => {
    const { state, moved } = walked(0);
    const gecko = new Gecko();

    gecko.update(state, moved, DT);
    expect(gecko.group.visible, '1인칭을 켜기 전에는 보여야 한다').toBe(true);

    gecko.setFirstPerson(true);
    gecko.update(state, moved, DT);
    expect(gecko.group.visible, '카메라 위치에 자기 머리가 남아 있다').toBe(false);

    gecko.dispose();
  });
});

describe('1인칭 카메라 방향 (§25)', () => {
  /** 카메라가 실제로 바라보는 월드 방향 단위벡터 */
  function lookDir(facing: number): THREE.Vector3 {
    const cam = new FirstPersonCamera(16 / 9);
    cam.snapTo({ x: 0, z: 0 }, facing);
    cam.camera.updateMatrixWorld(true);
    return cam.camera.getWorldDirection(new THREE.Vector3());
  }

  for (const [name, facing] of DIRS) {
    it(`${name} 을 볼 때 카메라도 같은 쪽을 본다`, () => {
      const dir = lookDir(facing);
      // facing 규약은 atan2(x, z) — 방향벡터는 (sin, cos) 다.
      expect(dir.x).toBeCloseTo(Math.sin(facing), 5);
      expect(dir.z).toBeCloseTo(Math.cos(facing), 5);
      expect(dir.y, '1인칭 카메라는 수평을 본다').toBeCloseTo(0, 5);
    });
  }

  it('전진 입력이 카메라가 보는 쪽으로 데려간다', () => {
    const { state } = walked(Math.PI / 2); // 동쪽
    expect(state.player.pos.x, 'W 를 눌렀는데 시선 반대로 갔다').toBeGreaterThan(0);

    const dir = lookDir(state.player.facing);
    expect(dir.x).toBeGreaterThan(0.99);
  });

  /**
   * D 를 누르면 **화면이** 오른쪽으로 돌아야 한다.
   *
   * 상태값만 보면 이 버그는 안 보인다. `facing` 은 D 를 눌렀을 때 성실히 변하고,
   * 8방향 시절에는 화면 회전이라는 개념 자체가 없었다. 1인칭에서 좌우가 뒤집히면
   * 게임을 할 수 없으므로, 여기서 카메라를 세워 실제 화면 축으로 확인한다.
   */
  it('D 를 누르면 시선이 화면 오른쪽으로 간다 (§25)', () => {
    const state = new GameState(1234);
    state.setPhase(Phase.PLAYING);
    state.player.facing = 0;

    const cam = new FirstPersonCamera(16 / 9);
    cam.snapTo(state.player.pos, state.player.facing);
    cam.camera.updateMatrixWorld(true);
    const before = cam.camera.getWorldDirection(new THREE.Vector3());
    // 카메라 로컬 +x 를 월드로 옮긴 것 = 화면 오른쪽.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.camera.quaternion);

    for (let i = 0; i < 10; i++) {
      updateMovement(state, { forward: 0, turn: 1, run: false }, DT);
    }

    cam.snapTo(state.player.pos, state.player.facing);
    cam.camera.updateMatrixWorld(true);
    const after = cam.camera.getWorldDirection(new THREE.Vector3());

    const swung = after.clone().sub(before).dot(right);
    expect(swung, `D 를 눌렀는데 화면이 왼쪽으로 돌았다 (${swung.toFixed(3)})`)
      .toBeGreaterThan(0);
  });

  it('눈높이는 바닥 위이고, 가구에 오르면 상판만큼 올라간다', () => {
    const cam = new FirstPersonCamera(16 / 9);

    cam.snapTo({ x: 0, z: 0 }, 0);
    const onFloor = cam.camera.position.y;
    expect(onFloor).toBeGreaterThan(0);
    expect(onFloor, '눈높이가 소파(0.75)보다 높으면 1인칭이 아니다').toBeLessThan(0.5);

    cam.snapTo({ x: 0, z: 0 }, 0, 0.75); // 소파 상판
    expect(cam.camera.position.y - onFloor).toBeCloseTo(0.75, 5);
  });

  it('반대편으로 돌 때 먼 쪽으로 돌아가지 않는다', () => {
    const cam = new FirstPersonCamera(16 / 9);
    const from = Math.PI - 0.05;
    const to = -Math.PI + 0.05; // 최단 경로로는 0.1 라디안

    cam.snapTo({ x: 0, z: 0 }, from);
    // 한 프레임만 보간한다. 먼 쪽으로 돌면 여기서 정반대로 튄다.
    cam.follow({ x: 0, z: 0 }, to, 0, 0, DT);
    cam.camera.updateMatrixWorld(true);

    const dir = cam.camera.getWorldDirection(new THREE.Vector3());
    const target = new THREE.Vector3(Math.sin(from), 0, Math.cos(from));
    expect(dir.dot(target), '카메라가 반대로 휘돌았다').toBeGreaterThan(0.99);
  });
});
