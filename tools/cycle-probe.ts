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
import { EventBus } from '../src/core/EventBus.ts';
import { Cell, Stance, dist, type DamageSource, type Vec2 } from '../src/core/types.ts';
import {
  angleDelta,
  headingTo,
  updateMovement,
  type MoveInput,
} from '../src/systems/MovementSystem.ts';
import { startPoop, updatePoop } from '../src/systems/PoopSystem.ts';
import { updateHunger } from '../src/systems/HungerSystem.ts';
import { isDead, updateInvulnerability } from '../src/systems/DamageSystem.ts';
import { initFoods, updateSpawns } from '../src/systems/SpawnSystem.ts';
import {
  INTERACT_RANGE,
  executeInteraction,
  findInteraction,
  updateEating,
} from '../src/systems/InteractionSystem.ts';
import { cellCenter } from '../src/systems/TerritorySystem.ts';
import { climbableFurniture, findFurniture } from '../src/world/furnitureLayout.ts';
import { nextWaypoint } from '../src/systems/Pathfinding.ts';
import { initVacuums, updateVacuums } from '../src/systems/VacuumSystem.ts';
import { updateShelterTimers } from '../src/systems/ShelterSystem.ts';
import { resetHumans, updateHumans } from '../src/systems/HumanSystem.ts';
import { initTreats, updateTreats } from '../src/systems/TreatSystem.ts';
import { despawnMate, resetMate, updateMate } from '../src/systems/MateSystem.ts';
import { analytic, simulate } from '../src/core/BalanceModel.ts';

const DT = CONFIG.FIXED_DT;

/**
 * 목표 지점을 향하는 **탱크 조작** 입력. (§25)
 *
 * 쿼터뷰 시절에는 목표 방향을 8방향으로 양자화해서 그대로 넘기면 끝이었다 —
 * 방향 전환 비용이 0 이었다. 1인칭 탱크 조작에서는 먼저 몸을 돌려야 하고,
 * **그 선회 시간이 사이클에 그대로 얹힌다.** 이 함수가 실제 플레이어보다
 * 효율적으로 돌면 측정된 사이클이 실제보다 짧게 나오고, §3 의 도달 시간
 * 검증 전체가 낙관 쪽으로 거짓말을 하게 된다.
 *
 * 그래서 사람이 할 법한 것만 한다: 크게 틀어져 있으면 서서 돌고,
 * 어지간히 맞았으면 돌면서 전진한다.
 *
 * @param slide 끼었을 때 쓰는 회피 모드.
 *   0 = 평소 / 1 = 어긋나 있어도 계속 밀어붙인다 / 2 = 후진하며 돈다
 */
function steer(from: Vec2, facing: number, to: Vec2, slide = 0): MoveInput {
  // 벽 모서리에 쐐기처럼 낀 상태. 사람이라면 뒤로 빼면서 몸을 돌린다.
  if (slide === 2) return { forward: -1, turn: 1, run: false };

  const off = angleDelta(facing, headingTo(from, to));

  // 한 스텝에 돌 수 있는 양보다 적게 남았으면 정렬된 것으로 본다.
  // 이 여유가 없으면 목표 각도 근처에서 좌우로 영원히 떤다.
  const perStep = CONFIG.TURN_SPEED * DT;
  const turn = Math.abs(off) <= perStep ? 0 : Math.sign(off);

  // 90도 넘게 틀어져 있으면 제자리에서 돈다 — 그대로 전진하면 목표에서 멀어진다.
  // slide 1 에서는 예외로 밀어붙인다. 그래야 모서리에서 옆으로 빠져나온다.
  const forward = Math.abs(off) > Math.PI / 2 && slide === 0 ? 0 : 1;

  return { forward, turn, run: false };
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

/**
 * 인간에게 쫓기는 중이면 가장 가까운 피난처(담요·등반 가구)를 돌려준다.
 *
 * **도망만 치면 굶어 죽는다.** 인간은 플레이어와 속도가 거의 같아서
 * 계속 달아나면 음식을 먹을 시간이 없다. §24 가 의도한 대응은 도주가 아니라
 * "담요·가구로 시야를 끊는 것"이다. 봇도 그렇게 플레이해야 실제 비용을 잰다.
 */
function shelterFromHuman(state: GameState): Vec2 | null {
  if (!state.humans.some((h) => h.mode === 'chase')) return null;

  const p = state.player.pos;
  const spots: Vec2[] = [];

  const blanket = findFurniture('blanket');
  if (blanket) spots.push({ x: blanket.x, z: blanket.z });
  for (const f of climbableFurniture()) {
    // 가구는 옆에 붙어야 올라갈 수 있다
    spots.push({ x: f.x, z: f.z + f.d / 2 + 0.8 });
  }

  return spots.sort((a, b) => dist(p, a) - dist(p, b))[0] ?? null;
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
  /** 하트가 0 이 된 시각. 살아남았으면 null */
  diedAtSec: number | null;
  poops: number;
  foods: number;
  cycleSec: number;
  finalRatio: number;
  hungerMin: number;
  starvedHits: number;
  /** 하트를 깎은 원인별 횟수. "무엇을 고쳐야 하는가" 가 여기서 갈린다 */
  damageBy: Record<DamageSource, number>;
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

function probe(seed: number, style: PlayStyle, capSec = 1800, useMate = false): ProbeResult {
  const state = new GameState(seed);
  state.setPhase('PLAYING');
  initFoods(state);
  initVacuums(state);
  initTreats(state);
  resetHumans(state);
  resetMate(state);
  // 짝을 안 쓰는 대조군에서는 아예 등장시키지 않는다. 그래야 두 수치가
  // "짝을 썼는가" 하나만 다른 비교가 된다.
  if (!useMate) despawnMate(state);

  // 하트가 무엇에 깎였는지 센다. 총합만 보면 "굶어 죽었다" 와 "청소기에 받혔다"
  // 를 구분할 수 없어, 어느 상수를 만져야 하는지 알 수 없다.
  const bus = new EventBus();
  const damageBy: Record<DamageSource, number> = {
    vacuum: 0,
    human: 0,
    starvation: 0,
    dog: 0,
  };
  bus.on('player:damaged', ({ source }) => {
    damageBy[source]++;
  });

  let t = 0;
  let hungerMin = CONFIG.HUNGER_MAX;
  const startHearts = state.player.hearts;

  // 봇이 끼면 결과가 조용히 망가지므로(사이클이 수백 초로 나온다) 감지해서 알린다.
  let stuckFor = 0;
  const lastPos = { x: NaN, z: NaN };
  let stuckReport = '';

  while (t < capSec) {
    const p = state.player;
    let input: MoveInput = { forward: 0, turn: 0, run: false };

    // 피난처 안에 있다 — 인간이 물러날 때까지 기다렸다가 나온다.
    // (화장실·가구 위도 같은 처리: 추적이 끊기면 곧바로 복귀)
    if (p.stance !== Stance.GROUND) {
      const stillHunted = state.humans.some((h) => h.mode === 'chase' || h.giveupLeft > 2);
      if (!stillHunted) executeInteraction(state);
      updateMovement(state, input, DT);
      updateEating(state, DT);
      updatePoop(state, DT);
      updateSpawns(state, DT);
      updateTreats(state, DT);
      updateMate(state, DT);
      updateVacuums(state, DT, bus);
      updateHumans(state, DT, bus);
      updateHunger(state, DT, bus);
      updateInvulnerability(state, DT);
      updateShelterTimers(state, DT);
      state.elapsed += DT;
      t += DT;
      continue;
    }

    // 끼어 있으면 회피 모드를 올린다.
    const slide = stuckFor > 0.6 ? 2 : stuckFor > 0.15 ? 1 : 0;

    // 인간에게 쫓기면 피난처로. 그다음이 청소기 회피, 그다음이 목표다.
    const shelter = style === 'cautious' ? shelterFromHuman(state) : null;
    const flee = shelter ?? (style === 'cautious' ? avoidVacuum(state) : null);

    // 피난처에 닿았는지는 거리로 재지 말고 **실제 상호작용이 잡히는지**로 판단한다.
    // 거리로 재면 "가까이는 갔는데 진입 판정은 안 되는" 지점에서 영원히 맴돈다.
    const here = shelter ? findInteraction(state) : null;
    if (here && (here.kind === 'climb-up' || here.kind === 'blanket-hide')) {
      executeInteraction(state);
    } else if (flee) {
      input = steer(p.pos, p.facing, nextWaypoint(state.collision, state.playerRadius, p.pos, flee), slide);
    } else if (useMate && state.mate.active && !state.isPregnant) {
      // 짝이 나와 있으면 곧바로 간다 — BalanceModel 의 useMate 와 같은 가정이다.
      if (findInteraction(state)?.kind === 'mate') executeInteraction(state);
      else {
        const wp = nextWaypoint(state.collision, state.playerRadius, p.pos, state.mate.pos);
        input = steer(p.pos, p.facing, wp, slide);
      }
    } else if (p.poop >= CONFIG.POOP_MAX) {
      // 게이지가 찼다 — 미개척지로 가서 싼다
      const spot = nearestEmpty(state);
      if (spot && dist(p.pos, spot) > CONFIG.CELL_SIZE) {
        const wp = nextWaypoint(state.collision, state.playerRadius, p.pos, spot);
        input = steer(p.pos, p.facing, wp, slide);
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
          input = steer(p.pos, p.facing, wp, slide);
        }
      }
    }

    updateMovement(state, input, DT);
    updateEating(state, DT);
    updatePoop(state, DT);
    updateSpawns(state, DT);
    updateTreats(state, DT);
    updateMate(state, DT);
    updateVacuums(state, DT, bus);
    updateHumans(state, DT, bus);
    updateHunger(state, DT, bus);
    updateInvulnerability(state, DT);
    // 바닥에 있어도 반드시 돌려야 한다. 가구에서 **내려온 직후**의 등반 보간이
    // 여기서 줄어드는데, 이걸 빼먹으면 `climbAnimLeft` 가 영영 0 이 되지 않아
    // `canMove` 가 false 로 굳는다 — 봇이 그 자리에서 굶어 죽는다.
    // (§3-8e 의 "인간 있으면 0/5 아사" 가 이 누락으로 오염돼 있었다.)
    updateShelterTimers(state, DT);

    state.elapsed += DT;
    t += DT;
    hungerMin = Math.min(hungerMin, p.hunger);

    // ── 끼임 감지 ──
    // 입력이 없는 정지(음식 리스폰 대기)는 끼임이 아니다.
    // **제자리 선회도 끼임이 아니다** (§25) — 탱크 조작에서는 크게 틀어져 있으면
    // 서서 도는 게 정상이라, 이걸 안 빼면 방향을 바꿀 때마다 끼었다고 보고한다.
    const wantsToMove = input.forward !== 0;
    const moved = Math.hypot(p.pos.x - lastPos.x, p.pos.z - lastPos.z);
    if (wantsToMove && moved < 1e-4 && p.eatAnimLeft <= 0 && p.poopAnimLeft <= 0) {
      stuckFor += DT;
      if (stuckFor > 3 && !stuckReport) {
        // **왜** 못 움직이는지까지 적는다. 좌표만 있으면 "가구에 낀 것"과
        // "자세 때문에 이동이 잠긴 것"을 구분할 수 없어 원인을 못 짚는다.
        stuckReport =
          `t=${t.toFixed(0)}s pos=(${p.pos.x.toFixed(3)},${p.pos.z.toFixed(3)}) ` +
          `poop=${p.poop} 목표=${p.poop >= CONFIG.POOP_MAX ? '배변지' : '음식'} ` +
          `입력=(전진 ${input.forward},선회 ${input.turn}) ` +
          `시선=${p.facing.toFixed(2)} ` +
          `자세=${p.stance} 이동가능=${state.canMove} ` +
          `설수있음=${state.collision.canStand(p.pos, state.playerRadius)} ` +
          `r=${state.playerRadius.toFixed(3)} Lvl${p.levelIndex + 1}` +
          `${p.pregnantLeft > 0 ? ' 임신' : ''}` +
          `${p.climbAnimLeft > 0 ? ' 등반중' : ''}` +
          `${p.transitionLeft > 0 ? ' 전환중' : ''}`;
      }
    } else {
      stuckFor = 0;
    }
    lastPos.x = p.pos.x;
    lastPos.z = p.pos.z;

    // 하트가 0 이면 실제 게임에서는 GAME_OVER 다. 계속 돌리면 사이클 수치가
    // 의미를 잃는다 (죽은 채로 배회한 시간까지 분모에 들어간다).
    if (isDead(state)) {
      return {
        clearedAtSec: null,
        diedAtSec: t,
        poops: state.stats.poops,
        foods: p.foodsEaten,
        cycleSec: t / Math.max(1, state.stats.poops),
        finalRatio: state.territoryRatio,
        hungerMin,
        starvedHits: startHearts - p.hearts,
        damageBy,
        stuckReport,
      };
    }

    if (state.targetReached) {
      return {
        clearedAtSec: t,
        diedAtSec: null,
        poops: state.stats.poops,
        foods: p.foodsEaten,
        cycleSec: t / Math.max(1, state.stats.poops),
        finalRatio: state.territoryRatio,
        hungerMin,
        starvedHits: startHearts - p.hearts,
        damageBy,
        stuckReport,
      };
    }
  }

  return {
    clearedAtSec: null,
    diedAtSec: null,
    poops: state.stats.poops,
    foods: state.player.foodsEaten,
    cycleSec: t / Math.max(1, state.stats.poops),
    finalRatio: state.territoryRatio,
    hungerMin,
    starvedHits: startHearts - state.player.hearts,
    damageBy,
    stuckReport,
  };
}

// ════════════════════════════════════════════════════════════════════════
const n = (x: number, d = 1): string => x.toFixed(d);
const seeds = [1, 7, 42, 1337, 2024];

function report(style: PlayStyle, label: string, useMate = false): ProbeResult[] {
  const results = seeds.map((s) => probe(s, style, 1800, useMate));

  console.log(`\n=== ${label} ===`);
  console.log(
    'seed\t사이클(초)\t배변\t음식\t도달(초)\t도달(분)\t최저 배고픔\t받은 피해\t원인(청소기/인간/굶주림/개)',
  );
  for (let i = 0; i < seeds.length; i++) {
    const r = results[i]!;
    console.log(
      `${seeds[i]}\t${n(r.cycleSec, 2)}\t\t${r.poops}\t${r.foods}\t` +
        `${
        r.clearedAtSec
          ? r.clearedAtSec.toFixed(0)
          : r.diedAtSec
            ? `☠${r.diedAtSec.toFixed(0)}`
            : '미도달'
      }\t\t` +
        `${r.clearedAtSec ? n(r.clearedAtSec / 60, 1) : '-'}\t\t` +
        `${n(r.hungerMin, 0)}\t\t${r.starvedHits}\t\t` +
        `${r.damageBy.vacuum}/${r.damageBy.human}/${r.damageBy.starvation}/${r.damageBy.dog}`,
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
// §24 재검증: 확장 기능(짝)을 최대한 써도 5~8분 구간을 벗어나지 않아야 한다.
const withMate = report(
  'cautious',
  '신중한 플레이 + 짝을 최대한 활용 (§3-8h)',
  true,
);

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
