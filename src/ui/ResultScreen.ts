/**
 * 클리어 / 게임 오버 결과 화면. (§11)
 * HTML 오버레이. 상태를 읽어 표시만 한다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { Phase } from '../core/types.ts';

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class ResultScreen {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly subtitle: HTMLParagraphElement;
  private readonly stats: HTMLDListElement;
  private readonly replay: HTMLButtonElement;

  constructor(parent: HTMLElement, onReplay: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'result-screen';
    this.root.innerHTML = `
      <div class="result-card">
        <h1 data-title></h1>
        <p class="result-sub" data-sub></p>
        <dl class="result-stats" data-stats></dl>
        <button class="result-replay" data-replay>다시 플레이 <kbd>R</kbd></button>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel) as T;
    this.title = q('[data-title]');
    this.subtitle = q('[data-sub]');
    this.stats = q('[data-stats]');
    this.replay = q('[data-replay]');

    this.replay.addEventListener('click', onReplay);
  }

  show(state: GameState): void {
    const cleared = state.phase === Phase.STAGE_CLEAR;
    const p = state.player;

    this.root.classList.toggle('cleared', cleared);
    this.root.classList.add('visible');

    this.title.textContent = cleared ? '💩 똥 땅 44% 달성!' : '😵 게임 오버';
    this.subtitle.textContent = cleared
      ? '이 집은 이제 네 거야.'
      : `달성률 ${(state.territoryRatio * 100).toFixed(1)}% 에서 쓰러졌다.`;

    const rows: [string, string][] = [
      ['생존 시간', formatTime(state.elapsed)],
      ['똥 땅 달성률', `${(state.territoryRatio * 100).toFixed(1)}% / ${(CONFIG.TARGET_RATIO * 100).toFixed(0)}%`],
      ['먹은 슈퍼푸드', `${p.foodsEaten}개`],
      ['배변 횟수', `${state.stats.poops}회`],
      ['청소기에게 지워진 셀', `${Math.round(state.stats.erasedCells)}칸`],
      ['최종 성장', `Age ${p.age} · Lvl ${p.levelIndex + 1}`],
      ['받은 피해', `${state.stats.damageTaken}회`],
    ];

    this.stats.innerHTML = rows
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');
  }

  hide(): void {
    this.root.classList.remove('visible');
  }

  dispose(): void {
    this.root.remove();
  }
}
