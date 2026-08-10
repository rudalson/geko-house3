import { CONFIG } from './GameConfig.ts';

/**
 * 고정 타임스텝 accumulator. §0-5
 *
 * 로직은 항상 정확히 1/60초 간격으로 갱신되고, 렌더링만 가변 프레임으로 돈다.
 * `deltaTime` 을 로직에 그대로 곱하지 않으므로 "초당 1.5 감소" 같은 값이
 * 프레임률에 따라 달라지지 않는다.
 *
 * 프레임 드랍 시 MAX_CATCHUP_STEPS 까지만 따라잡고 나머지는 버린다
 * (spiral of death 방지).
 *
 * Three.js 를 import 하지 않으므로 node 환경에서 그대로 테스트할 수 있다.
 */
export class GameLoop {
  private accumulator = 0;
  /** 렌더 보간용 [0, 1). 현재 프레임이 두 로직 스텝 사이 어디쯤인지 */
  alpha = 0;
  /** 이번 프레임에 실제로 실행된 로직 스텝 수 (디버그용) */
  lastStepCount = 0;
  /**
   * 캐치업 한도를 넘겨 버린 시간의 누적 (디버그용).
   *
   * **한 판 단위**의 값이다. 판이 시작될 때 `resetStats()` 로 0 이 된다.
   * 누적을 계속 이어가면 로딩·타이틀 구간의 히치(셰이더 컴파일, 첫 렌더)가
   * 플레이 중 성능 문제로 둔갑한다 — 실제로 §19 패널과 E2E 성능 테스트가
   * 그 값을 읽고 있었다.
   */
  droppedTime = 0;

  constructor(
    private readonly onFixedUpdate: (dt: number) => void,
    private readonly timeScale: () => number = () => 1,
  ) {}

  /**
   * @param frameDt 실제 경과 시간(초). 탭 복귀 등으로 튀는 값은 호출 측에서 reset 한다.
   */
  advance(frameDt: number): void {
    const dt = CONFIG.FIXED_DT;
    this.accumulator += frameDt * this.timeScale();

    let steps = 0;
    while (this.accumulator >= dt) {
      if (steps >= CONFIG.MAX_CATCHUP_STEPS) {
        // 따라잡기를 포기하고 남은 시간을 버린다.
        this.droppedTime += this.accumulator;
        this.accumulator = 0;
        break;
      }
      this.onFixedUpdate(dt);
      this.accumulator -= dt;
      steps++;
    }

    this.lastStepCount = steps;
    this.alpha = this.accumulator / dt;
  }

  /**
   * 탭 비활성 복귀 시 호출. 누적된 시간을 한꺼번에 소비하지 않도록 비운다. (§20)
   */
  reset(): void {
    this.accumulator = 0;
    this.alpha = 0;
    this.lastStepCount = 0;
  }

  /**
   * 판이 시작될 때 호출. 계측값만 비운다.
   *
   * `reset()` 과 나눠 둔 이유: `reset()` 은 탭 복귀·긴 프레임마다 불린다.
   * 거기서 `droppedTime` 까지 지우면 **버려진 시간을 지우는 게 곧 버리는 순간**이라
   * 이 계측값이 영원히 0 에 가깝게 나온다.
   */
  resetStats(): void {
    this.droppedTime = 0;
    this.lastStepCount = 0;
  }
}
