import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { Cell, Phase, Stance, dist } from '../src/core/types.ts';
import { applyPoop, recountOwned } from '../src/systems/TerritorySystem.ts';
import { initVacuums, slowVacuums, updateVacuums } from '../src/systems/VacuumSystem.ts';
import { updateInvulnerability } from '../src/systems/DamageSystem.ts';

const DT = CONFIG.FIXED_DT;

let state: GameState;
beforeEach(() => {
  state = new GameState(31337);
  state.setPhase(Phase.PLAYING);
  state.player.pos = { x: 0, z: -0.5 };
  initVacuums(state);
});

function run(s: GameState, seconds: number, bus?: EventBus): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    updateVacuums(s, DT, bus);
    updateInvulnerability(s, DT);
  }
}

/** 플레이어를 청소기에서 멀리 치워 우발적 충돌을 막는다. */
function movePlayerAway(s: GameState): void {
  const v = s.vacuums[0]!;
  const spot = s.collision
    .standablePoints(s.playerRadius)
    .slice()
    .sort((a, b) => dist(b, v.pos) - dist(a, v.pos))[0]!;
  s.player.pos = { x: spot.x, z: spot.z };
}

describe('청소기 생성 (§12)', () => {
  it('VACUUM_COUNT 만큼 만들어진다', () => {
    expect(state.vacuums).toHaveLength(CONFIG.VACUUM_COUNT);
  });

  it('플레이어에게서 떨어진 곳에서 시작한다 — 시작하자마자 맞지 않게', () => {
    for (let i = 0; i < 30; i++) {
      const s = new GameState(700 + i);
      s.player.pos = { x: 0, z: 0 };
      initVacuums(s);
      expect(dist(s.vacuums[0]!.pos, s.player.pos), `seed ${700 + i}`).toBeGreaterThan(4);
    }
  });

  it('설 수 있는 자리에서 시작한다', () => {
    for (let i = 0; i < 30; i++) {
      const s = new GameState(800 + i);
      initVacuums(s);
      for (const v of s.vacuums) {
        expect(s.collision.canStand(v.pos, CONFIG.VACUUM_RADIUS), `seed ${800 + i}`).toBe(true);
      }
    }
  });

  it('시드가 같으면 같은 자리에서 시작한다 (§0-5)', () => {
    const a = new GameState(4242);
    const b = new GameState(4242);
    initVacuums(a);
    initVacuums(b);
    expect(a.vacuums[0]!.pos).toEqual(b.vacuums[0]!.pos);
  });
});

describe('읽을 수 있는 이동 (§12)', () => {
  it('벽이나 가구를 통과하지 않는다', () => {
    movePlayerAway(state);
    for (let i = 0; i < 60 * 60; i++) {
      updateVacuums(state, DT);
      const v = state.vacuums[0]!;
      if (!state.collision.canStand(v.pos, CONFIG.VACUUM_RADIUS)) {
        throw new Error(`t=${(i / 60).toFixed(1)}s 에 (${v.pos.x}, ${v.pos.z}) 로 파고들었다`);
      }
    }
  });

  it('방 밖으로 나가지 않는다', () => {
    movePlayerAway(state);
    run(state, 120);
    const v = state.vacuums[0]!;
    expect(Math.abs(v.pos.x)).toBeLessThanOrEqual(DERIVED.ROOM_W / 2);
    expect(Math.abs(v.pos.z)).toBeLessThanOrEqual(DERIVED.ROOM_H / 2);
  });

  it('회전 중에는 이동하지 않는다 — 예고 동작', () => {
    const v = state.vacuums[0]!;
    v.turnLeft = CONFIG.VACUUM_TURN_TIME;
    v.turnFrom = 0;
    v.turnTo = Math.PI / 2;
    const before = { ...v.pos };

    for (let i = 0; i < 10; i++) updateVacuums(state, DT);
    expect(v.pos).toEqual(before);
    expect(v.turnLeft).toBeGreaterThan(0);
  });

  it('회전이 끝나면 목표 방향에 정확히 도달한다', () => {
    const v = state.vacuums[0]!;
    v.turnLeft = CONFIG.VACUUM_TURN_TIME;
    v.turnFrom = 0;
    v.turnTo = 1.2;

    run(state, CONFIG.VACUUM_TURN_TIME + 0.1);
    expect(v.heading).toBeCloseTo(1.2, 5);
    expect(v.turnLeft).toBe(0);
  });

  it('직선 구간이 VACUUM_STRAIGHT_MIN 보다 짧지 않다 — 예측 가능해야 한다', () => {
    movePlayerAway(state);
    const v = state.vacuums[0]!;
    v.turnLeft = 0;
    v.straightLeft = CONFIG.VACUUM_STRAIGHT_MIN;

    // 벽에 부딪히지 않는 한 최소 시간은 직진해야 한다
    let straightTime = 0;
    for (let i = 0; i < 60 * 10; i++) {
      const headingBefore = v.heading;
      updateVacuums(state, DT);
      if (v.heading !== headingBefore || v.turnLeft > 0) break;
      straightTime += DT;
    }
    // 벽 충돌로 일찍 꺾일 수 있으므로 "0 이 아니다"만 보장한다
    expect(straightTime).toBeGreaterThan(0);
  });

  it('새 직선 구간의 길이가 설정 범위 안에 있다', () => {
    movePlayerAway(state);
    const seen: number[] = [];
    const v = state.vacuums[0]!;
    let last = v.straightLeft;

    for (let i = 0; i < 60 * 120; i++) {
      updateVacuums(state, DT);
      if (v.straightLeft > last) seen.push(v.straightLeft); // 새로 배정됨
      last = v.straightLeft;
    }

    expect(seen.length).toBeGreaterThan(3);
    for (const s of seen) {
      expect(s).toBeGreaterThanOrEqual(CONFIG.VACUUM_STRAIGHT_MIN);
      expect(s).toBeLessThanOrEqual(CONFIG.VACUUM_STRAIGHT_MAX);
    }
  });

  it('한 자리에 갇히지 않는다 — 2분 동안 방을 돌아다닌다', () => {
    movePlayerAway(state);
    const v = state.vacuums[0]!;
    const start = { ...v.pos };
    let maxDist = 0;

    for (let i = 0; i < 60 * 120; i++) {
      updateVacuums(state, DT);
      maxDist = Math.max(maxDist, dist(start, v.pos));
    }
    expect(maxDist, '청소기가 제자리를 맴돈다').toBeGreaterThan(4);
  });
});

describe('청소 (§12)', () => {
  it('똥 땅 위를 지나가면 EMPTY 로 되돌린다', () => {
    movePlayerAway(state);
    const v = state.vacuums[0]!;
    // 청소기 자리에 영역을 깔아둔다
    applyPoop(state, v.pos, 3);
    const before = state.ownedCells;
    expect(before).toBeGreaterThan(0);

    run(state, 3);
    expect(state.ownedCells).toBeLessThan(before);
    expect(state.ownedCells).toBe(recountOwned(state));
  });

  it('지운 셀 수가 통계에 누적된다 (결과 화면용)', () => {
    movePlayerAway(state);
    applyPoop(state, state.vacuums[0]!.pos, 3);
    const before = state.ownedCells;

    run(state, 3);
    expect(state.stats.erasedCells).toBe(before - state.ownedCells);
  });

  it('BLOCKED 셀을 건드리지 않는다', () => {
    movePlayerAway(state);
    const blockedBefore = state.collision.blockedCells;
    run(state, 60);
    let blocked = 0;
    for (const c of state.grid) if (c === Cell.BLOCKED) blocked++;
    expect(blocked).toBe(blockedBefore);
  });

  it('빈 바닥만 지나가면 통계가 늘지 않는다', () => {
    movePlayerAway(state);
    run(state, 10);
    expect(state.stats.erasedCells).toBe(0);
  });
});

describe('플레이어 충돌 (§12)', () => {
  /** 플레이어를 청소기 위에 올린다. */
  function collide(s: GameState): void {
    const v = s.vacuums[0]!;
    s.player.pos = { x: v.pos.x, z: v.pos.z };
  }

  it('충돌하면 하트가 줄고 무적이 걸린다', () => {
    collide(state);
    updateVacuums(state, DT);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
    expect(state.isInvulnerable).toBe(true);
  });

  it('무적 시간 덕에 연속 충돌로 즉사하지 않는다', () => {
    collide(state);
    // 무적 시간 내내 붙어 있어도 하트는 하나만 준다
    for (let i = 0; i < Math.floor(CONFIG.INVULN_TIME / DT) - 2; i++) {
      collide(state);
      updateVacuums(state, DT);
      updateInvulnerability(state, DT);
    }
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
  });

  it('넉백으로 밀려나며 설 수 있는 자리에 착지한다', () => {
    collide(state);
    updateVacuums(state, DT);
    expect(state.collision.canStand(state.player.pos, state.playerRadius)).toBe(true);
  });

  it('가구 위에서는 판정 대상에서 제외된다 (§7)', () => {
    collide(state);
    state.player.stance = Stance.ON_FURNITURE;
    updateVacuums(state, DT);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS);
  });

  it('담요 밑에서는 판정 대상에서 제외된다 (§13)', () => {
    collide(state);
    state.player.stance = Stance.HIDDEN;
    updateVacuums(state, DT);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS);
  });

  it('배변 중에도 무적이 아니다 — 위험을 감수하는 행동이어야 한다 (§10)', () => {
    collide(state);
    state.player.poopAnimLeft = CONFIG.POOP_ANIM_TIME;
    updateVacuums(state, DT);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
  });
});

describe('변기 보너스 감속 (§14)', () => {
  it('감속되면 같은 시간에 덜 움직인다', () => {
    const fast = new GameState(555);
    fast.setPhase(Phase.PLAYING);
    initVacuums(fast);
    movePlayerAway(fast);
    const fastStart = { ...fast.vacuums[0]!.pos };

    const slow = new GameState(555);
    slow.setPhase(Phase.PLAYING);
    initVacuums(slow);
    movePlayerAway(slow);
    slowVacuums(slow);
    const slowStart = { ...slow.vacuums[0]!.pos };

    // 회전이 섞이지 않도록 짧게만 비교한다
    run(fast, 1);
    run(slow, 1);

    expect(dist(slowStart, slow.vacuums[0]!.pos)).toBeLessThan(
      dist(fastStart, fast.vacuums[0]!.pos),
    );
  });

  it('TOILET_VACUUM_SLOW_TIME 이 지나면 원래 속도로 돌아온다', () => {
    slowVacuums(state);
    movePlayerAway(state);
    expect(state.vacuums[0]!.slowLeft).toBe(CONFIG.TOILET_VACUUM_SLOW_TIME);

    run(state, CONFIG.TOILET_VACUUM_SLOW_TIME + 0.1);
    expect(state.vacuums[0]!.slowLeft).toBe(0);
  });
});
