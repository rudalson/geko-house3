/**
 * 게임의 모든 가변 상태. **순수 데이터만 담는다.** (§0-4)
 *
 * Three.js 를 import 하지 않으므로 Vitest(WebGL 없음)에서 그대로 돌아간다.
 * entities/ · scenes/ · ui/ 는 이 객체를 **읽기만** 한다. 역방향 참조 금지.
 *
 * 재시작 시에는 이 객체를 새로 만든다. 재사용하지 않는다. (§8)
 */

import { CONFIG, levelIndexForAge } from './GameConfig.ts';
import { Rng } from './Rng.ts';
import { Phase, Stance, type GamePhase, type PlayerStance, type Vec2 } from './types.ts';
import { CollisionMap } from '../world/CollisionMap.ts';

export interface PlayerState {
  pos: Vec2;
  /** 바라보는 방향 (라디안, +z 기준 시계방향) */
  facing: number;
  stance: PlayerStance;

  hearts: number;
  /** > 0 이면 무적. 초 단위로 감소한다. */
  invulnTimer: number;

  hunger: number;
  /** 배고픔 0 도달 후 첫 피해까지 남은 유예 시간. 0 이하가 되면 주기 피해 시작 */
  starveGraceLeft: number;
  /** 다음 굶주림 피해까지 남은 시간 */
  starveDamageTimer: number;

  poop: number;
  /** > 0 이면 배변 중이라 이동 불가 (무적 아님) */
  poopAnimLeft: number;
  /** > 0 이면 먹는 중이라 이동 불가 */
  eatAnimLeft: number;
  /** > 0 이면 변기 사용 중이라 이동 불가 (§14) */
  toiletAnimLeft: number;

  /** 담요 밑에 숨어 있은 시간 (§13) */
  hiddenFor: number;
  /** 담요 경고가 이미 표시됐는지 */
  blanketWarned: boolean;

  /** 올라가 있는 가구의 id. 없으면 null (§7) */
  climbedOn: string | null;
  /** 가구 위/아래로 오르내리는 보간 시간 */
  climbAnimLeft: number;

  /** 화장실 왕복 페이드 시간. > 0 이면 이동 불가 (§6) */
  transitionLeft: number;

  /** > 0 이면 교미 중이라 이동 불가. **무적이 아니다** (§24) */
  mateAnimLeft: number;
  /** > 0 이면 임신 중 — 느려지고 히트박스가 커진다 (§24) */
  pregnantLeft: number;
  /** 산란 누적 횟수 */
  eggsLaid: number;

  /** 먹은 슈퍼푸드 누적 개수 */
  foodsEaten: number;
  age: number;
  /** 0-based 레벨 인덱스. HUD 에는 +1 해서 보여준다. */
  levelIndex: 0 | 1 | 2;

  /** 달리기 남은 지속 시간 */
  runLeft: number;
  /** 달리기 재사용 대기 시간 */
  runCooldownLeft: number;
}

/** 슈퍼푸드 슬롯. 비활성 슬롯은 respawnLeft 가 다 되면 다시 스폰된다. (§15) */
export interface FoodItem {
  id: number;
  pos: Vec2;
  active: boolean;
  /** 비활성일 때 남은 리스폰 시간 */
  respawnLeft: number;
  /** 스폰된 시각 — 반짝임 연출용 */
  spawnedAt: number;
}

/** 로봇청소기. 이동 로직은 S4 의 VacuumSystem 이 채운다. (§12) */
export interface VacuumState {
  id: number;
  pos: Vec2;
  /** 진행 방향 (라디안) */
  heading: number;
  /** 현재 직선 구간에 남은 시간 */
  straightLeft: number;
  /** > 0 이면 회전 연출 중 — 플레이어가 다음 방향을 예측할 수 있게 한다 */
  turnLeft: number;
  turnFrom: number;
  turnTo: number;
  /** > 0 이면 변기 보너스로 감속 중 (§14) */
  slowLeft: number;
  /**
   * 구역별로 머문 시간 (초). 오래된 기록은 서서히 옅어진다.
   * 다음 방향을 고를 때 **덜 간 쪽**을 향하게 하는 데 쓴다. (VacuumSystem)
   */
  zoneVisits: number[];
  /** 갇힘 감지 창이 끝날 때까지 남은 시간 */
  stuckLeft: number;
  /** 그 창이 시작될 때의 위치. 창이 끝났는데 별로 못 벗어났으면 갇힌 것이다. */
  stuckFrom: Vec2;
}

/** 인간 적. Lvl 2 부터 등장한다. (§24) */
export interface HumanState {
  id: number;
  pos: Vec2;
  facing: number;
  mode: 'idle' | 'chase' | 'giveup';
  /** 다음 경로 재계산까지 남은 시간 — §24 는 0.5초에 1회로 제한한다 */
  pathCooldown: number;
  /** 현재 향하는 지점 */
  waypoint: Vec2;
  /** 말풍선 남은 시간 */
  speechLeft: number;
  /** 추적 포기 후 재발견 대기 */
  giveupLeft: number;
  /** 배회 목적지 (idle 상태) */
  wanderTo: Vec2;
  /** true 면 휴식 중 — 플레이어를 찾지 않는다 */
  resting: boolean;
  /** 현재 사냥/휴식 구간에 남은 시간 */
  dutyLeft: number;
  /** 현재 추격을 지속한 시간 — 상한을 넘으면 놓아준다 */
  chaseFor: number;
}

/**
 * 짝 도마뱀. (§24)
 *
 * 한 마리만 존재하고 제자리에 머문다. 쫓아다니는 적이 아니라
 * **플레이어가 갈지 말지 고르는 지점**이라 이동 AI 가 필요 없다.
 */
export interface MateState {
  /** 지금 방에 나와 있는지 */
  active: boolean;
  pos: Vec2;
  /** 다음 등장까지 남은 시간 (초). active 면 의미 없다 */
  appearIn: number;
  /** 등장한 시각 — 등장 연출용 */
  spawnedAt: number;
}

/** 특식. 획득 시 SecretEvent 하나가 무작위로 발동한다. (§24) */
export interface TreatItem {
  id: number;
  pos: Vec2;
  active: boolean;
  /** 다음 등장까지 남은 시간 */
  respawnLeft: number;
  spawnedAt: number;
}

export interface RunStats {
  /** 청소기가 지운 누적 셀 수 */
  erasedCells: number;
  poops: number;
  damageTaken: number;
}

export class GameState {
  phase: GamePhase = Phase.BOOT;
  /** PLAYING 상태에서 누적된 시간(초). 브라우저 타이머를 쓰지 않는다. (§8) */
  elapsed = 0;

  readonly rng: Rng;
  readonly collision: CollisionMap;

  /** 격자. Uint8Array 로 관리한다. 2차원 배열이나 객체 배열을 쓰지 않는다. (§10) */
  readonly grid: Uint8Array;
  /** 분모. 시작 시 1회 계산해 캐싱한다. 매 프레임 순회하지 않는다. (§10) */
  readonly effectiveCells: number;
  /** 분자. 셀 상태가 바뀔 때마다 증분 갱신한다. */
  ownedCells = 0;
  /**
   * 이번 프레임에 상태가 바뀐 셀 인덱스. 렌더러가 소비하고 비운다.
   * 변경이 있는 프레임에만 GPU 버퍼를 갱신하기 위한 것이다. (§10 시각화)
   */
  readonly dirtyCells: number[] = [];

  readonly player: PlayerState;
  readonly stats: RunStats = { erasedCells: 0, poops: 0, damageTaken: 0 };

  /** 슈퍼푸드 슬롯. 개수는 FOOD_MAX_CONCURRENT 로 고정된다. */
  readonly foods: FoodItem[] = [];
  /** 로봇청소기 (S4 에서 채워진다) */
  readonly vacuums: VacuumState[] = [];
  /** 인간 적. Lvl 2 에 도달하면 SpawnSystem 이 채운다. (§24) */
  readonly humans: HumanState[] = [];
  /** 특식 (§24) */
  readonly treats: TreatItem[] = [];
  /** 짝 도마뱀 (§24). MateSystem 이 등장·소멸을 관리한다 */
  readonly mate: MateState = {
    active: false,
    pos: { x: 0, z: 0 },
    appearIn: CONFIG.MATE_FIRST_APPEAR_SEC,
    spawnedAt: 0,
  };
  /** > 0 이면 특식 효과로 청소기가 멈춰 있다 */
  vacuumStopLeft = 0;
  /** 먹는 중인 음식의 위치. 애니메이션이 끝나면 null 로 돌아간다. (연출용) */
  pendingFood: Vec2 | null = null;

  constructor(seed: number = Date.now() >>> 0, collision = new CollisionMap()) {
    this.rng = new Rng(seed);
    this.collision = collision;
    this.grid = collision.createCellGrid();
    this.effectiveCells = collision.effectiveCells;

    this.player = {
      pos: { x: 0, z: 0 },
      facing: 0,
      stance: Stance.GROUND,
      hearts: CONFIG.MAX_HEARTS,
      invulnTimer: 0,
      hunger: CONFIG.HUNGER_MAX,
      starveGraceLeft: CONFIG.STARVE_GRACE,
      starveDamageTimer: 0,
      poop: 0,
      poopAnimLeft: 0,
      eatAnimLeft: 0,
      toiletAnimLeft: 0,
      hiddenFor: 0,
      blanketWarned: false,
      climbedOn: null,
      climbAnimLeft: 0,
      transitionLeft: 0,
      mateAnimLeft: 0,
      pregnantLeft: 0,
      eggsLaid: 0,
      foodsEaten: 0,
      age: 0,
      levelIndex: 0,
      runLeft: 0,
      runCooldownLeft: 0,
    };
  }

  /** 현재 똥 땅 달성률 [0, 1]. 매 프레임 격자를 순회하지 않는다. */
  get territoryRatio(): number {
    return this.effectiveCells === 0 ? 0 : this.ownedCells / this.effectiveCells;
  }

  /** 목표 달성 여부 */
  get targetReached(): boolean {
    return this.territoryRatio >= CONFIG.TARGET_RATIO;
  }

  /** 현재 레벨의 배변 반경 (셀) */
  get poopRadiusCells(): number {
    return CONFIG.LEVEL_POOP_RADIUS_CELLS[this.player.levelIndex]!;
  }

  /** 임신 중인지 (§24) */
  get isPregnant(): boolean {
    return this.player.pregnantLeft > 0;
  }

  /**
   * 현재 이동 속도 (world units/초).
   * 임신하면 느려진다 — 산란 보너스의 대가다. (§24)
   */
  get moveSpeed(): number {
    const base = CONFIG.MOVE_SPEED * CONFIG.LEVEL_SPEED_MUL[this.player.levelIndex]!;
    return this.isPregnant ? base * CONFIG.MATE_SPEED_MUL : base;
  }

  /**
   * 현재 충돌 반경.
   *
   * 성장하면 커진다 — 넓게 싸는 대신 더 쉽게 걸린다는 트레이드오프. (§9-4)
   * 임신 중에도 커진다. 같은 논리다: 보상을 기다리는 동안 더 잘 걸린다. (§24)
   */
  get playerRadius(): number {
    const base = CONFIG.PLAYER_RADIUS * CONFIG.LEVEL_HITBOX_MUL[this.player.levelIndex]!;
    return this.isPregnant ? base * CONFIG.MATE_HITBOX_MUL : base;
  }

  get isInvulnerable(): boolean {
    return this.player.invulnTimer > 0;
  }

  /**
   * 로봇청소기의 충돌 판정 대상인지.
   * 가구 위(§7)와 담요 밑(§13)에서는 제외된다.
   */
  get isVulnerableToVacuum(): boolean {
    return (
      this.phase === Phase.PLAYING &&
      this.player.stance === Stance.GROUND &&
      !this.isInvulnerable
    );
  }

  /** 이동 입력을 받을 수 있는 상태인지 */
  get canMove(): boolean {
    const p = this.player;
    return (
      this.phase === Phase.PLAYING &&
      p.poopAnimLeft <= 0 &&
      p.eatAnimLeft <= 0 &&
      p.toiletAnimLeft <= 0 &&
      p.mateAnimLeft <= 0 &&
      p.climbAnimLeft <= 0 &&
      p.transitionLeft <= 0 &&
      p.stance !== Stance.HIDDEN
    );
  }

  /** 먹은 음식 수로부터 Age 와 Lvl 을 다시 계산한다. 레벨이 올랐으면 true. */
  refreshGrowth(): boolean {
    const p = this.player;
    p.age = Math.floor(p.foodsEaten / CONFIG.FOOD_PER_AGE);
    const next = levelIndexForAge(p.age);
    if (next === p.levelIndex) return false;
    p.levelIndex = next;
    return true;
  }

  setPhase(next: GamePhase): GamePhase | null {
    if (this.phase === next) return null;
    const from = this.phase;
    this.phase = next;
    return from;
  }
}
