import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GameState } from '../src/core/GameState.ts';
import { DungBeetleRenderer } from '../src/entities/DungBeetle.ts';
import { ChickenAvatar } from '../src/entities/chickenAvatar.ts';

/**
 * 미션 2 의 적 겉모습. 로직은 청소기·인간과 같으므로(`VacuumSystem`·`HumanSystem`)
 * 여기서는 **겉모습이 상태를 제대로 읽는지**만 본다. Three.js 오브젝트 계산은
 * WebGL 없이 node 에서 돈다.
 */

function ballRadius(r: DungBeetleRenderer): number {
  let radius = 0;
  r.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry.type === 'IcosahedronGeometry') radius = m.scale.x;
  });
  return radius;
}

describe('쇠똥구리 (청소기 자리)', () => {
  it('지운 셀이 늘수록 똥 공이 커지고, 상한에서 멈춘다', () => {
    const s = new GameState(3, 'outdoor');
    s.vacuums.push({
      id: 0, pos: { x: 0, z: 0 }, heading: 0, straightLeft: 1, turnLeft: 0, turnFrom: 0, turnTo: 0,
      slowLeft: 0, zoneVisits: [], stuckLeft: 0, stuckFrom: { x: 0, z: 0 },
    });
    const beetle = new DungBeetleRenderer(1);

    beetle.update(s, 1 / 60);
    const start = ballRadius(beetle);
    s.stats.erasedCells = 100;
    beetle.update(s, 1 / 60);
    const mid = ballRadius(beetle);
    s.stats.erasedCells = 100_000;
    beetle.update(s, 1 / 60);
    const capped = ballRadius(beetle);

    expect(mid).toBeGreaterThan(start);
    expect(capped).toBeGreaterThan(mid);
    expect(capped).toBeLessThanOrEqual(0.4);
    beetle.dispose();
  });

  it('청소기가 없으면 감춘다', () => {
    const beetle = new DungBeetleRenderer(1);
    beetle.update(new GameState(3, 'outdoor'), 1 / 60);
    expect(beetle.group.children[0]!.visible).toBe(false);
    beetle.dispose();
  });
});

describe('닭 (인간 자리)', () => {
  it('look 으로 깃털 색을 고르고, 음수도 견딘다', () => {
    const chicken = new ChickenAvatar();
    const colors = new Set<number>();
    for (const look of [0, 1, 2, -1]) {
      chicken.setLook(look);
      let c = -1;
      chicken.object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (c < 0 && m.isMesh && m.castShadow) c = (m.material as THREE.MeshLambertMaterial).color.getHex();
      });
      colors.add(c);
    }
    expect(colors.size).toBe(3);
    chicken.dispose();
  });

  it('쫓을 때는 앞으로 숙인다 — 추격 중임이 멀리서도 읽혀야 한다', () => {
    const chicken = new ChickenAvatar();
    const h = { mode: 'idle' } as Parameters<ChickenAvatar['update']>[0];
    chicken.update(h, 0, 1 / 60);
    const torso = chicken.object.children.find((c) => c.type === 'Group' && c.position.x === 0)!;
    const idleTilt = torso.rotation.x;
    chicken.update({ ...h, mode: 'chase' }, 2, 1 / 60);
    expect(torso.rotation.x).toBeGreaterThan(idleTilt);
    chicken.dispose();
  });
});
