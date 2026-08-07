import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { Cell, Phase, Stance, dist } from '../src/core/types.ts';
import { findFurniture, climbableFurniture } from '../src/world/furnitureLayout.ts';
import {
  BATHROOM_BOUNDS,
  BATHROOM_EXIT,
  LIVING_DOOR,
  TOILET_POS,
  insideBathroom,
} from '../src/world/bathroomLayout.ts';
import {
  CLIMB_TIME,
  TRANSITION_TIME,
  blanketTimeLeft,
  climbDown,
  climbOnto,
  enterBathroom,
  exitBathroom,
  hideUnderBlanket,
  leaveBlanket,
  startToilet,
  updateBlanket,
  updateShelterTimers,
  updateToilet,
} from '../src/systems/ShelterSystem.ts';
import { checkPoop, startPoop } from '../src/systems/PoopSystem.ts';
import { updateMovement } from '../src/systems/MovementSystem.ts';
import { executeInteraction, findInteraction } from '../src/systems/InteractionSystem.ts';
import { applyPoop } from '../src/systems/TerritorySystem.ts';
import { initVacuums, updateVacuums } from '../src/systems/VacuumSystem.ts';
import { updateHunger } from '../src/systems/HungerSystem.ts';

const DT = CONFIG.FIXED_DT;
const BLANKET = findFurniture('blanket')!;

let state: GameState;
beforeEach(() => {
  state = new GameState(555);
  state.setPhase(Phase.PLAYING);
  state.player.pos = { x: 0, z: -0.5 };
});

function run(s: GameState, seconds: number, bus?: EventBus): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    updateToilet(s, DT, bus);
    updateBlanket(s, DT, bus);
    updateShelterTimers(s, DT);
    updateHunger(s, DT, bus);
  }
}

const move = (s: GameState, x: number, z: number, seconds: number): void => {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) updateMovement(s, { x, z, run: false }, DT);
};

describe('담요 은신 (§13)', () => {
  it('숨으면 담요 중앙으로 이동하고 이동·배변이 막힌다', () => {
    hideUnderBlanket(state, BLANKET);

    expect(state.player.stance).toBe(Stance.HIDDEN);
    expect(state.player.pos).toEqual({ x: BLANKET.x, z: BLANKET.z });
    expect(state.canMove).toBe(false);
    expect(checkPoop(state)).toBe('hidden');
  });

  it('숨은 동안에도 배고픔은 계속 줄어든다 — 농성을 막는 유일한 압박', () => {
    hideUnderBlanket(state, BLANKET);
    const before = state.player.hunger;
    run(state, 4);
    expect(state.player.hunger).toBeCloseTo(before - CONFIG.HUNGER_DRAIN * 4, 1);
  });

  it('청소기 판정 대상에서 제외된다', () => {
    initVacuums(state);
    hideUnderBlanket(state, BLANKET);
    state.vacuums[0]!.pos = { ...state.player.pos };

    updateVacuums(state, DT);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS);
  });

  it('BLANKET_WARN_TIME 뒤에 경고가 나온다', () => {
    const bus = new EventBus();
    let warned = 0;
    bus.on('blanket:warn', () => warned++);

    hideUnderBlanket(state, BLANKET);
    run(state, CONFIG.BLANKET_WARN_TIME - 0.2, bus);
    expect(warned).toBe(0);

    run(state, 0.4, bus);
    expect(warned).toBe(1);

    // 경고는 한 번만
    run(state, 1, bus);
    expect(warned).toBe(1);
  });

  it('경고 후 BLANKET_DOG_TIME 안에 안 나오면 강아지가 온다 — 하트 -1 + 밖으로', () => {
    const bus = new EventBus();
    let dog = 0;
    bus.on('blanket:dog', () => dog++);

    hideUnderBlanket(state, BLANKET);
    run(state, CONFIG.BLANKET_WARN_TIME + CONFIG.BLANKET_DOG_TIME - 0.2, bus);
    expect(dog).toBe(0);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS);

    run(state, 0.4, bus);
    expect(dog).toBe(1);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
    expect(state.player.stance).toBe(Stance.GROUND);
    expect(state.isInvulnerable).toBe(true);
    expect(state.collision.canStand(state.player.pos, state.playerRadius)).toBe(true);
  });

  it('제때 나오면 아무 일도 없고 타이머가 초기화된다', () => {
    hideUnderBlanket(state, BLANKET);
    run(state, CONFIG.BLANKET_WARN_TIME + 1);
    leaveBlanket(state);

    expect(state.player.stance).toBe(Stance.GROUND);
    expect(state.player.hiddenFor).toBe(0);
    expect(state.player.blanketWarned).toBe(false);

    // 다시 숨어도 카운트가 처음부터
    hideUnderBlanket(state, BLANKET);
    expect(blanketTimeLeft(state)).toBeCloseTo(
      CONFIG.BLANKET_WARN_TIME + CONFIG.BLANKET_DOG_TIME,
      5,
    );
  });

  it('숨어 있을 때 상호작용 안내는 "나가기" 하나뿐이다', () => {
    hideUnderBlanket(state, BLANKET);
    const i = findInteraction(state);
    expect(i?.kind).toBe('blanket-leave');
  });
});

describe('가구 등반 (§7)', () => {
  const table = findFurniture('coffee-table')!;

  it('올라가면 청소기 판정에서 빠지고 배변이 막힌다', () => {
    initVacuums(state);
    climbOnto(state, table);

    expect(state.player.stance).toBe(Stance.ON_FURNITURE);
    expect(state.player.climbedOn).toBe(table.id);
    expect(checkPoop(state)).toBe('on-furniture');

    state.vacuums[0]!.pos = { ...state.player.pos };
    updateVacuums(state, DT);
    expect(state.player.hearts).toBe(CONFIG.MAX_HEARTS);
  });

  it('가구 위에서는 상판 밖으로 나가지 못한다', () => {
    climbOnto(state, table);
    run(state, CLIMB_TIME + 0.1); // 보간 종료

    move(state, 1, 0, 3); // 오른쪽으로 계속
    expect(state.player.pos.x).toBeLessThanOrEqual(table.x + table.w / 2);

    move(state, 0, 1, 3);
    expect(state.player.pos.z).toBeLessThanOrEqual(table.z + table.d / 2);
  });

  it('올라가는 동안에는 움직일 수 없다', () => {
    climbOnto(state, table);
    expect(state.canMove).toBe(false);
    run(state, CLIMB_TIME + 0.1);
    expect(state.canMove).toBe(true);
  });

  it('내려오면 설 수 있는 자리에 착지한다', () => {
    climbOnto(state, table);
    run(state, CLIMB_TIME + 0.1);
    climbDown(state);

    expect(state.player.stance).toBe(Stance.GROUND);
    expect(state.player.climbedOn).toBeNull();
    expect(state.collision.canStand(state.player.pos, state.playerRadius)).toBe(true);
  });

  it('등반 가능한 모든 가구에서 올라갔다 내려올 수 있다', () => {
    for (const f of climbableFurniture()) {
      const s = new GameState(1);
      s.setPhase(Phase.PLAYING);
      climbOnto(s, f);
      for (let i = 0; i < Math.ceil(CLIMB_TIME / DT) + 2; i++) updateShelterTimers(s, DT);
      climbDown(s);
      expect(s.collision.canStand(s.player.pos, s.playerRadius), f.id).toBe(true);
    }
  });

  it('가구 위에서 상호작용 안내는 "내려가기" 하나뿐이다', () => {
    climbOnto(state, table);
    run(state, CLIMB_TIME + 0.1);
    expect(findInteraction(state)?.kind).toBe('climb-down');
  });
});

describe('화장실과 변기 (§6, §14)', () => {
  it('화장실로 들어가면 좌표가 옮겨지고 페이드 동안 이동 불가', () => {
    enterBathroom(state);

    expect(state.player.stance).toBe(Stance.BATHROOM);
    expect(insideBathroom(state.player.pos, state.playerRadius)).toBe(true);
    expect(state.canMove).toBe(false);

    run(state, TRANSITION_TIME + 0.05);
    expect(state.canMove).toBe(true);
  });

  it('화장실 안에서는 경계 밖으로 나가지 못한다', () => {
    enterBathroom(state);
    run(state, TRANSITION_TIME + 0.05);

    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      move(state, dx!, dz!, 4);
      expect(
        insideBathroom(state.player.pos, state.playerRadius),
        `(${dx},${dz}) → (${state.player.pos.x.toFixed(2)}, ${state.player.pos.z.toFixed(2)})`,
      ).toBe(true);
    }
  });

  it('화장실에서는 Space 배변이 막힌다 — 변기로만 가능', () => {
    enterBathroom(state);
    state.player.poop = CONFIG.POOP_MAX;
    expect(startPoop(state)).toBe('bathroom');
  });

  it('게이지가 가득 차야 변기를 쓸 수 있다', () => {
    enterBathroom(state);
    run(state, TRANSITION_TIME + 0.05);
    state.player.pos = { ...TOILET_POS };

    expect(startToilet(state)).toBe(false);

    state.player.poop = CONFIG.POOP_MAX;
    expect(startToilet(state)).toBe(true);
    expect(state.canMove).toBe(false);
  });

  it('변기 보너스가 유효 셀의 TOILET_BONUS_RATIO 만큼 확장된다', () => {
    const bus = new EventBus();
    let gained = 0;
    bus.on('toilet:done', (p) => (gained = p.gainedCells));

    applyPoop(state, { x: 0, z: 0 }, 2.3); // 씨앗 영역
    const before = state.ownedCells;

    enterBathroom(state);
    run(state, TRANSITION_TIME + 0.05); // 페이드 중에는 변기를 쓸 수 없다
    state.player.poop = CONFIG.POOP_MAX;
    expect(startToilet(state)).toBe(true);
    run(state, CONFIG.TOILET_ANIM_TIME + 0.1, bus);

    const expected = Math.round(state.effectiveCells * CONFIG.TOILET_BONUS_RATIO);
    expect(gained).toBe(expected);
    expect(state.ownedCells).toBe(before + expected);
    expect(state.player.poop).toBe(0);
  });

  it('변기 보너스는 덩어리로 붙는다 — 고립 셀을 만들지 않는다', () => {
    applyPoop(state, { x: 0, z: 0 }, 2.3);
    enterBathroom(state);
    run(state, TRANSITION_TIME + 0.05); // 페이드 중에는 변기를 쓸 수 없다
    state.player.poop = CONFIG.POOP_MAX;
    expect(startToilet(state)).toBe(true);
    run(state, CONFIG.TOILET_ANIM_TIME + 0.1);

    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] !== Cell.POOP_TERRITORY) continue;
      const cx = i % CONFIG.GRID_W;
      const cz = Math.floor(i / CONFIG.GRID_W);
      const adj = [
        cx > 0 ? i - 1 : -1,
        cx < CONFIG.GRID_W - 1 ? i + 1 : -1,
        cz > 0 ? i - CONFIG.GRID_W : -1,
        cz < CONFIG.GRID_H - 1 ? i + CONFIG.GRID_W : -1,
      ].filter((n) => n >= 0);
      expect(
        adj.some((n) => state.grid[n] === Cell.POOP_TERRITORY),
        `셀 ${i} 가 고립됐다`,
      ).toBe(true);
    }
  });

  it('변기를 쓰면 청소기가 감속한다', () => {
    initVacuums(state);
    enterBathroom(state);
    run(state, TRANSITION_TIME + 0.05); // 페이드 중에는 변기를 쓸 수 없다
    state.player.poop = CONFIG.POOP_MAX;
    expect(startToilet(state)).toBe(true);
    run(state, CONFIG.TOILET_ANIM_TIME + 0.1);

    expect(state.vacuums[0]!.slowLeft).toBe(CONFIG.TOILET_VACUUM_SLOW_TIME);
  });

  it('화장실에 있는 동안에도 거실 청소기는 계속 돈다 — 이게 왕복의 리스크다', () => {
    initVacuums(state);
    applyPoop(state, state.vacuums[0]!.pos, 3);
    const before = state.ownedCells;

    enterBathroom(state);
    for (let i = 0; i < Math.round(4 / DT); i++) {
      updateVacuums(state, DT);
      updateShelterTimers(state, DT);
    }

    expect(state.ownedCells, '화장실에 있는 동안 영역이 그대로다').toBeLessThan(before);
  });

  it('거실로 돌아오면 문 앞에 서고 설 수 있는 자리다', () => {
    enterBathroom(state);
    run(state, TRANSITION_TIME + 0.05);
    exitBathroom(state);

    expect(state.player.stance).toBe(Stance.GROUND);
    expect(dist(state.player.pos, LIVING_DOOR)).toBeLessThan(1.5);
    expect(state.collision.canStand(state.player.pos, state.playerRadius)).toBe(true);
  });

  it('화장실 좌표는 거실 격자 밖이다 — 달성률 분모에 들어가지 않는다', () => {
    enterBathroom(state);
    expect(state.collision.cellIndexAt(state.player.pos)).toBe(-1);
    expect(BATHROOM_BOUNDS.maxZ).toBeLessThan(-6); // 거실 북쪽 벽 밖
  });

  it('변기와 출구 중 가까운 쪽만 안내된다', () => {
    enterBathroom(state);
    run(state, TRANSITION_TIME + 0.05);

    state.player.pos = { ...TOILET_POS };
    expect(findInteraction(state)?.kind).toBe('toilet');

    state.player.pos = { ...BATHROOM_EXIT };
    expect(findInteraction(state)?.kind).toBe('bathroom-exit');
  });
});

describe('상호작용 통합 (§7 — 가장 가까운 하나만)', () => {
  it('문 앞에서 E 를 누르면 화장실로 간다', () => {
    state.player.pos = { ...LIVING_DOOR };
    expect(executeInteraction(state)).toBe(true);
    expect(state.player.stance).toBe(Stance.BATHROOM);
  });

  it('담요 위에서 E 를 누르면 숨는다', () => {
    state.player.pos = { x: BLANKET.x, z: BLANKET.z };
    expect(executeInteraction(state)).toBe(true);
    expect(state.player.stance).toBe(Stance.HIDDEN);
  });

  it('등반 가능한 가구 옆에서 E 를 누르면 올라간다', () => {
    const table = findFurniture('coffee-table')!;
    state.player.pos = { x: table.x, z: table.z + table.d / 2 + 0.4 };
    const i = findInteraction(state);
    expect(i?.kind).toBe('climb-up');

    expect(executeInteraction(state)).toBe(true);
    expect(state.player.stance).toBe(Stance.ON_FURNITURE);
  });

  it('아무것도 없는 곳에서는 안내가 없다', () => {
    // 가구·문·음식에서 모두 떨어진 자리
    state.player.pos = { x: -1.5, z: -1.0 };
    for (const f of state.foods) f.active = false;
    expect(findInteraction(state)).toBeNull();
    expect(executeInteraction(state)).toBe(false);
  });
});
