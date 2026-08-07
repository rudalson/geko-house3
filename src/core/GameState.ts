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

  /** 현재 레벨의 이동 속도 (world units/초) */
  get moveSpeed(): number {
    return CONFIG.MOVE_SPEED * CONFIG.LEVEL_SPEED_MUL[this.player.levelIndex]!;
  }

  /**
   * 현재 레벨의 충돌 반경.
   * 성장하면 커진다 — 넓게 싸는 대신 더 쉽게 걸린다는 트레이드오프. (§9-4)
   */
  get playerRadius(): number {
    return CONFIG.PLAYER_RADIUS * CONFIG.LEVEL_HITBOX_MUL[this.player.levelIndex]!;
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
