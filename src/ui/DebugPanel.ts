/**
 * 디버그 패널. (§19)
 *
 * **프로덕션 번들에 들어가지 않는다.** Game 이 `import.meta.env.DEV` 가드 안에서
 * `await import()` 로만 불러오므로, 프로덕션 빌드에서는 조건이 상수 false 가 되어
 * 이 모듈을 가리키는 참조 자체가 사라진다. (vite.config.ts 주석 참조)
 *
 * 여기서 보여 주는 건 FPS 가 아니라 **§0-1 의 밸런스 항들**이다.
 * R2("실제 배변 사이클이 예측과 다름")를 플레이 중에 발견하려면
 * `G`(증가율)·`S·p`(감소율)·순증가율·실측 사이클이 화면에 떠 있어야 한다.
 */

import './DebugPanel.css';
import type { DebugInfo } from '../core/Game.ts';

export interface DebugPanelHooks {
  info: () => DebugInfo;
  setTimeScale: (v: number) => void;
  getTimeScale: () => number;
  fillPoop: () => void;
  fillHunger: () => void;
  healHearts: () => void;
  forceWin: () => void;
  forceGameOver: () => void;
  restart: () => void;
}

/** 갱신 주기 (초). 매 프레임 DOM 을 다시 쓰면 측정 대상이 측정에 흔들린다. */
const REFRESH = 0.2;

const TIME_SCALES = [0.25, 1, 2, 4];

export class DebugPanel {
  private readonly root: HTMLDivElement;
  private readonly rows: HTMLDListElement;
  private visible = false;
  private sinceRefresh = 0;

  constructor(parent: HTMLElement, private readonly hooks: DebugPanelHooks) {
    this.root = document.createElement('div');
    this.root.className = 'debug-panel';
    this.root.innerHTML = `
      <div class="debug-head">디버그 <span class="muted">\` 로 닫기</span></div>
      <dl class="debug-rows" data-rows></dl>
      <div class="debug-actions">
        <div class="debug-group" data-speed></div>
        <div class="debug-group">
          <button data-act="fillPoop">💩 채우기</button>
          <button data-act="fillHunger">🍖 채우기</button>
          <button data-act="healHearts">♥ 회복</button>
        </div>
        <div class="debug-group">
          <button data-act="forceWin">승리</button>
          <button data-act="forceGameOver">패배</button>
          <button data-act="restart">재시작</button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);

    this.rows = this.root.querySelector<HTMLDListElement>('[data-rows]') as HTMLDListElement;

    const speed = this.root.querySelector<HTMLDivElement>('[data-speed]') as HTMLDivElement;
    for (const scale of TIME_SCALES) {
      const btn = document.createElement('button');
      btn.textContent = `×${scale}`;
      btn.dataset.speed = String(scale);
      speed.appendChild(btn);
    }

    this.root.addEventListener('click', this.onClick);
  }

  private readonly onClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement)) return;

    if (target.dataset.speed) {
      this.hooks.setTimeScale(Number(target.dataset.speed));
      this.markSpeed();
      return;
    }

    const act = target.dataset.act;
    if (act === 'fillPoop') this.hooks.fillPoop();
    else if (act === 'fillHunger') this.hooks.fillHunger();
    else if (act === 'healHearts') this.hooks.healHearts();
    else if (act === 'forceWin') this.hooks.forceWin();
    else if (act === 'forceGameOver') this.hooks.forceGameOver();
    else if (act === 'restart') this.hooks.restart();
  };

  private markSpeed(): void {
    const current = this.hooks.getTimeScale();
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-speed]')) {
      btn.classList.toggle('active', Number(btn.dataset.speed) === current);
    }
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.root.classList.toggle('visible', this.visible);
    if (this.visible) {
      this.markSpeed();
      this.refresh();
    }
    return this.visible;
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.sinceRefresh += dt;
    if (this.sinceRefresh < REFRESH) return;
    this.sinceRefresh = 0;
    this.refresh();
  }

  private refresh(): void {
    const d = this.hooks.info();

    // 순증가율의 부호가 이 게임의 전부다 — 음수면 그 순간 플레이어는 지고 있다.
    const net = d.netRate;
    const netClass = net >= 0 ? 'good' : 'bad';

    const rows: [string, string, string?][] = [
      ['달성률', `${(d.territoryRatio * 100).toFixed(1)}% (${d.ownedCells}칸)`],
      ['G 증가율', `${d.gainRate.toFixed(2)} 칸/s`],
      ['S·p 감소율', `${d.erosionRate.toFixed(2)} 칸/s`],
      ['순증가율', `${net >= 0 ? '+' : ''}${net.toFixed(2)} 칸/s`, netClass],
      ['실측 배변 사이클', `${d.measuredCycle.toFixed(2)} s`],
      ['경과', `${d.elapsed.toFixed(1)} s`],
      ['BLOCKED', `${(d.blockedRatio * 100).toFixed(1)}%`],
      ['고정 스텝/프레임', String(d.fixedSteps)],
      ['버려진 시간', `${d.droppedTime.toFixed(3)} s`],
      ['draw calls', String(d.drawCalls)],
      ['삼각형', d.triangles.toLocaleString('en-US')],
      ['geometry / texture', `${d.geometries} / ${d.textures}`],
    ];

    this.rows.innerHTML = rows
      .map(([k, v, cls]) => `<div><dt>${k}</dt><dd class="${cls ?? ''}">${v}</dd></div>`)
      .join('');
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.remove();
  }
}
