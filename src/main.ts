import './style.css';
import { Game } from './core/Game.ts';
import { CONFIG } from './core/GameConfig.ts';
import { analytic, simulate } from './core/BalanceModel.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('#game-canvas 를 찾을 수 없다');

if (import.meta.env.DEV) {
  const a = analytic();
  const sim = simulate();
  console.info(
    `[balance] 목표 ${(CONFIG.TARGET_RATIO * 100).toFixed(0)}%` +
      ` / p*=${a.pStar.toFixed(3)} / 예상 도달 ${(sim.timeSec / 60).toFixed(1)}분`,
  );
}

const game = new Game({ canvas });
game.exposeForTests();
game.start();

// TODO(S8): 로딩 → 타이틀 → 플레이 흐름으로 교체한다. 지금은 바로 플레이로 진입한다.
const ui = document.querySelector<HTMLDivElement>('#ui-root');
if (ui) {
  ui.innerHTML = `
    <div class="controls-hint">
      <b>WASD / 방향키</b> 이동 · <b>Shift</b> 달리기
      <span class="muted">— S1: 이동과 카메라</span>
    </div>
  `;
}
