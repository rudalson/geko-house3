/**
 * Kenney Animated Characters (CC0) 의 FBX 를 게임이 쓰는 GLB 한 개로 굽는다.
 *
 *   node tools/convert-character.mjs
 *   → public/models/human.glb
 *
 * ## 왜 빌드 타임에 굽는가
 * 런타임에 FBX 를 읽으려면 `FBXLoader` 를 번들에 넣어야 하는데 그것만 110 kB 가
 * 넘고, 원본 4개(모델 + 애니메이션 3개)는 합쳐서 2.3 MB 다 — 게임의 나머지 에셋
 * 전부를 합친 것의 일곱 배다. 게다가 애니메이션이 모델과 **다른 파일**에 있어서,
 * 런타임에 매번 클립을 모델 스켈레톤에 얹는 일을 반복하게 된다.
 * 한 번 구워 두면 이미 번들에 있는 `GLTFLoader` 로 파일 하나만 받으면 된다.
 *
 * ## 여기서 하는 일
 *   ① 모델 FBX + 애니메이션 FBX 를 읽어 클립을 모델에 붙인다
 *   ② 쓰지 않는 것을 덜어낸다 — 흰색뿐인 정점 색, `Targeting Pose` 더미 클립,
 *      값이 변하지 않는 position·scale 트랙, 중복 정점
 *   ③ 스킨 텍스처는 **넣지 않는다.** 인물마다 다른 PNG 를 런타임에 갈아끼워야
 *      하므로(§24 사람은 판마다 다른 얼굴이다) 텍스처는 별도 파일로 둔다.
 *
 * 원본 배포판은 .gitignore 되어 있다. 다시 구우려면 kenney.nl 에서 받아
 * assets/kenney_animated-characters-protagonists/ 에 풀 것.
 */

import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * `GLTFExporter` 의 바이너리(GLB) 경로는 브라우저의 `FileReader` 로 Blob 을 읽는다.
 * Node 에는 `Blob` 은 있어도 `FileReader` 가 없다. 쓰는 곳이 여기 한 군데뿐이라
 * 필요한 만큼만 흉내 낸다 — 라이브러리를 포크하거나 헤드리스 브라우저를 띄우는
 * 것보다 이쪽이 훨씬 싸다.
 */
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets', 'kenney_animated-characters-protagonists');
const OUT_DIR = join(ROOT, 'public', 'models');

/** 게임이 쓰는 클립만. `jump` 는 사람이 뛸 일이 없어 굽지 않는다. */
const CLIPS = { Idle: 'idle', Run: 'run' };

/** 얼굴 스킨. `src/entities/humanAvatar.ts` 의 목록과 같아야 한다. */
const SKINS = ['criminalMaleA', 'skaterFemaleA', 'skaterMaleA'];

function loadFbx(file) {
  if (!existsSync(file)) {
    throw new Error(
      `${file} 이 없다. 원본 배포판은 .gitignore 되어 있다 —\n` +
        '  https://kenney.nl/assets/animated-characters-2 에서 받아\n' +
        `  ${SRC} 에 풀 것.`,
    );
  }
  const buf = readFileSync(file);
  return new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

/**
 * 값이 처음부터 끝까지 같은 트랙인지.
 *
 * FBX 는 뼈 45개마다 position·quaternion·scale 을 전부 내보낸다. 그중 실제로
 * 움직이는 건 회전뿐이라, 나머지를 들고 있으면 파일의 대부분이 "1, 1, 1, 1, …" 이
 * 된다. 상수 트랙은 지워도 결과가 같다 — 뼈의 기본 위치·크기는 바인드 포즈가
 * 이미 들고 있고, 트랙이 없으면 재생기가 그 값을 그대로 둔다.
 */
function isConstant(track) {
  const { values, valueSize } = track;
  for (let i = valueSize; i < values.length; i++) {
    if (Math.abs(values[i] - values[i % valueSize]) > 1e-6) return false;
  }
  return true;
}

function main() {
  const model = loadFbx(join(SRC, 'Model', 'characterMedium.fbx'));

  let verticesBefore = 0;
  let verticesAfter = 0;
  model.traverse((obj) => {
    if (!obj.isSkinnedMesh) return;

    // 정점 색은 전부 흰색이다 — 스킨 텍스처가 색을 다 담당한다. 들고 있어 봐야
    // 정점당 12바이트를 흰색으로 채울 뿐이다.
    obj.geometry.deleteAttribute('color');

    verticesBefore += obj.geometry.attributes.position.count;
    // FBX 는 인덱스 없이 나온다. 공유 정점을 합치면 절반 가까이 줄어든다.
    obj.geometry = mergeVertices(obj.geometry);
    verticesAfter += obj.geometry.attributes.position.count;

    // Phong 은 glTF 에 그대로 담기지 않아 내보내기가 경고를 뱉는다. 어차피
    // 런타임이 재질을 갈아끼우므로(스킨 텍스처 + 게임 조명) 여기서 정리해 둔다.
    obj.material = new THREE.MeshStandardMaterial({ name: 'skin', roughness: 1, metalness: 0 });
  });

  const animations = [];
  for (const file of ['idle', 'run']) {
    const clips = loadFbx(join(SRC, 'Animations', `${file}.fbx`)).animations;
    for (const clip of clips) {
      // FBX 이름은 `Root|Idle` 꼴이고, 어느 파일에나 `0.Targeting Pose` 더미가 끼어 있다.
      const short = clip.name.split('|').pop();
      const name = CLIPS[short];
      if (!name) continue;

      clip.name = name;
      clip.tracks = clip.tracks.filter(
        (t) => t.name.endsWith('.quaternion') || !isConstant(t),
      );
      clip.optimize();
      animations.push(clip);
    }
  }

  const missing = Object.values(CLIPS).filter((n) => !animations.some((c) => c.name === n));
  if (missing.length > 0) throw new Error(`클립을 찾지 못했다: ${missing.join(', ')}`);

  mkdirSync(OUT_DIR, { recursive: true });

  new GLTFExporter().parse(
    model,
    (glb) => {
      const out = join(OUT_DIR, 'human.glb');
      writeFileSync(out, Buffer.from(glb));
      console.log(`${out}  ${(glb.byteLength / 1024).toFixed(0)} kB`);
      console.log(`  정점 ${verticesBefore} → ${verticesAfter}`);
      for (const c of animations) {
        console.log(`  클립 ${c.name}  ${c.duration.toFixed(2)}s  트랙 ${c.tracks.length}`);
      }
    },
    (err) => {
      throw err;
    },
    { binary: true, animations, includeCustomExtensions: false },
  );

  for (const skin of SKINS) {
    copyFileSync(join(SRC, 'Skins', `${skin}.png`), join(OUT_DIR, `human-${skin}.png`));
  }
  console.log(`  스킨 ${SKINS.length}장 복사`);
}

main();
