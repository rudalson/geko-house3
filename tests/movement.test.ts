import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { Phase, Stance } from '../src/core/types.ts';
import { updateMovement, updateRun, type MoveInput } from '../src/systems/MovementSystem.ts';

const DT = CONFIG.FIXED_DT;
const input = (x: number, z: number, run = false): MoveInput => ({ x, z, run });

/** n 스텝 동안 같은 입력을 유지한다. */
function step(state: GameState, i: MoveInput, steps: number): number {
  let moved = 0;
  for (let k = 0; k < steps; k++) moved += updateMovement(state, i, DT);
  return moved;
}

let state: GameState;
beforeEach(() => {
  state = new GameState(1234);
  state.setPhase(Phase.PLAYING);
  // 방 한복판의 빈 공간 (가구 없음)
  state.player.pos = { x: 0, z: -0.5 };
});

describe('8방향 이동', () => {
  it('1초 동안 MOVE_SPEED 만큼 이동한다', () => {
    const startX = state.player.pos.x;
    step(state, input(1, 0), 60);
    expect(state.player.pos.x - startX).toBeCloseTo(CONFIG.MOVE_SPEED, 1);
  });

  it('대각선이 직선보다 빠르지 않다 — 입력을 정규화한다', () => {
    const straight = new GameState(1);
    straight.setPhase(Phase.PLAYING);
    straight.player.pos = { x: 0, z: -0.5 };
    const straightDist = step(straight, input(1, 0), 30);

    const diagonal = new GameState(1);
    diagonal.setPhase(Phase.PLAYING);
    diagonal.player.pos = { x: 0, z: -0.5 };
    const diagDist = step(diagonal, input(1, 1), 30);

    expect(diagDist).toBeCloseTo(straightDist, 5);
  });

  it('입력이 없으면 움직이지 않는다', () => {
    const before = { ...state.player.pos };
    step(state, input(0, 0), 30);
    expect(state.player.pos).toEqual(before);
  });

  it('입력 방향을 바라본다', () => {
    step(state, input(1, 0), 1);
    expect(state.player.facing).toBeCloseTo(Math.PI / 2, 5); // +x
    step(state, input(0, -1), 1);
    expect(state.player.facing).toBeCloseTo(Math.PI, 5); // -z
  });

  it('벽을 통과하지 못한다', () => {
    step(state, input(1, 0), 60 * 10); // 10초간 오른쪽으로 밀어붙인다
    expect(state.player.pos.x).toBeLessThanOrEqual(DERIVED.ROOM_W / 2);
    expect(state.collision.canStand(state.player.pos, state.playerRadius)).toBe(true);
  });

  it('어느 방향으로 오래 밀어붙여도 항상 설 수 있는 위치에 있다', () => {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      const s = new GameState(7);
      s.setPhase(Phase.PLAYING);
      s.player.pos = { x: 0, z: -0.5 };
      step(s, input(dx!, dz!), 60 * 8);
      expect(
        s.collision.canStand(s.player.pos, s.playerRadius),
        `방향 (${dx}, ${dz}) → (${s.player.pos.x.toFixed(2)}, ${s.player.pos.z.toFixed(2)})`,
      ).toBe(true);
    }
  });
});

describe('이동 차단 상태', () => {
  it('PLAYING 이 아니면 움직이지 않는다', () => {
    state.setPhase(Phase.PAUSED);
    const before = { ...state.player.pos };
    step(state, input(1, 0), 30);
    expect(state.player.pos).toEqual(before);
  });

  it('배변 중에는 움직이지 못하고, 타이머가 끝나면 다시 움직인다', () => {
    state.player.poopAnimLeft = CONFIG.POOP_ANIM_TIME;
    const before = { ...state.player.pos };

    step(state, input(1, 0), 30); // 0.5초 — 아직 배변 중
    expect(state.player.pos).toEqual(before);
    expect(state.player.poopAnimLeft).toBeGreaterThan(0);

    step(state, input(1, 0), 60); // 애니메이션 종료 후
    expect(state.player.poopAnimLeft).toBe(0);
    expect(state.player.pos.x).toBeGreaterThan(before.x);
  });

  it('담요 밑에 숨어 있으면 움직이지 못한다', () => {
    state.player.stance = Stance.HIDDEN;
    const before = { ...state.player.pos };
    step(state, input(1, 0), 30);
    expect(state.player.pos).toEqual(before);
  });
});

describe('짧은 달리기 (§7)', () => {
  it('Shift 를 누르면 RUN_MULTIPLIER 만큼 빨라진다', () => {
    const walk = step(state, input(1, 0), 30);

    const runner = new GameState(1);
    runner.setPhase(Phase.PLAYING);
    runner.player.pos = { x: -3, z: -0.5 };
    const run = step(runner, input(1, 0, true), 30);

    expect(run / walk).toBeCloseTo(CONFIG.RUN_MULTIPLIER, 1);
  });

  it('RUN_DURATION 이 지나면 자동으로 끝나고 쿨다운이 시작된다', () => {
    // 첫 호출은 달리기를 시작하기만 하고 시간을 소비하지 않는다.
    expect(updateRun(state, true, DT)).toBe(true);
    expect(state.player.runLeft).toBeCloseTo(CONFIG.RUN_DURATION, 5);

    const steps = Math.round(CONFIG.RUN_DURATION / DT);
    for (let i = 0; i < steps; i++) updateRun(state, true, DT);

    expect(state.player.runLeft).toBe(0);
    expect(state.player.runCooldownLeft).toBeCloseTo(CONFIG.RUN_COOLDOWN, 5);
  });

  it('쿨다운 중에는 다시 달릴 수 없다', () => {
    state.player.runCooldownLeft = CONFIG.RUN_COOLDOWN;
    expect(updateRun(state, true, DT)).toBe(false);
    expect(state.player.runLeft).toBe(0);
  });

  it('쿨다운이 끝나면 다시 달릴 수 있다', () => {
    state.player.runCooldownLeft = CONFIG.RUN_COOLDOWN;
    const steps = Math.ceil(CONFIG.RUN_COOLDOWN / DT);
    for (let i = 0; i < steps; i++) updateRun(state, false, DT);
    expect(state.player.runCooldownLeft).toBe(0);
    expect(updateRun(state, true, DT)).toBe(true);
  });

  it('쿨다운은 가만히 있어도 회복된다 — 이동 입력과 무관하다', () => {
    state.player.runCooldownLeft = 1.0;
    step(state, input(0, 0), 30); // 0.5초간 정지
    expect(state.player.runCooldownLeft).toBeCloseTo(0.5, 2);
  });
});

describe('레벨 성장에 따른 이동·히트박스 (§9-4)', () => {
  it('Lvl 3 는 이동 속도가 10% 빠르다', () => {
    const base = state.moveSpeed;
    state.player.levelIndex = 2;
    expect(state.moveSpeed / base).toBeCloseTo(1.1, 5);
  });

  it('성장하면 히트박스가 커진다 — 넓게 싸는 대가', () => {
    const r1 = state.playerRadius;
    state.player.levelIndex = 2;
    expect(state.playerRadius).toBeGreaterThan(r1);
    expect(state.playerRadius / r1).toBeCloseTo(CONFIG.LEVEL_HITBOX_MUL[2]!, 5);
  });

  it('먹은 음식 수에서 Age 와 Lvl 이 파생된다', () => {
    state.player.foodsEaten = CONFIG.FOOD_PER_AGE * 4; // Age 4 → Lvl 2
    expect(state.refreshGrowth()).toBe(true);
    expect(state.player.age).toBe(4);
    expect(state.player.levelIndex).toBe(1);

    expect(state.refreshGrowth()).toBe(false); // 변화 없으면 false
  });
});
