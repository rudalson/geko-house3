/**
 * 배변 사이클 실측. (ROADMAP 위험요소 R2)
 *
 *   node tools/cycle-probe.ts
 *
 * §0-1 밸런스 계산은 "배변 1회 사이클 13.1초"를 가정한다. 그 값은 모델일 뿐이고,
 * 실제 구현에서 그렇게 나오는지는 **돌려봐야** 안다.
 *
 * systems/ 가 Three.js 를 import 하지 않으므로(§0-4) 렌더러 없이
 * 실제 게임 시스템을 그대로 돌릴 수 있다. 이게 §0-4 를 지킨 실질적 이득이다.
 *
 * 봇은 "가장 가까운 음식으로 직진 → 먹기 → 게이지가 차면 미개척지로 이동 → 배변"
 * 만 한다. 사람보다 낭비가 적으므로 결과는 **사이클 하한**으로 읽어야 한다.
 */

import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { Cell, dist, type Vec2 } from '../src/core/types.ts';
import { updateMovement, type MoveInput } from '../src/systems/MovementSystem.ts';
import { startPoop, updatePoop } from '../src/systems/PoopSystem.ts';
import { updateHunger } from '../src/systems/HungerSystem.ts';
import { updateInvulnerability } from '../src/systems/DamageSystem.ts';
import { initFoods, updateSpawns } from '../src/systems/SpawnSystem.ts';
import {
  INTERACT_RANGE,
  executeInteraction,
  updateEating,
} from '../src/systems/InteractionSystem.ts';
import { cellCenter } from '../src/systems/TerritorySystem.ts';
import { nextWaypoint } from '../src/systems/Pathfinding.ts';
import { initVacuums, updateVacuums } from '../src/systems/VacuumSystem.ts';
import { analytic, simulate } from '../src/core/BalanceModel.ts';

const DT = CONFIG.FIXED_DT;

/**
 * 목표 지점으로 향하는 8방향 입력.
 *
 * @param slide 끼었을 때 쓰는 회피 모드.
 *   0 = 평소(지배 축 위주) / 1 = 완전 대각 / 2 = 보조 축만
 *
 * 지배 축만 남기고 작은 성분을 버리면 가구 모서리에 쐐기처럼 낀다.
 * (왼쪽 벽에 스치듯 걸린 채 계속 왼쪽만 누르는 상황 — 사람은 자연스럽게
 *  위아래로 비켜서지만 봇은 그러지 못한다)
 */
function steer(from: Vec2, to: Vec2, slide = 0): MoveInput {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const m = Math.max(Math.abs(dx), Math.abs(dz)) || 1;

  if (slide === 1) return { x: Math.sign(dx), z: Math.sign(dz), run: false };
  if (slide === 2) {
    // 지배 축을 버리고 보조 축으로만 — 모서리에서 옆으로 빠져나온다
    return Math.abs(dx) >= Math.abs(dz)
      ? { x: 0, z: Math.sign(dz) || 1, run: false }
      : { x: Math.sign(dx) || 1, z: 0, run: false };
  }

  const q = (v: number): number => (Math.abs(v) / m > 0.4 ? Math.sign(v) : 0);
  return { x: q(dx), z: q(dz), run: false };
}

/**
 * 청소기가 위험하게 가까우면 피할 방향을 돌려준다. 안전하면 null.
 *
 * 진짜 플레이어는 청소기를 본다. 회피를 전혀 안 하는 봇으로 측정하면
 * "영역은 채우는데 하트가 0" 이라는, 아무도 하지 않을 플레이를 재는 셈이다.
 */
function avoidVacuum(state: GameState): Vec2 | null {
  const p = state.player.pos;
  const danger = state.playerRadius + CONFIG.VACUUM_RADIUS + 1.1;

  for (const v of state.vacuums) {
    if (dist(p, v.pos) > danger) continue;
    // 청소기 반대 방향으로 물러난다.
    //
    // "진행 방향 옆으로 비키기"와 "다가올 때만 피하기"도 시험해 봤지만
    // 둘 다 피해를 못 막았다. 옆으로 비키면 곧바로 목표를 향해 되돌아가면서
    // 청소기 경로로 다시 들어가기 때문이다. 단순히 물러나는 쪽이 확실하다.
    const away = { x: p.x - v.pos.x, z: p.z - v.pos.z };
    const len = Math.hypot(away.x, away.z) || 1;
    return { x: p.x + (away.x / len) * 2, z: p.z + (away.z / len) * 2 };
  }
  return null;
}

/** 가장 가까운 미개척 셀 중심 */
function nearestEmpty(state: GameState): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < state.grid.length; i++) {
    if (state.grid[i] !== Cell.EMPTY) continue;
    const c = cellCenter(i);
    if (!state.collision.canStand(c, state.playerRadius)) continue;
    const d = dist(state.player.pos, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

interface ProbeResult {
  clearedAtSec: number | null;
  poops: number;
  foods: number;
  cycleSec: number;
  finalRatio: number;
  hungerMin: number;
  starvedHits: number;
  stuckReport: string;
}

/**
 * 플레이 성향.
 * - `cautious`: 청소기가 가까우면 물러난다. 안전하지만 사이클이 길어진다.
 * - `reckless`: 청소기를 무시하고 영역만 채운다. 빠르지만 하트가 남지 않는다.
 *
 * 두 극단을 모두 재야 "이 게임이 클리어 가능한가"와 "긴장이 있는가"를
 * 동시에 확인할 수 있다.
 */
type PlayStyle = 'cautious' | 'reckless';

function probe(seed: number, style: PlayStyle, capSec = 1800): ProbeResult {
  const state = new GameState(seed);
  state.setPhase('PLAYING');
  initFoods(state);
  initVacuums(state);

  let t = 0;
  let hungerMin = CONFIG.HUNGER_MAX;
  const startHearts = state.player.hearts;

  // 봇이 끼면 결과가 조용히 망가지므로(사이클이 수백 초로 나온다) 감지해서 알린다.
  let stuckFor = 0;
  const lastPos = { x: NaN, z: NaN };
  let stuckReport = '';

  while (t < capSec) {
    const p = state.player;
    let input: MoveInput = { x: 0, z: 0, run: false };

    // 끼어 있으면 회피 모드를 올린다.
    const slide = stuckFor > 0.6 ? 2 : stuckFor > 0.15 ? 1 : 0;

    // 청소기 회피가 최우선 — 목표보다 생존이 먼저다.
    const flee = style === 'cautious' ? avoidVacuum(state) : null;
    if (flee) {
      input = steer(p.pos, nextWaypoint(state.collision, state.playerRadius, p.pos, flee), slide);
    } else if (p.poop >= CONFIG.POOP_MAX) {
      // 게이지가 찼다 — 미개척지로 가서 싼다
      const spot = nearestEmpty(state);
      if (spot && dist(p.pos, spot) > CONFIG.CELL_SIZE) {
        const wp = nextWaypoint(state.collision, state.playerRadius, p.pos, spot);
        input = steer(p.pos, wp, slide);
      } else {
        startPoop(state);
      }
    } else {
      // 가장 가까운 음식으로
      const food = state.foods
        .filter((f) => f.active)
        .sort((a, b) => dist(p.pos, a.pos) - dist(p.pos, b.pos))[0];
      if (food) {
        if (dist(p.pos, food.pos) <= INTERACT_RANGE * 0.8) executeInteraction(state);
        else {
          const wp = nextWaypoint(state.collision, state.playerRadius, p.pos, food.pos);
          input = steer(p.pos, wp, slide);
        }
      }
    }

    updateMovement(state, input, DT);
    updateEating(state, DT);
    updatePoop(state, DT);
    updateSpawns(state, DT);
    updateVacuums(state, DT);
    updateHunger(state, DT);
    updateInvulnerability(state, DT);

    state.elapsed += DT;
    t += DT;
    hungerMin = Math.min(hungerMin, p.hunger);

    // ── 끼임 감지 ──
    // 입력이 없는 정지(음식 리스폰 대기)는 끼임이 아니다.
    const wantsToMove = input.x !== 0 || input.z !== 0;
    const moved = Math.hypot(p.pos.x - lastPos.x, p.pos.z - lastPos.z);
    if (wantsToMove && moved < 1e-4 && p.eatAnimLeft <= 0 && p.poopAnimLeft <= 0) {
      stuckFor += DT;
      if (stuckFor > 3 && !stuckReport) {
        stuckReport =
          `t=${t.toFixed(0)}s pos=(${p.pos.x.toFixed(2)},${p.pos.z.toFixed(2)}) ` +
          `poop=${p.poop} 목표=${p.poop >= CONFIG.POOP_MAX ? '배변지' : '음식'} ` +
          `입력=(${input.x},${input.z})`;
      }
    } else {
      stuckFor = 0;
    }
    lastPos.x = p.pos.x;
    lastPos.z = p.pos.z;

    if (state.targetReached) {
      return {
        clearedAtSec: t,
        poops: state.stats.poops,
        foods: p.foodsEaten,
        cycleSec: t / Math.max(1, state.stats.poops),
        finalRatio: state.territoryRatio,
        hungerMin,
        starvedHits: startHearts - p.hearts,
        stuckReport,
      };
    }
  }

  return {
    clearedAtSec: null,
    poops: state.stats.poops,
    foods: state.player.foodsEaten,
    cycleSec: t / Math.max(1, state.stats.poops),
    finalRatio: state.territoryRatio,
    hungerMin,
    starvedHits: startHearts - state.player.hearts,
    stuckReport,
  };
}

// ════════════════════════════════════════════════════════════════════════
const n = (x: number, d = 1): string => x.toFixed(d);
const seeds = [1, 7, 42, 1337, 2024];

function report(style: PlayStyle, label: string): ProbeResult[] {
  const results = seeds.map((s) => probe(s, style));

  console.log(`\n=== ${label} ===`);
  console.log('seed\t사이클(초)\t배변\t음식\t도달(초)\t도달(분)\t최저 배고픔\t받은 피해');
  for (let i = 0; i < seeds.length; i++) {
    const r = results[i]!;
    console.log(
      `${seeds[i]}\t${n(r.cycleSec, 2)}\t\t${r.poops}\t${r.foods}\t` +
        `${r.clearedAtSec ? r.clearedAtSec.toFixed(0) : '미도달'}\t\t` +
        `${r.clearedAtSec ? n(r.clearedAtSec / 60, 1) : '-'}\t\t` +
        `${n(r.hungerMin, 0)}\t\t${r.starvedHits}`,
    );
  }
  for (let i = 0; i < seeds.length; i++) {
    const r = results[i]!;
    if (r.stuckReport) console.log(`  ⚠ seed ${seeds[i]} 봇 끼임 → ${r.stuckReport}`);
  }
  return results;
}

const cautious = report('cautious', '신중한 플레이 — 청소기가 가까우면 물러난다');
const reckless = report('reckless', '무모한 플레이 — 청소기를 무시하고 영역만 채운다');

const avg = (rs: ProbeResult[], f: (r: ProbeResult) => number): number =>
  rs.reduce((s, r) => s + f(r), 0) / rs.length;

const modelCycle = analytic().cycleSec;
console.log('\n=== 모델 대조 ===');
console.log(`모델 가정 사이클 : ${n(modelCycle, 2)}초  (BalanceModel.cycleTime)`);
console.log(`모델 예상 도달   : ${n(simulate().timeSec, 0)}초`);
console.log(
  `신중한 플레이     : 사이클 ${n(avg(cautious, (r) => r.cycleSec), 2)}초 / ` +
    `도달 ${n(avg(cautious, (r) => r.clearedAtSec ?? 1800), 0)}초 / ` +
    `평균 피해 ${n(avg(cautious, (r) => r.starvedHits), 1)}`,
);
console.log(
  `무모한 플레이     : 사이클 ${n(avg(reckless, (r) => r.cycleSec), 2)}초 / ` +
    `도달 ${n(avg(reckless, (r) => r.clearedAtSec ?? 1800), 0)}초 / ` +
    `평균 피해 ${n(avg(reckless, (r) => r.starvedHits), 1)}`,
);

// ── MVP 게이트 판정 ──
const allCleared = [...cautious, ...reckless].every((r) => r.clearedAtSec !== null);
const cautiousSurvives = cautious.every((r) => r.starvedHits < CONFIG.MAX_HEARTS);
const recklessDies = reckless.some((r) => r.starvedHits >= CONFIG.MAX_HEARTS);
const inWindow = cautious.filter(
  (r) => r.clearedAtSec !== null && r.clearedAtSec >= 300 && r.clearedAtSec <= 480,
).length;

console.log('\n=== MVP 게이트 ===');
console.log(`${allCleared ? '✅' : '❌'} 치트 없이 클리어 가능 (전 시드·전 성향)`);
console.log(`${cautiousSurvives ? '✅' : '❌'} 신중하게 플레이하면 죽지 않고 클리어`);
console.log(`${recklessDies ? '✅' : '❌'} 무모하게 플레이하면 죽는다 — 청소기가 실제 위협`);
console.log(`${inWindow >= 3 ? '✅' : '⚠️'} 신중한 플레이 ${inWindow}/${seeds.length} 시드가 5~8분 구간`);

const V = DERIVED.TOTAL_CELLS - new GameState(1).collision.blockedCells;
console.log(`\n유효 셀 ${V} / 목표 ${Math.round(V * CONFIG.TARGET_RATIO)}셀`);

if (!allCleared || !cautiousSurvives) process.exitCode = 1;
