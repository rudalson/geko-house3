import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { Phase, dist } from '../src/core/types.ts';
import { applyDamage, updateInvulnerability } from '../src/systems/DamageSystem.ts';
import {
  isInStarveGrace,
  isStarving,
  restoreHunger,
  updateHunger,
} from '../src/systems/HungerSystem.ts';
import { activeFoods, consumeFood, initFoods, updateSpawns } from '../src/systems/SpawnSystem.ts';
import {
  INTERACT_RANGE,
  executeInteraction,
  findInteraction,
  updateEating,
} from '../src/systems/InteractionSystem.ts';

const DT = CONFIG.FIXED_DT;

let state: GameState;
beforeEach(() => {
  state = new GameState(2024);
  state.setPhase(Phase.PLAYING);
  state.player.pos = { x: 0, z: -0.5 };
  initFoods(state);
});

/** n 초만큼 시뮬레이션한다. */
function run(s: GameState, seconds: number, bus?: EventBus): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    updateEating(s, DT, bus);
    updateSpawns(s, DT, bus);
    updateHunger(s, DT, bus);
    updateInvulnerability(s, DT);
  }
}

describe('배고픔 (§9-2)', () => {
  it('초당 HUNGER_DRAIN 만큼 감소한다', () => {
    const before = state.player.hunger;
    run(state, 10);
    expect(before - state.player.hunger).toBeCloseTo(CONFIG.HUNGER_DRAIN * 10, 1);
  });

  it('회복되고, 상한 초과분은 버려진다', () => {
    state.player.hunger = CONFIG.HUNGER_MAX - 3;
    const restored = restoreHunger(state, CONFIG.FOOD_HUNGER_RESTORE);
    expect(restored).toBe(3);
    expect(state.player.hunger).toBe(CONFIG.HUNGER_MAX);
  });

  it('0 에 닿으면 유예가 시작되고 그동안은 피해가 없다', () => {
    state.player.hunger = 0.5;
    run(state, 1); // 0 도달
    expect(state.player.hunger).toBe(0);
    expect(isInStarveGrace(state)).toBe(true);
    expect(isStarving(state)).toBe(false);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS);
  });

  it('유예가 끝나면 첫 피해가 들어간다', () => {
    state.player.hunger = 0;
    state.player.starveGraceLeft = CONFIG.STARVE_GRACE;
    state.player.starveDamageTimer = 0;

    run(state, CONFIG.STARVE_GRACE - 0.2);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS);

    run(state, 0.4);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
    expect(isStarving(state)).toBe(true);
  });

  it('그 뒤로 STARVE_DAMAGE_INTERVAL 마다 하트가 하나씩 준다', () => {
    state.player.hunger = 0;
    state.player.starveGraceLeft = 0;
    state.player.starveDamageTimer = 0;

    run(state, 0.1); // 첫 피해
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);

    // 무적 시간(1.5초)이 간격(5초)보다 짧아야 다음 피해가 들어간다
    expect(CONFIG.INVULN_TIME).toBeLessThan(CONFIG.STARVE_DAMAGE_INTERVAL);

    run(state, CONFIG.STARVE_DAMAGE_INTERVAL);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 2);
  });

  it('먹으면 유예가 초기화된다', () => {
    state.player.hunger = 0;
    state.player.starveGraceLeft = 0.5;
    restoreHunger(state, CONFIG.FOOD_HUNGER_RESTORE);
    expect(state.player.starveGraceLeft).toBe(CONFIG.STARVE_GRACE);
    expect(isStarving(state)).toBe(false);
  });

  it('PLAYING 이 아니면 감소하지 않는다', () => {
    state.setPhase(Phase.PAUSED);
    const before = state.player.hunger;
    run(state, 5);
    expect(state.player.hunger).toBe(before);
  });
});

describe('피해와 무적 (§9-1, §12)', () => {
  it('피해를 받으면 하트가 줄고 무적이 걸린다', () => {
    expect(applyDamage(state, 'vacuum', { x: 1, z: 0 })).toBe(true);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
    expect(state.isInvulnerable).toBe(true);
  });

  it('무적 중 추가 피해는 무시된다 — 연속 충돌로 즉사하지 않는다', () => {
    applyDamage(state, 'vacuum', { x: 1, z: 0 });
    expect(applyDamage(state, 'vacuum', { x: 1, z: 0 })).toBe(false);
    expect(applyDamage(state, 'vacuum', { x: 1, z: 0 })).toBe(false);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
  });

  it('무적이 끝나면 다시 피해를 받는다', () => {
    applyDamage(state, 'vacuum', { x: 1, z: 0 });
    for (let i = 0; i < Math.ceil(CONFIG.INVULN_TIME / DT) + 1; i++) {
      updateInvulnerability(state, DT);
    }
    expect(state.isInvulnerable).toBe(false);
    expect(applyDamage(state, 'vacuum', { x: 1, z: 0 })).toBe(true);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 2);
  });

  it('넉백은 가해자 반대쪽으로 밀되 벽을 통과하지 않는다', () => {
    const before = { ...state.player.pos };
    applyDamage(state, 'vacuum', { x: before.x - 1, z: before.z });

    expect(state.player.pos.x).toBeGreaterThan(before.x);
    expect(state.collision.canStand(state.player.pos, state.playerRadius)).toBe(true);
  });

  it('정확히 겹쳐도 넉백 방향이 NaN 이 되지 않는다', () => {
    const before = { ...state.player.pos };
    applyDamage(state, 'vacuum', { ...before });
    expect(Number.isFinite(state.player.pos.x)).toBe(true);
    expect(Number.isFinite(state.player.pos.z)).toBe(true);
  });

  it('굶주림 피해는 넉백이 없다', () => {
    const before = { ...state.player.pos };
    applyDamage(state, 'starvation', null);
    expect(state.player.pos).toEqual(before);
  });

  it('피해를 받으면 배변이 중단되고 게이지는 남는다', () => {
    state.player.poop = CONFIG.POOP_MAX;
    state.player.poopAnimLeft = CONFIG.POOP_ANIM_TIME;
    applyDamage(state, 'vacuum', { x: 1, z: 0 });
    expect(state.player.poopAnimLeft).toBe(0);
    expect(state.player.poop).toBe(CONFIG.POOP_MAX);
  });

  it('하트가 0 이 되면 게임오버 이벤트가 나간다', () => {
    const bus = new EventBus();
    let over = false;
    bus.on('stage:gameOver', () => (over = true));

    for (let i = 0; i < CONFIG.MAX_HEARTS; i++) {
      state.player.invulnTimer = 0;
      applyDamage(state, 'starvation', null, bus);
    }
    expect(state.player.hearts).toBe(0);
    expect(over).toBe(true);
  });
});

describe('슈퍼푸드 스폰 (§15)', () => {
  it('FOOD_MAX_CONCURRENT 개가 동시에 존재한다', () => {
    expect(state.foods).toHaveLength(CONFIG.FOOD_MAX_CONCURRENT);
    expect(activeFoods(state)).toHaveLength(CONFIG.FOOD_MAX_CONCURRENT);
  });

  it('모든 음식이 플레이어가 설 수 있는 자리에 스폰된다', () => {
    for (let i = 0; i < 40; i++) {
      const s = new GameState(1000 + i);
      s.setPhase(Phase.PLAYING);
      initFoods(s);
      for (const f of s.foods) {
        expect(
          s.collision.canStand(f.pos, s.playerRadius),
          `seed ${1000 + i}: (${f.pos.x}, ${f.pos.z}) 에 갈 수 없다`,
        ).toBe(true);
      }
    }
  });

  it('리스폰은 플레이어에게서 FOOD_MIN_SPAWN_DIST 이상 떨어져 나온다 — 밸런스 제약', () => {
    // 첫 스폰은 튜토리얼용으로 완화되므로 리스폰만 검사한다.
    for (let i = 0; i < 30; i++) {
      const s = new GameState(500 + i);
      s.setPhase(Phase.PLAYING);
      s.player.pos = { x: 0, z: 0 };
      initFoods(s);

      const food = s.foods[0]!;
      consumeFood(s, food);
      for (let k = 0; k < Math.ceil(CONFIG.FOOD_RESPAWN_DELAY / DT) + 2; k++) {
        updateSpawns(s, DT);
      }

      expect(food.active).toBe(true);
      expect(
        dist(food.pos, s.player.pos),
        `seed ${500 + i}: 거리 ${dist(food.pos, s.player.pos).toFixed(2)}`,
      ).toBeGreaterThanOrEqual(CONFIG.FOOD_MIN_SPAWN_DIST * 0.6);
    }
  });

  it('먹으면 FOOD_RESPAWN_DELAY 뒤에 다시 나온다', () => {
    const food = state.foods[0]!;
    consumeFood(state, food);
    expect(food.active).toBe(false);

    run(state, CONFIG.FOOD_RESPAWN_DELAY - 0.2);
    expect(food.active).toBe(false);

    run(state, 0.4);
    expect(food.active).toBe(true);
  });

  it('시드가 같으면 스폰 위치가 같다 (§0-5 결정성)', () => {
    const a = new GameState(777);
    const b = new GameState(777);
    initFoods(a);
    initFoods(b);
    expect(a.foods.map((f) => f.pos)).toEqual(b.foods.map((f) => f.pos));
  });

  it('시드가 다르면 스폰 위치가 달라진다', () => {
    const a = new GameState(1);
    const b = new GameState(2);
    initFoods(a);
    initFoods(b);
    expect(a.foods.map((f) => f.pos)).not.toEqual(b.foods.map((f) => f.pos));
  });

  it('음식끼리 같은 자리에 겹치지 않는다', () => {
    for (let i = 0; i < 30; i++) {
      const s = new GameState(3000 + i);
      initFoods(s);
      const [a, b] = s.foods;
      if (a && b) expect(dist(a.pos, b.pos)).toBeGreaterThan(1);
    }
  });
});

describe('상호작용과 섭취 (§7, §15)', () => {
  /** 플레이어를 첫 번째 음식 위로 옮긴다. */
  function standOnFood(s: GameState): void {
    const food = s.foods.find((f) => f.active)!;
    s.player.pos = { ...food.pos };
  }

  it('사정거리 안에서만 안내가 뜬다', () => {
    state.player.pos = { x: 0, z: 0 };
    const far = findInteraction(state);
    const food = state.foods[0]!;
    if (dist(state.player.pos, food.pos) > INTERACT_RANGE) expect(far).toBeNull();

    standOnFood(state);
    const near = findInteraction(state);
    expect(near).not.toBeNull();
    expect(near!.kind).toBe('food');
    expect(near!.label).toContain('슈퍼푸드');
  });

  it('여러 대상이 겹치면 가장 가까운 하나만 고른다', () => {
    // 두 음식을 플레이어 양옆에 인위적으로 배치한다.
    state.player.pos = { x: 0, z: 0 };
    state.foods[0]!.pos = { x: 0.9, z: 0 };
    state.foods[1]!.pos = { x: 0.3, z: 0 };
    const found = findInteraction(state);
    expect(found!.food).toBe(state.foods[1]);
  });

  it('먹으면 배고픔·똥 게이지가 오르고 Age 진행도가 늘어난다', () => {
    state.player.hunger = 50;
    standOnFood(state);

    expect(executeInteraction(state)).toBe(true);
    // 애니메이션 중에는 아직 효과가 없다
    expect(state.player.poop).toBe(0);
    expect(state.canMove).toBe(false);

    const elapsed = CONFIG.FOOD_EAT_TIME + 0.1;
    run(state, elapsed);

    expect(state.player.poop).toBe(CONFIG.POOP_PER_FOOD);
    // 먹는 동안에도 배고픔은 계속 줄어든다 (§9-2) — 그만큼 빼고 비교한다.
    const drained = CONFIG.HUNGER_DRAIN * elapsed;
    expect(state.player.hunger).toBeCloseTo(50 - drained + CONFIG.FOOD_HUNGER_RESTORE, 5);
    expect(state.player.foodsEaten).toBe(1);
    expect(state.canMove).toBe(true);
  });

  it('음식 3개면 똥 게이지가 정확히 가득 찬다 — 밸런스 사이클 전제', () => {
    for (let i = 0; i < DERIVED.FOODS_PER_POOP; i++) {
      const food = state.foods.find((f) => f.active);
      expect(food, `${i + 1}번째 음식이 없다`).toBeDefined();
      state.player.pos = { ...food!.pos };
      expect(executeInteraction(state)).toBe(true);
      run(state, CONFIG.FOOD_EAT_TIME + 0.05);
      // 다음 음식이 리스폰될 때까지 기다린다
      run(state, CONFIG.FOOD_RESPAWN_DELAY);
    }
    expect(state.player.poop).toBe(CONFIG.POOP_MAX);
    expect(state.player.foodsEaten).toBe(3);
  });

  it('사정거리 밖에서는 실행되지 않는다', () => {
    state.player.pos = { x: 0, z: 0 };
    state.foods[0]!.pos = { x: 6, z: 4 };
    state.foods[1]!.pos = { x: -6, z: 4 };
    expect(executeInteraction(state)).toBe(false);
  });

  it('먹는 중에는 다시 상호작용할 수 없다', () => {
    standOnFood(state);
    executeInteraction(state);
    expect(findInteraction(state)).toBeNull();
  });

  it('먹은 음식은 즉시 비활성화된다 — 애니메이션 중 중복 섭취 방지', () => {
    standOnFood(state);
    const active = activeFoods(state).length;
    executeInteraction(state);
    expect(activeFoods(state)).toHaveLength(active - 1);
  });

  it('FOOD_PER_AGE 개마다 Age 가 오르고 임계값에서 레벨업한다 (§9-4)', () => {
    const bus = new EventBus();
    let levelUps = 0;
    bus.on('player:levelUp', () => levelUps++);

    // Age 4 = Lvl 2 가 되는 지점까지 먹인 것으로 친다
    state.player.foodsEaten = CONFIG.FOOD_PER_AGE * 4 - 1;
    state.player.hunger = 50;
    standOnFood(state);
    executeInteraction(state, bus);
    run(state, CONFIG.FOOD_EAT_TIME + 0.1, bus);

    expect(state.player.age).toBe(4);
    expect(state.player.levelIndex).toBe(1);
    expect(levelUps).toBe(1);
  });
});
