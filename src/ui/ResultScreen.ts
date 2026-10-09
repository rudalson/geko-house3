/**
 * 클리어 / 게임 오버 결과 화면. (§11)
 * HTML 오버레이. 상태를 읽어 표시만 한다.
 */

import type { GameState } from '../core/GameState.ts';
import { Phase } from '../core/types.ts';
import { STAGES } from '../world/stages.ts';

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
  /** 다음 미션으로. 다음 미션이 있는 클리어에서만 보인다 */
  private readonly next: HTMLButtonElement;

  constructor(parent: HTMLElement, onReplay: () => void, onNext: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'result-screen';
    this.root.innerHTML = `
      <div class="result-card">
        <h1 data-title></h1>
        <p class="result-sub" data-sub></p>
        <dl class="result-stats" data-stats></dl>
        <div class="result-actions">
          <button class="result-replay result-next" data-next hidden></button>
          <button class="result-replay" data-replay>다시 플레이 <kbd>R</kbd></button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel) as T;
    this.title = q('[data-title]');
    this.subtitle = q('[data-sub]');
    this.stats = q('[data-stats]');
    this.replay = q('[data-replay]');
    this.next = q('[data-next]');

    this.replay.addEventListener('click', onReplay);
    this.next.addEventListener('click', onNext);
  }

  show(state: GameState): void {
    const cleared = state.phase === Phase.STAGE_CLEAR;
    const p = state.player;

    this.root.classList.toggle('cleared', cleared);
    this.root.classList.add('visible');

    const { stage } = state;
    const next = cleared && stage.next ? STAGES[stage.next] : null;
    const pct = (state.targetRatio * 100).toFixed(0);

    this.title.textContent = !cleared
      ? '😵 게임 오버'
      : next
        ? `🎉 미션 ${stage.mission} 클리어! — 똥 땅 ${pct}%`
        : `🏆 모든 미션 클리어! — 똥 땅 ${pct}%`;
    this.subtitle.textContent = cleared
      ? stage.text.clearSub
      : `미션 ${stage.mission} · 달성률 ${(state.territoryRatio * 100).toFixed(1)}% 에서 쓰러졌다.`;

    // 다음 미션이 있으면 그쪽을 주 버튼으로 세우고, 다시 하기는 한 단계 낮춘다.
    this.next.hidden = next === null;
    this.replay.classList.toggle('secondary', next !== null);
    if (next) {
      this.next.innerHTML = `미션 ${next.mission} — ${next.text.place}로 ▶ <kbd>Enter</kbd>`;
    }

    const rows: [string, string][] = [
      ['생존 시간', formatTime(state.elapsed)],
      ['똥 땅 달성률', `${(state.territoryRatio * 100).toFixed(1)}% / ${pct}%`],
      ['먹은 슈퍼푸드', `${p.foodsEaten}개`],
      ['배변 횟수', `${state.stats.poops}회`],
      // 지금까지 세기만 하고 어디에도 보여 주지 않던 값이다. 짝을 쓴 판과
      // 안 쓴 판의 기록이 달라야 그게 선택지였다는 게 남는다. (§24)
      ['산란 · 새끼', `${p.eggsLaid}마리`],
      [`${stage.text.eraser}에게 지워진 셀`, `${Math.round(state.stats.erasedCells)}칸`],
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
