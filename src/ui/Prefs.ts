/**
 * 화면 설정 저장. (§16 타이틀 옵션)
 *
 * **게임 상태가 아니다.** 시드·진행도는 저장하지 않는다 — §8 의 재시작 규칙과
 * §0-5 의 결정성은 저장된 값에 의존하면 안 된다. 여기 들어가는 건
 * "소리를 껐다" 처럼 판이 끝나도 유지되기를 기대하는 취향뿐이다.
 *
 * localStorage 는 프라이빗 모드나 iframe 에서 던질 수 있어 전부 감싼다.
 * 실패하면 이번 세션에만 적용되고 조용히 넘어간다.
 */

const KEY = 'gecko-house.prefs.v1';

export interface Prefs {
  sound: boolean;
  tutorial: boolean;
}

const DEFAULTS: Prefs = { sound: true, tutorial: true };

export function loadPrefs(): Prefs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULTS.sound,
      tutorial: typeof parsed.tutorial === 'boolean' ? parsed.tutorial : DEFAULTS.tutorial,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 저장할 수 없는 환경이면 이번 세션에만 적용된다.
  }
}
