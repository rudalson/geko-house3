/**
 * 우측 상단 미니맵 HUD. (§17, §25)
 *
 * 1인칭으로 바꾸면서 **없으면 게임이 성립하지 않는** 요소가 됐다.
 * 눈높이 0.34 에서는 소파 하나만 앞에 있어도 방의 절반이 보이지 않는다.
 * 청소기가 어디 있는지, 아직 안 싼 바닥이 어느 쪽인지, 화장실 문이 뒤인지
 * 옆인지 — 쿼터뷰가 공짜로 주던 정보 전부가 여기로 옮겨왔다.
 *
 * Three.js 월드가 아니라 2D 캔버스로 그린다. HUD 는 DOM 오버레이라는 §17 의
 * 규칙을 따르고, 무엇보다 격자 768칸을 사각형으로 칠하는 일은 2D 캔버스가
 * InstancedMesh 보다 훨씬 싸다.
 *
 * 상태를 읽어 반영만 한다. 단방향. (§0-4)
 */

import { CONFIG, DERIVED, cellCenterX, cellCenterZ } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import { Cell, Stance } from '../core/types.ts';
import { GECKO_PALETTE } from '../entities/geckoSkin.ts';
import { LIVING_ROOM_FURNITURE } from '../world/furnitureLayout.ts';
import { BATHROOM_BOUNDS, TOILET_POS } from '../world/bathroomLayout.ts';

/**
 * 지도가 덮는 월드 범위. 거실과 화장실을 **둘 다** 담는다.
 *
 * 거실만 그리면 화장실 왕복(§14)이 지도에서 사라진다 — 변기까지 얼마나 남았는지
 * 모른 채로 20초를 걸어야 하고, 그건 선택지가 아니라 도박이 된다.
 */
const VIEW = {
  minX: -DERIVED.ROOM_W / 2 - 0.4,
  maxX: DERIVED.ROOM_W / 2 + 0.4,
  minZ: BATHROOM_BOUNDS.minZ - 0.4,
  maxZ: DERIVED.ROOM_H / 2 + 0.4,
};
const VIEW_W = VIEW.maxX - VIEW.minX;
const VIEW_H = VIEW.maxZ - VIEW.minZ;

/** 캔버스 CSS 크기 (px). 세로가 긴 이유는 화장실이 거실 북쪽에 붙어 있어서다. */
const CSS_W = 148;
const CSS_H = Math.round((CSS_W * VIEW_H) / VIEW_W);

/** 0x7cc86a → '#7cc86a'. Three.js 쪽 팔레트는 숫자라 CSS 로 옮겨 줘야 한다. */
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

const COLOR = {
  /** 방 바깥 여백. `.minimap` 패널 배경과 같은 톤이어야 테두리가 어색하지 않다 */
  panel: '#241c15',
  livingFloor: '#3a2e22',
  bathFloor: '#2c3a3e',
  furniture: '#6b573f',
  furnitureSoft: '#4a4032',
  territory: '#c08b4e',
  wall: 'rgba(244, 231, 200, 0.55)',
  player: hex(GECKO_PALETTE.body),
  vacuum: '#e0554a',
  human: '#f2a03d',
  food: '#a8e06a',
  treat: '#ffd166',
  mate: '#f08fb4',
  hatchling: '#bff09a',
  toilet: '#8fd0e8',
} as const;

/**
 * 똥 땅 레이어를 다시 칠하는 간격 (초).
 * 격자는 초당 몇 칸 단위로만 바뀐다. 매번 768칸을 훑을 이유가 없다.
 */
const TERRITORY_INTERVAL = 0.15;

/**
 * 지도 전체를 다시 그리는 간격 (초) — 20Hz.
 *
 * 매 프레임 그리면 안 된다. 게임 루프와 **같은 스레드**를 쓰기 때문이다.
 * 렌더가 빡빡한 환경(헤드리스 소프트웨어 GL 등)에서는 프레임이 늘어지고,
 * GameLoop 이 캐치업 한도(5스텝)를 넘긴 시간을 버리기 시작하면 게임 시간이
 * 벽시계보다 느려진다 — 지도가 게임 진행을 갉아먹는 셈이다.
 *
 * 20Hz 면 지도에서는 차이를 알 수 없다. 지도는 "어디에 무엇이 있나" 를 읽는
 * 물건이지 조준하는 물건이 아니다. 실제 조작 반응은 3D 화면이 담당한다.
 */
const REDRAW_INTERVAL = 1 / 20;

/** 오프스크린 캔버스 하나. 브라우저가 아니면 null 을 돌려준다. */
function makeLayer(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export class Minimap {
  readonly root: HTMLDivElement;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  /** 방·가구처럼 절대 변하지 않는 것. 한 번만 그린다 */
  private readonly bg: HTMLCanvasElement | null;
  /**
   * 방 + 똥 땅을 합쳐 둔 바탕. TERRITORY_INTERVAL 마다 다시 만든다.
   *
   * 레이어를 따로 두고 매번 두 장을 겹쳐 그리면 갱신마다 캔버스 전체를 두 번
   * 블릿한다. 똥 땅은 어차피 0.15초에 한 번만 바뀌므로, 그때 **미리 합쳐** 두면
   * 갱신 때는 한 장만 그리면 된다.
   */
  private readonly base: HTMLCanvasElement | null;
  private terrLeft = 0;
  /** 지도 전체 갱신까지 남은 시간 */
  private redrawLeft = 0;

  /**
   * 디바이스 픽셀 배율. 이걸 안 걸면 고DPI 화면에서 지도가 뭉갠 것처럼 보인다.
   *
   * 상한이 2 가 아니라 1.5 인 이유: 캔버스 비용은 **배율의 제곱**으로 늘고,
   * 이 지도는 게임 루프와 같은 스레드를 쓴다. 2 로 두면 픽셀 수가 1.8배가 되는데,
   * 지도에서 그만큼의 선명함은 눈에 띄지 않는다.
   */
  private readonly dpr: number;
  private readonly w: number;
  private readonly h: number;

  constructor(parent: HTMLElement) {
    this.dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio, 1.5);
    this.w = Math.round(CSS_W * this.dpr);
    this.h = Math.round(CSS_H * this.dpr);

    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.root.innerHTML = '<div class="minimap-label">집</div>';

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = `${CSS_W}px`;
    this.canvas.style.height = `${CSS_H}px`;
    this.root.appendChild(this.canvas);
    parent.appendChild(this.root);

    this.ctx = this.canvas.getContext('2d');
    this.bg = makeLayer(this.w, this.h);
    this.base = makeLayer(this.w, this.h);

    this.drawBackground();
  }

  /** 월드 x → 캔버스 x (디바이스 픽셀) */
  private px(x: number): number {
    return ((x - VIEW.minX) / VIEW_W) * this.w;
  }

  /** 월드 z → 캔버스 y. 지도는 항상 북(-z)이 위다 */
  private py(z: number): number {
    return ((z - VIEW.minZ) / VIEW_H) * this.h;
  }

  /** 월드 길이 → 캔버스 길이 */
  private ps(len: number): number {
    return (len / VIEW_W) * this.w;
  }

  /** 방 윤곽과 가구. 값이 절대 변하지 않으므로 생성자에서 한 번만 그린다. */
  private drawBackground(): void {
    const g = this.bg?.getContext('2d');
    if (!g) return;

    // 캔버스 전체를 불투명하게 깐다. 이래야 매 갱신마다 clearRect 를 부르지 않아도
    // 된다 — 아래 레이어가 화면 전체를 덮으므로 지우는 단계 자체가 필요 없어진다.
    g.fillStyle = COLOR.panel;
    g.fillRect(0, 0, this.w, this.h);

    const room = {
      x: this.px(-DERIVED.ROOM_W / 2),
      y: this.py(-DERIVED.ROOM_H / 2),
      w: this.ps(DERIVED.ROOM_W),
      h: this.ps(DERIVED.ROOM_H),
    };
    const bath = {
      x: this.px(BATHROOM_BOUNDS.minX),
      y: this.py(BATHROOM_BOUNDS.minZ),
      w: this.ps(BATHROOM_BOUNDS.maxX - BATHROOM_BOUNDS.minX),
      h: this.ps(BATHROOM_BOUNDS.maxZ - BATHROOM_BOUNDS.minZ),
    };

    g.fillStyle = COLOR.livingFloor;
    g.fillRect(room.x, room.y, room.w, room.h);
    g.fillStyle = COLOR.bathFloor;
    g.fillRect(bath.x, bath.y, bath.w, bath.h);

    g.strokeStyle = COLOR.wall;
    g.lineWidth = Math.max(1, this.dpr);
    g.strokeRect(room.x, room.y, room.w, room.h);
    g.strokeRect(bath.x, bath.y, bath.w, bath.h);

    // 가구. solid 는 진하게, 밟고 지나갈 수 있는 소품은 옅게 —
    // 지도에서 "돌아가야 하는 것"과 "그냥 지나가도 되는 것"이 갈려야 한다.
    for (const f of LIVING_ROOM_FURNITURE) {
      g.fillStyle = f.solid ? COLOR.furniture : COLOR.furnitureSoft;
      g.fillRect(this.px(f.x - f.w / 2), this.py(f.z - f.d / 2), this.ps(f.w), this.ps(f.d));
    }

    // 변기 — 화장실에서 유일하게 목적지가 되는 지점 (§14)
    this.dot(g, TOILET_POS.x, TOILET_POS.z, 2.2, COLOR.toilet);
  }

  /**
   * 바탕(방 + 똥 땅)을 다시 만든다. 전체를 훑되 TERRITORY_INTERVAL 마다만 부른다.
   */
  private drawBase(state: GameState): void {
    const g = this.base?.getContext('2d');
    if (!g || !this.bg) return;

    g.drawImage(this.bg, 0, 0);
    g.fillStyle = COLOR.territory;

    // 셀 하나의 캔버스 크기. 반올림 때문에 생기는 틈을 메우려고 조금 키운다.
    const cw = this.ps(CONFIG.CELL_SIZE) + 0.5;
    const ch = this.ps(CONFIG.CELL_SIZE) + 0.5;
    const half = CONFIG.CELL_SIZE / 2;

    for (let cz = 0; cz < CONFIG.GRID_H; cz++) {
      for (let cx = 0; cx < CONFIG.GRID_W; cx++) {
        if (state.grid[cz * CONFIG.GRID_W + cx] !== Cell.POOP_TERRITORY) continue;
        g.fillRect(this.px(cellCenterX(cx) - half), this.py(cellCenterZ(cz) - half), cw, ch);
      }
    }
  }

  private dot(
    g: CanvasRenderingContext2D,
    x: number,
    z: number,
    radiusPx: number,
    color: string,
  ): void {
    g.fillStyle = color;
    g.beginPath();
    g.arc(this.px(x), this.py(z), radiusPx * this.dpr, 0, Math.PI * 2);
    g.fill();
  }

  /** @param dt 렌더 델타 (가변) */
  update(state: GameState, dt: number): void {
    const g = this.ctx;
    if (!g) return;

    this.redrawLeft -= dt;
    if (this.redrawLeft > 0) return;
    this.redrawLeft = REDRAW_INTERVAL;

    this.terrLeft -= dt;
    if (this.terrLeft <= 0) {
      this.terrLeft = TERRITORY_INTERVAL;
      this.drawBase(state);
    }

    // 바탕이 캔버스 전체를 불투명하게 덮으므로 지우지 않는다.
    if (this.base) g.drawImage(this.base, 0, 0);

    // ── 움직이는 것들 ──
    // 그리는 순서가 곧 우선순위다. 겹쳤을 때 위에 남아야 하는 것이 나중에 온다.
    for (const f of state.foods) {
      if (f.active) this.dot(g, f.pos.x, f.pos.z, 2.2, COLOR.food);
    }
    for (const t of state.treats) {
      if (t.active) this.dot(g, t.pos.x, t.pos.z, 2.6, COLOR.treat);
    }
    if (state.mate.active) this.dot(g, state.mate.pos.x, state.mate.pos.z, 2.6, COLOR.mate);
    for (const hl of state.hatchlings) {
      this.dot(g, hl.pos.x, hl.pos.z, 2.0, COLOR.hatchling);
    }
    for (const v of state.vacuums) {
      this.dot(g, v.pos.x, v.pos.z, 3.2, COLOR.vacuum);
    }

    // 인간은 추적 중일 때 테두리를 둘러 눈에 띄게 만든다. 색만으로 알리지 않는다. (§17)
    for (const h of state.humans) {
      this.dot(g, h.pos.x, h.pos.z, 3.4, COLOR.human);
      if (h.mode !== 'chase') continue;
      g.strokeStyle = COLOR.human;
      g.lineWidth = Math.max(1, this.dpr);
      g.beginPath();
      g.arc(this.px(h.pos.x), this.py(h.pos.z), 6 * this.dpr, 0, Math.PI * 2);
      g.stroke();
    }

    this.drawPlayer(g, state);
  }

  /**
   * 내 위치와 시선. 지도에서 유일하게 **방향**을 가진 표시다.
   *
   * 점이 아니라 삼각형인 이유가 핵심이다. 1인칭에서는 "내가 어디 있나"보다
   * "내가 어디를 보고 있나"가 먼저 필요하다 — 지도에서 청소기를 찾아도
   * 지금 시선 기준으로 왼쪽인지 뒤인지 모르면 어느 키를 누를지 알 수 없다.
   */
  private drawPlayer(g: CanvasRenderingContext2D, state: GameState): void {
    const p = state.player;
    const r = 5 * this.dpr;

    g.save();
    g.translate(this.px(p.pos.x), this.py(p.pos.z));
    // 캔버스는 +y 가 아래이고 월드는 +z 가 아래다. facing = atan2(x, z) 는
    // +z(화면 아래)에서 시작해 +x(화면 오른쪽)로 도는 각이므로,
    // 화면 위(-y)를 0 으로 두는 캔버스 회전으로 바꾸려면 π 에서 빼야 한다.
    g.rotate(Math.PI - p.facing);

    g.fillStyle = COLOR.player;
    g.beginPath();
    g.moveTo(0, -r);
    g.lineTo(r * 0.72, r * 0.8);
    g.lineTo(0, r * 0.4);
    g.lineTo(-r * 0.72, r * 0.8);
    g.closePath();
    g.fill();

    // 담요 밑에 숨어 있으면 테두리를 덧그린다 — 위치는 알되 평소와 달라 보이게
    if (p.stance === Stance.HIDDEN) {
      g.strokeStyle = '#f4e7c8';
      g.lineWidth = Math.max(1, this.dpr);
      g.stroke();
    }
    g.restore();
  }

  /** 로딩·타이틀에서는 통째로 감춘다. (§16) */
  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  dispose(): void {
    this.root.remove();
  }
}
