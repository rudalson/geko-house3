/**
 * 개발 모드에서 Game.exposeForTests() 가 노출하는 전역 훅. (§21-2)
 * Playwright 가 화면 픽셀이 아니라 내부 상태를 직접 검증할 수 있게 한다.
 */

import type { CONFIG } from '../src/core/GameConfig.ts';
import type { DebugInfo } from '../src/core/Game.ts';
import type { GameState } from '../src/core/GameState.ts';
import type { InteractionKind } from '../src/systems/InteractionSystem.ts';

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
        summonMate(): void;
        forceWin(): void;
        forceGameOver(): void;
        restart(seed?: number): void;
        interaction(): InteractionKind | null;
        startRun(): void;
        particleCount(): number;
        sceneStats(): { objects: number; geometries: number; materials: number };
        tutorialStep(): string | null;
        soundUnlocked(): boolean;
        config: typeof CONFIG;
      };
    };
  }
}

export {};
