/**
 * 짝 도마뱀·임신·산란. (§24)
 *
 * 여기서 지켜야 할 것은 두 가지다.
 *
 *   ① 흐름이 끊기지 않는가 — 등장 → 교미 → 임신 → 산란 → 쿨다운 → 재등장.
 *      한 군데라도 멈추면 플레이어는 영영 오지 않는 짝을 기다린다.
 *   ② **대가가 실제로 붙는가** — 느려지고 커지지 않으면 §3-8h 의 손익 계산이
 *      전부 무의미해지고, 짝은 그냥 공짜 보너스가 된다.
 */

import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { Phase, Stance, dist } from '../src/core/types.ts';
import {
  canMate,
  pregnancyProgress,
  resetMate,
  startMating,
  updateMate,
} from '../src/systems/MateSystem.ts';
import { checkPoop } from '../src/systems/PoopSystem.ts';
import { findInteraction } from '../src/systems/InteractionSystem.ts';

const DT = 1 / 60;

function playing(seed = 4242): GameState {
  const s = new GameState(seed);
  s.setPhase(Phase.PLAYING);
  return s;
}

/** 짝이 나타날 때까지 시간을 흘린다. */
function runUntilMate(state: GameState, bus?: EventBus, capSec = 200): number {
  let t = 0;
  while (t < capSec && !state.mate.active) {
    state.elapsed += DT;
    updateMate(state, DT, bus);
    t += DT;
  }
  return t;
}

/** 짝 옆으로 순간이동한 뒤 교미를 시작한다. */
function mateNow(state: GameState): boolean {
  state.player.pos.x = state.mate.pos.x;
  state.player.pos.z = state.mate.pos.z;
  return startMating(state);
}

function advance(state: GameState, seconds: number, bus?: EventBus): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state.elapsed += DT;
    updateMate(state, DT, bus);
  }
}

describe('짝 등장 (§24)', () => {
  it('시작 직후에는 없고, 정해진 시간이 지나면 나타난다', () => {
    const state = playing();
    expect(state.mate.active).toBe(false);

    advance(state, CONFIG.MATE_FIRST_APPEAR_SEC - 1);
    expect(state.mate.active, '예정보다 일찍 나타났다').toBe(false);

    advance(state, 2);
    expect(state.mate.active, '예정 시간이 지나도 나타나지 않는다').toBe(true);
  });

  it('플레이어에게서 최소 거리 밖에 나타난다', () => {
    // 왕복 비용이 0 이면 §3-8h 의 손익이 무너져 그냥 공짜 보너스가 된다.
    for (const seed of [1, 7, 42, 1337, 2024]) {
      const state = playing(seed);
      runUntilMate(state);
      const d = dist(state.player.pos, state.mate.pos);
      expect(d, `시드 ${seed}: 짝이 ${d.toFixed(2)} 거리에 나타났다`).toBeGreaterThanOrEqual(
        CONFIG.MATE_MIN_SPAWN_DIST * 0.6,
      );
    }
  });

  it('등장 이벤트를 한 번만 쏜다', () => {
    const state = playing();
    const bus = new EventBus();
    let count = 0;
    bus.on('mate:appeared', () => count++);

    runUntilMate(state, bus);
    advance(state, 10, bus);
    expect(count).toBe(1);
  });

  it('같은 시드는 같은 자리에 나타난다 (§0-5)', () => {
    const a = playing(99);
    const b = playing(99);
    runUntilMate(a);
    runUntilMate(b);
    expect(a.mate.pos).toEqual(b.mate.pos);
  });
});

describe('교미 (§24)', () => {
  it('사정거리 밖에서는 교미할 수 없다', () => {
    const state = playing();
    runUntilMate(state);
    // 플레이어는 원점, 짝은 최소 거리 밖에 있다.
    expect(canMate(state)).toBe(false);
    expect(startMating(state)).toBe(false);
  });

  it('가구 위·담요 밑에서는 교미할 수 없다', () => {
    for (const stance of [Stance.ON_FURNITURE, Stance.HIDDEN, Stance.BATHROOM]) {
      const state = playing();
      runUntilMate(state);
      state.player.pos.x = state.mate.pos.x;
      state.player.pos.z = state.mate.pos.z;
      state.player.stance = stance;
      expect(canMate(state), `${stance} 에서 교미가 가능하다`).toBe(false);
    }
  });

  it('교미 중에는 움직일 수 없고 무적도 아니다', () => {
    const state = playing();
    runUntilMate(state);
    expect(mateNow(state)).toBe(true);

    expect(state.canMove, '교미 중에 움직일 수 있다').toBe(false);
    // §10 과 같은 규칙이다. 여기서 무적을 주면 "안전하게 보너스를 예약"하게 된다.
    expect(state.isInvulnerable, '교미가 무적을 준다 — 긴장이 사라진다').toBe(false);
  });

  it('교미 중에는 배변이 막히고, 임신 중에는 막히지 않는다', () => {
    const state = playing();
    runUntilMate(state);
    state.player.poop = CONFIG.POOP_MAX;
    mateNow(state);

    expect(checkPoop(state), '교미 중에는 막혀야 한다').toBe('mating');

    // 교미가 끝나 임신 상태가 되면 다시 쌀 수 있어야 한다.
    // 임신 25초 내내 못 싸면 대가가 너무 커서 아무도 짝에게 가지 않는다.
    advance(state, CONFIG.MATE_ANIM_TIME + 0.1);
    expect(state.isPregnant).toBe(true);
    expect(checkPoop(state), '임신 중에 배변이 막혔다').toBeNull();
  });

  it('E 안내가 짝을 가리킨다', () => {
    const state = playing();
    runUntilMate(state);
    state.player.pos.x = state.mate.pos.x;
    state.player.pos.z = state.mate.pos.z;

    // 음식이 겹쳐 있으면 먹기가 우선이므로 비워 둔다 (InteractionSystem 의 규칙).
    for (const f of state.foods) f.active = false;
    for (const t of state.treats) t.active = false;

    expect(findInteraction(state)?.kind).toBe('mate');
  });
});

describe('임신의 대가 (§3-8h)', () => {
  it('임신하면 느려지고 히트박스가 커진다', () => {
    const state = playing();
    const baseSpeed = state.moveSpeed;
    const baseRadius = state.playerRadius;

    runUntilMate(state);
    mateNow(state);
    advance(state, CONFIG.MATE_ANIM_TIME + 0.1);

    expect(state.isPregnant).toBe(true);
    expect(state.moveSpeed, '임신해도 속도가 그대로다').toBeCloseTo(
      baseSpeed * CONFIG.MATE_SPEED_MUL,
      5,
    );
    expect(state.playerRadius, '임신해도 히트박스가 그대로다').toBeCloseTo(
      baseRadius * CONFIG.MATE_HITBOX_MUL,
      5,
    );
  });

  it('산란이 끝나면 대가가 사라진다', () => {
    const state = playing();
    const baseSpeed = state.moveSpeed;

    runUntilMate(state);
    mateNow(state);
    advance(state, CONFIG.MATE_ANIM_TIME + CONFIG.MATE_PREGNANCY_TIME + 0.2);

    expect(state.isPregnant).toBe(false);
    expect(state.moveSpeed).toBeCloseTo(baseSpeed, 5);
  });

  it('임신 진행률은 0 에서 1 로 간다', () => {
    const state = playing();
    expect(pregnancyProgress(state), '임신 중이 아니면 null 이어야 한다').toBeNull();

    runUntilMate(state);
    mateNow(state);
    advance(state, CONFIG.MATE_ANIM_TIME + 0.1);

    const early = pregnancyProgress(state)!;
    advance(state, CONFIG.MATE_PREGNANCY_TIME / 2);
    const late = pregnancyProgress(state)!;

    expect(early).toBeGreaterThanOrEqual(0);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThanOrEqual(1);
  });
});

describe('산란 (§24)', () => {
  it('임신이 끝나면 영역이 덩어리로 늘어난다', () => {
    const state = playing();
    const bus = new EventBus();
    let laid: { gainedCells: number } | null = null;
    bus.on('mate:laid', (p) => (laid = p));

    runUntilMate(state, bus);
    mateNow(state);
    advance(state, CONFIG.MATE_ANIM_TIME + CONFIG.MATE_PREGNANCY_TIME + 0.2, bus);

    expect(laid, '산란 이벤트가 오지 않았다').not.toBeNull();
    expect(state.player.eggsLaid).toBe(1);

    const expected = Math.round(state.effectiveCells * CONFIG.MATE_EGG_BONUS_RATIO);
    expect(state.ownedCells, `보너스 ${expected}칸이 반영되지 않았다`).toBe(expected);
    expect(laid!.gainedCells).toBe(expected);
  });

  it('산란 후 쿨다운이 지나면 짝이 다시 나타난다', () => {
    const state = playing();
    runUntilMate(state);
    mateNow(state);
    advance(state, CONFIG.MATE_ANIM_TIME + CONFIG.MATE_PREGNANCY_TIME + 0.2);

    expect(state.mate.active, '산란 직후에 짝이 남아 있다').toBe(false);

    advance(state, CONFIG.MATE_COOLDOWN_SEC - 2);
    expect(state.mate.active, '쿨다운 중에 나타났다').toBe(false);

    advance(state, 4);
    expect(state.mate.active, '쿨다운이 지나도 나타나지 않는다').toBe(true);
  });

  it('임신 중에는 짝이 다시 나타나지 않는다', () => {
    const state = playing();
    runUntilMate(state);
    mateNow(state);
    advance(state, CONFIG.MATE_ANIM_TIME + 0.1);

    expect(state.isPregnant).toBe(true);
    // 임신 중에 또 나타나면 "가야 하나" 라는 헛된 신호가 된다.
    advance(state, CONFIG.MATE_PREGNANCY_TIME - 1);
    expect(state.mate.active).toBe(false);
  });

  it('교미는 짝을 곧바로 치운다 — 두 번 쓸 수 없다', () => {
    const state = playing();
    runUntilMate(state);
    mateNow(state);
    advance(state, CONFIG.MATE_ANIM_TIME + 0.1);

    expect(state.mate.active).toBe(false);
    expect(canMate(state)).toBe(false);
  });
});

describe('초기화 (§8)', () => {
  it('resetMate 가 진행 중이던 임신까지 되돌린다', () => {
    const state = playing();
    runUntilMate(state);
    mateNow(state);
    advance(state, CONFIG.MATE_ANIM_TIME + 1);

    resetMate(state);

    expect(state.mate.active).toBe(false);
    expect(state.player.pregnantLeft).toBe(0);
    expect(state.player.mateAnimLeft).toBe(0);
    expect(state.mate.appearIn).toBe(CONFIG.MATE_FIRST_APPEAR_SEC);
    expect(state.isPregnant).toBe(false);
  });

  it('PLAYING 이 아니면 아무것도 진행되지 않는다', () => {
    const state = new GameState(1);
    state.setPhase(Phase.TITLE);
    advance(state, CONFIG.MATE_FIRST_APPEAR_SEC + 10);
    expect(state.mate.active).toBe(false);
  });
});
