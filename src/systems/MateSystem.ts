/**
 * 짝 도마뱀과 임신·산란. 순수 로직. (§0-4, §24)
 *
 * **변기(§14)와 같은 축의 선택지다** — 지금 손해를 보고 나중에 덩어리로 받는다.
 * 다만 대가의 성격이 다르다.
 *
 *   변기: 자리를 비운다. 그동안 안전하지만 아무것도 못 한다.
 *   짝  : 자리를 비우지 않는다. 대신 **느려지고 커진 채로 계속 싸워야 한다.**
 *
 * 그래서 둘이 서로를 대체하지 않는다. 청소기가 멀면 변기, 가까우면 짝을
 * 미루는 식의 판단이 생긴다.
 *
 * 짝은 이동하지 않는다. 쫓아오는 적이 아니라 **갈지 말지 고르는 지점**이라
 * 이동 AI 가 필요 없고, 그만큼 인간 적(§24)과 역할이 겹치지 않는다.
 *
 * 밸런스 근거는 ROADMAP §3-8h. 보상은 `MATE_EGG_BONUS_RATIO` 하나로 조절한다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { GameState } from '../core/GameState.ts';
import { Phase, Stance, dist, distSq, type Vec2 } from '../core/types.ts';
import { tickDown } from './MovementSystem.ts';
import { expandFromTerritory } from './TerritorySystem.ts';

/** 짝에게 다가가 상호작용할 수 있는 거리 (world units) */
export const MATE_INTERACT_RANGE = 1.1;

/** 짝을 처음부터 없애고 싶을 때 (테스트·디버그) */
export function despawnMate(state: GameState): void {
  state.mate.active = false;
  state.mate.appearIn = Infinity;
}

/**
 * 등장 타이머와 임신·산란 진행. 고정 스텝마다 호출한다.
 */
export function updateMate(state: GameState, dt: number, bus?: EventBus): void {
  if (state.phase !== Phase.PLAYING) return;

  updateAppearance(state, dt, bus);
  updateMating(state, dt, bus);
  updatePregnancy(state, dt, bus);
}

function updateAppearance(state: GameState, dt: number, bus?: EventBus): void {
  const mate = state.mate;
  if (mate.active) return;
  // 임신 중에 짝이 다시 나타나면 "가야 하나" 라는 헛된 신호가 된다.
  if (state.player.pregnantLeft > 0) return;
  if (!Number.isFinite(mate.appearIn)) return;

  mate.appearIn -= dt;
  if (mate.appearIn > 0) return;

  const pos = pickMatePos(state);
  mate.pos = pos;
  mate.active = true;
  mate.spawnedAt = state.elapsed;
  bus?.emit('mate:appeared', { pos: { ...pos } });
}

/**
 * 짝이 나타날 자리.
 *
 * 플레이어에게서 `MATE_MIN_SPAWN_DIST` 밖이어야 한다 — 바로 옆에 나타나면
 * 왕복 비용이 0 이 되어 §3-8h 의 손익 계산이 무너진다. 공짜가 되는 순간
 * "고민해서 고르는 선택지" 가 아니라 그냥 주기적으로 받는 보너스가 된다.
 */
function pickMatePos(state: GameState): Vec2 {
  const points = state.collision.standablePoints(state.playerRadius);
  const player = state.player.pos;
  const min = CONFIG.MATE_MIN_SPAWN_DIST;

  const tiers: ((p: Vec2) => boolean)[] = [
    // 충분히 멀고, 청소기 코앞도 아니고, 음식과도 겹치지 않는다
    (p) =>
      distSq(p, player) >= min * min &&
      state.vacuums.every((v) => distSq(p, v.pos) >= 2.5 * 2.5) &&
      state.foods.every((f) => !f.active || distSq(p, f.pos) >= 2 * 2),
    // 청소기·음식 조건 완화
    (p) => distSq(p, player) >= min * min,
    // 거리 조건 완화 — 그래도 붙어서 나오지는 않게
    (p) => distSq(p, player) >= (min * 0.6) ** 2,
  ];

  for (const accept of tiers) {
    const candidates = points.filter(accept);
    if (candidates.length > 0) {
      const chosen = state.rng.pick(candidates);
      return { x: chosen.x, z: chosen.z };
    }
  }
  return { x: 0, z: 0 };
}

/** 지금 짝과 교미할 수 있는지 */
export function canMate(state: GameState): boolean {
  const p = state.player;
  return (
    state.mate.active &&
    p.stance === Stance.GROUND &&
    p.pregnantLeft <= 0 &&
    p.mateAnimLeft <= 0 &&
    p.poopAnimLeft <= 0 &&
    p.eatAnimLeft <= 0 &&
    dist(p.pos, state.mate.pos) <= MATE_INTERACT_RANGE
  );
}

/**
 * 교미를 시작한다.
 *
 * 배변과 같은 규칙이다 — **이동 불가이고 무적이 아니다.** (§10)
 * 여기서 무적을 주면 "안전하게 보너스를 예약하는" 동작이 되어 §1 의
 * "욕심 vs 안전" 이 사라진다.
 *
 * @returns 시작했으면 true
 */
export function startMating(state: GameState): boolean {
  if (!canMate(state)) return false;
  state.player.mateAnimLeft = CONFIG.MATE_ANIM_TIME;
  return true;
}

function updateMating(state: GameState, dt: number, bus?: EventBus): void {
  const p = state.player;
  if (p.mateAnimLeft <= 0) return;

  p.mateAnimLeft = tickDown(p.mateAnimLeft, dt);
  if (p.mateAnimLeft > 0) return;

  // ── 교미 완료 → 임신 ──
  const pos = { ...state.mate.pos };
  state.mate.active = false;
  p.pregnantLeft = CONFIG.MATE_PREGNANCY_TIME;
  bus?.emit('mate:mated', { pos });
}

function updatePregnancy(state: GameState, dt: number, bus?: EventBus): void {
  const p = state.player;
  if (p.pregnantLeft <= 0) return;

  p.pregnantLeft = tickDown(p.pregnantLeft, dt);
  if (p.pregnantLeft > 0) return;

  // ── 산란 ──
  // 변기와 같은 BFS 인접 확장을 쓴다. 무작위로 흩뿌리면 고립 셀이 생겨
  // 청소기에 금방 지워지고, 그러면 §3-8h 의 "중첩 손실 0" 전제가 깨진다. (§14)
  const bonus = Math.round(state.effectiveCells * CONFIG.MATE_EGG_BONUS_RATIO);
  const gained = expandFromTerritory(state, bonus);

  p.eggsLaid++;
  state.mate.appearIn = CONFIG.MATE_COOLDOWN_SEC;

  bus?.emit('mate:laid', { pos: { ...p.pos }, gainedCells: gained });
  bus?.emit('territory:changed', { owned: state.ownedCells, ratio: state.territoryRatio });
}

/** 임신 남은 시간 [0, 1]. HUD 게이지용. 임신 중이 아니면 null */
export function pregnancyProgress(state: GameState): number | null {
  const left = state.player.pregnantLeft;
  if (left <= 0) return null;
  return 1 - left / CONFIG.MATE_PREGNANCY_TIME;
}

/** 재시작 시 초기화. GameState 를 새로 만들지만 명시적으로 둔다. (§8) */
export function resetMate(state: GameState): void {
  state.mate.active = false;
  state.mate.appearIn = CONFIG.MATE_FIRST_APPEAR_SEC;
  state.mate.spawnedAt = 0;
  state.player.mateAnimLeft = 0;
  state.player.pregnantLeft = 0;
}
