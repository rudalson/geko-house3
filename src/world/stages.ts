/**
 * 미션(스테이지) 정의. 순수 데이터. (§0-4)
 *
 * 미션 1 은 거실, 미션 2 는 야외 캠프장이다. 거실에서 목표치를 채우면 다음
 * 미션으로 넘어간다 (`Game` 의 클리어 화면).
 *
 * ## 규칙은 그대로, 판만 바뀐다
 * 두 미션은 **같은 격자·같은 밸런스 상수**를 쓴다. 바뀌는 것은 배치(→ 충돌·
 * BLOCKED·메시가 모두 여기서 파생된다)와 화장실 유무, 그리고 화면의 말뿐이다.
 * 시스템은 `state.stage` 만 보면 되고, 어느 미션인지 분기하지 않는다 —
 * "담요" 는 `kind: 'blanket'` 인 무엇이든이고, "올라갈 수 있는 것" 은
 * `climbable` 인 무엇이든이다.
 *
 * Three.js 를 import 하지 않는다. (§0-4)
 */

import { LIVING_ROOM_FURNITURE, type FurnitureDef } from './furnitureLayout.ts';
import { OUTDOOR_LAYOUT } from './outdoorLayout.ts';

export type StageId = 'house' | 'outdoor';

/** 미션마다 다른 화면 문구. 로직은 이걸 읽지 않는다. */
export interface StageText {
  /** 미니맵·HUD 에 붙는 장소 이름 */
  place: string;
  /** 은신처에 숨을 때 안내 (`E: … 밑에 숨기`) */
  hide: string;
  /** 은신처에서 나올 때 안내 */
  leave: string;
  /** 은신처에 너무 오래 있었을 때 */
  dogToast: string;
  /** 인간에게 들켰을 때 */
  humanSpotted: string;
  /** 영역을 지우는 적의 이름 (결과 화면) */
  eraser: string;
  /** 미션을 시작할 때 띄우는 한 줄 */
  intro: string;
  /** 클리어 화면 부제 */
  clearSub: string;
}

export interface StageDef {
  id: StageId;
  /** 1부터. 화면 표시용 */
  mission: number;
  /** 클리어에 필요한 똥 땅 비율 [0, 1] */
  targetRatio: number;
  /** 배치. 충돌·BLOCKED·메시가 전부 여기서 파생된다 (§0-2) */
  layout: readonly FurnitureDef[];
  /** 화장실·변기가 있는지 (§6, §14) */
  hasBathroom: boolean;
  /** 클리어하면 넘어갈 미션. 마지막이면 null */
  next: StageId | null;
  text: StageText;

  // ── 배치에서 미리 걸러 둔 것 ──
  // `findInteraction()` 이 매 렌더 프레임 불리므로 그때마다 filter 하지 않는다.
  // 이유는 `furnitureLayout.ts` 의 `CLIMBABLE` 주석과 같다.
  readonly climbable: readonly FurnitureDef[];
  /** 은신처 (`kind: 'blanket'`). 없으면 null */
  readonly hideout: FurnitureDef | null;
  find(id: string): FurnitureDef | undefined;
}

function defineStage(
  base: Omit<StageDef, 'climbable' | 'hideout' | 'find'>,
): StageDef {
  const byId = new Map(base.layout.map((f) => [f.id, f]));
  return {
    ...base,
    climbable: base.layout.filter((f) => f.climbable === true),
    hideout: base.layout.find((f) => f.kind === 'blanket') ?? null,
    find: (id) => byId.get(id),
  };
}

export const STAGES: Readonly<Record<StageId, StageDef>> = {
  house: defineStage({
    id: 'house',
    mission: 1,
    targetRatio: 0.2,
    layout: LIVING_ROOM_FURNITURE,
    hasBathroom: true,
    next: 'outdoor',
    text: {
      place: '집',
      hide: 'E: 담요 밑에 숨기',
      leave: 'E: 담요 밖으로 나가기',
      dogToast: '🐶 강아지가 담요를 차지했다!',
      humanSpotted: '🧍 발견됐다! 담요나 가구 위로!',
      eraser: '청소기',
      intro: '🏠 미션 1 — 거실 바닥을 똥 땅으로!',
      clearSub: '이 집은 이제 네 거야. 다음은 바깥이다.',
    },
  }),
  outdoor: defineStage({
    id: 'outdoor',
    mission: 2,
    targetRatio: 0.4,
    layout: OUTDOOR_LAYOUT,
    hasBathroom: false,
    next: null,
    text: {
      place: '캠프장',
      hide: 'E: 침낭 속에 숨기',
      leave: 'E: 침낭 밖으로 나가기',
      dogToast: '🐶 캠핑 온 강아지가 침낭을 차지했다!',
      humanSpotted: '🐔 닭에게 들켰다! 침낭이나 바위 위로!',
      eraser: '쇠똥구리',
      intro: '🌲 미션 2 — 야외 캠프장! 쇠똥구리가 똥을 굴려 간다. 닭도 조심!',
      clearSub: '집도 마당도 이제 전부 네 거야.',
    },
  }),
};

export const FIRST_STAGE: StageId = 'house';

export function isStageId(v: unknown): v is StageId {
  return typeof v === 'string' && Object.hasOwn(STAGES, v);
}
