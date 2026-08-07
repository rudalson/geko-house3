import './style.css';
import { CONFIG, DERIVED } from './core/GameConfig.ts';
import { analytic, simulate } from './core/BalanceModel.ts';

/**
 * 진입점. S1 에서 Game 을 조립하면서 채워진다.
 * 지금은 코어(설정·모델)가 브라우저에서도 그대로 로드되는지 확인만 한다.
 */

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('#game-canvas 를 찾을 수 없다');

if (import.meta.env.DEV) {
  const a = analytic();
  const sim = simulate();
  console.info(
    `[balance] 거실 ${DERIVED.ROOM_W}x${DERIVED.ROOM_H} / 목표 ${(CONFIG.TARGET_RATIO * 100).toFixed(0)}%` +
      ` / p*=${a.pStar.toFixed(3)} / 예상 도달 ${(sim.timeSec / 60).toFixed(1)}분`,
  );
}

const ui = document.querySelector<HTMLDivElement>('#ui-root');
if (ui) {
  ui.innerHTML = `
    <div class="boot-notice">
      <h1>🦎 게코 하우스 서바이벌</h1>
      <p>S0 스캐폴딩 완료 — 코어 루프·설정·밸런스 모델이 로드되었습니다.</p>
      <p class="muted">다음 단계: 거실 월드와 도마뱀 이동 (S1)</p>
    </div>
  `;
}
