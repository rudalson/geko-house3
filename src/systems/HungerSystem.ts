/**
 * 배고픔. 순수 로직. (§0-4, §9-2)
 *
 * 은신·등반 중에도 계속 감소한다 — 이것이 농성을 막는 유일한 압박이다.
 * 0 에 닿아도 곧바로 죽지 않고 STARVE_GRACE 초의 유예를 준 뒤
 * STARVE_DAMAGE_INTERVAL 마다 하트가 하나씩 줄어든다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { GameState } from '../core/GameState.ts';
import { Phase } from '../core/types.ts';
import { applyDamage } from './DamageSystem.ts';
import { tickDown } from './MovementSystem.ts';

/** 배고픔이 0 이고 유예도 끝나 실제로 피해를 받는 중인지 (HUD 경고용) */
export function isStarving(state: GameState): boolean {
  return state.player.hunger <= 0 && state.player.starveGraceLeft <= 0;
}

/** 배고픔이 0 이지만 아직 유예 중인지 — 이 동안 화면에 경고를 띄운다. (§9-2) */
export function isInStarveGrace(state: GameState): boolean {
  return state.player.hunger <= 0 && state.player.starveGraceLeft > 0;
}

/**
 * 회복한다. **상한 초과분은 버린다.** (§9-2)
 * 회복하면 유예 시간도 초기화된다.
 */
export function restoreHunger(state: GameState, amount: number): number {
  const p = state.player;
  const before = p.hunger;
  p.hunger = Math.min(CONFIG.HUNGER_MAX, p.hunger + amount);

  if (p.hunger > 0) {
    p.starveGraceLeft = CONFIG.STARVE_GRACE;
    p.starveDamageTimer = 0;
  }
  return p.hunger - before;
}

export function updateHunger(state: GameState, dt: number, bus?: EventBus): void {
  if (state.phase !== Phase.PLAYING) return;

  const p = state.player;

  if (p.hunger > 0) {
    p.hunger = Math.max(0, p.hunger - CONFIG.HUNGER_DRAIN * dt);
    if (p.hunger > 0) return;
    // 방금 0 에 닿았다 — 유예 시작.
    // 피해 타이머는 0 으로 둔다. "3초 유예 후 5초 간격" 이므로
    // 유예가 끝나는 순간 첫 피해가 들어가고, 그 뒤로 5초마다 반복된다.
    p.starveGraceLeft = CONFIG.STARVE_GRACE;
    p.starveDamageTimer = 0;
  }

  // ── 배고픔 0 ──
  if (p.starveGraceLeft > 0) {
    p.starveGraceLeft = tickDown(p.starveGraceLeft, dt);
    bus?.emit('player:starving', { graceLeft: p.starveGraceLeft });
    return;
  }

  p.starveDamageTimer = tickDown(p.starveDamageTimer, dt);
  if (p.starveDamageTimer === 0) {
    // 굶주림은 넉백이 없다.
    applyDamage(state, 'starvation', null, bus);
    p.starveDamageTimer = CONFIG.STARVE_DAMAGE_INTERVAL;
  }
}
