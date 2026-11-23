// First-person city walk: WASD moves the camera along the street at eye
// height, the mouse looks around under pointer lock (or by dragging if the
// browser refuses the lock). OrbitControls is parked while walking and takes
// over again from the same spot on exit.
import * as THREE from 'three';

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 3.2; // m/s, a brisk city stroll
const RUN_SPEED = 11;
const ACCEL = 12; // how quickly the walk speed settles
const LOOK_SENSITIVITY = 0.0023;
const PITCH_LIMIT = Math.PI / 2 - 0.08;
// The orbit camera keeps a 1.5 m near plane for depth precision at overview
// distance; eye height 1.7 m makes that personal space feel like a wall.
const NEAR_WALK = 0.5;

const MOVE_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

export function createWalkController({ camera, controls, domElement, groundHeightAt, onChange }) {
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  let active = false;
  let dragging = false;
  let orbitNear = camera.near;

  function requestLock() {
    if (document.pointerLockElement === domElement) return;
    // Chrome returns a promise here; a refusal (no gesture, embedded frame)
    // must not surface as an unhandled rejection — drag-look covers that case.
    const request = domElement.requestPointerLock?.();
    if (request && typeof request.catch === 'function') request.catch(() => {});
  }

  function enter() {
    if (active) return;
    euler.setFromQuaternion(camera.quaternion, 'YXZ');
    camera.position.y = groundHeightAt(camera.position.x, camera.position.z) + EYE_HEIGHT;
    orbitNear = camera.near;
    camera.near = Math.min(camera.near, NEAR_WALK);
    camera.updateProjectionMatrix();
    controls.enabled = false;
    velocity.set(0, 0, 0);
    keys.clear();
    dragging = false;
    active = true;
    // Pointer lock is the nice path; a refused request still leaves drag-look.
    requestLock();
    onChange?.(active);
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
    camera.getWorldDirection(forward);
    controls.target.copy(camera.position).addScaledVector(forward, 12);
    controls.update();
    keys.clear();
    dragging = false;
    velocity.set(0, 0, 0);
    onChange?.(active);
  }

  function look(dx, dy) {
    euler.y -= dx * LOOK_SENSITIVITY;
    euler.x = THREE.MathUtils.clamp(euler.x - dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
    camera.quaternion.setFromEuler(euler);
  }

  function onPointerMove(event) {
    if (!active) return;
    if (document.pointerLockElement !== domElement && !dragging) return;
    look(event.movementX ?? 0, event.movementY ?? 0);
  }

  function onPointerDown(event) {
    if (!active || event.button !== 0) return;
    if (document.pointerLockElement === domElement) return;
    dragging = true;
    requestLock();
  }

  function onPointerUp() {
    dragging = false;
  }

  function onPointerLockChange() {
    // Esc (or the browser) drops the lock, which is the expected way out.
    if (!active || document.pointerLockElement === domElement) return;
    if (dragging) return;
    exit();
  }

  function onKeyDown(event) {
    if (!active) return;
    if (MOVE_CODES.has(event.code)) {
      keys.add(event.code);
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function update(dt) {
    if (!active) return;
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = run ? RUN_SPEED : WALK_SPEED;
    const ahead = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
      - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    move.set(0, 0, 0).addScaledVector(forward, ahead).addScaledVector(right, side);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    velocity.lerp(move, Math.min(1, ACCEL * dt));

    camera.position.addScaledVector(velocity, dt);
    camera.position.y = groundHeightAt(camera.position.x, camera.position.z) + EYE_HEIGHT;
  }

  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerdown', onPointerDown);
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
    enter,
    exit,
    toggle: () => (active ? exit() : enter()),
    update,
  };
}
