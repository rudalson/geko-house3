/**
 * Kenney Survival Kit (CC0) 의 GLB 를 이 게임의 키트 파이프라인이 읽을 수 있게 굽는다.
 *
 *   node tools/bake-survival.mjs        (npm run bake:survival)
 *   → public/models/<name>.glb
 *
 * ## 왜 그대로 복사하지 않는가
 * 가구 키트는 색을 **머티리얼**에 담는다 (`wood`, `metal` …). `modelKit.ts` 는
 * 그 전제로 짜여 있어서 머티리얼 색만 뽑아 정점에 굽고 uv 는 버린다.
 *
 * 서바이벌 키트는 다르다. 모델마다 머티리얼이 `colormap` 하나뿐이고, 색은 전부
 * 512x512 팔레트 텍스처(`Textures/colormap.png`)의 칸을 uv 로 가리켜서 나온다.
 * 그대로 들여오면 머티리얼 색이 흰색이라 **나무도 바위도 전부 하얗게** 나온다.
 * 게다가 텍스처가 GLB 밖의 별도 파일이라 `public/models/` 에 경로째 옮겨야 한다.
 *
 * ## 여기서 하는 일
 * 삼각형마다 uv 중심이 가리키는 텍스처 칸의 색을 읽어, **같은 색끼리 묶어
 * 머티리얼 하나씩**으로 다시 쓴다. Kenney 팔레트는 칸마다 단색이라 이 변환은
 * 손실이 없다. 결과물은 가구 키트와 같은 모양(머티리얼 = 단색)이 되므로
 * 런타임 코드를 하나도 고치지 않고 `fitKitModel()` 이 그대로 읽는다.
 *
 * 머티리얼 이름은 색 그 자체다 (`c6b4a2f`). 가구 키트처럼 의미 있는 이름이
 * 없으니, 색을 갈아끼우고 싶으면(`tint`) 이 이름을 열쇠로 쓴다.
 *
 * 원본 배포판은 .gitignore 되어 있다. 다시 구우려면 kenney.nl 에서 받아
 * assets/kenney_survival-kit/ 에 풀 것.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// `convert-character.mjs` 와 같은 사정이다 — GLB 내보내기가 FileReader 를 쓴다.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.();
    });
  }
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets', 'kenney_survival-kit', 'Models', 'GLB format');
const OUT_DIR = join(ROOT, 'public', 'models');

/**
 * 게임이 쓰는 모델. `src/world/outdoorModels.ts`·`src/world/Outdoor.ts` 가 이름으로
 * 참조한다. 빠뜨리면 `tests/stages.test.ts` 가 파일이 없다고 알려 준다.
 */
export const SURVIVAL_MODELS = [
  'tree',
  'tree-tall',
  'tree-autumn',
  'tree-autumn-tall',
  'tree-trunk',
  'tree-log',
  'tree-log-small',
  'rock-a',
  'rock-b',
  'rock-c',
  'rock-flat-grass',
  'tent-canvas',
  'campfire-pit',
  'bedroll',
  'barrel',
  'box-large',
  'chest',
  'workbench',
  'fence',
  'fence-doorway',
  'signpost',
  'bucket',
  'grass',
  'grass-large',
  'tool-axe',
];

// ── PNG ─────────────────────────────────────────────────────────────────────
//
// 팔레트(컬러 타입 3)·8비트·비인터레이스만 읽는다. 키트의 colormap 이 그 형식이고,
// 이것 하나 때문에 이미지 라이브러리를 들이는 건 과하다. 다른 형식이 오면
// 조용히 틀린 색을 내지 않도록 즉시 멈춘다.

function decodePalettePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let palette = null;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colorType, , , interlace] = data.subarray(8, 13);
      if (depth !== 8 || colorType !== 3 || interlace !== 0) {
        throw new Error(`colormap.png: 8비트 팔레트 PNG 만 읽는다 (depth ${depth}, type ${colorType})`);
      }
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!palette) throw new Error('colormap.png: PLTE 청크가 없다');

  const raw = inflateSync(Buffer.concat(idat));
  const index = new Uint8Array(width * height);
  const stride = width; // 픽셀당 1바이트
  let prev = new Uint8Array(stride);

  // PNG 필터를 푼다. bpp 는 1 이다.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x > 0 ? out[x - 1] : 0;
      const b = prev[x];
      const c = x > 0 ? prev[x - 1] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 0xff;
    }
    index.set(out, y * stride);
    prev = out;
  }

  /** uv → sRGB 16진수. glTF uv 는 원점이 왼쪽 위라 PNG 행 순서와 같다. */
  return (u, v) => {
    const x = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
    const i = index[y * width + x] * 3;
    return (palette[i] << 16) | (palette[i + 1] << 8) | palette[i + 2];
  };
}

// ── GLB ─────────────────────────────────────────────────────────────────────

/**
 * 텍스처 참조를 걷어낸 GLB 를 돌려준다.
 *
 * 그대로 `GLTFLoader` 에 넘기면 외부 이미지(`Textures/colormap.png`)를 받으려고
 * 브라우저 API 를 찾다가 Node 에서 멈춘다. 색은 우리가 따로 읽으므로 텍스처는 필요 없다.
 */
function stripTextures(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  for (const m of json.materials ?? []) delete m.pbrMetallicRoughness?.baseColorTexture;
  delete json.images;
  delete json.textures;
  delete json.samplers;

  const rest = buf.subarray(20 + jsonLen);
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4 !== 0) text += ' ';
  const jsonBuf = Buffer.from(text);

  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonBuf.length + rest.length, 8);
  header.writeUInt32LE(jsonBuf.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  const out = Buffer.concat([header, jsonBuf, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

function parseGlb(arrayBuffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });
}

function exportGlb(scene) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(scene, resolve, reject, { binary: true });
  });
}

const hexName = (c) => `c${c.toString(16).padStart(6, '0')}`;

/**
 * 모델 하나를 색별 메시로 다시 짠다.
 *
 * 노드 변환은 지오메트리에 구워 넣는다 — `modelKit.loadOne()` 도 어차피 그렇게
 * 읽으므로, 여기서 미리 해 두면 결과 파일이 평평한 메시 몇 개로 단순해진다.
 */
async function bakeOne(name, sample) {
  const file = join(SRC, `${name}.glb`);
  if (!existsSync(file)) {
    throw new Error(
      `${file} 이 없다. 원본 배포판은 .gitignore 되어 있다 —\n` +
        '  https://kenney.nl/assets/survival-kit 에서 받아\n' +
        `  ${join(ROOT, 'assets', 'kenney_survival-kit')} 에 풀 것.`,
    );
  }

  const gltf = await parseGlb(stripTextures(readFileSync(file)));
  gltf.scene.updateMatrixWorld(true);

  /** 색 → 그 색 삼각형의 [위치, 법선] 배열 */
  const byColor = new Map();

  gltf.scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
    geo.applyMatrix4(obj.matrixWorld);

    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    if (!uv) throw new Error(`${name}: uv 가 없는 메시가 있다 — 색을 알 수 없다`);

    for (let t = 0; t < pos.count; t += 3) {
      const u = (uv.getX(t) + uv.getX(t + 1) + uv.getX(t + 2)) / 3;
      const v = (uv.getY(t) + uv.getY(t + 1) + uv.getY(t + 2)) / 3;
      const color = sample(u, v);

      let bucket = byColor.get(color);
      if (!bucket) {
        bucket = { p: [], n: [] };
        byColor.set(color, bucket);
      }
      for (let k = 0; k < 3; k++) {
        bucket.p.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
        bucket.n.push(nrm.getX(t + k), nrm.getY(t + k), nrm.getZ(t + k));
      }
    }
  });

  const out = new THREE.Scene();
  const colors = [...byColor.keys()].sort((a, b) => a - b);
  for (const color of colors) {
    const { p, n } = byColor.get(color);
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    geo = mergeVertices(geo);
    const mat = new THREE.MeshStandardMaterial({
      name: hexName(color),
      color: new THREE.Color().setHex(color),
      roughness: 1,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = hexName(color);
    out.add(mesh);
  }

  const box = new THREE.Box3().setFromObject(out);
  const size = box.getSize(new THREE.Vector3());
  const glb = await exportGlb(out);
  writeFileSync(join(OUT_DIR, `${name}.glb`), Buffer.from(glb));

  return { colors: colors.map(hexName), size, bytes: glb.byteLength };
}

async function main() {
  const sample = decodePalettePng(readFileSync(join(SRC, 'Textures', 'colormap.png')));
  mkdirSync(OUT_DIR, { recursive: true });

  let total = 0;
  for (const name of SURVIVAL_MODELS) {
    const { colors, size, bytes } = await bakeOne(name, sample);
    total += bytes;
    const dims = [size.x, size.y, size.z].map((v) => v.toFixed(2)).join(' x ');
    console.log(`${name.padEnd(18)} ${dims.padEnd(20)} ${(bytes / 1024).toFixed(1).padStart(5)} kB  ${colors.join(' ')}`);
  }
  console.log(`합계 ${SURVIVAL_MODELS.length}개 ${(total / 1024).toFixed(0)} kB`);
}

await main();
