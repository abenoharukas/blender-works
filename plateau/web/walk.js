// First-person Minecraft-style city controller: WASD moves the camera across
// the scene at all times, Space jumps on the street, double-tap Space takes off
// into creative flight (hold Space to climb, hold Shift to descend, touch down
// to land), and the mouse looks around by dragging or under pointer lock (F).
import * as THREE from 'three';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 12; // m/s, responsive street traversal at city scale
const FLY_SPEED = 24; // m/s, creative flight speed (WASD + Space up / Shift down)
const DOUBLE_TAP_MS = 400; // Minecraft's creative-flight double-tap window
const JUMP_SPEED = 6.8; // single Space tap on ground (~1.3 m jump apex)
const GRAVITY = 18;
const ACCEL = 14; // how quickly horizontal & active climb speed settles
const FLY_COAST_ACCEL = 5; // vertical glide damping so a double-tap visibly lifts off
const LOOK_SENSITIVITY = 0.0023;
const PITCH_LIMIT = Math.PI / 2 - 0.08;
// The orbit camera keeps a 1.5 m near plane for depth precision at overview
// distance; eye height 1.7 m makes that personal space feel like a wall.
const NEAR_WALK = 0.5;

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

  function groundYAt(x, z) {
    return groundHeightAt(x, z) + EYE_HEIGHT;
  }

  function grounded() {
    return camera.position.y <= groundYAt(camera.position.x, camera.position.z) + 0.05;
  }

  function requestLock() {
    if (document.pointerLockElement === domElement) return;
    // Chrome returns a promise here; a refusal (no gesture, embedded frame)
    // must not surface as an unhandled rejection — drag-look covers that case.
    const request = domElement.requestPointerLock?.();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  }

  function syncFromCamera({ preserveHeight = true } = {}) {
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    euler.z = 0;
    const groundY = groundYAt(camera.position.x, camera.position.z);
    if (preserveHeight && camera.position.y > groundY + 0.5) {
      flying = true;
    } else {
      camera.position.y = groundY;
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
    // Hand the heading back to OrbitControls: orbit what the eye was looking
    // at, from where the eye stood, so the view does not jump.
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
    // Esc releases the pointer lock so the cursor can use the UI panels, while
    // keeping WASD / Space / Shift movement active across the scene.
    if (document.pointerLockElement !== domElement) {
      dragging = false;
    }
  }

  function onKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const norm = normalizeKey(event);
    if (!norm) return;

    // Auto-engage on any movement or flight key so WASD / Space / Shift work
    // immediately from every view without requiring a prior mode toggle.
    if (!active) {
      enter({ lock: false, preserveHeight: true });
    }
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    event.preventDefault();

    if (norm === 'Space') {
      // Minecraft creative flight: one tap on the ground jumps; a double-tap
      // takes off and boosts upward; holding Space climbs continuously.
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

    if (flying) {
      const climb = (space ? 1 : 0) - (shift ? 1 : 0);
      const vBlend = Math.min(1, (climb !== 0 ? ACCEL : FLY_COAST_ACCEL) * dt);
      velocity.y += (climb * FLY_SPEED - velocity.y) * vBlend;
      camera.position.addScaledVector(velocity, dt);

      const groundY = groundYAt(camera.position.x, camera.position.z);
      if (camera.position.y <= groundY) {
        camera.position.y = groundY;
        if (shift || velocity.y < 0) {
          velocity.y = 0;
          flying = false;
        }
      }
    } else {
      velocity.y -= GRAVITY * dt;
      camera.position.addScaledVector(velocity, dt);
      const groundY = groundYAt(camera.position.x, camera.position.z);
      if (camera.position.y <= groundY) {
        camera.position.y = groundY;
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
  // Losing focus mid-stride should not leave a key stuck down.
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
