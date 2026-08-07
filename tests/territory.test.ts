import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { Cell, Phase, Stance } from '../src/core/types.ts';
import {
  applyPoop,
  cellCenter,
  eraseCircle,
  expandFromTerritory,
  recountOwned,
} from '../src/systems/TerritorySystem.ts';
import {
  addPoopGauge,
  checkPoop,
  hasSignal,
  startPoop,
  updatePoop,
} from '../src/systems/PoopSystem.ts';

const DT = CONFIG.FIXED_DT;

let state: GameState;
beforeEach(() => {
  state = new GameState(42);
  state.setPhase(Phase.PLAYING);
  state.player.pos = { x: 0, z: -0.5 };
});

/** 배변 애니메이션이 끝날 때까지 스텝을 돌린다. */
function finishPoop(s: GameState, bus?: EventBus): void {
  const steps = Math.ceil(CONFIG.POOP_ANIM_TIME / DT) + 2;
  for (let i = 0; i < steps; i++) updatePoop(s, DT, bus);
}

describe('달성률 계산 (§10)', () => {
  it('BLOCKED 셀이 분모에서 제외된다', () => {
    expect(state.effectiveCells).toBe(state.collision.effectiveCells);
    expect(state.effectiveCells).toBeLessThan(DERIVED.TOTAL_CELLS);
    expect(state.effectiveCells + state.collision.blockedCells).toBe(DERIVED.TOTAL_CELLS);
  });

  it('시작 시 달성률은 0 이다', () => {
    expect(state.ownedCells).toBe(0);
    expect(state.territoryRatio).toBe(0);
  });

  it('점유 수를 증분 갱신한 값이 전체 순회 결과와 일치한다', () => {
    applyPoop(state, { x: 0, z: 0 }, 3);
    applyPoop(state, { x: 2, z: 1 }, 2.5);
    eraseCircle(state, { x: 1, z: 0.5 }, 0.6);
    expect(state.ownedCells).toBe(recountOwned(state));
  });

  it('달성률 = 점유 / 유효 셀', () => {
    const gained = applyPoop(state, { x: 0, z: 0 }, 3);
    expect(state.territoryRatio).toBeCloseTo(gained / state.effectiveCells, 10);
  });

  it('44% 를 넘으면 targetReached 가 true 가 된다', () => {
    expect(state.targetReached).toBe(false);
    // 격자를 직접 채워 임계값을 넘긴다
    let filled = 0;
    const need = Math.ceil(state.effectiveCells * CONFIG.TARGET_RATIO);
    for (let i = 0; i < state.grid.length && filled < need; i++) {
      if (state.grid[i] === Cell.EMPTY) {
        state.grid[i] = Cell.POOP_TERRITORY;
        state.ownedCells++;
        filled++;
      }
    }
    expect(state.targetReached).toBe(true);
  });
});

describe('배변 영역 전환 (§10)', () => {
  it('반경 안의 EMPTY 셀이 POOP_TERRITORY 로 바뀐다', () => {
    const gained = applyPoop(state, { x: 0, z: 0 }, 2.3);
    expect(gained).toBeGreaterThan(0);
    expect(state.ownedCells).toBe(gained);
  });

  it('확보 면적이 원 면적에 근사한다 — 밸런스 모델의 A_eff 가정과 맞는지', () => {
    // 가구 없는 자리에서 확보하면 π r² 에 가까워야 한다.
    const r = CONFIG.LEVEL_POOP_RADIUS_CELLS[0]!;
    const gained = applyPoop(state, { x: 0, z: 0.5 }, r);
    const expected = Math.PI * r * r;
    expect(gained).toBeGreaterThan(expected * 0.75);
    expect(gained).toBeLessThan(expected * 1.25);
  });

  it('BLOCKED 셀은 절대 확보되지 않는다', () => {
    // 소파 한복판에서 배변해도 소파 셀은 그대로 BLOCKED
    applyPoop(state, { x: -4.5, z: -5.2 }, 4);
    for (let i = 0; i < state.grid.length; i++) {
      const wasBlocked = state.collision.isBlockedCell(
        i % CONFIG.GRID_W,
        Math.floor(i / CONFIG.GRID_W),
      );
      if (wasBlocked) expect(state.grid[i]).toBe(Cell.BLOCKED);
    }
    expect(state.ownedCells).toBe(recountOwned(state));
  });

  it('이미 확보한 영역에 다시 싸도 중복 계산되지 않는다', () => {
    const first = applyPoop(state, { x: 0, z: 0 }, 2.3);
    const second = applyPoop(state, { x: 0, z: 0 }, 2.3);
    expect(second).toBe(0);
    expect(state.ownedCells).toBe(first);
  });

  it('겹쳐 싸면 새로 확보한 만큼만 증가한다', () => {
    const first = applyPoop(state, { x: 0, z: 0 }, 2.3);
    const second = applyPoop(state, { x: 0.6, z: 0 }, 2.3);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
    expect(state.ownedCells).toBe(first + second);
  });

  it('방 밖 좌표에서도 안전하게 동작한다', () => {
    expect(() => applyPoop(state, { x: 100, z: 100 }, 3)).not.toThrow();
    expect(state.ownedCells).toBe(0);
  });

  it('변경된 셀이 dirtyCells 에 기록된다 — 렌더러가 소비할 목록', () => {
    const gained = applyPoop(state, { x: 0, z: 0 }, 2.3);
    expect(state.dirtyCells).toHaveLength(gained);
  });
});

describe('청소기 제거 (§12)', () => {
  it('POOP_TERRITORY 가 EMPTY 로 돌아가고 달성률이 감소한다', () => {
    applyPoop(state, { x: 0, z: 0 }, 3);
    const before = state.ownedCells;

    const erased = eraseCircle(state, { x: 0, z: 0 }, CONFIG.CELL_SIZE * 1.2);
    expect(erased).toBeGreaterThan(0);
    expect(state.ownedCells).toBe(before - erased);
    expect(state.ownedCells).toBe(recountOwned(state));
  });

  it('빈 바닥을 지나가도 아무 일이 없다', () => {
    expect(eraseCircle(state, { x: 3, z: 2 }, 1)).toBe(0);
    expect(state.ownedCells).toBe(0);
  });

  it('BLOCKED 셀을 EMPTY 로 바꾸지 않는다', () => {
    const blockedBefore = state.collision.blockedCells;
    eraseCircle(state, { x: -4.5, z: -5.2 }, 3);
    let blocked = 0;
    for (const v of state.grid) if (v === Cell.BLOCKED) blocked++;
    expect(blocked).toBe(blockedBefore);
  });
});

describe('똥 게이지 (§9-3)', () => {
  it('충전되고, 상한 초과분은 버려진다', () => {
    addPoopGauge(state, CONFIG.POOP_PER_FOOD);
    expect(state.player.poop).toBe(CONFIG.POOP_PER_FOOD);

    addPoopGauge(state, CONFIG.POOP_PER_FOOD);
    addPoopGauge(state, CONFIG.POOP_PER_FOOD);
    expect(state.player.poop).toBe(CONFIG.POOP_MAX);

    // 가득 찬 상태에서 더 먹으면 반영되는 양이 0 — 손해라는 뜻
    expect(addPoopGauge(state, CONFIG.POOP_PER_FOOD)).toBe(0);
    expect(state.player.poop).toBe(CONFIG.POOP_MAX);
  });

  it('음식 3개로 정확히 가득 찬다', () => {
    for (let i = 0; i < DERIVED.FOODS_PER_POOP; i++) addPoopGauge(state, CONFIG.POOP_PER_FOOD);
    expect(hasSignal(state)).toBe(true);

    const two = new GameState(1);
    addPoopGauge(two, CONFIG.POOP_PER_FOOD);
    addPoopGauge(two, CONFIG.POOP_PER_FOOD);
    expect(hasSignal(two)).toBe(false);
  });

  it('배변하면 게이지가 0 으로 초기화된다', () => {
    state.player.poop = CONFIG.POOP_MAX;
    startPoop(state);
    finishPoop(state);
    expect(state.player.poop).toBe(0);
  });
});

describe('배변 차단 조건 (§10, §21-1)', () => {
  beforeEach(() => {
    state.player.poop = CONFIG.POOP_MAX;
  });

  it('게이지가 가득 차지 않으면 배변할 수 없다', () => {
    state.player.poop = CONFIG.POOP_MAX - 1;
    expect(checkPoop(state)).toBe('not-full');
    expect(startPoop(state)).toBe('not-full');
    expect(state.player.poopAnimLeft).toBe(0);
  });

  it('가구 위에서는 배변이 차단된다', () => {
    state.player.stance = Stance.ON_FURNITURE;
    expect(startPoop(state)).toBe('on-furniture');
  });

  it('담요 밑에서는 배변이 차단된다', () => {
    state.player.stance = Stance.HIDDEN;
    expect(startPoop(state)).toBe('hidden');
  });

  it('화장실에서는 배변이 차단된다 — 변기 상호작용으로만 가능', () => {
    state.player.stance = Stance.BATHROOM;
    expect(startPoop(state)).toBe('bathroom');
  });

  it('차단되면 게이지를 소모하지 않고 영역도 변하지 않는다', () => {
    state.player.stance = Stance.ON_FURNITURE;
    startPoop(state);
    finishPoop(state);
    expect(state.player.poop).toBe(CONFIG.POOP_MAX);
    expect(state.ownedCells).toBe(0);
  });

  it('배변 중에는 다시 시작할 수 없다', () => {
    expect(startPoop(state)).toBeNull();
    expect(startPoop(state)).toBe('already-pooping');
  });
});

describe('배변 진행 (§10)', () => {
  it('애니메이션이 끝나는 시점에 영역이 확보된다 — 시작 즉시가 아니다', () => {
    state.player.poop = CONFIG.POOP_MAX;
    startPoop(state);

    // 중간에는 아직 확보되지 않는다
    for (let i = 0; i < 10; i++) updatePoop(state, DT);
    expect(state.ownedCells).toBe(0);
    expect(state.player.poopAnimLeft).toBeGreaterThan(0);

    finishPoop(state);
    expect(state.ownedCells).toBeGreaterThan(0);
    expect(state.stats.poops).toBe(1);
  });

  it('배변 중에는 이동할 수 없지만 무적은 아니다', () => {
    state.player.poop = CONFIG.POOP_MAX;
    startPoop(state);
    expect(state.canMove).toBe(false);
    expect(state.isInvulnerable).toBe(false);
  });

  it('레벨이 오르면 더 넓게 확보한다', () => {
    const lvl1 = new GameState(9);
    lvl1.setPhase(Phase.PLAYING);
    lvl1.player.pos = { x: 0, z: 0.5 };
    lvl1.player.poop = CONFIG.POOP_MAX;
    startPoop(lvl1);
    finishPoop(lvl1);

    const lvl3 = new GameState(9);
    lvl3.setPhase(Phase.PLAYING);
    lvl3.player.pos = { x: 0, z: 0.5 };
    lvl3.player.levelIndex = 2;
    lvl3.player.poop = CONFIG.POOP_MAX;
    startPoop(lvl3);
    finishPoop(lvl3);

    expect(lvl3.ownedCells).toBeGreaterThan(lvl1.ownedCells);
  });

  it('완료 시 이벤트가 발행된다', () => {
    const bus = new EventBus();
    let done: { gainedCells: number } | null = null;
    bus.on('poop:done', (p) => (done = p));

    state.player.poop = CONFIG.POOP_MAX;
    startPoop(state, bus);
    finishPoop(state, bus);

    expect(done).not.toBeNull();
    expect(done!.gainedCells).toBe(state.ownedCells);
  });
});

describe('변기 보너스 BFS 확장 (§14)', () => {
  it('기존 영역에 인접한 셀부터 확장한다 — 고립된 셀을 만들지 않는다', () => {
    applyPoop(state, { x: 0, z: 0 }, 2.3);
    const before = state.ownedCells;

    const gained = expandFromTerritory(state, 34);
    expect(gained).toBe(34);
    expect(state.ownedCells).toBe(before + 34);

    // 새로 확보된 모든 셀이 다른 확보 셀과 인접해야 한다 (덩어리 유지)
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
      const hasNeighbor = adj.some((n) => state.grid[n] === Cell.POOP_TERRITORY);
      expect(hasNeighbor, `셀 ${i} (${cx},${cz}) 가 고립됐다`).toBe(true);
    }
  });

  it('확보한 영역이 없으면 플레이어 주변에서 시작한다', () => {
    const gained = expandFromTerritory(state, 20);
    expect(gained).toBe(20);
    expect(state.ownedCells).toBe(20);
  });

  it('요청 수가 0 이하면 아무 일도 하지 않는다', () => {
    expect(expandFromTerritory(state, 0)).toBe(0);
    expect(expandFromTerritory(state, -5)).toBe(0);
  });

  it('남은 빈 셀보다 많이 요청하면 있는 만큼만 확보한다', () => {
    const gained = expandFromTerritory(state, state.effectiveCells + 500);
    expect(gained).toBe(state.effectiveCells);
    expect(state.territoryRatio).toBe(1);
  });
});

describe('셀 좌표 변환', () => {
  it('셀 중심 좌표가 방 안에 들어간다', () => {
    for (const i of [0, 100, 500, DERIVED.TOTAL_CELLS - 1]) {
      const c = cellCenter(i);
      expect(Math.abs(c.x)).toBeLessThanOrEqual(DERIVED.ROOM_W / 2);
      expect(Math.abs(c.z)).toBeLessThanOrEqual(DERIVED.ROOM_H / 2);
    }
  });

  it('셀 중심 → 인덱스 왕복이 일치한다', () => {
    for (const i of [0, 37, 400, DERIVED.TOTAL_CELLS - 1]) {
      expect(state.collision.cellIndexAt(cellCenter(i))).toBe(i);
    }
  });
});
