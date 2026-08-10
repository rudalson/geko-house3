/**
 * 로딩 화면. (§16)
 *
 * 이 게임은 내려받을 에셋이 없다 — 메시도 소리도 전부 코드로 만든다.
 * 그래서 진행 바가 **가짜가 되지 않도록** 실제로 시간이 걸리는 일만 단계로 잡는다:
 * 셰이더 컴파일, 밸런스 검산, 첫 프레임 렌더.
 * 진행률을 타이머로 흉내 내지 않는다 — 저사양에서 실제보다 빨리 차면 거짓말이 된다.
 */

const TIPS = [
  '이미 확보한 땅 위에 겹쳐 싸면 손해다. 미개척지를 노려라.',
  '배변 1초 동안은 움직일 수 없고 무적도 아니다.',
  '레벨이 오르면 배변 반경이 커지지만 히트박스도 커진다.',
  '담요 밑에 오래 있으면 강아지가 온다.',
  '가구 위에서는 안전하지만 똥을 쌀 수 없다.',
  '화장실 변기는 한 방에 크게 벌지만 왕복 20초 동안 거실은 계속 청소된다.',
];

export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly percent: HTMLSpanElement;

  constructor(parent: HTMLElement, tipIndex: number) {
    this.root = document.createElement('div');
    this.root.className = 'loading-screen visible';
    this.root.innerHTML = `
      <div class="loading-card">
        <div class="loading-logo">🦎</div>
        <h1>게코 하우스 서바이벌</h1>
        <div class="loading-bar"><div class="loading-bar-fill" data-bar></div></div>
        <div class="loading-label"><span data-label>준비 중</span> <span data-pct>0%</span></div>
        <p class="loading-tip">💡 ${TIPS[tipIndex % TIPS.length]}</p>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel) as T;
    this.bar = q('[data-bar]');
    this.label = q('[data-label]');
    this.percent = q('[data-pct]');
  }

  /** @param progress [0, 1] */
  setProgress(progress: number, label: string): void {
    const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    this.bar.style.width = `${pct}%`;
    this.percent.textContent = `${pct}%`;
    this.label.textContent = label;
  }

  hide(): void {
    this.root.classList.remove('visible');
  }

  dispose(): void {
    this.root.remove();
  }
}
