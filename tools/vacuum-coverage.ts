/**
 * 청소기 커버리지 실측. (§12 "골고루 훑는가")
 *
 *   node tools/vacuum-coverage.ts [초] [시드 개수]
 *
 * 청소기는 무작위 반사로 움직인다. 그런 움직임은 **평균적으로는** 방을 고루 훑지만,
 * 한 판 안에서 그런지는 돌려봐야 안다. 여기서 재는 것은 두 가지다.
 *
 *   - 커버리지: 설 수 있는 셀 중 몇 %를 지나갔는가
 *   - 편중도: 방을 4x3 구역으로 나눴을 때 가장 많이 머문 구역과 가장 적게 머문 구역의 비
 *
 * 편중도가 크면 "한쪽만 깨끗하고 반대쪽은 그대로"가 되어, 플레이어는 청소기를
 * 피하는 게 아니라 그냥 반대편에 눌러앉게 된다.
 */

import { CONFIG, DERIVED } from '../src/core/GameConfig.ts';
import { GameState } from '../src/core/GameState.ts';
import { Cell, Phase } from '../src/core/types.ts';
import { initVacuums, updateVacuums } from '../src/systems/VacuumSystem.ts';

const SECONDS = Number(process.argv[2] ?? 240);
const RUNS = Number(process.argv[3] ?? 12);
const DT = 1 / 60;
const ZONES_X = 4;
const ZONES_Z = 3;

interface Result {
  coverage: number;
  imbalance: number;
  zones: number[];
}

function run(seed: number): Result {
  const state = new GameState(seed);
  state.setPhase(Phase.PLAYING);
  // 플레이어를 구석에 치워 둔다 — 충돌로 데미지가 나면 그 자체는 여기서 관심 밖이다.
  state.player.pos = { x: -7.5, z: -5.5 };
  initVacuums(state);

  const visited = new Uint8Array(DERIVED.TOTAL_CELLS);
  const zones = new Array<number>(ZONES_X * ZONES_Z).fill(0);

  for (let i = 0; i < SECONDS / DT; i++) {
    updateVacuums(state, DT);

    for (const v of state.vacuums) {
      const cx = Math.floor((v.pos.x + DERIVED.ROOM_W / 2) / CONFIG.CELL_SIZE);
      const cz = Math.floor((v.pos.z + DERIVED.ROOM_H / 2) / CONFIG.CELL_SIZE);
      if (cx < 0 || cz < 0 || cx >= CONFIG.GRID_W || cz >= CONFIG.GRID_H) continue;
      visited[cz * CONFIG.GRID_W + cx] = 1;

      const zx = Math.min(ZONES_X - 1, Math.floor((cx / CONFIG.GRID_W) * ZONES_X));
      const zz = Math.min(ZONES_Z - 1, Math.floor((cz / CONFIG.GRID_H) * ZONES_Z));
      zones[zz * ZONES_X + zx]!++;
    }
  }

  let standable = 0;
  let seen = 0;
  for (let i = 0; i < visited.length; i++) {
    if (state.grid[i] === Cell.BLOCKED) continue;
    standable++;
    if (visited[i]) seen++;
  }

  const total = zones.reduce((a, b) => a + b, 0);
  const share = zones.map((z) => z / total);
  const max = Math.max(...share);
  const min = Math.min(...share);

  return { coverage: seen / standable, imbalance: min > 0 ? max / min : Infinity, zones: share };
}

const results = Array.from({ length: RUNS }, (_, i) => run(1000 + i * 7919));
const avg = (f: (r: Result) => number): number =>
  results.reduce((a, r) => a + f(r), 0) / results.length;

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
/** 한 구역에 몰린 정도. 이게 큰 판이 곧 "청소기가 한쪽에만 머문" 판이다. */
const hottest = results.map((r) => Math.max(...r.zones));
const even = 1 / (ZONES_X * ZONES_Z);

console.log(`청소기 커버리지 — ${SECONDS}초 x ${RUNS}판\n`);
console.log(
  `  지나간 셀 비율    평균 ${pct(avg((r) => r.coverage))}  최악 ${pct(Math.min(...results.map((r) => r.coverage)))}`,
);
console.log(
  `  구역 편중도       평균 ${avg((r) => r.imbalance).toFixed(1)}배  최악 ${Math.max(...results.map((r) => r.imbalance)).toFixed(1)}배`,
);
console.log(
  `  한 구역 최대 점유  평균 ${pct(hottest.reduce((a, b) => a + b, 0) / hottest.length)}  최악 ${pct(Math.max(...hottest))}  (균등하면 ${pct(even)})`,
);

// 가장 편중이 심했던 판의 구역별 체류 비율을 방 모양 그대로 찍는다.
const worst = results.reduce((a, b) => (Math.max(...a.zones) > Math.max(...b.zones) ? a : b));
console.log(`\n  최악 판의 구역별 체류 비율 (균등하면 각 ${((100 / (ZONES_X * ZONES_Z)) | 0)}%)`);
for (let z = 0; z < ZONES_Z; z++) {
  const row = [];
  for (let x = 0; x < ZONES_X; x++) row.push(`${(worst.zones[z * ZONES_X + x]! * 100).toFixed(1)}%`.padStart(7));
  console.log(`   ${row.join('')}`);
}
