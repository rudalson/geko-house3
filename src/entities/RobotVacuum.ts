/**
 * 로봇청소기 메시. 상태를 읽어 반영만 한다. 단방향. (§0-4)
 *
 * §12 는 "진행 방향에 바닥 조명 또는 화살표 데칼을 표시해 경로를 읽히게" 하라고
 * 요구한다. 청소기는 플레이어보다 5배 느려서 위협은 속도가 아니라
 * **어디로 갈지 아는 것**에서 온다. 그 정보를 화면에 그려줘야 회피가 실력이 된다.
 */

import * as THREE from 'three';
import { CONFIG, DERIVED } from '../core/GameConfig.ts';
import type { GameState } from '../core/GameState.ts';

const BODY_COLOR = 0x4a5560;
const TRIM_COLOR = 0xd8dde3;
const PATH_COLOR = 0xff6b5a;
const SLOW_COLOR = 0x5aa8ff;

interface VacuumMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  path: THREE.Mesh;
  pathMat: THREE.MeshBasicMaterial;
  brush: THREE.Mesh;
}

export class RobotVacuumRenderer {
  readonly group = new THREE.Group();

  private readonly items: VacuumMesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private time = 0;

  constructor(count: number) {
    this.group.name = 'vacuums';

    const r = CONFIG.VACUUM_RADIUS;
    const bodyGeo = this.track(new THREE.CylinderGeometry(r, r * 0.95, 0.16, 20));
    const bodyMat = this.track(new THREE.MeshLambertMaterial({ color: BODY_COLOR }));
    const capGeo = this.track(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.04, 16));
    const capMat = this.track(new THREE.MeshLambertMaterial({ color: TRIM_COLOR }));
    const bumperGeo = this.track(new THREE.BoxGeometry(r * 1.5, 0.1, 0.06));
    const bumperMat = this.track(new THREE.MeshLambertMaterial({ color: TRIM_COLOR }));

    // 청소 범위를 바닥에 링으로 표시 — 어디까지 지워지는지 보이게 한다.
    const brushGeo = this.track(
      new THREE.RingGeometry(
        DERIVED.VACUUM_CLEAN_RADIUS_WORLD * 0.85,
        DERIVED.VACUUM_CLEAN_RADIUS_WORLD,
        20,
      ),
    );
    const brushMat = this.track(
      new THREE.MeshBasicMaterial({ color: TRIM_COLOR, transparent: true, opacity: 0.4 }),
    );

    // 진행 경로 데칼 (§12)
    const pathGeo = this.track(new THREE.PlaneGeometry(0.22, 2.4));
    pathGeo.translate(0, 1.35, 0); // 청소기 앞쪽으로 뻗도록 원점 이동

    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();

      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 0.08;
      body.castShadow = true;
      group.add(body);

      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = 0.18;
      group.add(cap);

      const bumper = new THREE.Mesh(bumperGeo, bumperMat);
      bumper.position.set(0, 0.08, -r * 0.85);
      group.add(bumper);

      const brush = new THREE.Mesh(brushGeo, brushMat);
      brush.rotation.x = -Math.PI / 2;
      brush.position.y = 0.012;
      group.add(brush);

      // 경로 데칼은 청소기 회전과 함께 돌아야 하므로 같은 그룹에 넣는다.
      const pathMat = this.track(
        new THREE.MeshBasicMaterial({
          color: PATH_COLOR,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      ) as THREE.MeshBasicMaterial;
      const path = new THREE.Mesh(pathGeo, pathMat);
      path.rotation.x = -Math.PI / 2;
      path.position.y = 0.008;
      group.add(path);

      this.group.add(group);
      this.items.push({ group, body, path, pathMat, brush });
    }
  }

  private track<T extends THREE.BufferGeometry | THREE.Material>(x: T): T {
    if (x instanceof THREE.BufferGeometry) this.geometries.push(x);
    else this.materials.push(x);
    return x;
  }

  update(state: GameState, dt: number): void {
    this.time += dt;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const v = state.vacuums[i];

      if (!v) {
        item.group.visible = false;
        continue;
      }

      item.group.visible = true;
      item.group.position.set(v.pos.x, 0, v.pos.z);
      // 데칼이 앞(-z 로컬)을 향하도록 π 를 더한다.
      item.group.rotation.y = v.heading + Math.PI;

      // 회전 중에는 경로 데칼을 깜빡여 "방향이 바뀌는 중"임을 알린다.
      const turning = v.turnLeft > 0;
      item.pathMat.opacity = turning ? 0.15 + Math.abs(Math.sin(this.time * 14)) * 0.35 : 0.35;
      item.pathMat.color.setHex(v.slowLeft > 0 ? SLOW_COLOR : PATH_COLOR);

      // 본체는 계속 돌아가는 브러시 느낌으로 살짝 회전
      item.body.rotation.y += dt * (v.slowLeft > 0 ? 1.5 : 3.5);
      item.brush.rotation.z = this.time * 2;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.items.length = 0;
    this.group.clear();
  }
}
