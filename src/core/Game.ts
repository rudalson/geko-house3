/**
 * 렌더러·씬·시스템 조립과 메인 루프.
 *
 * core/ 에서 유일하게 Three.js 를 import 하는 파일이다. (§0-4 예외)
 * 게임 로직은 전부 systems/ 에 있고, 여기서는 "상태를 갱신하고 → 그린다"만 한다.
 */

import * as THREE from 'three';
import { CONFIG } from './GameConfig.ts';
import { GameLoop } from './GameLoop.ts';
import { GameState } from './GameState.ts';
import { EventBus } from './EventBus.ts';
import { InputManager } from './InputManager.ts';
import { Phase } from './types.ts';
import { HouseScene } from '../scenes/HouseScene.ts';
import { QuarterViewCamera } from '../scenes/QuarterViewCamera.ts';
import { updateMovement } from '../systems/MovementSystem.ts';
import { startPoop, updatePoop } from '../systems/PoopSystem.ts';
import { updateHunger } from '../systems/HungerSystem.ts';
import { applyDamage, isDead, updateInvulnerability } from '../systems/DamageSystem.ts';
import { initFoods, updateSpawns } from '../systems/SpawnSystem.ts';
import { executeInteraction, findInteraction, updateEating } from '../systems/InteractionSystem.ts';
import { currentErosionRate, initVacuums, updateVacuums } from '../systems/VacuumSystem.ts';
import { expandFromTerritory } from '../systems/TerritorySystem.ts';
import { HUD } from '../ui/HUD.ts';
import { ResultScreen } from '../ui/ResultScreen.ts';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  /** HUD 오버레이가 붙을 DOM 요소 (§17) */
  uiRoot: HTMLElement;
  seed?: number;
}

/**
 * 이 시간(초)을 넘는 프레임은 "멈췄다 돌아온 것"으로 보고 따라잡지 않는다.
 *
 * 탭 복귀·셰이더 컴파일·창 이동처럼 **한 번 크게 튄** 경우만 걸러내려는 것이다.
 * 임계를 캐치업 한도(5스텝 ≈ 83ms)에 가깝게 낮추면 안 된다.
 * 저사양에서 프레임이 지속적으로 100ms씩 걸릴 때 한 스텝씩만 진행하게 되어
 * 게임이 6배 느린 슬로모션으로 돌아간다.
 *
 * 83ms~0.5초 구간은 GameLoop 이 §0-5 대로 최대 5스텝까지 따라잡고 나머지를 버린다.
 * 그게 저사양에서의 정상 동작이다.
 */
const STALL_THRESHOLD = 0.5;

/**
 * §19 디버그 계측값. Playwright 가 그대로 읽으므로 Record<string, number> 대신
 * 이름을 붙여 둔다 — 오타가 조용히 undefined 로 넘어가지 않게.
 */
export interface DebugInfo {
  fixedSteps: number;
  droppedTime: number;
  geometries: number;
  textures: number;
  drawCalls: number;
  triangles: number;
  elapsed: number;
  blockedRatio: number;
  /** 실측 초당 영역 증가율 (셀/초) */
  gainRate: number;
  /** 실측 초당 영역 감소율 (셀/초) */
  erosionRate: number;
  netRate: number;
  measuredCycle: number;
  ownedCells: number;
  territoryRatio: number;
}

export class Game {
  readonly bus = new EventBus();
  state: GameState;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: QuarterViewCamera;
  private readonly input: InputManager;
  private readonly loop: GameLoop;
  private scene: HouseScene;
  private readonly hud: HUD;
  private readonly result: ResultScreen;
  private readonly pauseOverlay: HTMLDivElement;

  private rafHandle = 0;
  private lastFrameMs = 0;
  private running = false;
  private disposed = false;

  /** 이번 프레임에 플레이어가 움직인 거리 — 걷기 애니메이션용 */
  private movedThisFrame = 0;
  /** 디버그 배속 (§19) */
  timeScale = 1;

  constructor(private readonly options: GameOptions) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.state = new GameState(options.seed ?? (Date.now() >>> 0));
    this.scene = new HouseScene(this.state);
    this.camera = new QuarterViewCamera(this.aspect);
    this.input = new InputManager();
    this.hud = new HUD(options.uiRoot);
    this.result = new ResultScreen(options.uiRoot, () => this.restart());

    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.className = 'pause-overlay';
    this.pauseOverlay.textContent = '⏸ 일시정지  —  Esc 로 계속';
    options.uiRoot.appendChild(this.pauseOverlay);

    // 배변이 막힌 이유를 화면에 알린다. 게이지는 소모되지 않는다. (§10)
    this.bus.on('poop:blocked', ({ reason }) => this.hud.showToast(reason));

    this.loop = new GameLoop(
      (dt) => this.fixedUpdate(dt),
      () => this.timeScale,
    );

    this.resize();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    // 가구 배치에서 파생된 BLOCKED 비율을 확인한다. 허용 범위를 벗어나면
    // ROADMAP §3 의 밸런스 계산이 무너지므로 즉시 보이게 로그로 남긴다. (R1)
    console.info(this.state.collision.describe());
  }

  private get aspect(): number {
    const el = this.options.canvas;
    return el.clientWidth / Math.max(1, el.clientHeight);
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    initFoods(this.state, this.bus);
    initVacuums(this.state);
    this.state.setPhase(Phase.PLAYING);
    this.camera.snapTo(this.state.player.pos);
    this.lastFrameMs = performance.now();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private readonly tick = (nowMs: number): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.tick);

    const rawDt = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;

    this.movedThisFrame = 0;

    // 연출(카메라 damping·걷기 모션)에 쓸 델타. 튄 프레임에서 카메라가
    // 순간이동하지 않도록 로직과 같은 값으로 맞춘다.
    let renderDt = rawDt;

    if (rawDt > STALL_THRESHOLD) {
      // 없던 일로 하고 한 스텝만 진행한다. 따라잡으려 하면 캐릭터가 순간이동한다.
      renderDt = CONFIG.FIXED_DT;
      this.loop.reset();
      this.loop.advance(CONFIG.FIXED_DT);
    } else {
      this.loop.advance(rawDt);
    }

    // 렌더는 가변 프레임. 로직은 이미 고정 스텝으로 돌았다. (§0-5)
    this.scene.update(this.state, this.movedThisFrame, renderDt);
    this.camera.follow(this.state.player.pos, renderDt);
    this.hud.setHint(findInteraction(this.state)?.label ?? '');
    this.hud.update(this.state, renderDt);
    this.renderer.render(this.scene.scene, this.camera.camera);

    // 고정 스텝이 한 번도 돌지 않은 프레임에서는 입력을 버리지 않는다.
    // 144Hz 처럼 프레임이 로직 스텝(1/60)보다 짧으면 accumulator 가 차지 않아
    // 스텝이 0번 도는 프레임이 생기는데, 거기서 지워버리면 그 사이 눌린
    // Space·E 가 **아무 일도 없이 사라진다.**
    if (this.loop.lastStepCount > 0) this.input.endStep();
  };

  /** 항상 dt = 1/60 로 호출된다. */
  private fixedUpdate(dt: number): void {
    const s = this.state;

    // ── 진행 상태와 무관한 입력 ──
    // 이 처리를 phase 가드 뒤에 두면 게임 오버 후 R 이 영원히 안 먹는다.
    if (s.phase === Phase.STAGE_CLEAR || s.phase === Phase.GAME_OVER) {
      if (this.input.consume('restart')) this.restart();
      return;
    }
    if (this.input.consume('pause')) {
      if (s.phase === Phase.PLAYING) this.pause();
      else if (s.phase === Phase.PAUSED) this.resume();
    }

    if (s.phase !== Phase.PLAYING) return;

    s.elapsed += dt;

    const move = this.input.readMove();
    this.movedThisFrame += updateMovement(s, move, dt);

    if (this.input.consume('interact')) executeInteraction(s, this.bus);
    updateEating(s, dt, this.bus);

    if (this.input.consume('poop')) startPoop(s, this.bus);
    updatePoop(s, dt, this.bus);

    updateSpawns(s, dt, this.bus);
    updateVacuums(s, dt, this.bus);
    updateHunger(s, dt, this.bus);
    updateInvulnerability(s, dt);

    this.trackBalanceMetrics(s, dt);
    this.checkEndConditions(s);
  }

  /**
   * 승패 판정. (§11, §8)
   * 달성률이 44% 를 넘는 **즉시** 클리어로 전환한다.
   */
  private checkEndConditions(s: GameState): void {
    if (s.targetReached) {
      s.setPhase(Phase.STAGE_CLEAR);
      this.bus.emit('stage:clear', { timeSec: s.elapsed });
      this.onGameEnded();
      return;
    }
    if (isDead(s)) {
      // stage:gameOver 이벤트는 DamageSystem 이 이미 발행했다.
      s.setPhase(Phase.GAME_OVER);
      this.onGameEnded();
    }
  }

  private onGameEnded(): void {
    this.result.show(this.state);
    this.hud.setHint('');
  }

  /**
   * §19 실시간 밸런스 계측.
   * §0-1 의 계산이 실제 플레이와 맞는지 플레이 중에 확인할 수 있어야 한다. (R2)
   */
  private readonly metrics = {
    /** 실측 초당 영역 증가율 (셀/초) */
    gainRate: 0,
    /** 실측 초당 영역 감소율 (셀/초) */
    erosionRate: 0,
    /** 마지막 배변으로부터 경과 시간 */
    sinceLastPoop: 0,
    /** 실측 배변 사이클 (초) */
    measuredCycle: 0,
  };
  private lastOwned = 0;
  private metricWindow = 0;

  private trackBalanceMetrics(s: GameState, dt: number): void {
    this.metrics.sinceLastPoop += dt;
    if (s.stats.poops > 0) this.metrics.measuredCycle = s.elapsed / s.stats.poops;

    this.metricWindow += dt;
    if (this.metricWindow < 1) return;

    // 1초 창으로 순증가율을 재고, 감소율은 청소기 상태에서 직접 계산한다.
    const delta = s.ownedCells - this.lastOwned;
    this.metrics.erosionRate = currentErosionRate(s);
    this.metrics.gainRate = delta / this.metricWindow + this.metrics.erosionRate;

    this.lastOwned = s.ownedCells;
    this.metricWindow = 0;
  }

  pause(): void {
    if (this.state.phase !== Phase.PLAYING) return;
    this.state.setPhase(Phase.PAUSED);
    this.pauseOverlay.classList.add('visible');
  }

  resume(): void {
    if (this.state.phase !== Phase.PAUSED) return;
    this.state.setPhase(Phase.PLAYING);
    this.pauseOverlay.classList.remove('visible');
    this.loop.reset();
  }

  private readonly onResize = (): void => this.resize();

  private resize(): void {
    const el = this.options.canvas;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.resize(w / h);
  }

  /**
   * 탭이 가려지면 자동 일시정지하고, 복귀 시 accumulator 를 비운다.
   * 그러지 않으면 복귀하는 순간 누적된 시간을 한꺼번에 소비한다. (§20)
   */
  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.pause();
    } else {
      this.loop.reset();
      this.lastFrameMs = performance.now();
      this.resume();
    }
  };

  /** 디버그용 계측 (§19) */
  get debugInfo(): DebugInfo {
    return {
      fixedSteps: this.loop.lastStepCount,
      droppedTime: this.loop.droppedTime,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      elapsed: this.state.elapsed,
      blockedRatio: this.state.collision.blockedRatio,
      gainRate: this.metrics.gainRate,
      erosionRate: this.metrics.erosionRate,
      netRate: this.metrics.gainRate - this.metrics.erosionRate,
      measuredCycle: this.metrics.measuredCycle,
      ownedCells: this.state.ownedCells,
      territoryRatio: this.state.territoryRatio,
    };
  }

  /** §8 재시작 요구사항 — 오브젝트·리스너·타이머를 전부 정리한다. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;

    cancelAnimationFrame(this.rafHandle);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    this.input.dispose();
    this.hud.dispose();
    this.result.dispose();
    this.pauseOverlay.remove();
    this.bus.clear();
    this.scene.dispose();
    this.renderer.dispose();
  }

  /**
   * 상태를 **새 객체로** 만들어 다시 시작한다. 이전 상태를 재사용하지 않는다. (§8)
   *
   * 씬은 먼저 dispose 한 뒤 다시 만든다. 순서를 바꾸면 이전 씬의
   * geometry/material 이 GPU 에 남아 재시작할 때마다 누적된다.
   * tests + E2E 가 3회 재시작 후 renderer.info.memory 를 비교해 감시한다.
   */
  restart(seed?: number): void {
    this.scene.dispose();

    this.state = new GameState(seed ?? (Date.now() >>> 0));
    this.scene = new HouseScene(this.state);

    // 누적 상태를 전부 초기화한다 — 하나라도 빠지면 판이 거듭될수록 값이 어긋난다.
    this.loop.reset();
    this.metrics.gainRate = 0;
    this.metrics.erosionRate = 0;
    this.metrics.sinceLastPoop = 0;
    this.metrics.measuredCycle = 0;
    this.lastOwned = 0;
    this.metricWindow = 0;
    this.movedThisFrame = 0;

    this.result.hide();
    this.hud.setHint('');

    this.camera.snapTo(this.state.player.pos);
    this.state.setPhase(Phase.PLAYING);
    initFoods(this.state, this.bus);
    initVacuums(this.state);
  }

  /** 개발 모드에서 Playwright 가 내부 상태를 검증할 수 있게 노출한다. (§21-2) */
  exposeForTests(): void {
    if (!import.meta.env.DEV) return;
    const game = this;
    (window as unknown as { __GAME__: unknown }).__GAME__ = {
      // restart() 가 state 를 새 객체로 바꾸므로 getter 로 노출해야
      // 테스트가 낡은 참조를 붙들지 않는다.
      get state() {
        return game.state;
      },
      game: this,
      debug: {
        info: () => this.debugInfo,
        setTimeScale: (v: number) => {
          this.timeScale = v;
        },
        teleport: (x: number, z: number) => {
          this.state.player.pos.x = x;
          this.state.player.pos.z = z;
        },
        // §19 디버그 치트. 개발 모드에서만 노출된다.
        fillPoop: () => {
          this.state.player.poop = CONFIG.POOP_MAX;
        },
        fillHunger: () => {
          this.state.player.hunger = CONFIG.HUNGER_MAX;
        },
        setHunger: (v: number) => {
          this.state.player.hunger = v;
        },
        healHearts: () => {
          this.state.player.hearts = CONFIG.MAX_HEARTS;
        },
        /**
         * 격자를 직접 채워 승리 조건을 만든다 (§19 승리 강제).
         * 딱 맞게 채우면 판정이 돌기 전에 청소기가 한 칸만 지워도 조건이 깨지므로
         * 여유분을 더한다.
         */
        forceWin: () => {
          const s = this.state;
          const need = Math.ceil(s.effectiveCells * CONFIG.TARGET_RATIO) + 10 - s.ownedCells;
          if (need > 0) expandFromTerritory(s, need);
        },
        forceGameOver: () => {
          const s = this.state;
          s.player.invulnTimer = 0;
          s.player.hearts = 1;
          applyDamage(s, 'starvation', null, this.bus);
        },
        restart: () => this.restart(),
        config: CONFIG,
      },
    };
  }
}
