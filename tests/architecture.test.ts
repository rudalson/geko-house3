import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, posix, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §0-4 / §0-5 를 코드로 강제한다.
 *
 * 이 테스트가 없으면 누군가 systems/ 에서 무심코 `import * as THREE` 를 하고,
 * 그 순간 Vitest(WebGL 컨텍스트 없음)에서 단위 테스트 전체가 실행 불가능해진다.
 * 문제를 커밋 시점이 아니라 "테스트를 처음 짜려는 시점"에 발견하게 되므로 비싸다.
 */

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && extname(e.name) === '.ts')
    .map((e) => join(e.parentPath, e.name));
}

/** 저장소 기준 상대 경로를 슬래시 표기로 (Windows 대응) */
const rel = (file: string): string => relative(ROOT, file).split(sep).join(posix.sep);

/**
 * 주석을 지운 소스를 돌려준다.
 *
 * 이걸 하지 않으면 "Math.random() 을 쓰지 말 것" 같은 **주석 문구**가 위반으로
 * 잡힌다. 규칙을 설명하는 주석을 달았다는 이유로 테스트가 깨지면,
 * 사람들은 규칙을 지키는 대신 주석을 지우게 된다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const readCode = (file: string): string => stripComments(readFileSync(file, 'utf8'));

/**
 * Three.js 를 import 해서는 안 되는 파일. (§0-4)
 * core/Game.ts 는 씬을 조립하는 자리라 예외다.
 */
function mustBePure(file: string): boolean {
  const r = rel(file);
  if (r.startsWith('src/systems/')) return true;
  if (r.startsWith('src/core/') && !r.endsWith('/Game.ts')) return true;
  return r === 'src/world/CollisionMap.ts' || r === 'src/world/furnitureLayout.ts';
}

const THREE_IMPORT = /^\s*import\s[^;]*?from\s+['"]three(\/.*)?['"]/m;

describe('아키텍처 제약 (§0-4)', () => {
  const files = sourceFiles(SRC);

  it('src/ 에 TypeScript 소스가 존재한다', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('순수 로직 계층은 Three.js 를 import 하지 않는다', () => {
    const offenders = files
      .filter(mustBePure)
      .filter((f) => THREE_IMPORT.test(readCode(f)))
      .map(rel);

    expect(
      offenders,
      `다음 파일이 Three.js 를 import 한다. 렌더링은 entities/ · scenes/ 로 옮길 것:\n` +
        offenders.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('순수 로직 계층은 렌더 계층을 역참조하지 않는다 — 단방향 유지', () => {
    const offenders = files
      .filter(mustBePure)
      .filter((f) => /from\s+['"][^'"]*\/(entities|scenes|ui)\//.test(readCode(f)))
      .map(rel);

    expect(offenders, `순수 계층 → 렌더 계층 참조는 금지된다 (§6-2)`).toEqual([]);
  });
});

describe('결정성 제약 (§0-5)', () => {
  const files = sourceFiles(SRC);

  it('Math.random() 을 직접 호출하지 않는다 — Rng 를 주입해서 쓸 것', () => {
    const offenders = files
      .filter((f) => rel(f) !== 'src/core/Rng.ts')
      .filter((f) => /Math\s*\.\s*random\s*\(/.test(readCode(f)))
      .map(rel);

    expect(
      offenders,
      `Math.random() 은 재현 불가능한 버그를 만든다. core/Rng.ts 를 쓸 것:\n` +
        offenders.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('게임 로직이 브라우저 타이머에 의존하지 않는다 (§8 재시작 요구사항)', () => {
    const offenders = files
      .filter(mustBePure)
      .filter((f) => /\b(setTimeout|setInterval)\s*\(/.test(readCode(f)))
      .map(rel);

    expect(
      offenders,
      `타이머는 게임 내부 누적 시간으로 관리해야 재시작 시 누수가 없다:\n` +
        offenders.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
  });
});

describe('밸런스 상수 단일 원천 (§4)', () => {
  it('GameConfig 밖에서 CONFIG 값을 재정의하지 않는다', () => {
    const dupes = sourceFiles(SRC)
      .filter((f) => rel(f) !== 'src/core/GameConfig.ts')
      .filter((f) => /^\s*(export\s+)?const\s+CONFIG\s*=/m.test(readCode(f)))
      .map(rel);

    expect(dupes, 'CONFIG 는 src/core/GameConfig.ts 한 곳에만 있어야 한다').toEqual([]);
  });
});
