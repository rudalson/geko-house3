import { expect, test } from '@playwright/test';
import { advanceGameTime, collectConsoleErrors, snap, startGame } from './helpers.ts';

/**
 * **실시간 진행**을 재는 두 건만 따로 모았다. 이 파일에서는 트레이스를 끈다.
 *
 * `retain-on-failure` 는 **통과해도 녹화는 계속** 한다. 녹화 비용이 프레임에
 * 그대로 얹히므로, 프레임 시간을 재는 테스트에서는 계측기가 계측 대상을 흔든다.
 * 실제로 여기서 한참 헤맸다 — 같은 작업본이 트레이스를 끄면 통과하고 켜면
 * 실패했으며, HEAD(쿼터뷰)도 트레이스를 켜면 똑같이 실패했다. 두 테스트는
 * 렌더 성능이 아니라 **녹화 오버헤드**를 재고 있었던 셈이다.
 *
 * 잣대는 하나도 느슨하게 하지 않았다 — 버린 시간 1.0초, 게임 시간 60초 그대로다.
 * 흔드는 도구만 뗀다. 실패했을 때의 단서는 스크린샷과 실패 메시지의 수치로 충분하다.
 *
 * 파일을 나눈 것은 Playwright 제약이다. `test.use({ trace })` 는 describe 안에
 * 쓸 수 없고 (워커를 새로 띄워야 해서) 파일 최상단에서만 먹는다.
 */
test.use({ trace: 'off' });

test('소크: 실제 키 입력으로 계속 플레이해도 상태가 망가지지 않는다', async ({
  page,
}, testInfo) => {
  test.setTimeout(260_000);
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 씬이 실제로 들고 있는 리소스 수. 보이든 안 보이든 다 센다.
  const before = await page.evaluate(() => window.__GAME__.debug.sceneStats());
  const beforeTextures = await page.evaluate(() => window.__GAME__.debug.info().textures);

  // 페이지 안에서 실제 KeyboardEvent 를 쏜다 — InputManager 를 포함한
  // 입력 경로 전체를 그대로 통과시키기 위해서다. (치트 없음)
  const run = await page.evaluate(async () => {
    const g = window.__GAME__;
    g.debug.setTimeScale(2);

    const held = new Set<string>();
    const press = (code: string, down: boolean): void => {
      window.dispatchEvent(
        new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }),
      );
    };
    /** 눌러야 할 이동 키 집합을 그대로 맞춘다 (누른 채 유지되는 키라서) */
    const hold = (want: string[]): void => {
      for (const code of held) if (!want.includes(code)) press(code, false);
      for (const code of want) if (!held.has(code)) press(code, true);
      held.clear();
      for (const code of want) held.add(code);
    };
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

    // `Math.random()` 을 쓰면 실행마다 다른 조작이 되어 실패를 재현할 수 없다.
    // 시드 고정 LCG 로 흔들기만 한다. (§0-5)
    let rngState = 0x1a2b3c4d;
    const rand = (): number => {
      rngState = (rngState * 1664525 + 1013904223) >>> 0;
      return rngState / 0x1_0000_0000;
    };

    const wrap = (a: number): number => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const bearing = (to: { x: number; z: number }): number => {
      const p = g.state.player;
      return wrap(Math.atan2(to.x - p.pos.x, to.z - p.pos.z) - p.facing);
    };

    /**
     * 목표 쪽으로 몸을 돌린다. **시간을 계산하지 않고 실제 facing 을 보고** 멈춘다.
     *
     * 탱크 조작(§25)에서 A/D 는 선회 키다. 한 틱을 통째로 눌러 두면
     * TURN_SPEED(3.6 rad/s) × timeScale 2 로 한 틱에 90° 넘게 돌아 목표를 지나치고,
     * 다음 틱엔 반대로 지나친다 — 봇이 음식 앞에서 제자리 왕복만 하다 끝난다.
     * 틱이 길어질수록 심해지므로 열린 루프로 두면 **스위트 전체를 함께 돌릴 때만**
     * 터지는 테스트가 된다. 그래서 닫힌 루프로 돌린다.
     */
    const faceTo = async (goal: { x: number; z: number }): Promise<void> => {
      for (let i = 0; i < 40; i++) {
        const off = bearing(goal);
        if (Math.abs(off) < 0.15) break;
        // 키가 뒤집혀 보이는 건 맞다. `off` 를 줄이려면 facing 을 키워야 하고,
        // facing 을 키우는 건 좌회전(A)이다 (MovementSystem 의 주석 참고).
        hold([off > 0 ? 'KeyA' : 'KeyD']);
        await sleep(25);
        if (g.state.phase !== 'PLAYING') return;
      }
      hold([]);
    };

    let tick = 0;
    let stuck = 0;
    let last = { x: g.state.player.pos.x, z: g.state.player.pos.z };
    // **게임 시간** 기준으로 돈다. 벽시계로 재면 느린 기계에서 진행이 모자란다.
    const started = g.state.elapsed;
    const until = started + 80;

    /**
     * 탈출구는 **벽시계가 아니라 진행**으로 잡는다.
     *
     * 예전엔 벽시계 100초를 한도로 썼는데, 그건 "멈췄나" 가 아니라 "느리나" 를
     * 재는 잣대다. 헤드리스가 실시간의 0.6배로 돌면 100초에 게임 시간 60초를
     * 겨우 채우고, 그러면 게임이 멀쩡한데도 `시간이 흐르지 않았다` 로 깨진다
     * (실제로 59.5초에서 깨졌다). 성능은 `성능:` 테스트가 따로 잰다.
     *
     * 대신 **게임 시간이 실제로 멎었는지**를 본다. 15초 동안 0.5초도 안 흘렀으면
     * 그건 느린 게 아니라 멈춘 것이다. 벽시계 한도는 그 뒤의 안전망으로만 둔다.
     */
    let mark = g.state.elapsed;
    let markedAt = performance.now();
    const STALL_MS = 15_000;
    const wallCap = performance.now() + 200_000;

    while (g.state.elapsed < until && performance.now() < wallCap) {
      if (g.state.elapsed > mark + 0.5) {
        mark = g.state.elapsed;
        markedAt = performance.now();
      } else if (performance.now() - markedAt > STALL_MS) {
        break; // 게임 시간이 멎었다 — 여기서 끊고 아래 검사에 걸리게 둔다
      }
      const s = g.state;
      const p = s.player.pos;

      // ── 어디로 갈지 ──
      // 순수 무작위 보행은 시작점 주변만 맴돌다 끝난다 — 음식은 6.5 units 밖에
      // 스폰되므로 한 번도 먹지 못하고, 그러면 이 소크는 "게임을 계속 돌린" 게
      // 아니라 "이동만 반복한" 게 된다. 가장 가까운 음식을 향하되 가끔 흔든다.
      let goal: { x: number; z: number } | null = null;
      if (tick % 7 !== 6 && stuck < 3) {
        let bestD = Infinity;
        for (const f of s.foods) {
          if (!f.active) continue;
          const d = Math.hypot(f.pos.x - p.x, f.pos.z - p.z);
          if (d < bestD) {
            bestD = d;
            goal = f.pos;
          }
        }
      }

      if (goal) {
        await faceTo(goal);
        hold(['KeyW']);
      } else {
        // 흔들기 — 벽·가구 구석처럼 평소 안 가는 자리로도 밀어 넣는다.
        // 벽에 코를 박았을 때(stuck)도 여기로 온다. 1인칭에서는 몸을 돌리지 않는 한
        // 벽을 따라 미끄러지지 못하므로, 빠져나오려면 선회가 필요하다.
        hold([(['KeyA', 'KeyD'] as const)[Math.floor(rand() * 2)]!]);
        await sleep(120);
        hold(['KeyW']);
        stuck = 0;
      }
      await sleep(220);

      // 제자리걸음 감지 — 음식 쪽을 향한 채 가구에 박혀 있으면 영원히 못 먹는다.
      stuck = Math.hypot(p.x - last.x, p.z - last.z) < 0.05 ? stuck + 1 : 0;
      last = { x: p.x, z: p.z };

      // ── 무엇을 누를지 ──
      // E 는 상황을 보고 누른다. 매 틱 누르면 가구를 올랐다 내렸다만 반복한다.
      const kind = g.debug.interaction();
      if (kind === 'food' || kind === 'treat' || tick % 13 === 12) {
        press('KeyE', true);
        press('KeyE', false);
      }
      // 게이지가 찼을 때만 싼다 — 빈 게이지로 누르면 안내 토스트만 쌓인다.
      if (s.player.poop >= g.debug.config.POOP_MAX) {
        press('Space', true);
        press('Space', false);
      }

      tick++;
      if (g.state.phase !== 'PLAYING') break;
    }
    hold([]);
    g.debug.setTimeScale(1);
    return { ticks: tick, elapsed: g.state.elapsed - started };
  });

  const after = await page.evaluate(() => {
    const s = window.__GAME__.state;
    return {
      info: window.__GAME__.debug.info(),
      phase: s.phase,
      stance: s.player.stance,
      x: s.player.pos.x,
      z: s.player.pos.z,
      hunger: s.player.hunger,
      foods: s.player.foodsEaten,
      climbedOn: s.player.climbedOn,
      standable: s.collision.canStand(s.player.pos, s.playerRadius),
      activeFoods: s.foods.filter((f) => f.active).length,
      vacuumOk: s.vacuums.every(
        (v) => Number.isFinite(v.pos.x) && Number.isFinite(v.pos.z),
      ),
    };
  });

  // 시뮬레이션이 실제로 진행됐다
  expect(after.info.elapsed, '시간이 흐르지 않았다').toBeGreaterThan(60);
  // 시스템이 살아 있다
  expect(after.hunger, '배고픔이 줄지 않았다 — HungerSystem 정지').toBeLessThan(100);
  expect(after.foods, '먹기가 한 번도 성공하지 않았다').toBeGreaterThan(0);
  // 상태가 깨지지 않았다
  expect(Number.isFinite(after.x) && Number.isFinite(after.z)).toBe(true);
  // `canStand` 는 **거실 바닥에 서 있을 때만** 맞는 잣대다.
  // 이 소크는 E 를 계속 눌러서 가구 위·담요 밑·화장실로도 들어간다.
  // 가구 위 좌표는 solid AABB 한가운데(예: 협탁 3.6, 2.6)라 canStand 가 false 인데,
  // 그건 정상이다. 자세를 보지 않고 단정하면 게임이 멀쩡한데 테스트가 깨진다.
  if (after.stance === 'GROUND') {
    expect(after.standable, `설 수 없는 자리에 있다 (${after.x}, ${after.z})`).toBe(true);
  } else {
    // 특수 자세면 그 자세의 데이터가 맞아떨어져야 한다. 자세만 남고 대상이
    // 사라지면 내려올 수도, 이동 범위를 제한할 수도 없다.
    expect(
      after.stance === 'ON_FURNITURE' ? after.climbedOn !== null : true,
      `ON_FURNITURE 인데 올라탄 가구가 없다`,
    ).toBe(true);
  }
  expect(after.vacuumOk).toBe(true);
  expect(after.activeFoods, '음식이 다시 스폰되지 않는다').toBeGreaterThan(0);

  // 소크가 실제로 게임을 돌렸는지 (조작만 반복한 게 아니라)
  expect(run.elapsed, '게임 시간이 목표만큼 흐르지 않았다').toBeGreaterThan(60);
  expect(run.ticks, '입력 틱이 너무 적다').toBeGreaterThan(50);

  // ── 지속 플레이 중 리소스 (R5) ──
  //
  // `renderer.info.memory` 로 재면 안 된다. three.js 는 메시가 **처음 그려질 때**
  // 지오메트리를 올리므로, Lvl 2 에서 인간이 등장하면 아무것도 새로 만들지
  // 않았는데 카운트가 오른다 (실측: 57 → 59 → 62). 그걸 누수로 읽으면
  // 멀쩡한 코드를 고치게 된다.
  //
  // 씬 그래프가 참조하는 **서로 다른** 리소스 수를 보면 그 착시가 없다.
  // 이 값이 그대로면 한 판 내내 아무것도 새로 할당되지 않은 것이다.
  const scene = await page.evaluate(() => window.__GAME__.debug.sceneStats());
  expect(scene.geometries, `플레이 중 지오메트리가 늘었다 (${before.geometries} → ${scene.geometries})`)
    .toBe(before.geometries);
  expect(scene.materials, `플레이 중 머티리얼이 늘었다 (${before.materials} → ${scene.materials})`)
    .toBe(before.materials);
  expect(scene.objects, `플레이 중 씬 오브젝트가 늘었다 (${before.objects} → ${scene.objects})`)
    .toBe(before.objects);
  expect(after.info.textures, '텍스처가 늘었다').toBe(beforeTextures);

  await snap(page, testInfo, '10-soak');
  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});


test('성능: 60fps 목표에서 프레임 드랍 누적이 없다', async ({ page }) => {
  const { errors } = collectConsoleErrors(page);

  await startGame(page);

  // 시작 직후를 재면 안 된다. 그 구간에는 타이틀 페이드아웃·HUD 등장·처음
  // 보이는 메시의 지연 업로드가 몰려 있어서, 한 번뿐인 히치가 지속적인 성능
  // 문제로 보고된다. 이 테스트가 알고 싶은 건 **누적**이므로 정상 구간을 잰다.
  await advanceGameTime(page, 2);

  const before = await page.evaluate(() => {
    const d = window.__GAME__.debug.info();
    return { dropped: d.droppedTime, elapsed: d.elapsed };
  });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => {
    const d = window.__GAME__.debug.info();
    return { dropped: d.droppedTime, elapsed: d.elapsed };
  });

  const simulated = after.elapsed - before.elapsed;
  const dropped = after.dropped - before.dropped;

  // 헤드리스 렌더링은 실제 GPU 보다 느려서 프레임이 자주 늘어진다.
  // §0-5 대로 캐치업 한도를 넘긴 시간은 버려지므로 droppedTime 이 0 은 아니다.
  // 여기서 잡고 싶은 건 "죽음의 나선"(따라잡기가 계속 밀려 시뮬레이션이 정지)이다.
  expect(simulated, `시뮬레이션이 실시간의 절반도 못 따라간다 (${simulated.toFixed(2)}초/2초)`)
    .toBeGreaterThan(1.0);
  expect(dropped, `벽시계 2초 동안 ${dropped.toFixed(2)}초를 버렸다 — 성능 문제`)
    .toBeLessThan(1.0);

  expect(errors, `콘솔 에러:\n${errors.join('\n')}`).toEqual([]);
});
