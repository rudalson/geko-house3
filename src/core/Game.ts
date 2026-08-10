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
import { BATHROOM_BOUNDS } from '../world/bathroomLayout.ts';
import { DERIVED } from './GameConfig.ts';
import { updateMovement } from '../systems/MovementSystem.ts';
import { startPoop, updatePoop } from '../systems/PoopSystem.ts';
import { updateHunger } from '../systems/HungerSystem.ts';
import { applyDamage, isDead, updateInvulnerability } from '../systems/DamageSystem.ts';
import { initFoods, updateSpawns } from '../systems/SpawnSystem.ts';
import { executeInteraction, findInteraction, updateEating } from '../systems/InteractionSystem.ts';
import { currentErosionRate, initVacuums, updateVacuums } from '../systems/VacuumSystem.ts';
import { resetHumans, updateHumans } from '../systems/HumanSystem.ts';
import { initTreats, updateTreats } from '../systems/TreatSystem.ts';
import { expandFromTerritory } from '../systems/TerritorySystem.ts';
import {
  updateBlanket,
  updateShelterTimers,
  updateToilet,
} from '../systems/ShelterSystem.ts';
import { HUD } from '../ui/HUD.ts';
import { ResultScreen } from '../ui/ResultScreen.ts';
import { LoadingScreen } from '../ui/LoadingScreen.ts';
import { TitleScreen } from '../ui/TitleScreen.ts';
import { Tutorial } from '../ui/Tutorial.ts';
import { loadPrefs, savePrefs, type Prefs } from '../ui/Prefs.ts';
import { SoundManager } from '../audio/SoundManager.ts';
import { analytic } from './BalanceModel.ts';
// 타입만 가져온다. 실체는 DEV 가드 안의 동적 import 로만 로드되므로
// 프로덕션 번들에는 DebugPanel 코드가 들어가지 않는다. (§19)
import type { DebugPanel } from '../ui/DebugPanel.ts';

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

/** 거실 카메라 구역 */
const LIVING_REGION = {
  minX: -DERIVED.ROOM_W / 2,
  maxX: DERIVED.ROOM_W / 2,
  minZ: -DERIVED.ROOM_H / 2,
  maxZ: DERIVED.ROOM_H / 2,
};

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
  private readonly loading: LoadingScreen;
  private readonly title: TitleScreen;
  private readonly tutorial: Tutorial;
  private readonly sound = new SoundManager();
  private readonly prefs: Prefs;
  /** DEV 에서 ` 를 처음 누를 때 동적으로 로드된다 (§19) */
  private debugPanel: DebugPanel | null = null;
  private debugPanelLoading = false;

  private rafHandle = 0;
  private lastFrameMs = 0;
  private running = false;
  private disposed = false;

  /** 로딩 단계. 진행 바를 흉내 내지 않으려고 실제 작업만 담는다. (§16) */
  private bootSteps: { label: string; run: () => void }[] = [];
  private bootIndex = 0;

  /** 청소 먼지 파티클의 최소 간격 — 이벤트가 고정 스텝마다 오므로 솎아낸다 */
  private dustCooldown = 0;

  /** 이번 프레임에 플레이어가 움직인 거리 — 걷기 애니메이션용 */
  private movedThisFrame = 0;
  /** 디버그 배속 (§19) */
  timeScale = 1;

  /**
   * 밖에서 시드를 지정했으면(`?seed=`) 그 값. 지정하지 않았으면 null.
   *
   * 지정된 경우 **재시작도 결정적**이어야 한다 — 아니면 "시드 고정" 이
   * 첫 판에만 해당돼서, 재시작이 섞인 재현 절차가 다시 무작위가 된다.
   */
  private readonly pinnedSeed: number | null;
  private runIndex = 0;

  constructor(private readonly options: GameOptions) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.pinnedSeed = options.seed ?? null;
    const seed = this.pinnedSeed ?? (Date.now() >>> 0);
    this.state = new GameState(seed);
    this.scene = new HouseScene(this.state);
    this.camera = new QuarterViewCamera(this.aspect);
    this.input = new InputManager();
    this.hud = new HUD(options.uiRoot);
    this.result = new ResultScreen(options.uiRoot, () => this.restart());

    this.prefs = loadPrefs();
    this.loading = new LoadingScreen(options.uiRoot, seed);
    this.tutorial = new Tutorial(options.uiRoot, this.prefs.tutorial);
    this.title = new TitleScreen(options.uiRoot, {
      onStart: () => this.beginRun(),
      onToggleTutorial: (enabled) => {
        this.prefs.tutorial = enabled;
        this.tutorial.setEnabled(enabled);
        savePrefs(this.prefs);
      },
      onToggleSound: (enabled) => {
        this.prefs.sound = enabled;
        // 토글을 누른 것 자체가 사용자 제스처라 여기서 언락해도 된다. (§0-6)
        if (enabled) this.sound.unlock();
        this.sound.setMuted(!enabled);
        savePrefs(this.prefs);
        if (enabled) this.sound.playUi('toggle');
      },
      tutorialEnabled: this.prefs.tutorial,
      soundEnabled: this.prefs.sound,
    });

    this.pauseOverlay = document.createElement('div');
    this.pauseOverlay.className = 'pause-overlay';
    this.pauseOverlay.textContent = '⏸ 일시정지  —  Esc 로 계속';
    options.uiRoot.appendChild(this.pauseOverlay);

    this.sound.attach(this.bus);
    this.wireFeedback();

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

  /**
   * 이벤트 → 연출 배선. 로직은 이벤트를 쏠 뿐 무엇이 그려지는지 모른다. (§6-2)
   *
   * 씬은 재시작 때 새로 만들어지므로 핸들러 안에서 `this.scene` 을 그때그때 읽는다.
   * 씬 인스턴스를 클로저에 가두면 재시작 후 죽은 씬에 파티클을 쏘게 된다.
   */
  private wireFeedback(): void {
    const particles = (): HouseScene['particles'] => this.scene.particles;

    // 배변이 막힌 이유를 화면에 알린다. 게이지는 소모되지 않는다. (§10)
    this.bus.on('poop:blocked', ({ reason }) => this.hud.showToast(reason));
    this.bus.on('treat:taken', ({ description }) => this.hud.showToast(description, 2.4));
    this.bus.on('human:spotted', () => this.hud.showToast('🧍 발견됐다! 담요나 가구 위로!', 2.0));
    this.bus.on('blanket:dog', () => this.hud.showToast('🐶 강아지가 담요를 차지했다!', 2.0));
    this.bus.on('player:levelUp', ({ level }) =>
      this.hud.showToast(`✨ Lvl ${level} — 배변 반경이 커졌다. 히트박스도.`, 2.4),
    );

    // 파티클 (§16)
    this.bus.on('poop:done', ({ pos, radiusCells }) =>
      // 반경이 커질수록 크게 터진다 — 성장이 눈에 보여야 한다.
      particles().emit('poop', pos, radiusCells / CONFIG.LEVEL_POOP_RADIUS_CELLS[0]!),
    );
    this.bus.on('food:eaten', ({ pos }) => particles().emit('eat', pos));
    this.bus.on('treat:taken', () => particles().emit('treat', this.state.player.pos, 1.3));
    this.bus.on('player:damaged', () => particles().emit('damage', this.state.player.pos));
    this.bus.on('player:levelUp', () => particles().emit('levelUp', this.state.player.pos));
    this.bus.on('toilet:done', () => particles().emit('levelUp', this.state.player.pos, 1.4));

    // 청소 먼지는 고정 스텝마다 날아온다. 그대로 받으면 풀이 먼지로만 찬다.
    this.bus.on('vacuum:cleaned', ({ pos }) => {
      if (this.dustCooldown > 0) return;
      this.dustCooldown = 0.12;
      particles().emit('dust', pos);
    });
  }

  /**
   * 로딩 → 타이틀 → 플레이. (§16, §8 상태 머신)
   *
   * 곧바로 PLAYING 으로 넘어가지 않는 이유가 두 가지 있다.
   * ① §0-6 오디오 언락은 사용자 제스처가 필요하고, 타이틀의 첫 입력이 그 자리다.
   * ② 첫 프레임의 셰이더 컴파일은 실제로 수백 ms 가 걸린다. 플레이 중에 하면
   *    시작하자마자 프레임이 튀는데, 그 순간 청소기가 어디 있는지 모른다.
   */
  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;

    this.state.setPhase(Phase.LOADING);
    this.bootSteps = [
      {
        label: '집 짓는 중',
        run: () => {
          initFoods(this.state, this.bus);
          initVacuums(this.state);
          initTreats(this.state);
          resetHumans(this.state);
          this.camera.snapTo(this.state.player.pos);
        },
      },
      {
        // 여기서 미리 하지 않으면 플레이 첫 프레임에 통째로 터진다.
        label: '셰이더 컴파일',
        run: () => this.renderer.compile(this.scene.scene, this.camera.camera),
      },
      {
        // §3 의 계산이 현재 상수로도 성립하는지 부팅 때마다 확인한다 (R2)
        label: '밸런스 검산',
        run: () => {
          const a = analytic();
          if (a.pStar <= CONFIG.TARGET_RATIO) {
            console.warn(
              `[balance] 평형 점유율 ${a.pStar.toFixed(3)} 이 목표 ${CONFIG.TARGET_RATIO} 이하다 —` +
                ' 이 설정으로는 클리어가 수학적으로 불가능하다. GameConfig 를 확인할 것.',
            );
          }
        },
      },
      {
        label: '첫 프레임',
        run: () => {
          // update() 를 먼저 돌려야 한다. 메시는 생성 직후 전부 원점에 visible 로
          // 놓여 있어서, 그대로 그리면 아직 등장하지 않은 인간·특식이 방 한가운데
          // 겹쳐 찍힌다. 화면상 한 프레임이지만 GPU 에는 그 지오메트리가 그대로
          // 올라가 버려서, 재시작 후 리소스 카운트와도 어긋난다 (R5 테스트가 잡았다).
          this.scene.update(this.state, 0, 0);
          this.renderer.render(this.scene.scene, this.camera.camera);
        },
      },
    ];
    this.bootIndex = 0;

    this.lastFrameMs = performance.now();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  /** 로딩 단계를 한 프레임에 하나씩 진행한다. 다 끝나면 타이틀로 넘어간다. */
  private advanceBoot(): void {
    const step = this.bootSteps[this.bootIndex];
    if (!step) {
      this.loading.setProgress(1, '완료');
      this.loading.hide();
      this.state.setPhase(Phase.TITLE);
      this.title.show();
      return;
    }

    this.loading.setProgress(this.bootIndex / this.bootSteps.length, step.label);
    step.run();
    this.bootIndex++;
  }

  /**
   * 타이틀의 첫 입력에서 호출된다. **사용자 제스처 컨텍스트 안**이라
   * 여기서 오디오를 언락할 수 있다. (§0-6)
   */
  private beginRun(): void {
    if (this.state.phase !== Phase.TITLE) return;

    if (this.prefs.sound) this.sound.unlock();
    this.sound.setMuted(!this.prefs.sound);
    this.sound.playUi('confirm');

    this.title.hide();
    this.state.setPhase(Phase.PLAYING);

    // 타이틀에서 누른 키가 그대로 첫 배변으로 흘러들지 않게 비운다.
    this.input.endStep();
    this.loop.reset();
    // 로딩·타이틀에서 버려진 시간을 플레이 계측에 섞지 않는다.
    this.loop.resetStats();
    this.lastFrameMs = performance.now();
    this.tutorial.start();
  }

  private readonly tick = (nowMs: number): void => {
    if (this.disposed) return;
    this.rafHandle = requestAnimationFrame(this.tick);

    const rawDt = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;

    this.movedThisFrame = 0;

    if (this.state.phase === Phase.LOADING) {
      this.advanceBoot();
      return;
    }

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

    if (this.dustCooldown > 0) this.dustCooldown -= renderDt;

    // 렌더는 가변 프레임. 로직은 이미 고정 스텝으로 돌았다. (§0-5)
    this.scene.update(this.state, this.movedThisFrame, renderDt);
    this.camera.setRegion(
      this.state.player.stance === 'BATHROOM' ? BATHROOM_BOUNDS : LIVING_REGION,
    );
    this.camera.follow(this.state.player.pos, renderDt);
    // 타이틀에서는 HUD 를 감춘다 — 뒤에서 방은 계속 돌지만 게이지는 아직 의미가 없다.
    this.hud.setVisible(this.state.phase !== Phase.TITLE);
    this.hud.setHint(
      this.state.phase === Phase.PLAYING ? (findInteraction(this.state)?.label ?? '') : '',
    );
    this.hud.update(this.state, renderDt);
    this.tutorial.update(this.state, this.movedThisFrame, renderDt);
    this.sound.update(this.state);
    this.debugPanel?.update(renderDt);
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
    if (this.input.consume('mute')) this.toggleMute();
    if (this.input.consume('debug')) void this.toggleDebugPanel();

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

    updateToilet(s, dt, this.bus);
    updateBlanket(s, dt, this.bus);
    updateShelterTimers(s, dt);

    updateSpawns(s, dt, this.bus);
    updateTreats(s, dt, this.bus);
    updateVacuums(s, dt, this.bus);
    updateHumans(s, dt, this.bus);
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
    // 멈춘 화면에서 청소기 험이 계속 들리면 정지한 것처럼 느껴지지 않는다.
    this.sound.update(this.state);
  }

  resume(): void {
    if (this.state.phase !== Phase.PAUSED) return;
    this.state.setPhase(Phase.PLAYING);
    this.pauseOverlay.classList.remove('visible');
    this.loop.reset();
  }

  /** `M` 키. 설정은 판이 끝나도 유지된다. */
  toggleMute(): void {
    // 아직 언락 전이라면 이 키 입력이 곧 사용자 제스처다. (§0-6)
    if (this.sound.isMuted) this.sound.unlock();
    const muted = this.sound.toggleMute();
    this.prefs.sound = !muted;
    savePrefs(this.prefs);
    this.hud.showToast(muted ? '🔇 음소거' : '🔊 소리 켬', 1.2);
    if (!muted) this.sound.playUi('toggle');
  }

  /**
   * `\`` 키. **DEV 에서만 동작한다.**
   * 프로덕션 빌드에서는 이 메서드의 본문이 통째로 제거되므로
   * DebugPanel 모듈이 번들에 포함되지 않는다. (§19)
   */
  private async toggleDebugPanel(): Promise<void> {
    if (!import.meta.env.DEV) return;

    if (!this.debugPanel) {
      // 두 번 연속 눌러도 인스턴스가 두 개 생기지 않게 한다.
      if (this.debugPanelLoading) return;
      this.debugPanelLoading = true;
      const { DebugPanel } = await import('../ui/DebugPanel.ts');
      if (this.disposed) return;
      this.debugPanel = new DebugPanel(this.options.uiRoot, {
        info: () => this.debugInfo,
        setTimeScale: (v) => {
          this.timeScale = v;
        },
        getTimeScale: () => this.timeScale,
        fillPoop: () => {
          this.state.player.poop = CONFIG.POOP_MAX;
        },
        fillHunger: () => {
          this.state.player.hunger = CONFIG.HUNGER_MAX;
        },
        healHearts: () => {
          this.state.player.hearts = CONFIG.MAX_HEARTS;
        },
        forceWin: () => this.forceWin(),
        forceGameOver: () => this.forceGameOver(),
        restart: () => this.restart(),
      });
      this.debugPanelLoading = false;
    }

    this.debugPanel.toggle();
  }

  /**
   * 격자를 직접 채워 승리 조건을 만든다 (§19 승리 강제).
   * 딱 맞게 채우면 판정이 돌기 전에 청소기가 한 칸만 지워도 조건이 깨지므로
   * 여유분을 더한다.
   */
  private forceWin(): void {
    const s = this.state;
    const need = Math.ceil(s.effectiveCells * CONFIG.TARGET_RATIO) + 10 - s.ownedCells;
    if (need > 0) expandFromTerritory(s, need);
  }

  private forceGameOver(): void {
    const s = this.state;
    s.player.invulnTimer = 0;
    s.player.hearts = 1;
    applyDamage(s, 'starvation', null, this.bus);
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
    this.loading.dispose();
    this.title.dispose();
    this.tutorial.dispose();
    this.debugPanel?.dispose();
    this.debugPanel = null;
    this.sound.dispose();
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

    // 시드를 고정한 세션이면 판마다 다르되 **재현 가능한** 시드를 쓴다.
    // 매번 같은 시드로 되돌리면 재시작 테스트가 "정말 새 판인가"를 못 본다.
    this.runIndex++;
    const next =
      seed ?? (this.pinnedSeed === null ? Date.now() >>> 0 : (this.pinnedSeed + this.runIndex) >>> 0);
    this.state = new GameState(next);
    this.scene = new HouseScene(this.state);

    // 부팅 때와 똑같이 미리 컴파일한다. 빼먹으면 재시작 직후 첫 프레임에
    // 셰이더 컴파일이 몰려 화면이 한 번 끊긴다 — 하필 청소기 위치를 다시
    // 파악해야 하는 순간이다. (§8 리소스 카운트가 첫 판과 어긋나는 원인이기도 하다)
    this.renderer.compile(this.scene.scene, this.camera.camera);

    // 누적 상태를 전부 초기화한다 — 하나라도 빠지면 판이 거듭될수록 값이 어긋난다.
    this.loop.reset();
    this.loop.resetStats();
    this.metrics.gainRate = 0;
    this.metrics.erosionRate = 0;
    this.metrics.sinceLastPoop = 0;
    this.metrics.measuredCycle = 0;
    this.lastOwned = 0;
    this.metricWindow = 0;
    this.movedThisFrame = 0;
    this.dustCooldown = 0;

    this.result.hide();
    this.hud.setHint('');
    // 두 번째 판부터는 안내를 띄우지 않는다 — 방금 한 판을 끝낸 사람이다.
    this.tutorial.start();

    this.camera.snapTo(this.state.player.pos);
    this.state.setPhase(Phase.PLAYING);
    initFoods(this.state, this.bus);
    initVacuums(this.state);
    initTreats(this.state);
    resetHumans(this.state);
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
        forceWin: () => this.forceWin(),
        forceGameOver: () => this.forceGameOver(),
        restart: (seed?: number) => this.restart(seed),
        /**
         * 지금 `E` 가 무엇을 할지. (§7)
         *
         * 음식은 사정거리 안에 있으면 **무조건 우선**이라, 가구 옆에 음식이
         * 스폰되면 등반 대신 먹기가 실행된다. 테스트가 그걸 모른 채 E 를 누르면
         * 원인을 짚을 수 없는 실패가 된다 — 무엇이 걸려 있는지 먼저 볼 수 있어야 한다.
         */
        interaction: () => findInteraction(this.state)?.kind ?? null,
        /** 타이틀을 건너뛴다. 오디오 언락은 일어나지 않는다 (제스처가 아니다). */
        startRun: () => this.beginRun(),
        /** 살아 있는 파티클 수 — 연출이 실제로 도는지 확인용 (§16) */
        particleCount: () => this.scene.particles.aliveCount,
        /**
         * 씬 그래프가 실제로 들고 있는 오브젝트·리소스 수. (R5)
         *
         * `renderer.info.memory` 로는 누수를 못 가린다. three.js 는 메시가
         * **처음 그려질 때** GPU 에 올리므로, Lvl 2 에서 인간이 등장하면
         * 아무것도 새로 만들지 않았는데 카운트가 오른다. 반대로 만들어 두고
         * 안 그린 것은 세지 않는다. 둘 다 누수 판정을 흐린다.
         *
         * 여기서 세는 건 "지금 씬이 참조하는 서로 다른 리소스 개수"다.
         * 이 값이 늘지 않으면 아무것도 새로 할당되지 않은 것이다.
         */
        sceneStats: () => {
          const geometries = new Set<unknown>();
          const materials = new Set<unknown>();
          let objects = 0;
          this.scene.scene.traverse((o) => {
            objects++;
            const mesh = o as Partial<THREE.Mesh>;
            if (mesh.geometry) geometries.add(mesh.geometry);
            const mat = mesh.material;
            if (Array.isArray(mat)) for (const m of mat) materials.add(m);
            else if (mat) materials.add(mat);
          });
          return { objects, geometries: geometries.size, materials: materials.size };
        },
        /** 현재 튜토리얼 단계 key. 끝났으면 null (§18) */
        tutorialStep: () => this.tutorial.currentKey,
        soundUnlocked: () => this.sound.isUnlocked,
        config: CONFIG,
      },
    };
  }
}
