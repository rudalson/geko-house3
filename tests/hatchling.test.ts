/**
 * 새끼 도마뱀. (§24, ROADMAP §3-8i)
 *
 * 여기서 지켜야 할 것은 세 가지다.
 *
 *   ① 산란하면 실제로 태어나고, 수명이 다하면 사라진다 — 새는 쪽이 있으면
 *      새끼가 무한히 쌓여 후반이 통째로 무너진다.
 *   ② **총 출력이 밸런스 모델과 같다** — `BalanceModel.hatchlingPoopCount()` 는
 *      이 시스템이 몇 번 쌀지를 가정하고 클리어 시간을 계산한다. 둘이 어긋나면
 *      리포트가 ✅ 라고 말하면서 실제 게임은 다른 난이도가 된다.
 *   ③ 따라온다 — 안 따라오면 새끼는 그냥 그 자리의 얼룩이다.
 */

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { Phase, dist, type Vec2 } from '../src/core/types.ts';
import { hatchlingPoopCount } from '../src/core/BalanceModel.ts';
import {
  hatchlingLifeProgress,
  resetHatchlings,
  spawnHatchling,
  updateHatchlings,
} from '../src/systems/HatchlingSystem.ts';
import { startMating, updateMate } from '../src/systems/MateSystem.ts';

const DT = 1 / 60;

function playing(seed = 777): GameState {
  const s = new GameState(seed);
  s.setPhase(Phase.PLAYING);
  resetHatchlings(s);
  return s;
}

function advance(state: GameState, seconds: number, bus?: EventBus): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state.elapsed += DT;
    updateHatchlings(state, DT, bus);
  }
}

/** 플레이어에게서 `about` 만큼 떨어진, 설 수 있는 자리 */
function standableNear(state: GameState, about: number): Vec2 {
  const points = state.collision.standablePoints(CONFIG.HATCHLING_RADIUS);
  let best = points[0]!;
  let bestErr = Infinity;
  for (const p of points) {
    const err = Math.abs(dist(p, state.player.pos) - about);
    if (err < bestErr) {
      bestErr = err;
      best = p;
    }
  }
  return { x: best.x, z: best.z };
}

describe('탄생 (§24)', () => {
  it('산란하면 새끼가 태어난다', () => {
    const state = playing();
    const bus = new EventBus();
    let born = 0;
    bus.on('hatchling:born', () => born++);

    // 짝이 나타날 때까지 돌린 뒤 옆으로 가서 교미한다.
    while (!state.mate.active) {
      state.elapsed += DT;
      updateMate(state, DT, bus);
    }
    state.player.pos.x = state.mate.pos.x;
    state.player.pos.z = state.mate.pos.z;
    expect(startMating(state)).toBe(true);

    for (let i = 0; i < Math.round((CONFIG.MATE_ANIM_TIME + CONFIG.MATE_PREGNANCY_TIME + 0.2) / DT); i++) {
      state.elapsed += DT;
      updateMate(state, DT, bus);
    }

    expect(state.player.eggsLaid).toBe(1);
    expect(born, '산란했는데 새끼가 태어나지 않았다').toBe(1);
    expect(state.hatchlings).toHaveLength(1);
  });

  it('상한을 넘으면 가장 오래된 새끼가 먼저 떠난다', () => {
    const state = playing();
    const bus = new EventBus();
    let left = 0;
    bus.on('hatchling:left', () => left++);

    const ids: number[] = [];
    for (let i = 0; i < CONFIG.HATCHLING_MAX + 1; i++) {
      ids.push(spawnHatchling(state, state.player.pos, bus).id);
    }

    expect(state.hatchlings).toHaveLength(CONFIG.HATCHLING_MAX);
    expect(left, '자리를 비우면서 떠난 것을 알리지 않았다').toBe(1);
    // 먼저 태어난 쪽이 빠져야 한다 — 새로 태어난 쪽을 거절하면 산란이 헛일이 된다.
    expect(state.hatchlings.map((h) => h.id)).not.toContain(ids[0]);
    expect(state.hatchlings.map((h) => h.id)).toContain(ids[ids.length - 1]);
  });
});

describe('배변 (§3-8i)', () => {
  it('첫 배변까지 뜸을 들이고, 그 뒤 간격마다 싼다', () => {
    const state = playing();
    const bus = new EventBus();
    let poops = 0;
    bus.on('hatchling:poop', () => poops++);

    spawnHatchling(state, state.player.pos, bus);

    advance(state, CONFIG.HATCHLING_FIRST_POOP_SEC - 0.5, bus);
    expect(poops, '태어나자마자 쌌다').toBe(0);

    advance(state, 1, bus);
    expect(poops).toBe(1);
    expect(state.ownedCells, '새끼가 쌌는데 영역이 늘지 않았다').toBeGreaterThan(0);

    advance(state, CONFIG.HATCHLING_POOP_INTERVAL, bus);
    expect(poops).toBe(2);
  });

  it('한 마리의 총 배변 횟수가 밸런스 모델의 가정과 같다', () => {
    const state = playing();
    const bus = new EventBus();
    let poops = 0;
    bus.on('hatchling:poop', () => poops++);

    spawnHatchling(state, state.player.pos, bus);
    advance(state, CONFIG.HATCHLING_LIFETIME_SEC + 2, bus);

    expect(poops, 'BalanceModel 의 가정과 실제 출력이 어긋난다').toBe(hatchlingPoopCount());
  });

  it('영역이 늘면 territory:changed 로 알린다 — HUD 가 갱신되어야 한다', () => {
    const state = playing();
    const bus = new EventBus();
    let changed = 0;
    bus.on('territory:changed', () => changed++);

    spawnHatchling(state, state.player.pos, bus);
    advance(state, CONFIG.HATCHLING_FIRST_POOP_SEC + 0.5, bus);

    expect(changed).toBeGreaterThan(0);
  });
});

describe('따라다니기', () => {
  it('플레이어 쪽으로 다가온다', () => {
    const state = playing();
    const far = standableNear(state, 4);
    const h = spawnHatchling(state, far);
    const before = dist(h.pos, state.player.pos);

    advance(state, 3);

    const after = dist(h.pos, state.player.pos);
    expect(after, `따라오지 않는다 (${before.toFixed(2)} → ${after.toFixed(2)})`).toBeLessThan(
      before,
    );
  });

  it('발밑까지 파고들지는 않는다', () => {
    const state = playing();
    const h = spawnHatchling(state, standableNear(state, 4));

    advance(state, 12);

    // 붙어 다니면 쿼터뷰에서 부모 실루엣에 묻혀 두 마리가 한 덩어리로 보인다.
    expect(dist(h.pos, state.player.pos)).toBeGreaterThan(CONFIG.HATCHLING_FOLLOW_DIST * 0.5);
  });

  it('가구를 뚫고 지나가지 않는다', () => {
    const state = playing();
    const h = spawnHatchling(state, standableNear(state, 6));

    for (let i = 0; i < Math.round(10 / DT); i++) {
      updateHatchlings(state, DT);
      expect(
        state.collision.canStand(h.pos, CONFIG.HATCHLING_RADIUS),
        `설 수 없는 자리로 들어갔다: ${JSON.stringify(h.pos)}`,
      ).toBe(true);
    }
  });
});

describe('수명과 초기화 (§8)', () => {
  it('수명이 다하면 사라지고 그것을 알린다', () => {
    const state = playing();
    const bus = new EventBus();
    let left = 0;
    bus.on('hatchling:left', () => left++);

    spawnHatchling(state, state.player.pos, bus);
    advance(state, CONFIG.HATCHLING_LIFETIME_SEC - 1, bus);
    expect(state.hatchlings, '수명 전에 사라졌다').toHaveLength(1);

    advance(state, 2, bus);
    expect(state.hatchlings).toHaveLength(0);
    expect(left).toBe(1);
  });

  it('남은 수명 진행률은 1 에서 0 으로 간다', () => {
    const state = playing();
    expect(hatchlingLifeProgress(state), '없으면 null 이어야 한다').toBeNull();

    spawnHatchling(state, state.player.pos);
    const early = hatchlingLifeProgress(state)!;
    advance(state, CONFIG.HATCHLING_LIFETIME_SEC / 2);
    const late = hatchlingLifeProgress(state)!;

    expect(early).toBeCloseTo(1, 1);
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThan(0);
  });

  it('resetHatchlings 가 전부 치운다', () => {
    const state = playing();
    spawnHatchling(state, state.player.pos);
    resetHatchlings(state);
    expect(state.hatchlings).toHaveLength(0);
  });

  it('PLAYING 이 아니면 아무것도 진행되지 않는다', () => {
    const state = playing();
    spawnHatchling(state, state.player.pos);
    state.setPhase(Phase.PAUSED);

    advance(state, CONFIG.HATCHLING_LIFETIME_SEC + 5);

    expect(state.hatchlings, '멈춘 판에서 수명이 흘렀다').toHaveLength(1);
    expect(state.ownedCells, '멈춘 판에서 새끼가 쌌다').toBe(0);
  });
});
