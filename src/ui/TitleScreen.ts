/**
 * 타이틀 화면. (§16)
 *
 * 배경은 가리지 않는다 — 뒤에서 실제 거실이 그대로 렌더되고 도마뱀이 숨 쉬고 있다.
 * 정지 화면 대신 살아 있는 방을 보여 주는 쪽이 "무슨 게임인지" 를 빨리 알린다.
 *
 * §0-6 오디오 언락의 진입점이기도 하다. 시작 입력이 곧 사용자 제스처이므로,
 * 여기서 딱 한 번 `SoundManager.unlock()` 을 호출하면 된다.
 */

export interface TitleOptions {
  /** 시작 입력. 사용자 제스처 컨텍스트 안에서 동기 호출된다 (오디오 언락용) */
  onStart: () => void;
  onToggleTutorial: (enabled: boolean) => void;
  onToggleSound: (enabled: boolean) => void;
  tutorialEnabled: boolean;
  soundEnabled: boolean;
}

/** 시작 입력으로 치지 않는 키. 이 키들은 각자 다른 의미가 이미 있다. */
const IGNORED_KEYS = new Set(['Escape', 'Tab', 'F5', 'F12', 'Backquote']);

export class TitleScreen {
  private readonly root: HTMLDivElement;
  private readonly startButton: HTMLButtonElement;
  private readonly tutorialToggle: HTMLInputElement;
  private readonly soundToggle: HTMLInputElement;
  private listening = false;

  constructor(parent: HTMLElement, private readonly options: TitleOptions) {
    this.root = document.createElement('div');
    this.root.className = 'title-screen';
    this.root.innerHTML = `
      <div class="title-card">
        <div class="title-logo">🦎💩</div>
        <h1>게코 하우스 서바이벌</h1>
        <p class="title-sub">거실 바닥의 <b>44%</b>를 똥 땅으로 만들어라.<br />
          로봇청소기는 그걸 계속 지운다.</p>

        <button class="title-start" data-start>플레이 <kbd>아무 키</kbd></button>

        <div class="title-controls">
          <div><kbd>WASD</kbd><span>이동</span></div>
          <div><kbd>Shift</kbd><span>달리기</span></div>
          <div><kbd>E</kbd><span>먹기 · 숨기 · 오르기</span></div>
          <div><kbd>Space</kbd><span>똥 싸기</span></div>
          <div><kbd>Esc</kbd><span>일시정지</span></div>
          <div><kbd>M</kbd><span>음소거</span></div>
        </div>

        <div class="title-options">
          <label><input type="checkbox" data-tutorial /> 튜토리얼 안내</label>
          <label><input type="checkbox" data-sound /> 효과음</label>
        </div>

        <p class="title-pending">🏆 랭킹 · 🛒 상점 · ☕ 도마뱀 카페 — <b>열심히 싸는 중입니다</b></p>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel) as T;
    this.startButton = q('[data-start]');
    this.tutorialToggle = q('[data-tutorial]');
    this.soundToggle = q('[data-sound]');

    this.tutorialToggle.checked = options.tutorialEnabled;
    this.soundToggle.checked = options.soundEnabled;

    this.startButton.addEventListener('click', this.onStartClick);
    this.tutorialToggle.addEventListener('change', this.onTutorialChange);
    this.soundToggle.addEventListener('change', this.onSoundChange);
  }

  show(): void {
    this.root.classList.add('visible');
    if (!this.listening) {
      window.addEventListener('keydown', this.onKeyDown);
      this.listening = true;
    }
  }

  hide(): void {
    this.root.classList.remove('visible');
    this.stopListening();
  }

  private stopListening(): void {
    if (!this.listening) return;
    window.removeEventListener('keydown', this.onKeyDown);
    this.listening = false;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // 체크박스에 포커스가 있을 때의 Space/Enter 는 그 토글의 것이다.
    if (e.target instanceof HTMLInputElement) return;
    if (IGNORED_KEYS.has(e.code) || e.code.startsWith('F')) return;
    e.preventDefault();
    this.start();
  };

  private readonly onStartClick = (): void => this.start();

  private readonly onTutorialChange = (): void =>
    this.options.onToggleTutorial(this.tutorialToggle.checked);

  private readonly onSoundChange = (): void =>
    this.options.onToggleSound(this.soundToggle.checked);

  private start(): void {
    // 입력이 중복으로 들어와도 한 번만 시작한다.
    if (!this.listening) return;
    this.stopListening();
    this.options.onStart();
  }

  dispose(): void {
    this.stopListening();
    this.startButton.removeEventListener('click', this.onStartClick);
    this.tutorialToggle.removeEventListener('change', this.onTutorialChange);
    this.soundToggle.removeEventListener('change', this.onSoundChange);
    this.root.remove();
  }
}
