/**
 * 개발 모드에서 Game.exposeForTests() 가 노출하는 전역 훅. (§21-2)
 * Playwright 가 화면 픽셀이 아니라 내부 상태를 직접 검증할 수 있게 한다.
 */

import type { CONFIG } from '../src/core/GameConfig.ts';
import type { DebugInfo } from '../src/core/Game.ts';
import type { GameState } from '../src/core/GameState.ts';

declare global {
  interface Window {
    __GAME__: {
      readonly state: GameState;
      debug: {
        info(): DebugInfo;
        setTimeScale(v: number): void;
        teleport(x: number, z: number): void;
        fillPoop(): void;
        fillHunger(): void;
        setHunger(v: number): void;
        healHearts(): void;
        forceWin(): void;
        forceGameOver(): void;
        restart(): void;
        config: typeof CONFIG;
      };
    };
  }
}

export {};
