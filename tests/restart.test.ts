import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { Phase, Stance } from '../src/core/types.ts';
import { applyPoop } from '../src/systems/TerritorySystem.ts';
import { applyDamage, isDead } from '../src/systems/DamageSystem.ts';
import { initFoods } from '../src/systems/SpawnSystem.ts';
import { initVacuums } from '../src/systems/VacuumSystem.ts';

/**
 * §8 재시작 요구사항 — GameState 를 **새 객체로 생성**하고 이전 상태를 재사용하지 않는다.
 *
 * GPU 리소스 누수는 브라우저에서만 확인할 수 있으므로 E2E 가 담당한다
 * ("§8 누수: 3회 재시작해도 GPU 리소스가 누적되지 않는다").
 * 여기서는 순수 상태가 완전히 초기화되는지를 본다.
 */

/** 판을 한창 진행한 것처럼 더럽혀 둔다. */
function dirty(s: GameState): void {
  s.setPhase(Phase.PLAYING);
  initFoods(s);
  initVacuums(s);

  applyPoop(s, { x: 0, z: 0 }, 3);
  s.player.hunger = 12;
  s.player.poop = CONFIG.POOP_MAX;
  s.player.foodsEaten = 37;
  s.refreshGrowth();
  s.player.stance = Stance.ON_FURNITURE;
  s.player.poopAnimLeft = 0.5;
  s.player.runCooldownLeft = 2;
  s.elapsed = 240;
  s.stats.erasedCells = 88;
  s.stats.poops = 12;
  s.stats.damageTaken = 2;
  applyDamage(s, 'vacuum', { x: 1, z: 1 });
}

describe('재시작 시 상태 초기화 (§8)', () => {
  it('새 GameState 는 진행 상태를 하나도 물려받지 않는다', () => {
    const old = new GameState(11);
    dirty(old);

    const fresh = new GameState(22);

    expect(fresh.ownedCells).toBe(0);
    expect(fresh.territoryRatio).toBe(0);
    expect(fresh.elapsed).toBe(0);
    expect(fresh.phase).toBe(Phase.BOOT);

    expect(fresh.player.hearts).toBe(CONFIG.MAX_HEARTS);
    expect(fresh.player.hunger).toBe(CONFIG.HUNGER_MAX);
    expect(fresh.player.poop).toBe(0);
    expect(fresh.player.foodsEaten).toBe(0);
    expect(fresh.player.age).toBe(0);
    expect(fresh.player.levelIndex).toBe(0);
    expect(fresh.player.stance).toBe(Stance.GROUND);
    expect(fresh.player.poopAnimLeft).toBe(0);
    expect(fresh.player.eatAnimLeft).toBe(0);
    expect(fresh.player.invulnTimer).toBe(0);
    expect(fresh.player.runCooldownLeft).toBe(0);

    expect(fresh.stats).toEqual({ erasedCells: 0, poops: 0, damageTaken: 0 });
    expect(fresh.dirtyCells).toEqual([]);
  });

  it('격자가 새로 만들어져 이전 판의 똥 땅이 남지 않는다', () => {
    const old = new GameState(11);
    dirty(old);
    expect(old.ownedCells).toBeGreaterThan(0);

    const fresh = new GameState(11);
    expect(fresh.ownedCells).toBe(0);
    // 두 상태가 같은 배열을 공유하지 않아야 한다
    expect(fresh.grid).not.toBe(old.grid);
  });

  it('이전 상태를 변경해도 새 상태에 영향을 주지 않는다', () => {
    const fresh = new GameState(11);
    const old = new GameState(11);
    dirty(old);

    expect(fresh.ownedCells).toBe(0);
    expect(fresh.player.hearts).toBe(CONFIG.MAX_HEARTS);
    expect(fresh.foods).toHaveLength(0);
    expect(fresh.vacuums).toHaveLength(0);
  });

  it('음식·청소기를 다시 배치하면 정상 개수가 된다', () => {
    const s = new GameState(33);
    initFoods(s);
    initVacuums(s);
    expect(s.foods).toHaveLength(CONFIG.FOOD_MAX_CONCURRENT);
    expect(s.vacuums).toHaveLength(CONFIG.VACUUM_COUNT);

    // 두 번 호출해도 누적되지 않는다 — 재시작 때 실제로 이 경로를 탄다
    initFoods(s);
    initVacuums(s);
    expect(s.foods).toHaveLength(CONFIG.FOOD_MAX_CONCURRENT);
    expect(s.vacuums).toHaveLength(CONFIG.VACUUM_COUNT);
  });

  it('같은 시드로 재시작하면 완전히 같은 판이 된다 (§0-5)', () => {
    const a = new GameState(4242);
    initFoods(a);
    initVacuums(a);

    const b = new GameState(4242);
    initFoods(b);
    initVacuums(b);

    expect(a.foods.map((f) => f.pos)).toEqual(b.foods.map((f) => f.pos));
    expect(a.vacuums.map((v) => ({ pos: v.pos, h: v.heading }))).toEqual(
      b.vacuums.map((v) => ({ pos: v.pos, h: v.heading })),
    );
  });
});

describe('승패 판정 (§11)', () => {
  it('달성률이 44% 를 넘으면 targetReached 가 true 가 된다', () => {
    const s = new GameState(1);
    expect(s.targetReached).toBe(false);

    // 목표 직전까지 채운다
    const need = Math.ceil(s.effectiveCells * CONFIG.TARGET_RATIO);
    let filled = 0;
    for (let i = 0; i < s.grid.length && filled < need - 1; i++) {
      if (s.grid[i] === 0) {
        s.grid[i] = 1;
        s.ownedCells++;
        filled++;
      }
    }
    expect(s.targetReached).toBe(false);

    for (let i = 0; i < s.grid.length; i++) {
      if (s.grid[i] === 0) {
        s.grid[i] = 1;
        s.ownedCells++;
        break;
      }
    }
    expect(s.targetReached).toBe(true);
  });

  it('하트가 0 이면 isDead 가 true 가 된다', () => {
    const s = new GameState(1);
    expect(isDead(s)).toBe(false);

    for (let i = 0; i < CONFIG.MAX_HEARTS; i++) {
      s.player.invulnTimer = 0;
      applyDamage(s, 'starvation', null);
    }
    expect(isDead(s)).toBe(true);
  });

  it('죽은 뒤에는 추가 피해가 들어가지 않는다 — 하트가 음수가 되지 않는다', () => {
    const s = new GameState(1);
    for (let i = 0; i < CONFIG.MAX_HEARTS + 5; i++) {
      s.player.invulnTimer = 0;
      applyDamage(s, 'starvation', null);
    }
    expect(s.player.hearts).toBe(0);
  });
});
