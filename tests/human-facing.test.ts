/**
 * 사람이 진행 방향(facing)을 정면으로 바라보고 걷는지 검증한다. (§24)
 *
 * 얼굴을 기준으로 똑바로 걷지 않고 옆걸음질(crab-walk)치는 버그를 방지한다.
 * Three.js 의 Object3D 계산은 WebGL 없이 node 환경에서 그대로 돌아가므로
 * 8방향 전부에 대해 얼굴이 진행 방향 쪽에 있는지 확인한다.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KIT_MODEL_YAW, createHumanAvatar } from '../src/entities/humanAvatar.ts';
import { CONFIG } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { Phase } from '../src/core/types.ts';
import { angleDelta } from '../src/systems/MovementSystem.ts';
import { resetHumans, spawnHumanIfDue, updateHumans } from '../src/systems/HumanSystem.ts';

const UP = new THREE.Vector3(0, 1, 0);

// 8방향: [이름, facing 라디안, 진행 단위 벡터 (x, z)]
const DIRS: [string, number, [number, number]][] = [
  ['북 (−z)', Math.PI, [0, -1]],
  ['남 (+z)', 0, [0, 1]],
  ['서 (−x)', -Math.PI / 2, [-1, 0]],
  ['동 (+x)', Math.PI / 2, [1, 0]],
  ['북서', (-3 * Math.PI) / 4, [-Math.SQRT1_2, -Math.SQRT1_2]],
  ['북동', (3 * Math.PI) / 4, [Math.SQRT1_2, -Math.SQRT1_2]],
  ['남서', -Math.PI / 4, [-Math.SQRT1_2, Math.SQRT1_2]],
  ['남동', Math.PI / 4, [Math.SQRT1_2, Math.SQRT1_2]],
];

/**
 * `human.glb` 스킨드 메시에서 **얼굴이 향하는 로컬 방향**을 실측한다.
 *
 * 머리 전체 정점의 평균에서 이목구비(스킨 텍스처 UV 영역) 정점의 평균으로 가는
 * 벡터가 곧 정면이다. 상수를 믿지 않고 에셋에서 재는 게 요점이다 — 모델을 다시
 * 구우면 여기서 바로 드러난다.
 */
function faceDirOf(scene: THREE.Object3D): THREE.Vector3 {
  let skinnedMesh: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedMesh = o as THREE.SkinnedMesh;
  });
  expect(skinnedMesh).not.toBeNull();
  const mesh = skinnedMesh as unknown as THREE.SkinnedMesh;
  mesh.updateMatrixWorld(true);

  const pos = mesh.geometry.attributes.position!;
  const uv = mesh.geometry.attributes.uv!;
  const avgFace = new THREE.Vector3();
  const avgHead = new THREE.Vector3();
  let faceCount = 0;
  let headCount = 0;

  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const worldV = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(
      mesh.matrixWorld,
    );
    // 스킨 텍스처 상 얼굴 이목구비 UV 영역
    if (u >= 0.26 && u <= 0.36 && v >= 0.74 && v <= 0.84) {
      avgFace.add(worldV);
      faceCount++;
    }
    // 머리 전체 정점
    if (worldV.y > 260) {
      avgHead.add(worldV);
      headCount++;
    }
  }

  expect(faceCount).toBeGreaterThan(0);
  expect(headCount).toBeGreaterThan(0);

  const dir = avgFace.divideScalar(faceCount).sub(avgHead.divideScalar(headCount));
  dir.y = 0;
  return dir.normalize();
}

describe('인간 모델 정면 방향 검증 (§24)', () => {
  describe('폴백 로우폴리 아바타 (PolyHumanAvatar)', () => {
    for (const [name, facing] of DIRS) {
      it(`${name} 방향으로 이동할 때 얼굴이 앞장선다`, () => {
        const avatar = createHumanAvatar();
        const originX = 10;
        const originZ = 15;
        avatar.object.position.set(originX, 0, originZ);
        avatar.object.rotation.y = facing;
        avatar.object.updateMatrixWorld(true);

        const torso = avatar.object.children[0] as THREE.Mesh;
        expect(torso).toBeDefined();

        const pos = torso.geometry.attributes.position!;
        // 얼굴 앞쪽(눈·코·입 등 local z > 0, y > 1.4) 정점들의 월드 위치 평균
        let count = 0;
        const sum = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
          const ly = pos.getY(i);
          const lz = pos.getZ(i);
          if (ly > 1.45 && lz > 0.15) {
            const worldV = new THREE.Vector3(pos.getX(i), ly, lz).applyMatrix4(torso.matrixWorld);
            sum.add(worldV);
            count++;
          }
        }
        expect(count).toBeGreaterThan(0);
        const faceCenter = sum.divideScalar(count);

        const relX = faceCenter.x - originX;
        const relZ = faceCenter.z - originZ;

        // 진행 방향으로의 투영(lead)은 양수여야 한다 (얼굴이 앞장섬)
        const lead = relX * Math.sin(facing) + relZ * Math.cos(facing);
        // 좌우 편차(side)는 대칭이므로 거의 0이어야 한다
        const side = relX * Math.cos(facing) - relZ * Math.sin(facing);

        expect(lead, `${name} 으로 걸을 때 얼굴이 앞을 보지 않는다 (lead=${lead})`).toBeGreaterThan(0.1);
        expect(Math.abs(side), `${name} 으로 걸을 때 얼굴이 옆으로 쏠렸다 (side=${side})`).toBeLessThan(0.05);

        avatar.dispose();
      });
    }
  });

  describe('키트 스킨드 모델 (human.glb)', () => {
    const glbBuffer = fs.readFileSync('public/models/human.glb');
    const arrayBuf = glbBuffer.buffer.slice(
      glbBuffer.byteOffset,
      glbBuffer.byteOffset + glbBuffer.byteLength,
    );

    let parsedGltf: { scene: THREE.Group; animations: THREE.AnimationClip[] };

    it('human.glb 모델을 파싱할 수 있다', async () => {
      const loader = new GLTFLoader();
      parsedGltf = await new Promise((resolve, reject) => {
        loader.parse(arrayBuf, '', resolve, reject);
      });
      expect(parsedGltf).toBeDefined();
      expect(parsedGltf.scene).toBeDefined();
    });

    it('원본 모델의 얼굴(이목구비)이 로컬 +z 를 정면으로 바라보고 있다', () => {
      const faceDir = faceDirOf(parsedGltf.scene);

      // 얼굴 방향 벡터가 로컬 +z 와 일치해야 한다 (z > 0.99, |x| < 0.05)
      expect(faceDir.z, '얼굴이 +z 정면을 향해야 한다').toBeGreaterThan(0.99);
      expect(Math.abs(faceDir.x), '얼굴이 옆으로 비틀려 있다').toBeLessThan(0.05);
    });

    it('달리기 애니메이션의 다리 스윙이 x축(옆걸음)이 아닌 z축(앞뒤 전진)을 따라 움직인다', () => {
      const runClip = parsedGltf.animations.find((a) => a.name === 'run');
      expect(runClip).toBeDefined();

      const mixer = new THREE.AnimationMixer(parsedGltf.scene);
      const action = mixer.clipAction(runClip!);
      action.play();

      let leftFoot: THREE.Object3D | null = null;
      let rightFoot: THREE.Object3D | null = null;
      parsedGltf.scene.traverse((o) => {
        if (o.name === 'LeftFoot') leftFoot = o;
        if (o.name === 'RightFoot') rightFoot = o;
      });
      expect(leftFoot).not.toBeNull();
      expect(rightFoot).not.toBeNull();

      let minZ = Infinity,
        maxZ = -Infinity;
      let minX = Infinity,
        maxX = -Infinity;

      for (let t = 0; t <= runClip!.duration; t += 0.05) {
        mixer.setTime(t);
        parsedGltf.scene.updateMatrixWorld(true);
        const lp = new THREE.Vector3();
        leftFoot!.getWorldPosition(lp);
        minZ = Math.min(minZ, lp.z);
        maxZ = Math.max(maxZ, lp.z);
        minX = Math.min(minX, lp.x);
        maxX = Math.max(maxX, lp.x);
      }

      const swingZ = maxZ - minZ;
      const swingX = maxX - minX;

      // 앞뒤(z축) 스윙 폭이 좌우(x축) 스윙 폭보다 훨씬 커야 한다 (앞으로 달림)
      expect(swingZ, 'z축 앞뒤 스윙이 있어야 한다').toBeGreaterThan(100);
      expect(swingX, 'x축 좌우 흔들림은 크지 않아야 한다').toBeLessThan(20);
    });

    for (const [name, facing] of DIRS) {
      it(`${name} 방향으로 걸을 때 키트 아바타의 얼굴이 진행 방향을 향한다`, () => {
        // 에셋에서 **실측한** 얼굴 방향에 MODEL_YAW 보정과 facing 을 차례로 걸면
        // 진행 방향 (sin f, cos f) 이 나와야 한다. 보정값이 틀어지면 (예전의
        // −90도처럼) 여기서 깨진다 — 상수를 안 보는 항등식이 아니다.
        const dir = faceDirOf(parsedGltf.scene)
          .applyAxisAngle(UP, KIT_MODEL_YAW)
          .applyAxisAngle(UP, facing);

        expect(dir.x, `${name} 으로 걸을 때 얼굴 x 가 진행 방향과 다르다`).toBeCloseTo(
          Math.sin(facing),
          2,
        );
        expect(dir.z, `${name} 으로 걸을 때 얼굴 z 가 진행 방향과 다르다`).toBeCloseTo(
          Math.cos(facing),
          2,
        );
      });
    }
  });
});

/**
 * 걷는 동안 얼굴이 떨리지 않는지. (§24)
 *
 * 웨이포인트를 지나쳤다 되돌아오기를 반복하면 `dir` 이 매 프레임 정확히 반대가
 * 되어 `facing` 이 180도씩 뒤집히고, 사람이 제자리에서 파르르 떤다. 실측에서
 * 20초 중 16% 의 프레임이 그랬다. 순수 로직이라 Three.js 없이 잡을 수 있다.
 */
describe('사람이 걸을 때 방향이 튀지 않는다 (§24)', () => {
  const DT = CONFIG.FIXED_DT;
  const SECONDS = 20;

  /** 20초를 돌리며 프레임별 선회량과, 같은 목표를 지나쳤다 되돌아온 횟수를 모은다 */
  function walk(seed: number): { turns: number[]; overshoots: number } {
    const state = new GameState(seed);
    state.setPhase(Phase.PLAYING);
    state.player.pos = { x: 0, z: -0.5 };
    resetHumans(state);
    state.player.foodsEaten = CONFIG.FOOD_PER_AGE * CONFIG.LEVEL_THRESHOLDS[1]!;
    state.refreshGrowth();
    expect(spawnHumanIfDue(state)).toBe(true);

    const h = state.humans[0]!;
    const turns: number[] = [];
    let overshoots = 0;
    let prevFacing = h.facing;
    let prevStep: { x: number; z: number } | null = null;
    let prevWaypoint = { x: h.waypoint.x, z: h.waypoint.z };

    for (let i = 0; i < Math.round(SECONDS / DT); i++) {
      const before = { x: h.pos.x, z: h.pos.z };
      updateHumans(state, DT);

      turns.push(Math.abs(angleDelta(prevFacing, h.facing)));
      prevFacing = h.facing;

      const step = { x: h.pos.x - before.x, z: h.pos.z - before.z };
      if (Math.hypot(step.x, step.z) > 1e-6) {
        // **목표가 그대로인데** 직전 프레임과 반대로 움직였다면 지나쳤다 되돌아온
        // 것이다. 경로 재계산이 뒤쪽 칸을 새로 집어서 돌아서는 건 정상이라
        // (20초에 2~4회), 웨이포인트가 바뀌지 않은 프레임만 센다.
        const sameWaypoint = prevWaypoint.x === h.waypoint.x && prevWaypoint.z === h.waypoint.z;
        if (sameWaypoint && prevStep && step.x * prevStep.x + step.z * prevStep.z < 0) overshoots++;
        prevStep = step;
      }
      prevWaypoint = { x: h.waypoint.x, z: h.waypoint.z };
    }
    return { turns, overshoots };
  }

  for (const seed of [8080, 1234, 20260913]) {
    it(`시드 ${seed} — 한 프레임에 HUMAN_TURN_SPEED 보다 많이 돌지 않는다`, () => {
      const { turns } = walk(seed);
      const max = Math.max(...turns);
      const limit = CONFIG.HUMAN_TURN_SPEED * DT;
      const deg = (r: number): string => ((r * 180) / Math.PI).toFixed(0);
      expect(max, `한 프레임에 ${deg(max)}도 돌았다 (한계 ${deg(limit)}도)`).toBeLessThanOrEqual(
        limit + 1e-9,
      );
    });

    it(`시드 ${seed} — 웨이포인트를 지나쳤다 되돌아오지 않는다`, () => {
      const { overshoots } = walk(seed);
      expect(overshoots, `같은 웨이포인트를 ${overshoots} 번 지나쳤다 되돌아왔다`).toBe(0);
    });
  }

  it('떨림을 없애느라 사람을 세워 버린 게 아니다 — 5초 동안 실제로 걸어간다', () => {
    const state = new GameState(8080);
    state.setPhase(Phase.PLAYING);
    state.player.pos = { x: 0, z: -0.5 };
    resetHumans(state);
    state.player.foodsEaten = CONFIG.FOOD_PER_AGE * CONFIG.LEVEL_THRESHOLDS[1]!;
    state.refreshGrowth();
    spawnHumanIfDue(state);

    const h = state.humans[0]!;
    const start = { x: h.pos.x, z: h.pos.z };
    let travelled = 0;
    for (let i = 0; i < Math.round(5 / DT); i++) {
      const before = { x: h.pos.x, z: h.pos.z };
      updateHumans(state, DT);
      travelled += Math.hypot(h.pos.x - before.x, h.pos.z - before.z);
    }
    expect(travelled).toBeGreaterThan(1.5);
    expect(Math.hypot(h.pos.x - start.x, h.pos.z - start.z)).toBeGreaterThan(0.5);
  });
});
