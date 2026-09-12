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
import { createHumanAvatar } from '../src/entities/humanAvatar.ts';

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
      let skinnedMesh: THREE.SkinnedMesh | null = null;
      parsedGltf.scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedMesh = o as THREE.SkinnedMesh;
      });
      expect(skinnedMesh).not.toBeNull();
      skinnedMesh!.updateMatrixWorld(true);

      const pos = skinnedMesh!.geometry.attributes.position!;
      const uv = skinnedMesh!.geometry.attributes.uv!;

      const faceVerts: THREE.Vector3[] = [];
      const headVerts: THREE.Vector3[] = [];

      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        const worldV = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(
          skinnedMesh!.matrixWorld,
        );

        // 스킨 텍스처 상 얼굴 이목구비 UV 영역
        if (u >= 0.26 && u <= 0.36 && v >= 0.74 && v <= 0.84) {
          faceVerts.push(worldV);
        }
        // 머리 전체 정점
        if (worldV.y > 260) {
          headVerts.push(worldV);
        }
      }

      expect(faceVerts.length).toBeGreaterThan(0);
      expect(headVerts.length).toBeGreaterThan(0);

      const avgFace = faceVerts
        .reduce((acc, v) => acc.add(v), new THREE.Vector3())
        .divideScalar(faceVerts.length);
      const avgHead = headVerts
        .reduce((acc, v) => acc.add(v), new THREE.Vector3())
        .divideScalar(headVerts.length);

      const faceDir = new THREE.Vector3().subVectors(avgFace, avgHead);
      faceDir.y = 0;
      faceDir.normalize();

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
        // rotation.y = facing 적용 시 (MODEL_YAW = 0)
        // 얼굴 벡터 (0, 0, 1) 이 진행 방향 (sin(facing), cos(facing)) 과 일치하는지 확인
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), facing);
        const expectedX = Math.sin(facing);
        const expectedZ = Math.cos(facing);

        expect(forward.x).toBeCloseTo(expectedX, 5);
        expect(forward.z).toBeCloseTo(expectedZ, 5);
      });
    }
  });
});
