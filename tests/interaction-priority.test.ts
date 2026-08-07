import { beforeEach, describe, expect, it } from 'vitest';
import { GameState } from '../src/core/GameState.ts';
import { Phase } from '../src/core/types.ts';
import { findFurniture } from '../src/world/furnitureLayout.ts';
import { executeInteraction, findInteraction } from '../src/systems/InteractionSystem.ts';
import { initFoods } from '../src/systems/SpawnSystem.ts';

/**
 * §7 "동시에 여러 대상이 범위 안에 있으면 가장 가까운 것 하나만"
 *
 * 다만 점(음식)까지의 거리와 면(가구)까지의 거리를 같은 자로 재면 안 된다.
 * 담요는 밟고 지나갈 수 있어 그 위에 음식이 스폰될 수 있는데, 거리로만 비교하면
 * 담요(사각형까지 거리 0)가 항상 이겨서 그 음식을 영영 먹을 수 없다.
 */
describe('상호작용 우선순위 (§7)', () => {
  const blanket = findFurniture('blanket')!;

  let state: GameState;
  beforeEach(() => {
    state = new GameState(99);
    state.setPhase(Phase.PLAYING);
    initFoods(state);
  });

  it('담요 위에 스폰된 음식을 먹을 수 있다 — 은신에 가려지지 않는다', () => {
    state.player.pos = { x: blanket.x, z: blanket.z };
    state.foods[0]!.pos = { x: blanket.x, z: blanket.z };
    state.foods[0]!.active = true;
    for (const f of state.foods.slice(1)) f.active = false;

    const found = findInteraction(state);
    expect(found?.kind, '담요 위 음식이 은신에 밀렸다').toBe('food');

    expect(executeInteraction(state)).toBe(true);
    expect(state.player.eatAnimLeft).toBeGreaterThan(0);
    expect(state.player.stance).toBe('GROUND');
  });

  it('등반 가능한 가구 옆의 음식도 먹기가 우선한다', () => {
    const table = findFurniture('coffee-table')!;
    const spot = { x: table.x, z: table.z + table.d / 2 + 0.35 };
    state.player.pos = { ...spot };
    state.foods[0]!.pos = { x: spot.x + 0.5, z: spot.z };
    state.foods[0]!.active = true;
    for (const f of state.foods.slice(1)) f.active = false;

    expect(findInteraction(state)?.kind).toBe('food');
  });

  it('음식이 사정거리 밖이면 은신·등반이 정상적으로 잡힌다', () => {
    for (const f of state.foods) f.active = false;

    state.player.pos = { x: blanket.x, z: blanket.z };
    expect(findInteraction(state)?.kind).toBe('blanket-hide');

    const table = findFurniture('coffee-table')!;
    state.player.pos = { x: table.x, z: table.z + table.d / 2 + 0.35 };
    expect(findInteraction(state)?.kind).toBe('climb-up');
  });

  it('음식이 여러 개면 그중 가장 가까운 것을 고른다', () => {
    state.player.pos = { x: 0, z: 0 };
    state.foods[0]!.pos = { x: 0.9, z: 0 };
    state.foods[0]!.active = true;
    state.foods[1]!.pos = { x: 0.3, z: 0 };
    state.foods[1]!.active = true;

    expect(findInteraction(state)?.food).toBe(state.foods[1]);
  });
});
