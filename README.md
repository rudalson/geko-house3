# 🦎 게코 하우스 서바이벌 (Gecko House Survival)

> 음식을 먹고 똥 게이지를 채운 뒤, 로봇청소기를 피해
> **거실 바닥의 44%를 '똥 땅'으로 만드는** 쿼터뷰 3D 생존·영역 확장 게임.

플레이어는 점(點)으로 칠하고, 로봇청소기는 선(線)으로 지운다.
화면의 초록색이 실시간으로 늘고 줄어드는 것 자체가 게임의 피드백이다.

---

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사(`tsc --noEmit`) + 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm test` | 단위 테스트 (Vitest) |
| `npm run test:e2e` | 스모크 테스트 (Playwright) |
| `npm run balance` | **밸런스 검증** — 불합격이면 exit 1 |
| `node tools/cycle-probe.ts` | 봇 플레이로 실제 사이클·도달 시간 실측 |

E2E 를 처음 돌리기 전에 브라우저를 한 번 받아야 한다: `npx playwright install chromium`

---

## 조작

| 키 | 동작 |
|---|---|
| `WASD` / 방향키 | 8방향 이동 |
| `Shift` | 짧은 달리기 (1.5초 지속 / 3초 쿨다운) |
| `E` 또는 `Z` | 상황별 상호작용 (슈퍼푸드 먹기 등) |
| `Space` | 똥 싸기 |
| `Esc` | 일시정지 |
| `R` | 클리어·게임오버 후 재시작 |

---

## 게임 규칙

1. **슈퍼푸드 3개**를 먹으면 똥 게이지가 가득 찬다.
2. 게이지가 찬 상태에서 `Space` — **1초 동안 움직일 수 없고 무적도 아니다.**
3. 배변 지점 반경이 초록색 '똥 땅'이 된다. **이미 확보한 곳에 겹쳐 싸면 손해다.**
4. 로봇청소기가 돌아다니며 똥 땅을 지운다. 부딪히면 하트가 1개 준다.
5. 거실 유효 바닥의 **44%** 를 확보하면 승리. 하트 3개를 모두 잃으면 패배.

**핵심 트레이드오프**

- 게이지가 가득 찬 상태에서 음식을 먹으면 초과분이 버려진다 → "먼저 쌀지, 더 먹을지"
- 성장하면 배변 반경이 커지지만 **히트박스도 커진다** → 강해질수록 눈에 띈다
- 넓은 미개척지 한복판이 가장 많이 벌지만 가장 위험하다

---

## 기술 스택

TypeScript(`strict`) · Vite · Three.js · Vitest · Playwright.
React 를 쓰지 않는다. **외부 물리 엔진도 쓰지 않는다** — 필요한 건 원-AABB 와
원-원 판정뿐이라 `world/CollisionMap.ts` 에 직접 구현했다.

### 설계 원칙

| 원칙 | 구현 |
|---|---|
| **가구 배치는 한 곳에만** | `world/furnitureLayout.ts` 하나에서 ① 렌더 메시 ② 충돌 AABB ③ 격자 `BLOCKED` 셀이 모두 파생된다 |
| **게임 로직은 Three.js 를 모른다** | `core/`·`systems/` 는 순수 TypeScript. 덕분에 **렌더러 없이 실제 시스템으로 밸런스를 실측**할 수 있다 (`tools/cycle-probe.ts`) |
| **결정적 시뮬레이션** | 고정 1/60초 타임스텝 + 시드 기반 PRNG. 같은 시드는 같은 판을 만든다 |
| **밸런스 계산식은 한 곳에만** | `core/BalanceModel.ts` 가 `GameConfig` 를 직접 읽는다. 상수를 바꾸면 검증 결과가 자동으로 따라온다 |

`tests/architecture.test.ts` 가 이 규칙들을 코드로 강제한다 —
순수 계층의 Three.js import, `Math.random()` 직접 호출, `CONFIG` 중복 정의를 막는다.

---

## 폴더 구조

```
src/
├─ core/        GameConfig · BalanceModel · GameState · GameLoop · Rng · InputManager · EventBus · Game
├─ systems/     Territory · Poop · Hunger · Damage · Spawn · Vacuum · Interaction · Movement · Pathfinding
├─ world/       furnitureLayout(단일 원천) · CollisionMap · LivingRoom · Furniture
├─ entities/    Gecko · RobotVacuum · Food · TerritoryGrid      (상태를 읽어 그리기만)
├─ scenes/      HouseScene · QuarterViewCamera
└─ ui/          HUD · ResultScreen                              (HTML 오버레이)

tools/          balance-check.ts(검증 리포트) · cycle-probe.ts(봇 실측)
tests/          Vitest — Three.js 없이 실행
e2e/            Playwright 스모크
```

---

## 구현된 기능 (MVP)

- [x] 쿼터뷰 3D 거실, 가구 충돌, 카메라 추적 + 가림 가구 반투명
- [x] 8방향 이동 + 짧은 달리기
- [x] 32×24 똥 땅 격자, InstancedMesh 시각화, 실시간 달성률
- [x] 슈퍼푸드 스폰·섭취, 배고픔, 똥 게이지, Age/Lvl 성장
- [x] 로봇청소기 (읽히는 이동 · 청소 · 충돌 피해 · 넉백 · 무적)
- [x] 승리/패배 판정, 결과 화면, `R` 재시작, `Esc` 일시정지
- [x] HTML/CSS HUD

## 아직 구현되지 않은 기능

- [ ] 담요 은신 (`Stance.HIDDEN` 과 배변 차단 로직은 있으나 진입 수단 없음)
- [ ] 화장실·변기 보너스 (`expandFromTerritory` BFS 는 구현·테스트 완료, 진입 수단 없음)
- [ ] 가구 등반 (`climbable` 데이터와 차단 로직은 있으나 진입 수단 없음)
- [ ] 인간 적, 짝 도마뱀, 특식
- [ ] 로딩·타이틀 화면, 사운드, 파티클, 튜토리얼, 디버그 패널 UI

> 위 항목들의 **순수 로직과 테스트는 이미 있다.** 남은 건 상호작용 진입점과 연출이다.
> `TODO(S6)` ~ `TODO(S8)` 주석으로 표시되어 있다.

---

## 밸런스를 바꾸려면

모든 밸런스 상수는 **`src/core/GameConfig.ts` 한 곳**에 있다.

```bash
# 1. GameConfig.ts 수정
# 2. 해석·수치 모델로 재검증 (불합격이면 exit 1)
npm run balance
# 3. 실제 시스템으로 봇 플레이 실측
node tools/cycle-probe.ts
# 4. 회귀 테스트
npm test
```

`tests/balance.test.ts` 가 **평형 점유율 > 0.44** 와 **44% 도달 300~480초**를 강제한다.
이 테스트가 깨지면 상수를 되돌리거나, 의도한 변경이라면 `ROADMAP.md` §3 의 표를 갱신한다.

가구를 옮기면 `BLOCKED` 비율이 바뀐다. 허용 범위(10~15%)를 벗어나면
`tests/collision.test.ts` 가 실패한다. 실측값은 게임 시작 시 콘솔에도 출력된다.

자세한 검증 근거는 [`ROADMAP.md`](./ROADMAP.md) §3 참조.

---

## 참고 이미지

`references/images` 디렉토리가 없어 사용하지 않았다.
모든 에셋은 Three.js 기본 지오메트리와 코드로 만든 로우폴리 메시다.

---

## 알려진 문제

- 프로덕션 번들이 500KB를 넘는다 (Three.js 본체). 코드 스플리팅 미적용.
- 봇 실측 기준 느린 플레이(신중한 회피)는 8~9분이 걸린다. §0-1 기준은 기준
  시나리오(6.7분)로 판정했다.
- 담요·변기·등반은 로직만 있고 진입할 수 없다 — 위 "아직 구현되지 않은 기능" 참조.
