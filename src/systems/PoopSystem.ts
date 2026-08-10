/**
 * 똥 게이지와 배변. 순수 로직. (§0-4, §9-3, §10)
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';
import type { EventBus } from '../core/EventBus.ts';
import { Stance, isPoopBlocked } from '../core/types.ts';
import { tickDown } from './MovementSystem.ts';
import { applyPoop } from './TerritorySystem.ts';

/** 배변이 막히는 이유. 막힌 경우 게이지를 소모하지 않고 안내만 표시한다. (§10) */
export type PoopBlockReason =
  | 'not-full'
  | 'on-furniture'
  | 'hidden'
  | 'bathroom'
  | 'mating'
  | 'already-pooping';

const BLOCK_MESSAGE: Record<PoopBlockReason, string> = {
  'not-full': '아직 신호가 안 왔어!',
  'on-furniture': '여기선 못 싸!',
  hidden: '담요 밑에선 못 싸!',
  bathroom: '변기를 써!',
  // 임신 자체는 배변을 막지 않는다. 막히는 건 교미하는 그 2.5초뿐이다 —
  // 임신 25초 내내 못 싸면 대가가 너무 커서 아무도 짝에게 가지 않는다.
  mating: '지금은 좀…',
  'already-pooping': '싸는 중이야!',
};

export function poopBlockMessage(reason: PoopBlockReason): string {
  return BLOCK_MESSAGE[reason];
}

/** 지금 배변할 수 있는지. 가능하면 null, 불가능하면 이유를 돌려준다. */
export function checkPoop(state: GameState): PoopBlockReason | null {
  const p = state.player;
  if (p.poopAnimLeft > 0) return 'already-pooping';
  if (p.mateAnimLeft > 0) return 'mating';
  if (p.stance === Stance.ON_FURNITURE) return 'on-furniture';
  if (p.stance === Stance.HIDDEN) return 'hidden';
  if (p.stance === Stance.BATHROOM) return 'bathroom';
  if (p.poop < CONFIG.POOP_MAX) return 'not-full';
  return null;
}

/** 똥 게이지가 가득 찼는지 — HUD 의 `!` 신호에 쓴다. */
export function hasSignal(state: GameState): boolean {
  return state.player.poop >= CONFIG.POOP_MAX;
}

/**
 * 게이지를 채운다. **상한 초과분은 버린다.** (§9-3)
 * 가득 찬 상태에서 먹으면 손해이므로 "먼저 싸고 먹을지" 선택이 생긴다.
 *
 * @returns 실제로 반영된 양 (버려진 분은 제외)
 */
export function addPoopGauge(state: GameState, amount: number): number {
  const p = state.player;
  const before = p.poop;
  p.poop = Math.min(CONFIG.POOP_MAX, p.poop + amount);
  return p.poop - before;
}

/**
 * 배변을 시작한다. 준비 애니메이션 동안 이동 불가이고 **무적이 아니다.** (§10)
 * 실제 영역 전환은 애니메이션이 끝나는 시점에 일어난다.
 *
 * @returns 시작했으면 null, 막혔으면 이유
 */
export function startPoop(state: GameState, bus?: EventBus): PoopBlockReason | null {
  const reason = checkPoop(state);
  if (reason) {
    bus?.emit('poop:blocked', { reason: poopBlockMessage(reason) });
    return reason;
  }

  state.player.poopAnimLeft = CONFIG.POOP_ANIM_TIME;
  bus?.emit('poop:started', { pos: { ...state.player.pos } });
  return null;
}

/**
 * 배변 애니메이션 타이머를 진행시키고, 끝나면 영역을 확보한다.
 * 고정 타임스텝에서 매 스텝 호출한다.
 */
export function updatePoop(state: GameState, dt: number, bus?: EventBus): void {
  const p = state.player;
  if (p.poopAnimLeft <= 0) return;

  p.poopAnimLeft = tickDown(p.poopAnimLeft, dt);
  if (p.poopAnimLeft > 0) return;

  // ── 완료 ──
  const radius = state.poopRadiusCells;
  const gained = applyPoop(state, p.pos, radius);

  p.poop = 0;
  state.stats.poops++;

  bus?.emit('poop:done', {
    pos: { ...p.pos },
    radiusCells: radius,
    gainedCells: gained,
  });
  bus?.emit('territory:changed', {
    owned: state.ownedCells,
    ratio: state.territoryRatio,
  });
}

/** 배변이 차단되는 자세인지 (UI 안내용) */
export function isBlockedStance(state: GameState): boolean {
  return isPoopBlocked(state.player.stance);
}
