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

// 로딩 → 타이틀 → 플레이. 조작 안내와 오디오 언락은 타이틀 화면이 맡는다. (§16, §0-6)
const game = new Game({ canvas, uiRoot });
game.exposeForTests();
game.start();
