/**
 * 도마뱀이 **가는 쪽을 보고 있는지** 검증한다.
 *
 * 이건 눈으로만 잡히던 종류의 버그다. 모델은 머리를 로컬 −Z 에 두고 만들었는데
 * `facing = atan2(dirX, dirZ)` 는 로컬 **+Z** 를 진행 방향에 맞추는 값이라,
 * 꼬리가 앞장서고 도마뱀이 뒷걸음질쳤다. 스크린샷을 봐도 저해상도에서는
 * 알아채기 어렵고, 상태값(`facing`)만 보면 정상으로 보인다.
 *
 * 그래서 화면이 아니라 **머리의 월드 좌표**를 본다. Three.js 의 Object3D 계산은
 * WebGL 없이 node 에서 그대로 돌아가므로 여기서 확인할 수 있다.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Gecko } from '../src/entities/Gecko.ts';
import { GameState } from '../src/core/GameState.ts';
import { Phase } from '../src/core/types.ts';
import { updateMovement } from '../src/systems/MovementSystem.ts';
import { initVacuums } from '../src/systems/VacuumSystem.ts';

/** 실제로 이동시킨 뒤, 머리가 몸 중심보다 진행 방향 쪽에 있는지 본다. */
function headLead(input: { x: number; z: number }): number {
  const state = new GameState(1234);
  state.setPhase(Phase.PLAYING);

  const gecko = new Gecko();
  const before = { ...state.player.pos };
  const moved = updateMovement(state, { ...input, run: false }, 1 / 60);
  expect(moved, '이동 자체가 일어나지 않았다 — 테스트 전제가 깨졌다').toBeGreaterThan(0);

  gecko.update(state, moved, 1 / 60);
  gecko.group.updateMatrixWorld(true);

  const head = gecko.group.getObjectByName('gecko-head');
  expect(head, '머리 오브젝트를 찾지 못했다').toBeDefined();

  const headWorld = new THREE.Vector3();
  head!.getWorldPosition(headWorld);

  // 진행 방향 단위벡터
  const len = Math.hypot(input.x, input.z);
  const dx = input.x / len;
  const dz = input.z / len;

  // 몸 중심(그룹 원점) 기준으로 머리가 얼마나 앞에 있는지.
  // 양수 = 머리가 앞장선다, 음수 = 뒷걸음질.
  const rel = headWorld.clone().sub(new THREE.Vector3(state.player.pos.x, 0, state.player.pos.z));
  gecko.dispose();
  void before;
  return rel.x * dx + rel.z * dz;
}

describe('도마뱀 방향', () => {
  // 8방향 전부 본다. 한 축만 보면 부호 하나가 틀려도 통과한다.
  const dirs: [string, { x: number; z: number }][] = [
    ['W (북)', { x: 0, z: -1 }],
    ['S (남)', { x: 0, z: 1 }],
    ['A (서)', { x: -1, z: 0 }],
    ['D (동)', { x: 1, z: 0 }],
    ['북서', { x: -1, z: -1 }],
    ['북동', { x: 1, z: -1 }],
    ['남서', { x: -1, z: 1 }],
    ['남동', { x: 1, z: 1 }],
  ];

  for (const [name, input] of dirs) {
    it(`${name} 으로 갈 때 머리가 앞장선다`, () => {
      const lead = headLead(input);
      expect(lead, `머리가 진행 방향 반대쪽에 있다 (투영 ${lead.toFixed(3)}) — 뒷걸음질`)
        .toBeGreaterThan(0);
    });
  }

  /**
   * 눈동자가 위협 쪽을 보는지. (§17 — 표정은 정보 채널이다)
   *
   * 진행 방향과 같은 회전 규약을 쓰므로 여기서 함께 본다. 실제로 방향 버그를
   * 고치면서 이쪽 역회전 부호도 뒤집혀 있던 것이 드러났다 — 정면을 보고 있을 때
   * 오른쪽 위협을 왼쪽이라고 답하고 있었다.
   */
  it('겁먹으면 눈동자가 위협 쪽으로 돌아간다', () => {
    const state = new GameState(1234);
    state.setPhase(Phase.PLAYING);

    // +z 를 향해 걷는다. 이때 도마뱀의 오른쪽은 월드 −x 다.
    const moved = updateMovement(state, { x: 0, z: 1, run: false }, 1 / 60);
    expect(moved).toBeGreaterThan(0);

    // 오른쪽(월드 −x)에 청소기를 붙인다. THREAT_RANGE(2.6) 안이어야 겁먹는다.
    initVacuums(state);
    const v = state.vacuums[0];
    expect(v, '청소기가 없으면 이 테스트는 성립하지 않는다').toBeDefined();
    v!.pos.x = state.player.pos.x - 1.0;
    v!.pos.z = state.player.pos.z;

    const gecko = new Gecko();
    // 표정은 0.12초에 걸쳐 보간되고 눈동자는 매 호출 10% 씩 따라간다. 여러 번 돌린다.
    for (let i = 0; i < 30; i++) gecko.update(state, moved, 1 / 60);

    const pupil = gecko.group.getObjectByName('gecko-pupil-r');
    expect(pupil, '동공을 찾지 못했다').toBeDefined();
    // 로컬 +x = 도마뱀의 오른쪽. 오른쪽 위협을 보면 양수여야 한다.
    expect(pupil!.position.x, '눈동자가 위협 반대쪽을 본다').toBeGreaterThan(0);

    gecko.dispose();
  });

  it('꼬리는 머리 반대쪽에 있다', () => {
    const state = new GameState(1234);
    state.setPhase(Phase.PLAYING);
    const gecko = new Gecko();
    const moved = updateMovement(state, { x: 1, z: 0, run: false }, 1 / 60);
    gecko.update(state, moved, 1 / 60);
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
});
