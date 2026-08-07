import type { GamePhase, Vec2 } from './types.ts';

/**
 * 시스템 → 렌더/사운드 단방향 통지 채널. (§6-2)
 *
 * 로직(systems/)이 렌더러나 사운드를 직접 호출하지 않게 하려고 존재한다.
 * entities/ · scenes/ · audio/ 는 여기를 **구독만** 한다.
 */
export interface GameEvents {
  'phase:changed': { from: GamePhase; to: GamePhase };

  'player:damaged': { hearts: number; from: Vec2; knockback: Vec2 };
  'player:invulnStart': Record<string, never>;
  'player:starving': { graceLeft: number };
  'player:levelUp': { level: number; age: number };

  'food:spawned': { id: number; pos: Vec2 };
  'food:eaten': { id: number; pos: Vec2; hunger: number; poop: number };

  'poop:started': { pos: Vec2 };
  'poop:done': { pos: Vec2; radiusCells: number; gainedCells: number };
  'poop:blocked': { reason: string };
  'toilet:done': { gainedCells: number };

  'territory:changed': { owned: number; ratio: number };
  'vacuum:cleaned': { pos: Vec2; erasedCells: number };
  'vacuum:turn': { heading: number };

  'blanket:warn': Record<string, never>;
  'blanket:dog': Record<string, never>;

  'stage:clear': { timeSec: number };
  'stage:gameOver': { timeSec: number };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<(p: never) => void>>();

  on<K extends keyof GameEvents>(event: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as (p: never) => void);
    return () => this.off(event, fn);
  }

  off<K extends keyof GameEvents>(event: K, fn: Handler<K>): void {
    this.handlers.get(event)?.delete(fn as (p: never) => void);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // 핸들러가 구독 해제를 호출해도 안전하도록 복사본을 순회한다.
    for (const fn of [...set]) (fn as Handler<K>)(payload);
  }

  /** 재시작 시 리스너 누적을 막기 위해 전부 비운다. (§8) */
  clear(): void {
    this.handlers.clear();
  }

  /** 디버그용: 현재 등록된 총 리스너 수 */
  listenerCount(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}
