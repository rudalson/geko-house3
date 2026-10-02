import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG, DERIVED, cellCenterX, cellCenterZ } from '../src/core/GameConfig.ts';
import { effectiveCells as modelEffectiveCells } from '../src/core/BalanceModel.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { GameState } from '../src/core/GameState.ts';
import { Phase, Stance } from '../src/core/types.ts';
import { CollisionMap, aabbOf } from '../src/world/CollisionMap.ts';
import { LIVING_ROOM_FURNITURE } from '../src/world/furnitureLayout.ts';
import { FURNITURE_MODELS } from '../src/world/furnitureModels.ts';
import { OUTDOOR_LAYOUT } from '../src/world/outdoorLayout.ts';
import { OUTDOOR_MODELS, outdoorModelNames } from '../src/world/outdoorModels.ts';
import { outdoorDecorModelNames } from '../src/world/Outdoor.ts';
import { LIVING_DOOR } from '../src/world/bathroomLayout.ts';
import { FIRST_STAGE, STAGES, isStageId } from '../src/world/stages.ts';
import { executeInteraction, findInteraction, INTERACT_RANGE } from '../src/systems/InteractionSystem.ts';
import { climbedHeight, updateBlanket } from '../src/systems/ShelterSystem.ts';

const outdoor = STAGES.outdoor;
const map = new CollisionMap(OUTDOOR_LAYOUT);
const R = CONFIG.PLAYER_RADIUS;

describe('미션 진행', () => {
  it('미션 1(거실) → 미션 2(야외) 로 이어지고, 미션 2 가 마지막이다', () => {
    expect(FIRST_STAGE).toBe('house');
    expect(STAGES.house.mission).toBe(1);
    expect(STAGES.house.next).toBe('outdoor');
    expect(outdoor.mission).toBe(2);
    expect(outdoor.next).toBeNull();
  });

  it('URL 로 받은 미션 이름을 검증한다', () => {
    expect(isStageId('outdoor')).toBe(true);
    expect(isStageId('house')).toBe(true);
    expect(isStageId('toString')).toBe(false);
    expect(isStageId(null)).toBe(false);
  });

  it('GameState 는 미션의 배치로 충돌맵을 만든다', () => {
    const s = new GameState(1, 'outdoor');
    expect(s.stage.id).toBe('outdoor');
    expect(s.collision.solids.map((b) => b.id)).toEqual(
      OUTDOOR_LAYOUT.filter((f) => f.solid).map((f) => f.id),
    );
    // 기본값은 여전히 거실이다 — 기존 테스트·도구가 그대로 돈다.
    expect(new GameState(1).stage.id).toBe('house');
  });
});

describe('야외 배치 — 거실과 같은 불변식 (§0-2, R1)', () => {
  it('BLOCKED 비율이 허용 범위(10~15%) 안이다', () => {
    const [lo, hi] = CONFIG.BLOCKED_RATIO_RANGE;
    expect(map.blockedRatio, map.describe()).toBeGreaterThanOrEqual(lo);
    expect(map.blockedRatio, map.describe()).toBeLessThanOrEqual(hi);
  });

  it('밸런스 모델이 가정한 유효 셀 수와 5% 안으로 맞는다 — 같은 상수로 같은 도달 시간', () => {
    const drift = Math.abs(map.effectiveCells - modelEffectiveCells()) / modelEffectiveCells();
    expect(drift, `실측 ${map.effectiveCells} vs 모델 ${modelEffectiveCells()}`).toBeLessThan(0.05);
  });

  it('모든 소품이 마당 안에 들어간다', () => {
    for (const f of OUTDOOR_LAYOUT) {
      const b = aabbOf(f);
      expect(b.minX, f.id).toBeGreaterThanOrEqual(-DERIVED.ROOM_W / 2);
      expect(b.maxX, f.id).toBeLessThanOrEqual(DERIVED.ROOM_W / 2);
      expect(b.minZ, f.id).toBeGreaterThanOrEqual(-DERIVED.ROOM_H / 2);
      expect(b.maxZ, f.id).toBeLessThanOrEqual(DERIVED.ROOM_H / 2);
    }
  });

  it('solid 소품끼리 겹치지 않는다', () => {
    const solids = map.solids;
    for (let i = 0; i < solids.length; i++) {
      for (let j = i + 1; j < solids.length; j++) {
        const a = solids[i]!;
        const b = solids[j]!;
        const overlap = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
        expect(overlap, `${a.id} 와 ${b.id} 가 겹친다`).toBe(false);
      }
    }
  });

  it('울타리와 소품 사이에 못 들어가는 죽은 틈이 없다', () => {
    const minGap = R * 2;
    const { minX, maxX, minZ, maxZ } = map.bounds;
    const offenders: string[] = [];
    for (const b of map.solids) {
      for (const [side, gap] of [
        ['-x', b.minX - minX],
        ['+x', maxX - b.maxX],
        ['-z', b.minZ - minZ],
        ['+z', maxZ - b.maxZ],
      ] as const) {
        if (gap > 1e-9 && gap < minGap) offenders.push(`${b.id} ↔ ${side}: ${gap.toFixed(2)}`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('시작 지점(0, 0)에 설 수 있다', () => {
    expect(map.canStand({ x: 0, z: 0 }, R)).toBe(true);
  });

  /**
   * 가둬진 빈 땅이 없어야 한다. 소품 사이에 막힌 주머니가 생기면 그 셀은 분모에는
   * 들어가는데 아무도 갈 수 없어서, 목표 40% 의 실제 난도가 조용히 올라간다.
   * 가장 큰 히트박스(Lvl 3)로도 확인한다 — 성장하면 지나던 틈이 막힐 수 있다.
   */
  it.each([
    ['Lvl 1', R],
    ['Lvl 3', R * CONFIG.LEVEL_HITBOX_MUL[2]!],
  ])('설 수 있는 모든 셀에 시작 지점에서 걸어갈 수 있다 (%s)', (_, radius) => {
    const mask = map.walkableMask(radius);
    const W = CONFIG.GRID_W;
    const start = Math.floor(CONFIG.GRID_H / 2) * W + Math.floor(W / 2);
    expect(mask[start]).toBe(1);

    const seen = new Uint8Array(mask.length);
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const i = queue.pop()!;
      const cx = i % W;
      const cz = (i - cx) / W;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= CONFIG.GRID_H) continue;
        const j = nz * W + nx;
        if (mask[j] === 1 && seen[j] === 0) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }

    const stranded: string[] = [];
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 1 && seen[i] === 0) {
        const cx = i % W;
        stranded.push(`(${cellCenterX(cx)}, ${cellCenterZ((i - cx) / W)})`);
      }
    }
    expect(stranded, `갈 수 없는 셀: ${stranded.join(' ')}`).toEqual([]);
  });

  it('은신처(침낭)가 하나 있고 밟고 지나갈 수 있다', () => {
    expect(outdoor.hideout?.id).toBe('camp-bedroll');
    expect(outdoor.hideout?.solid).toBe(false);
  });

  it('올라갈 수 있는 소품이 3개 이상이고, 전부 옆에 다가설 자리가 있다', () => {
    expect(outdoor.climbable.length).toBeGreaterThanOrEqual(3);
    const spots = map.standablePoints(R);
    for (const f of outdoor.climbable) {
      expect(f.solid, f.id).toBe(true);
      const b = aabbOf(f);
      const reachable = spots.some((p) => {
        const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
        const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
        return Math.hypot(dx, dz) <= INTERACT_RANGE;
      });
      expect(reachable, `${f.id} 에 다가설 자리가 없다`).toBe(true);
    }
  });
});

describe('야외 조립 지시서', () => {
  it('id 가 미션 사이에 겹치지 않는다 — 지시서를 id 로 찾기 때문이다', () => {
    const house = new Set(LIVING_ROOM_FURNITURE.map((f) => f.id));
    const clash = OUTDOOR_LAYOUT.filter((f) => house.has(f.id)).map((f) => f.id);
    expect(clash).toEqual([]);
    expect(Object.keys(OUTDOOR_MODELS).filter((id) => id in FURNITURE_MODELS)).toEqual([]);
  });

  it('야외 소품마다 키트 지시서가 있다 — 없으면 상자로 나온다', () => {
    const missing = OUTDOOR_LAYOUT.filter((f) => !OUTDOOR_MODELS[f.id]).map((f) => f.id);
    expect(missing).toEqual([]);
  });

  it('지시서가 쓰는 모델이 전부 public/models 에 구워져 있다', () => {
    const dir = join(import.meta.dirname, '..', 'public', 'models');
    const missing = [...outdoorModelNames(), ...outdoorDecorModelNames()].filter(
      (name) => !existsSync(join(dir, `${name}.glb`)),
    );
    expect(missing, '`npm run bake:survival` 의 SURVIVAL_MODELS 에 넣을 것').toEqual([]);
  });
});

describe('야외 규칙', () => {
  const play = (): GameState => {
    const s = new GameState(7, 'outdoor');
    s.setPhase(Phase.PLAYING);
    return s;
  };

  it('화장실이 없다 — 거실 문 자리에 서도 화장실로 가지 않는다', () => {
    const s = play();
    s.player.pos = { ...LIVING_DOOR };
    expect(findInteraction(s)?.kind).not.toBe('bathroom-enter');
  });

  it('침낭 속에 숨을 수 있고, 오래 있으면 강아지에게 쫓겨난다', () => {
    const s = play();
    const bed = outdoor.hideout!;
    s.player.pos = { x: bed.x + bed.w / 2 + 0.4, z: bed.z };

    const hit = findInteraction(s);
    expect(hit?.kind).toBe('blanket-hide');
    expect(hit?.label).toContain('침낭');

    executeInteraction(s);
    expect(s.player.stance).toBe(Stance.HIDDEN);
    expect(findInteraction(s)?.label).toContain('침낭');

    const bus = new EventBus();
    let dog = 0;
    bus.on('blanket:dog', () => dog++);
    const steps = Math.ceil((CONFIG.BLANKET_WARN_TIME + CONFIG.BLANKET_DOG_TIME) / CONFIG.FIXED_DT) + 2;
    for (let i = 0; i < steps; i++) updateBlanket(s, CONFIG.FIXED_DT, bus);
    expect(dog).toBe(1);
    expect(s.player.stance).toBe(Stance.GROUND);
    expect(s.player.hearts).toBe(CONFIG.MAX_HEARTS - 1);
  });

  it('통나무에 올라가면 그 높이에 선다', () => {
    const s = play();
    const log = outdoor.find('log-seat-n')!;
    s.player.pos = { x: log.x, z: log.z + log.d / 2 + 0.35 };

    const hit = findInteraction(s);
    expect(hit?.kind).toBe('climb-up');
    expect(hit?.label).toContain('통나무');

    executeInteraction(s);
    expect(s.player.stance).toBe(Stance.ON_FURNITURE);
    expect(climbedHeight(s)).toBe(log.h);
  });
});
