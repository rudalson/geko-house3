import './style.css';
import { Game } from './core/Game.ts';
import { CONFIG } from './core/GameConfig.ts';
import { analytic, simulate } from './core/BalanceModel.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiRoot = document.querySelector<HTMLDivElement>('#ui-root');
if (!canvas) throw new Error('#game-canvas 를 찾을 수 없다');
if (!uiRoot) throw new Error('#ui-root 를 찾을 수 없다');

if (import.meta.env.DEV) {
  const a = analytic();
  const sim = simulate();
  console.info(
    `[balance] 목표 ${(CONFIG.TARGET_RATIO * 100).toFixed(0)}%` +
      ` / p*=${a.pStar.toFixed(3)} / 예상 도달 ${(sim.timeSec / 60).toFixed(1)}분`,
  );
}

/**
 * `?seed=1337` 로 판을 고정한다.
 *
 * §0-5 는 "같은 시드면 같은 판"을 요구하는데, 정작 **밖에서 시드를 지정할 방법이
 * 없었다** — 기본값이 `Date.now()` 라 매번 다른 세계가 만들어졌다.
 * 그래서 E2E 는 매 실행마다 다른 음식 배치를 상대해야 했고, 상호작용처럼
 * 주변 상황에 좌우되는 테스트가 간헐적으로 깨졌다.
 *
 * 버그 재현에도 쓸 수 있다. 이상한 판을 만나면 주소창의 시드를 그대로 넘기면 된다.
 */
function seedFromUrl(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n >>> 0 : undefined;
}

// 로딩 → 타이틀 → 플레이. 조작 안내와 오디오 언락은 타이틀 화면이 맡는다. (§16, §0-6)
const seed = seedFromUrl();
const game = new Game(seed === undefined ? { canvas, uiRoot } : { canvas, uiRoot, seed });
game.exposeForTests();
game.start();
