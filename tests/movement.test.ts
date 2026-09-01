import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { Phase, Stance } from '../src/core/types.ts';
import {
  angleDelta,
  updateMovement,
  updateRun,
  wrapAngle,
  type MoveInput,
} from '../src/systems/MovementSystem.ts';
import { updatePoop } from '../src/systems/PoopSystem.ts';

const DT = CONFIG.FIXED_DT;
const input = (forward: number, turn = 0, run = false): MoveInput => ({ forward, turn, run });

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
  // x = −2 는 남북으로 길게 비어 있는 통로다 (소파는 −2.5 서쪽, 수납장은 z 5.1 북쪽).
  // 앞뒤로 3 units 넘게 밀어도 가구에 걸리지 않아야 속도를 잴 수 있다.
  state.player.pos = { x: -2, z: -0.5 };
});

describe('탱크 조작 이동 (§25)', () => {
  it('1초 전진하면 MOVE_SPEED 만큼 이동한다', () => {
    // facing 0 = +z. 이 방향으로 6 units 를 가도 방(z ≤ 6) 안이다.
    const startZ = state.player.pos.z;
    step(state, input(1), 60);
    expect(state.player.pos.z - startZ).toBeCloseTo(CONFIG.MOVE_SPEED, 1);
  });

  it('시선 방향으로 간다 — facing 을 돌려 두면 그쪽으로 이동한다', () => {
    state.player.facing = Math.PI / 2; // +x
    const start = { ...state.player.pos };
    step(state, input(1), 30);

    expect(state.player.pos.x - start.x).toBeCloseTo(CONFIG.MOVE_SPEED / 2, 1);
    expect(state.player.pos.z).toBeCloseTo(start.z, 5);
  });

  it('후진은 BACK_MULTIPLIER 만큼 느리고, 시선은 그대로다', () => {
    const forward = new GameState(1);
    forward.setPhase(Phase.PLAYING);
    forward.player.pos = { x: -2, z: -3 };
    const fwd = step(forward, input(1), 30);

    const back = new GameState(1);
    back.setPhase(Phase.PLAYING);
    back.player.pos = { x: -2, z: 3 };
    const bwd = step(back, input(-1), 30);

    expect(bwd / fwd).toBeCloseTo(CONFIG.BACK_MULTIPLIER, 2);
    // 뒤로 갔지 뒤를 돌아본 게 아니다 — 1인칭에서 이 둘은 완전히 다르다.
    expect(back.player.facing).toBe(0);
    expect(back.player.pos.z).toBeLessThan(3);
  });

  it('입력이 없으면 움직이지도 돌지도 않는다', () => {
    const before = { ...state.player.pos };
    step(state, input(0, 0), 30);
    expect(state.player.pos).toEqual(before);
    expect(state.player.facing).toBe(0);
  });
});

describe('선회 (§25)', () => {
  it('1초 선회하면 TURN_SPEED 만큼 돈다', () => {
    step(state, input(0, 1), 60);
    // 3.6 rad > π 라 한 바퀴를 넘어 접힌다 — 접힌 값과 비교해야 한다.
    // 우회전은 facing 을 **줄인다**. 부호는 아래 테스트가 따로 지킨다.
    expect(state.player.facing).toBeCloseTo(wrapAngle(-CONFIG.TURN_SPEED), 4);
  });

  /**
   * 화면에서 D 가 왼쪽으로 돌던 버그를 막는다.
   *
   * `facing` 은 atan2(x, z) 라 값이 커지면 시선이 +z → +x 로 가는데, 카메라의
   * 화면 오른쪽 축은 월드 (−cos f, sin f) 다. 즉 **facing 이 커지면 화면은
   * 왼쪽으로 돈다.** 그대로 더하면 D 가 좌회전이 된다 — 실제로 그렇게 나갔다.
   * 화면 기준 확인은 `gecko-facing.test.ts` 가 카메라로 한 번 더 한다.
   */
  it('우회전(+1)은 facing 을 줄이고 좌회전(−1)은 키운다', () => {
    const right = new GameState(1);
    right.setPhase(Phase.PLAYING);
    step(right, input(0, 1), 10);

    const left = new GameState(1);
    left.setPhase(Phase.PLAYING);
    step(left, input(0, -1), 10);

    expect(right.player.facing, 'D 가 좌회전이 됐다').toBeLessThan(0);
    expect(left.player.facing).toBeCloseTo(-right.player.facing, 6);
  });

  /**
   * 각도를 접지 않으면 오래 한쪽으로 돌 때 facing 이 무한히 커진다.
   * 그 자체로는 sin/cos 가 받아 주지만, 카메라의 최단호 보간과 미니맵 화살표가
   * "지금 각도" 를 그대로 쓰기 때문에 값이 커질수록 정밀도가 떨어진다.
   */
  it('한 방향으로 계속 돌아도 facing 이 (-π, π] 안에 머문다', () => {
    step(state, input(0, 1), 60 * 20); // 20초 = 약 11.5바퀴
    expect(state.player.facing).toBeGreaterThan(-Math.PI);
    expect(state.player.facing).toBeLessThanOrEqual(Math.PI);
  });

  it('좌우 동시 입력은 상쇄된다', () => {
    // InputManager 가 Math.sign 으로 합치므로 여기에는 0 이 들어온다.
    step(state, input(0, 0), 30);
    expect(state.player.facing).toBe(0);
  });

  it('돌면서 전진하면 곡선을 그린다 — 직진보다 덜 나아간다', () => {
    const straight = new GameState(1);
    straight.setPhase(Phase.PLAYING);
    straight.player.pos = { x: -2, z: -4 };
    step(straight, input(1, 0), 40);
    const straightGain = straight.player.pos.z - -4;

    const curving = new GameState(1);
    curving.setPhase(Phase.PLAYING);
    curving.player.pos = { x: -2, z: -4 };
    step(curving, input(1, 1), 40);
    const curveGain = curving.player.pos.z - -4;

    expect(curveGain).toBeLessThan(straightGain);
    // +z 를 보고 있을 때 화면 오른쪽은 월드 −x 다.
    expect(curving.player.pos.x, '오른쪽으로 휘지 않았다').toBeLessThan(-2);
  });
});

describe('각도 도우미', () => {
  it('wrapAngle 은 (-π, π] 로 접는다', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(-Math.PI), '−π 와 +π 는 같은 방향이다 — atan2 처럼 +π 로 모은다')
      .toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 6);
  });

  it('angleDelta 는 최단 호로 돈다 — 358도를 돌지 않는다', () => {
    const almostPi = Math.PI - 0.05;
    const delta = angleDelta(almostPi, -almostPi);
    expect(Math.abs(delta)).toBeLessThan(0.2);
  });
});

describe('벽·가구 충돌', () => {
  it('벽을 통과하지 못한다', () => {
    state.player.facing = Math.PI / 2; // +x
    step(state, input(1), 60 * 10); // 10초간 오른쪽으로 밀어붙인다
    expect(state.player.pos.x).toBeLessThanOrEqual(DERIVED.ROOM_W / 2);
    expect(state.collision.canStand(state.player.pos, state.playerRadius)).toBe(true);
  });

  it('어느 방향으로 오래 밀어붙여도 항상 설 수 있는 위치에 있다', () => {
    for (let i = 0; i < 8; i++) {
      const facing = (i * Math.PI) / 4;
      const s = new GameState(7);
      s.setPhase(Phase.PLAYING);
      s.player.pos = { x: -2, z: -0.5 };
      s.player.facing = facing;
      step(s, input(1), 60 * 8);
      expect(
        s.collision.canStand(s.player.pos, s.playerRadius),
        `시선 ${facing.toFixed(2)} → (${s.player.pos.x.toFixed(2)}, ${s.player.pos.z.toFixed(2)})`,
      ).toBe(true);
    }
  });

  it('벽에 비스듬히 부딪혀도 시선은 흔들리지 않는다', () => {
    // 동쪽 벽을 향해 비스듬히 밀어붙인다.
    state.player.facing = Math.PI / 3;
    step(state, input(1), 60 * 5);
    expect(state.player.facing).toBeCloseTo(Math.PI / 3, 6);
  });
});

describe('이동 차단 상태', () => {
  it('PLAYING 이 아니면 움직이지 않는다', () => {
    state.setPhase(Phase.PAUSED);
    const before = { ...state.player.pos };
    step(state, input(1), 30);
    expect(state.player.pos).toEqual(before);
  });

  /**
   * 무방비 시간에는 **선회도** 막힌다. (§25)
   *
   * 1인칭에서 이건 밸런스 결정이다. 힘주는 1초 동안 주위를 둘러볼 수 있으면
   * 청소기가 어디서 오는지 보이고, "무방비" 라는 대가가 절반으로 줄어든다.
   */
  it('배변 중에는 이동도 선회도 막히고, 타이머가 끝나면 둘 다 풀린다', () => {
    state.player.poopAnimLeft = CONFIG.POOP_ANIM_TIME;
    const before = { ...state.player.pos };

    for (let i = 0; i < 30; i++) {
      updateMovement(state, input(1, 1), DT);
      updatePoop(state, DT);
    }
    expect(state.player.pos).toEqual(before); // 0.5초 — 아직 배변 중
    expect(state.player.facing, '배변 중에 시선이 돌아갔다').toBe(0);
    expect(state.player.poopAnimLeft).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) {
      updateMovement(state, input(1, 1), DT);
      updatePoop(state, DT);
    }
    expect(state.player.poopAnimLeft).toBe(0);
    expect(state.player.facing).not.toBe(0);
  });

  it('담요 밑에 숨어 있으면 움직이지 못한다', () => {
    state.player.stance = Stance.HIDDEN;
    const before = { ...state.player.pos };
    step(state, input(1, 1), 30);
    expect(state.player.pos).toEqual(before);
    expect(state.player.facing).toBe(0);
  });
});

describe('짧은 달리기 (§7)', () => {
  it('Shift 를 누르면 RUN_MULTIPLIER 만큼 빨라진다', () => {
    const walk = step(state, input(1), 30);

    const runner = new GameState(1);
    runner.setPhase(Phase.PLAYING);
    runner.player.pos = { x: -2, z: -3 };
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
    step(state, input(0), 30); // 0.5초간 정지
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
