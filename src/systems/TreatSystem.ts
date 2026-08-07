/**
 * 특식과 비밀 이벤트. 순수 로직. (§0-4, §24)
 *
 * §24 는 "`SecretEvent` 인터페이스를 정의해 **배열에 추가만 하면 확장되는**
 * 구조로 작성"하라고 요구한다. 새 효과를 넣으려면 `SECRET_EVENTS` 에
 * 항목 하나를 추가하면 끝이고, 스폰·선택·발동 코드는 건드리지 않는다.
 */

import { CONFIG } from '../core/GameConfig.ts';
import type { EventBus } from '../core/EventBus.ts';
import type { GameState, TreatItem } from '../core/GameState.ts';
import { Phase, dist } from '../core/types.ts';
import { restoreHunger } from './HungerSystem.ts';
import { addPoopGauge } from './PoopSystem.ts';
import { applyPoop } from './TerritorySystem.ts';
import { tickDown } from './MovementSystem.ts';

export interface SecretEvent {
  id: string;
  /** 화면에 띄울 짧은 문구 */
  description: string;
  /** 지금 발동해도 의미가 있는지. false 면 다른 이벤트를 고른다. */
  isUseful?(state: GameState): boolean;
  apply(state: GameState, bus?: EventBus): void;
}

/**
 * 비밀 이벤트 목록. **여기에 추가만 하면 확장된다.**
 * 순서는 의미가 없다 — 시드 RNG 로 하나를 고른다.
 */
export const SECRET_EVENTS: readonly SecretEvent[] = [
  {
    id: 'invincible',
    description: '✨ 잠깐 무적!',
    apply(state) {
      state.player.invulnTimer = Math.max(state.player.invulnTimer, CONFIG.TREAT_INVULN_TIME);
    },
  },
  {
    id: 'full-gauges',
    description: '🍖 배부르고 신호도 왔다!',
    isUseful: (state) =>
      state.player.hunger < CONFIG.HUNGER_MAX || state.player.poop < CONFIG.POOP_MAX,
    apply(state) {
      restoreHunger(state, CONFIG.HUNGER_MAX);
      addPoopGauge(state, CONFIG.POOP_MAX);
    },
  },
  {
    id: 'stop-vacuum',
    description: '🛑 청소기가 멈췄다!',
    isUseful: (state) => state.vacuums.length > 0,
    apply(state) {
      state.vacuumStopLeft = CONFIG.TREAT_VACUUM_STOP_TIME;
    },
  },
  {
    id: 'mega-poop',
    description: '💩 초대형 똥!',
    apply(state) {
      // 게이지와 무관하게 그 자리에 크게 싼다.
      applyPoop(state, state.player.pos, state.poopRadiusCells * CONFIG.TREAT_MEGA_POOP_MUL);
      state.stats.poops++;
    },
  },
  {
    id: 'grow',
    description: '📈 갑자기 컸다! (하지만 더 잘 보인다)',
    isUseful: (state) => state.player.levelIndex < 2,
    apply(state) {
      // Age 를 다음 레벨 임계까지 끌어올린다 — 반경이 커지는 대신 히트박스도 커진다.
      const next = CONFIG.LEVEL_THRESHOLDS[state.player.levelIndex + 1];
      if (next === undefined) return;
      state.player.foodsEaten = Math.max(
        state.player.foodsEaten,
        next * CONFIG.FOOD_PER_AGE,
      );
      state.refreshGrowth();
    },
  },
  {
    id: 'heal',
    description: '❤️ 하트 회복!',
    isUseful: (state) => state.player.hearts < CONFIG.MAX_HEARTS,
    apply(state) {
      state.player.hearts = Math.min(CONFIG.MAX_HEARTS, state.player.hearts + 1);
    },
  },
];

let nextTreatId = 1;

export function initTreats(state: GameState): void {
  state.treats.length = 0;
  nextTreatId = 1;

  for (let i = 0; i < CONFIG.TREAT_MAX_CONCURRENT; i++) {
    state.treats.push({
      id: nextTreatId++,
      pos: { x: 0, z: 0 },
      active: false,
      respawnLeft: CONFIG.TREAT_FIRST_DELAY,
      spawnedAt: 0,
    });
  }
}

function spawnTreat(state: GameState, treat: TreatItem, bus?: EventBus): void {
  const points = state.collision.standablePoints(state.playerRadius);
  if (points.length === 0) return;

  // 음식보다 더 멀리 — 특식은 "찾아가는" 보상이어야 한다.
  const far = points.filter((p) => dist(p, state.player.pos) > CONFIG.FOOD_MIN_SPAWN_DIST);
  const spot = state.rng.pick(far.length > 0 ? far : points);

  treat.pos = { x: spot.x, z: spot.z };
  treat.active = true;
  treat.respawnLeft = 0;
  treat.spawnedAt = state.elapsed;
  bus?.emit('treat:spawned', { pos: { ...treat.pos } });
}

export function updateTreats(state: GameState, dt: number, bus?: EventBus): void {
  if (state.phase !== Phase.PLAYING) return;

  if (state.vacuumStopLeft > 0) state.vacuumStopLeft = tickDown(state.vacuumStopLeft, dt);

  for (const treat of state.treats) {
    if (treat.active) continue;
    treat.respawnLeft = tickDown(treat.respawnLeft, dt);
    if (treat.respawnLeft === 0) spawnTreat(state, treat, bus);
  }
}

/**
 * 특식을 먹는다. 이벤트 하나를 무작위로 골라 발동한다.
 * @returns 발동한 이벤트. 먹을 게 없으면 null
 */
export function consumeTreat(state: GameState, treat: TreatItem, bus?: EventBus): SecretEvent | null {
  if (!treat.active) return null;

  treat.active = false;
  treat.respawnLeft = CONFIG.TREAT_RESPAWN_DELAY;

  // 지금 의미 없는 효과는 제외한다 — 하트가 가득인데 회복이 나오면 김이 샌다.
  const usable = SECRET_EVENTS.filter((e) => e.isUseful?.(state) ?? true);
  const pool = usable.length > 0 ? usable : SECRET_EVENTS;
  const event = state.rng.pick(pool);

  event.apply(state, bus);
  bus?.emit('treat:taken', { effect: event.id, description: event.description });
  return event;
}

/** 활성 특식 목록 */
export function activeTreats(state: GameState): TreatItem[] {
  return state.treats.filter((t) => t.active);
}
