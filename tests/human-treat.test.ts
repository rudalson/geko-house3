import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { Phase, Stance, dist } from '../src/core/types.ts';
import {
  isBeingChased,
  isVisibleToHuman,
  resetHumans,
  shouldHumanAppear,
  spawnHumanIfDue,
  updateHumans,
} from '../src/systems/HumanSystem.ts';
import {
  SECRET_EVENTS,
  consumeTreat,
  initTreats,
  updateTreats,
} from '../src/systems/TreatSystem.ts';
import { updateVacuums, initVacuums } from '../src/systems/VacuumSystem.ts';
import { applyPoop } from '../src/systems/TerritorySystem.ts';
import { updateInvulnerability } from '../src/systems/DamageSystem.ts';

const DT = CONFIG.FIXED_DT;

let state: GameState;
beforeEach(() => {
  state = new GameState(8080);
  state.setPhase(Phase.PLAYING);
  state.player.pos = { x: 0, z: -0.5 };
  resetHumans(state);
});

function run(s: GameState, seconds: number, bus?: EventBus): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    updateHumans(s, DT, bus);
    updateTreats(s, DT, bus);
    updateInvulnerability(s, DT);
  }
}

/** Lvl 2 로 만든다 */
function reachLevel2(s: GameState): void {
  s.player.foodsEaten = CONFIG.FOOD_PER_AGE * CONFIG.LEVEL_THRESHOLDS[1]!;
  s.refreshGrowth();
}

describe('인간 등장 조건 (§24)', () => {
  it('Lvl 1 에서는 등장하지 않는다', () => {
    expect(shouldHumanAppear(state)).toBe(false);
    run(state, 3);
    expect(state.humans).toHaveLength(0);
  });

  it('Lvl 2(Age 4) 가 되면 등장한다', () => {
    reachLevel2(state);
    expect(state.player.levelIndex).toBe(1);
    expect(shouldHumanAppear(state)).toBe(true);

    run(state, 0.1);
    expect(state.humans).toHaveLength(1);
  });

  it('한 명만 등장한다 — 반복 호출해도 늘지 않는다', () => {
    reachLevel2(state);
    for (let i = 0; i < 5; i++) spawnHumanIfDue(state);
    expect(state.humans).toHaveLength(1);
  });

  it('플레이어 시야 밖에서 등장한다 — 나타나자마자 잡히지 않게', () => {
    for (let i = 0; i < 20; i++) {
      const s = new GameState(600 + i);
      s.setPhase(Phase.PLAYING);
      s.player.pos = { x: 0, z: 0 };
      reachLevel2(s);
      spawnHumanIfDue(s);
      expect(dist(s.humans[0]!.pos, s.player.pos), `seed ${600 + i}`).toBeGreaterThan(
        CONFIG.HUMAN_SIGHT,
      );
    }
  });

  it('설 수 있는 자리에서 등장하고 가구를 통과하지 않는다', () => {
    reachLevel2(state);
    spawnHumanIfDue(state);

    for (let i = 0; i < 60 * 30; i++) {
      updateHumans(state, DT);
      const h = state.humans[0]!;
      if (!state.collision.canStand(h.pos, CONFIG.HUMAN_RADIUS)) {
        throw new Error(`t=${(i / 60).toFixed(1)}s 에 (${h.pos.x}, ${h.pos.z}) 로 파고들었다`);
      }
    }
  });
});

describe('인간 추적 (§24)', () => {
  beforeEach(() => {
    reachLevel2(state);
    spawnHumanIfDue(state);
  });

  it('시야 안에 들어오면 추적을 시작하고 말풍선이 뜬다', () => {
    const bus = new EventBus();
    let spotted = 0;
    bus.on('human:spotted', () => spotted++);

    const h = state.humans[0]!;
    state.player.pos = { x: h.pos.x + 1.5, z: h.pos.z };

    run(state, 0.1, bus);
    expect(h.mode).toBe('chase');
    expect(h.speechLeft).toBeGreaterThan(0);
    expect(spotted).toBe(1);
    expect(isBeingChased(state)).toBe(true);
  });

  it('담요 밑에 숨으면 추적을 놓친다', () => {
    const h = state.humans[0]!;
    state.player.pos = { x: h.pos.x + 1.5, z: h.pos.z };
    run(state, 0.1);
    expect(h.mode).toBe('chase');

    state.player.stance = Stance.HIDDEN;
    expect(isVisibleToHuman(state)).toBe(false);

    run(state, 0.1);
    expect(h.mode).toBe('giveup');
  });

  it('가구 위로 올라가도 추적을 놓친다', () => {
    const h = state.humans[0]!;
    state.player.pos = { x: h.pos.x + 1.5, z: h.pos.z };
    run(state, 0.1);

    state.player.stance = Stance.ON_FURNITURE;
    run(state, 0.1);
    expect(h.mode).toBe('giveup');
  });

  it('멀리 도망가면 추적을 포기한다', () => {
    const h = state.humans[0]!;
    state.player.pos = { x: h.pos.x + 1.5, z: h.pos.z };
    run(state, 0.1);
    expect(h.mode).toBe('chase');

    // 추적 해제 범위 밖으로 순간이동
    state.player.pos = {
      x: h.pos.x + CONFIG.HUMAN_LOSE_RANGE + 1,
      z: h.pos.z,
    };
    run(state, 0.1);
    expect(h.mode).toBe('giveup');
  });

  it('추적 중에는 플레이어에게 가까워진다', () => {
    const h = state.humans[0]!;
    state.player.pos = { x: h.pos.x + 4, z: h.pos.z };
    const before = dist(h.pos, state.player.pos);

    run(state, 2);
    expect(dist(h.pos, state.player.pos)).toBeLessThan(before);
  });

  it('잡히면 하트가 줄고 잠시 물러난다', () => {
    const h = state.humans[0]!;
    state.player.pos = { x: h.pos.x, z: h.pos.z };

    run(state, 0.1);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
    expect(h.mode).toBe('giveup');

    // 무적이 풀리자마자 다시 잡히지 않는다
    run(state, CONFIG.INVULN_TIME + 0.1);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
  });

  it('무적 중에는 잡아도 피해가 없다', () => {
    const h = state.humans[0]!;
    state.player.invulnTimer = 5;
    state.player.pos = { x: h.pos.x, z: h.pos.z };

    run(state, 0.5);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS);
  });

  it('플레이어보다 느리다 — 달리면 벗어날 수 있다', () => {
    expect(CONFIG.HUMAN_SPEED).toBeLessThan(CONFIG.MOVE_SPEED);
    expect(CONFIG.HUMAN_SPEED).toBeLessThan(CONFIG.MOVE_SPEED * CONFIG.RUN_MULTIPLIER);
  });

  it('시야보다 추적 해제 범위가 넓다 — 경계에서 깜빡이지 않는다', () => {
    expect(CONFIG.HUMAN_LOSE_RANGE).toBeGreaterThan(CONFIG.HUMAN_SIGHT);
  });
});

describe('특식과 비밀 이벤트 (§24)', () => {
  beforeEach(() => {
    initTreats(state);
  });

  it('TREAT_FIRST_DELAY 뒤에 등장한다', () => {
    expect(state.treats[0]!.active).toBe(false);
    run(state, CONFIG.TREAT_FIRST_DELAY - 1);
    expect(state.treats[0]!.active).toBe(false);

    run(state, 2);
    expect(state.treats[0]!.active).toBe(true);
  });

  it('먹으면 이벤트가 하나 발동하고 재등장 타이머가 돈다', () => {
    const bus = new EventBus();
    let taken = '';
    bus.on('treat:taken', (p) => (taken = p.effect));

    run(state, CONFIG.TREAT_FIRST_DELAY + 1);
    const treat = state.treats[0]!;
    expect(treat.active).toBe(true);

    const event = consumeTreat(state, treat, bus);
    expect(event).not.toBeNull();
    expect(taken).toBe(event!.id);
    expect(treat.active).toBe(false);
    expect(treat.respawnLeft).toBe(CONFIG.TREAT_RESPAWN_DELAY);
  });

  it('이미 소비된 특식은 다시 먹을 수 없다', () => {
    run(state, CONFIG.TREAT_FIRST_DELAY + 1);
    const treat = state.treats[0]!;
    expect(consumeTreat(state, treat)).not.toBeNull();
    expect(consumeTreat(state, treat)).toBeNull();
  });

  it('지금 쓸모없는 효과는 고르지 않는다', () => {
    // 하트가 가득한 상태에서 "하트 회복"이 나오면 김이 샌다
    state.player.hearts = CONFIG.MAX_HEARTS;
    state.player.hunger = CONFIG.HUNGER_MAX;
    state.player.poop = CONFIG.POOP_MAX;
    state.player.levelIndex = 2;

    run(state, CONFIG.TREAT_FIRST_DELAY + 1);
    for (let i = 0; i < 30; i++) {
      // 매번 "아쉬울 게 없는" 상태로 되돌린다.
      // (Lvl 2 라 인간이 돌아다니며 하트를 깎으면 heal 이 다시 유효해진다)
      state.player.hearts = CONFIG.MAX_HEARTS;
      state.player.hunger = CONFIG.HUNGER_MAX;
      state.player.poop = CONFIG.POOP_MAX;
      state.player.levelIndex = 2;

      const treat = state.treats[0]!;
      treat.active = true;
      const e = consumeTreat(state, treat);
      expect(['heal', 'full-gauges', 'grow']).not.toContain(e!.id);
    }
  });

  it('모든 이벤트가 실제로 무언가를 바꾼다', () => {
    for (const event of SECRET_EVENTS) {
      const s = new GameState(1);
      s.setPhase(Phase.PLAYING);
      s.player.pos = { x: 0, z: 0.5 };
      initVacuums(s);
      // 모든 효과가 의미를 갖도록 여지를 만들어 둔다
      s.player.hearts = 1;
      s.player.hunger = 10;
      s.player.poop = 0;

      const before = {
        invuln: s.player.invulnTimer,
        hunger: s.player.hunger,
        poop: s.player.poop,
        stop: s.vacuumStopLeft,
        owned: s.ownedCells,
        level: s.player.levelIndex,
        hearts: s.player.hearts,
      };
      event.apply(s);
      const changed =
        s.player.invulnTimer !== before.invuln ||
        s.player.hunger !== before.hunger ||
        s.player.poop !== before.poop ||
        s.vacuumStopLeft !== before.stop ||
        s.ownedCells !== before.owned ||
        s.player.levelIndex !== before.level ||
        s.player.hearts !== before.hearts;

      expect(changed, `${event.id} 가 아무것도 바꾸지 않았다`).toBe(true);
    }
  });

  it('청소기 정지 효과는 실제로 청소기를 멈춘다', () => {
    initVacuums(state);
    applyPoop(state, state.vacuums[0]!.pos, 3);
    const owned = state.ownedCells;

    state.vacuumStopLeft = CONFIG.TREAT_VACUUM_STOP_TIME;
    for (let i = 0; i < Math.round(3 / DT); i++) updateVacuums(state, DT);

    expect(state.ownedCells, '멈춘 청소기가 청소했다').toBe(owned);
  });

  it('정지 시간이 끝나면 다시 움직인다', () => {
    initVacuums(state);
    state.vacuumStopLeft = CONFIG.TREAT_VACUUM_STOP_TIME;
    run(state, CONFIG.TREAT_VACUUM_STOP_TIME + 0.2);
    expect(state.vacuumStopLeft).toBe(0);

    const before = { ...state.vacuums[0]!.pos };
    for (let i = 0; i < Math.round(1 / DT); i++) updateVacuums(state, DT);
    expect(dist(before, state.vacuums[0]!.pos)).toBeGreaterThan(0);
  });

  it('시드가 같으면 같은 이벤트가 나온다 (§0-5)', () => {
    const pick = (seed: number): string => {
      const s = new GameState(seed);
      s.setPhase(Phase.PLAYING);
      initTreats(s);
      const t = s.treats[0]!;
      t.active = true;
      return consumeTreat(s, t)!.id;
    };
    expect(pick(4242)).toBe(pick(4242));
  });
});
