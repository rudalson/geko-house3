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

const game = new Game({ canvas, uiRoot });
game.exposeForTests();
game.start();

// TODO(S8): 로딩 → 타이틀 → 플레이 흐름과 튜토리얼 안내로 교체한다.
const hint = document.createElement('div');
hint.className = 'controls-hint';
hint.innerHTML =
  '<b>WASD</b> 이동 · <b>Shift</b> 달리기 · <b>E</b> 먹기 · <b>Space</b> 똥 싸기' +
  ' <span class="muted">— S3: 음식과 배고픔</span>';
uiRoot.appendChild(hint);
