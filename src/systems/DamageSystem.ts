/**
 * 피해·무적·넉백. 순수 로직. (§0-4, §9-1, §12)
 *
 * 무적 시간이 대미지 쿨다운 역할을 하므로 연속 충돌로 즉사하지 않는다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { GameState } from '../core/GameState.ts';
import { normalize, type Vec2 } from '../core/types.ts';
import { tickDown } from './MovementSystem.ts';

export type DamageSource = 'vacuum' | 'starvation' | 'dog' | 'human';

/**
 * 피해를 준다. 무적 중이면 무시한다.
 *
 * @param from 넉백 방향 계산의 기준점. 없으면 넉백 없음(굶주림 등).
 * @returns 실제로 피해가 적용됐으면 true
 */
export function applyDamage(
  state: GameState,
  /** 통계·연출 구분용. 지금은 피해량이 모두 하트 1 이라 로직 분기는 없다. */
  _source: DamageSource,
  from: Vec2 | null,
  bus?: EventBus,
): boolean {
  const p = state.player;
  if (state.isInvulnerable || p.hearts <= 0) return false;

  p.hearts--;
  p.invulnTimer = CONFIG.INVULN_TIME;
  state.stats.damageTaken++;

  // 넉백 — 벽이나 가구를 통과하지 않게 sweep 으로 밀어낸다. (§12)
  let knockback: Vec2 = { x: 0, z: 0 };
  if (from) {
    const dir = normalize({ x: p.pos.x - from.x, z: p.pos.z - from.z });
    // 정확히 겹쳐 방향이 0 이면 바라보는 반대쪽으로 민다.
    const safe =
      dir.x === 0 && dir.z === 0
        ? { x: -Math.sin(p.facing), z: -Math.cos(p.facing) }
        : dir;

    const landed = state.collision.sweep(
      p.pos,
      safe,
      CONFIG.KNOCKBACK_DISTANCE,
      state.playerRadius,
    );
    knockback = { x: landed.x - p.pos.x, z: landed.z - p.pos.z };
    p.pos.x = landed.x;
    p.pos.z = landed.z;
  }

  // 배변 중이었다면 중단된다 — 게이지는 그대로 남는다.
  p.poopAnimLeft = 0;
  p.eatAnimLeft = 0;

  bus?.emit('player:damaged', {
    hearts: p.hearts,
    from: from ?? { ...p.pos },
    knockback,
  });
  bus?.emit('player:invulnStart', {});

  if (p.hearts <= 0) {
    bus?.emit('stage:gameOver', { timeSec: state.elapsed });
  }

  return true;
}

/** 무적 타이머를 진행시킨다. 고정 스텝마다 호출한다. */
export function updateInvulnerability(state: GameState, dt: number): void {
  const p = state.player;
  if (p.invulnTimer > 0) p.invulnTimer = tickDown(p.invulnTimer, dt);
}

/** 남은 하트가 0 인지 */
export function isDead(state: GameState): boolean {
  return state.player.hearts <= 0;
}
