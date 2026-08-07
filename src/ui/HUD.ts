/**
 * HUD. Three.js 월드가 아니라 **HTML/CSS 오버레이**로 그린다. (§17)
 *
 * 상태를 읽어 DOM 에 반영만 한다. 게임 로직을 여기에 넣지 않는다.
 * 중요한 변화는 색상만으로 표현하지 않고 아이콘·애니메이션·텍스트를 함께 쓴다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { hasSignal } from '../systems/PoopSystem.ts';

export class HUD {
  private readonly root: HTMLDivElement;
  private readonly hearts: HTMLSpanElement;
  private readonly hungerFill: HTMLDivElement;
  private readonly poopFill: HTMLDivElement;
  private readonly signal: HTMLSpanElement;
  private readonly ratioText: HTMLSpanElement;
  private readonly ratioFill: HTMLDivElement;
  private readonly ageText: HTMLSpanElement;
  private readonly hint: HTMLDivElement;
  private readonly toast: HTMLDivElement;

  /** 같은 값을 매 프레임 DOM 에 쓰지 않도록 직전 값을 기억한다. */
  private last = { hearts: -1, hunger: -1, poop: -1, ratio: -1, age: -1, level: -1 };
  private toastLeft = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-panel">
        <div class="hud-row hud-hearts"><span data-hearts>♥♥♥</span></div>
        <div class="hud-row">
          <span class="hud-label">🍖</span>
          <div class="hud-bar"><div class="hud-bar-fill hunger" data-hunger></div></div>
        </div>
        <div class="hud-row">
          <span class="hud-label">💩</span>
          <div class="hud-bar"><div class="hud-bar-fill poop" data-poop></div></div>
          <span class="hud-signal" data-signal>!</span>
        </div>
        <div class="hud-row hud-age"><span data-age>Age 0 · Lvl 1</span></div>
      </div>

      <div class="hud-goal">
        <div class="hud-goal-text">똥 땅 <b data-ratio>0%</b> / ${(CONFIG.TARGET_RATIO * 100).toFixed(0)}%</div>
        <div class="hud-goal-bar">
          <div class="hud-goal-fill" data-ratio-fill></div>
          <div class="hud-goal-target"></div>
        </div>
      </div>

      <div class="hud-toast" data-toast></div>
      <div class="hud-hint" data-hint></div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T =>
      this.root.querySelector<T>(sel) as T;

    this.hearts = q('[data-hearts]');
    this.hungerFill = q('[data-hunger]');
    this.poopFill = q('[data-poop]');
    this.signal = q('[data-signal]');
    this.ratioText = q('[data-ratio]');
    this.ratioFill = q('[data-ratio-fill]');
    this.ageText = q('[data-age]');
    this.hint = q('[data-hint]');
    this.toast = q('[data-toast]');

    // 목표선 위치 — 달성률 바에서 44% 지점
    const targetLine = q<HTMLDivElement>('.hud-goal-target');
    targetLine.style.left = `${CONFIG.TARGET_RATIO * 100}%`;
  }

  /** 짧은 안내 메시지 (배변 차단 사유 등) */
  showToast(message: string, seconds = 1.6): void {
    this.toast.textContent = message;
    this.toast.classList.add('visible');
    this.toastLeft = seconds;
  }

  /** 상호작용 안내. 빈 문자열이면 숨긴다. (§7) */
  setHint(text: string): void {
    if (this.hint.textContent === text) return;
    this.hint.textContent = text;
    this.hint.classList.toggle('visible', text.length > 0);
  }

  update(state: GameState, dt: number): void {
    const p = state.player;

    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toast.classList.remove('visible');
    }

    if (p.hearts !== this.last.hearts) {
      this.last.hearts = p.hearts;
      this.hearts.textContent =
        '♥'.repeat(Math.max(0, p.hearts)) + '♡'.repeat(Math.max(0, CONFIG.MAX_HEARTS - p.hearts));
      this.hearts.classList.toggle('danger', p.hearts <= 1);
    }

    const hunger = Math.round(p.hunger);
    if (hunger !== this.last.hunger) {
      this.last.hunger = hunger;
      this.hungerFill.style.width = `${(hunger / CONFIG.HUNGER_MAX) * 100}%`;
      // 색상만으로 알리지 않는다 — 굶주림은 게이지에 클래스를 붙여 깜빡이게 한다.
      this.hungerFill.classList.toggle('critical', hunger <= 0);
      this.hungerFill.classList.toggle('low', hunger > 0 && hunger < 30);
    }

    const poop = Math.round(p.poop);
    if (poop !== this.last.poop) {
      this.last.poop = poop;
      this.poopFill.style.width = `${(poop / CONFIG.POOP_MAX) * 100}%`;
    }

    // 똥 신호 — 아이콘 + 흔들림 애니메이션 (§9-3)
    this.signal.classList.toggle('visible', hasSignal(state));

    const ratio = state.territoryRatio;
    const pct = Math.round(ratio * 1000) / 10;
    if (pct !== this.last.ratio) {
      this.last.ratio = pct;
      this.ratioText.textContent = `${pct.toFixed(1)}%`;
      this.ratioFill.style.width = `${Math.min(100, ratio * 100)}%`;
      this.ratioFill.classList.toggle('reached', ratio >= CONFIG.TARGET_RATIO);
    }

    if (p.age !== this.last.age || p.levelIndex !== this.last.level) {
      this.last.age = p.age;
      this.last.level = p.levelIndex;
      const toNext = CONFIG.FOOD_PER_AGE - (p.foodsEaten % CONFIG.FOOD_PER_AGE);
      this.ageText.textContent = `Age ${p.age} · Lvl ${p.levelIndex + 1} · 다음까지 🍖${toNext}`;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
