// First-person Minecraft-style city controller with 3D spatial-grid building &
// rooftop collision: WASD moves the camera across the scene, Space jumps on the
// street or rooftops, double-tap Space takes off into creative flight (hold
// Space to climb, hold Shift to descend, touch down on any street or building
// roof to land), and horizontal wall collisions prevent walking/flying through
// PLATEAU or placed buildings.
import * as THREE from 'three';

const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.65;
const STEP_HEIGHT = 0.95; // climb curbs, steps, and roof parapets up to ~1 m
const WALK_SPEED = 12; // m/s, responsive street traversal at city scale
const FLY_SPEED = 24; // m/s, creative flight speed (WASD + Space up / Shift down)
const DOUBLE_TAP_MS = 400; // Minecraft's creative-flight double-tap window
const JUMP_SPEED = 7.2; // single Space tap on ground/roof
const GRAVITY = 18;
const ACCEL = 14;
const FLY_COAST_ACCEL = 5;
const LOOK_SENSITIVITY = 0.0023;
const PITCH_LIMIT = Math.PI / 2 - 0.08;
const NEAR_WALK = 0.5;

const CELL_SIZE = 16;

function normalizeKey(event) {
  const { code, key } = event;
  if (code === 'KeyW' || code === 'ArrowUp' || key === 'w' || key === 'W' || key === 'ArrowUp') return 'KeyW';
  if (code === 'KeyS' || code === 'ArrowDown' || key === 's' || key === 'S' || key === 'ArrowDown') return 'KeyS';
  if (code === 'KeyA' || code === 'ArrowLeft' || key === 'a' || key === 'A' || key === 'ArrowLeft') return 'KeyA';
  if (code === 'KeyD' || code === 'ArrowRight' || key === 'd' || key === 'D' || key === 'ArrowRight') return 'KeyD';
  if (code === 'Space' || key === ' ' || key === 'Spacebar') return 'Space';
  if (code === 'ShiftLeft' || code === 'ShiftRight' || key === 'Shift') return 'Shift';
  return null;
}

/**
 * Closest point on 2D segment AB to point (px, pz).
 */
function closestPointOnSegment2D(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  if (len2 < 1e-8) return [ax, az];
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2));
  return [ax + t * abx, az + t * abz];
}

export function createWalkController({ camera, controls, domElement, groundHeightAt, onChange }) {
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  let active = false;
  let dragging = false;
  let flying = false;
  let lastSpaceTap = 0;
  let orbitNear = camera.near;

  // Spatial 2D hash grid of roof triangles and wall segments for O(1) collision queries
  const roofGrid = new Map();
  const wallGrid = new Map();
  const colliderBuckets = new Map();

  function rebuildSpatialGrid() {
    roofGrid.clear();
    wallGrid.clear();
    for (const { roofs, walls } of colliderBuckets.values()) {
      for (const r of roofs) {
        const c0x = Math.floor(r.minX / CELL_SIZE);
        const c1x = Math.floor(r.maxX / CELL_SIZE);
        const c0z = Math.floor(r.minZ / CELL_SIZE);
        const c1z = Math.floor(r.maxZ / CELL_SIZE);
        for (let cx = c0x; cx <= c1x; cx++) {
          for (let cz = c0z; cz <= c1z; cz++) {
            const key = `${cx},${cz}`;
            let list = roofGrid.get(key);
            if (!list) {
              list = [];
              roofGrid.set(key, list);
            }
            list.push(r);
          }
        }
      }
      for (const w of walls) {
        const c0x = Math.floor((w.minX - PLAYER_RADIUS) / CELL_SIZE);
        const c1x = Math.floor((w.maxX + PLAYER_RADIUS) / CELL_SIZE);
        const c0z = Math.floor((w.minZ - PLAYER_RADIUS) / CELL_SIZE);
        const c1z = Math.floor((w.maxZ + PLAYER_RADIUS) / CELL_SIZE);
        for (let cx = c0x; cx <= c1x; cx++) {
          for (let cz = c0z; cz <= c1z; cz++) {
            const key = `${cx},${cz}`;
            let list = wallGrid.get(key);
            if (!list) {
              list = [];
              wallGrid.set(key, list);
            }
            list.push(w);
          }
        }
      }
    }
  }

  /**
   * Registers or replaces a named 3D object tree (e.g., `'plateau'` or `'placed'`)
   * in the collision spatial index so the player can land on its roofs and
   * collide with its walls.
   */
  function setColliderGroup(groupId, rootObject) {
    if (!rootObject) {
      colliderBuckets.delete(groupId);
      rebuildSpatialGrid();
      return;
    }
    rootObject.updateMatrixWorld(true);
    const roofs = [];
    const walls = [];
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const fn = new THREE.Vector3();

    rootObject.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      const nName = (obj.name || '').toLowerCase();
      if (nName.includes('road') || nName.includes('ground') || nName.includes('curtain') || nName.includes('light')) {
        return;
      }
      const geom = obj.geometry;
      const pos = geom?.attributes?.position;
      if (!pos) return;
      const idx = geom.index;
      const mat = obj.matrixWorld;
      const triCount = idx ? idx.count : pos.count;

      for (let t = 0; t < triCount; t += 3) {
        const i0 = idx ? idx.getX(t) : t;
        const i1 = idx ? idx.getX(t + 1) : t + 1;
        const i2 = idx ? idx.getX(t + 2) : t + 2;

        v0.fromBufferAttribute(pos, i0).applyMatrix4(mat);
        v1.fromBufferAttribute(pos, i1).applyMatrix4(mat);
        v2.fromBufferAttribute(pos, i2).applyMatrix4(mat);

        const minY = Math.min(v0.y, v1.y, v2.y);
        const maxY = Math.max(v0.y, v1.y, v2.y);
        if (maxY < 0.6) continue;

        e1.subVectors(v1, v0);
        e2.subVectors(v2, v0);
        fn.crossVectors(e1, e2);
        const len = fn.length();
        if (len < 1e-5) continue;
        fn.divideScalar(len);

        const minX = Math.min(v0.x, v1.x, v2.x);
        const maxX = Math.max(v0.x, v1.x, v2.x);
        const minZ = Math.min(v0.z, v1.z, v2.z);
        const maxZ = Math.max(v0.z, v1.z, v2.z);

        // Walkable roof / terrace / floor slab (upward slope > ~30 deg from vertical)
        if (Math.abs(fn.y) > 0.48) {
          roofs.push({
            ax: v0.x,
            ay: v0.y,
            az: v0.z,
            bx: v1.x,
            by: v1.y,
            bz: v1.z,
            cx: v2.x,
            cy: v2.y,
            cz: v2.z,
            minX,
            maxX,
            minY,
            maxY,
            minZ,
            maxZ,
          });
        }

        // Vertical wall obstacle
        if (Math.abs(fn.y) < 0.45 && maxY - minY > 0.35) {
          // Project triangle to its longest 2D horizontal span so player cylinder pushes out cleanly
          const d01 = (v1.x - v0.x) ** 2 + (v1.z - v0.z) ** 2;
          const d12 = (v2.x - v1.x) ** 2 + (v2.z - v1.z) ** 2;
          const d20 = (v0.x - v2.x) ** 2 + (v0.z - v2.z) ** 2;
          let ax = v0.x;
          let az = v0.z;
          let bx = v1.x;
          let bz = v1.z;
          if (d12 >= d01 && d12 >= d20) {
            ax = v1.x;
            az = v1.z;
            bx = v2.x;
            bz = v2.z;
          } else if (d20 >= d01 && d20 >= d12) {
            ax = v2.x;
            az = v2.z;
            bx = v0.x;
            bz = v0.z;
          }
          if ((bx - ax) ** 2 + (bz - az) ** 2 > 0.04) {
            walls.push({
              ax,
              az,
              bx,
              bz,
              minX,
              maxX,
              minY,
              maxY,
              minZ,
              maxZ,
            });
          }
        }
      }
    });

    colliderBuckets.set(groupId, { roofs, walls });
    rebuildSpatialGrid();
  }

  /**
   * Returns the highest walkable surface Y (ground, plaza, or building rooftop)
   * at (x, z) that sits at or below `maxFootY`.
   */
  function supportHeightAt(x, z, maxFootY = Infinity) {
    let bestY = groundHeightAt(x, z);
    const key = `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
    const list = roofGrid.get(key);
    if (!list) return bestY;

    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.minY > maxFootY || r.maxY <= bestY) continue;
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;

      // 2D barycentric test in XZ plane
      const v0x = r.cx - r.ax;
      const v0z = r.cz - r.az;
      const v1x = r.bx - r.ax;
      const v1z = r.bz - r.az;
      const v2x = x - r.ax;
      const v2z = z - r.az;

      const dot00 = v0x * v0x + v0z * v0z;
      const dot01 = v0x * v1x + v0z * v1z;
      const dot02 = v0x * v2x + v0z * v2z;
      const dot11 = v1x * v1x + v1z * v1z;
      const dot12 = v1x * v2x + v1z * v2z;

      const denom = dot00 * dot11 - dot01 * dot01;
      if (Math.abs(denom) < 1e-8) continue;
      const invDenom = 1 / denom;
      const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
      if (u >= -0.02 && v >= -0.02 && u + v <= 1.02) {
        const y = r.ay + u * (r.cy - r.ay) + v * (r.by - r.ay);
        if (y <= maxFootY && y > bestY) {
          bestY = y;
        }
      }
    }
    return bestY;
  }

  /**
   * Resolves horizontal cylinder collision against nearby building walls.
   * Walls whose top is within `STEP_HEIGHT` above the player's feet are ignored
   * so the player can step onto roof terraces and curbs naturally.
   */
  function resolveWallCollisions(x, z, footY) {
    const bodyBottom = footY + STEP_HEIGHT;
    const bodyTop = footY + EYE_HEIGHT + 0.15;
    let px = x;
    let pz = z;

    for (let pass = 0; pass < 2; pass++) {
      const key = `${Math.floor(px / CELL_SIZE)},${Math.floor(pz / CELL_SIZE)}`;
      const list = wallGrid.get(key);
      if (!list) break;

      for (let i = 0; i < list.length; i++) {
        const w = list[i];
        if (w.maxY <= bodyBottom || w.minY >= bodyTop) continue;
        if (
          px < w.minX - PLAYER_RADIUS ||
          px > w.maxX + PLAYER_RADIUS ||
          pz < w.minZ - PLAYER_RADIUS ||
          pz > w.maxZ + PLAYER_RADIUS
        ) {
          continue;
        }
        const [cx, cz] = closestPointOnSegment2D(px, pz, w.ax, w.az, w.bx, w.bz);
        const dx = px - cx;
        const dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < PLAYER_RADIUS * PLAYER_RADIUS && d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = PLAYER_RADIUS - d;
          px += (dx / d) * push;
          pz += (dz / d) * push;
        }
      }
    }
    return [px, pz];
  }

  function groundYAt(x, z, currentCameraY = camera.position.y) {
    const footY = currentCameraY - EYE_HEIGHT;
    return supportHeightAt(x, z, footY + STEP_HEIGHT) + EYE_HEIGHT;
  }

  function grounded() {
    return camera.position.y <= groundYAt(camera.position.x, camera.position.z) + 0.08;
  }

  function requestLock() {
    if (document.pointerLockElement === domElement) return;
    const request = domElement.requestPointerLock?.();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  }

  function syncFromCamera({ preserveHeight = true } = {}) {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z = 0;
    const supportEyeY = supportHeightAt(camera.position.x, camera.position.z, camera.position.y) + EYE_HEIGHT;
    if (preserveHeight && camera.position.y > supportEyeY + 0.6) {
      flying = true;
    } else {
      camera.position.y = supportEyeY;
      flying = false;
    }
    velocity.set(0, 0, 0);
  }

  function enter({ lock = true, preserveHeight = false } = {}) {
    if (!active) {
      orbitNear = camera.near;
      camera.near = Math.min(camera.near, NEAR_WALK);
      camera.updateProjectionMatrix();
      controls.enabled = false;
      keys.clear();
      lastSpaceTap = 0;
      dragging = false;
      active = true;
      syncFromCamera({ preserveHeight });
      onChange?.(active);
    } else if (!preserveHeight) {
      syncFromCamera({ preserveHeight: false });
    }
    if (lock) requestLock();
  }

  function exit() {
    if (!active) return;
    active = false;
    if (document.pointerLockElement === domElement) document.exitPointerLock?.();
    camera.near = orbitNear;
    camera.updateProjectionMatrix();
    controls.enabled = true;
    camera.getWorldDirection(aim);
    controls.target.copy(camera.position).addScaledVector(aim, 12);
    controls.update();
    keys.clear();
    flying = false;
    lastSpaceTap = 0;
    dragging = false;
    velocity.set(0, 0, 0);
    onChange?.(active);
  }

  function look(dx, dy) {
    euler.y -= dx * LOOK_SENSITIVITY;
    euler.x = THREE.MathUtils.clamp(euler.x - dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
    euler.z = 0;
    camera.quaternion.setFromEuler(euler);
  }

  function onPointerMove(event) {
    if (!active) return;
    if (document.pointerLockElement !== domElement && !dragging) return;
    look(event.movementX ?? 0, event.movementY ?? 0);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    if (!active) enter({ lock: false, preserveHeight: true });
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    if (document.pointerLockElement === domElement) return;
    dragging = true;
  }

  function onPointerUp() {
    dragging = false;
  }

  function onPointerLockChange() {
    if (document.pointerLockElement !== domElement) {
      dragging = false;
    }
  }

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const norm = normalizeKey(event);
    if (!norm) return;

    if (!active) {
      enter({ lock: false, preserveHeight: true });
    }
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    event.preventDefault();

    if (norm === 'Space') {
      if (!event.repeat) {
        const now = performance.now();
        if (now - lastSpaceTap <= DOUBLE_TAP_MS) {
          flying = true;
          lastSpaceTap = 0;
          velocity.y = FLY_SPEED;
        } else {
          lastSpaceTap = now;
          if (!flying && grounded()) {
            velocity.y = JUMP_SPEED;
          }
        }
      }
      keys.add('Space');
      return;
    }

    keys.add(norm);
  }

  function onKeyUp(event) {
    const norm = normalizeKey(event);
    if (norm) keys.delete(norm);
  }

  function update(dt) {
    if (!active) return;
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z = 0;

    const shift = keys.has('Shift');
    const space = keys.has('Space');
    const speed = flying ? FLY_SPEED : WALK_SPEED;
    const ahead = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);

    forward.set(-Math.sin(euler.y), 0, -Math.cos(euler.y));
    right.set(Math.cos(euler.y), 0, -Math.sin(euler.y));

    move.set(0, 0, 0).addScaledVector(forward, ahead).addScaledVector(right, side);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);

    const blend = Math.min(1, ACCEL * dt);
    velocity.x += (move.x - velocity.x) * blend;
    velocity.z += (move.z - velocity.z) * blend;

    const prevY = camera.position.y;
    const nextX = camera.position.x + velocity.x * dt;
    const nextZ = camera.position.z + velocity.z * dt;

    // Resolve horizontal wall collisions against PLATEAU & placed buildings
    const [resolvedX, resolvedZ] = resolveWallCollisions(nextX, nextZ, prevY - EYE_HEIGHT);
    camera.position.x = resolvedX;
    camera.position.z = resolvedZ;

    if (flying) {
      const climb = (space ? 1 : 0) - (shift ? 1 : 0);
      const vBlend = Math.min(1, (climb !== 0 ? ACCEL : FLY_COAST_ACCEL) * dt);
      velocity.y += (climb * FLY_SPEED - velocity.y) * vBlend;
      camera.position.y += velocity.y * dt;

      // Support height beneath current altitude (can land on any building rooftop or street)
      const supportEyeY =
        supportHeightAt(camera.position.x, camera.position.z, Math.max(prevY, camera.position.y) - EYE_HEIGHT + STEP_HEIGHT) +
        EYE_HEIGHT;
      if (camera.position.y <= supportEyeY) {
        camera.position.y = supportEyeY;
        if (shift || velocity.y < 0) {
          velocity.y = 0;
          flying = false; // Touching down on a roof or street lands into walk mode!
        }
      }
    } else {
      velocity.y -= GRAVITY * dt;
      camera.position.y += velocity.y * dt;
      const supportEyeY =
        supportHeightAt(camera.position.x, camera.position.z, prevY - EYE_HEIGHT + STEP_HEIGHT) + EYE_HEIGHT;
      if (camera.position.y <= supportEyeY) {
        camera.position.y = supportEyeY;
        velocity.y = 0;
      }
    }

    camera.getWorldDirection(aim);
    controls.target.copy(camera.position).addScaledVector(aim, 24);
  }

  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('dblclick', () => requestLock());
  window.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  return {
    get active() {
      return active;
    },
    get flying() {
      return flying;
    },
    enter,
    exit,
    syncFromCamera,
    setColliderGroup,
    supportHeightAt,
    toggle: () => {
      if (!active) {
        enter({ lock: true, preserveHeight: true });
      } else if (document.pointerLockElement === domElement) {
        document.exitPointerLock?.();
      } else {
        requestLock();
      }
    },
    update,
  };
}
