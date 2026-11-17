/**
 * Gestos táctiles. Regla de oro: el dedo NUNCA mueve la cámara.
 * La cámara la controla el SLAM; el dedo escribe sobre GRUPO.
 */
import * as THREE from 'three';
import { GRUPO, POSICION_MODELO } from './escena.js';

const planoPiso = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const tmp = new THREE.Vector3();

const dedos = new Map();
let arrastrando = false;
const offset = new THREE.Vector3();
let inicio = null;
let escalaBase = 1;
let rotBase = 0;
let bloqueado = false;

const canvas = () => document.getElementById('camerafeed');

function ndc(x, y) {
  const r = canvas().getBoundingClientRect();
  return new THREE.Vector2(
    ((x - r.left) / r.width) * 2 - 1,
    -((y - r.top) / r.height) * 2 + 1
  );
}

function escena() {
  return window.XR8?.Threejs?.xrScene?.() ?? null;
}

function puntoEnPiso(x, y) {
  const s = escena();
  if (!s) return null;
  raycaster.setFromCamera(ndc(x, y), s.camera);
  return raycaster.ray.intersectPlane(planoPiso, tmp) ? tmp.clone() : null;
}

export function activarGestos() {
  const c = canvas();
  c.style.touchAction = 'none';

  c.addEventListener('pointerdown', (e) => {
    if (bloqueado) return;
    c.setPointerCapture?.(e.pointerId);
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (dedos.size === 1) {
      const s = escena();
      if (!s) return;
      raycaster.setFromCamera(ndc(e.clientX, e.clientY), s.camera);
      // Solo si tocó el modelo: un toque al aire no lo mueve.
      if (raycaster.intersectObject(GRUPO, true).length === 0) return;

      const p = puntoEnPiso(e.clientX, e.clientY);
      if (!p) return;
      arrastrando = true;
      offset.set(GRUPO.position.x - p.x, 0, GRUPO.position.z - p.z);
    }

    if (dedos.size === 2) {
      const [a, b] = [...dedos.values()];
      inicio = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1e-6,
        ang: Math.atan2(b.y - a.y, b.x - a.x),
      };
      escalaBase = GRUPO.scale.x;
      rotBase = GRUPO.rotation.y;
    }
  });

  c.addEventListener('pointermove', (e) => {
    if (!dedos.has(e.pointerId)) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (dedos.size === 1 && arrastrando) {
      const p = puntoEnPiso(e.clientX, e.clientY);
      if (p) GRUPO.position.set(p.x + offset.x, 0, p.z + offset.z);
    }

    if (dedos.size === 2 && inicio) {
      const [a, b] = [...dedos.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      GRUPO.scale.setScalar(THREE.MathUtils.clamp(escalaBase * (dist / inicio.dist), 0.2, 5));
      GRUPO.rotation.y = rotBase + (ang - inicio.ang);
    }
  });

  const soltar = (e) => {
    dedos.delete(e.pointerId);
    if (dedos.size === 0) {
      arrastrando = false;
      inicio = null;
    }
    if (dedos.size === 1) inicio = null;
  };
  c.addEventListener('pointerup', soltar);
  c.addEventListener('pointercancel', soltar);
  c.addEventListener('pointerleave', soltar);

  // Doble toque → recentrar el SLAM.
  let ultimoTap = 0;
  c.addEventListener('touchend', () => {
    const ahora = Date.now();
    if (ahora - ultimoTap < 300) {
      window.XR8?.XrController?.recenter?.();
      ultimoTap = 0;
      return;
    }
    ultimoTap = ahora;
  });
}

export function setBloqueado(v) {
  bloqueado = v;
}

export function estaBloqueado() {
  return bloqueado;
}

export function reset() {
  GRUPO.position.copy(POSICION_MODELO);
  GRUPO.rotation.set(0, 0, 0);
  GRUPO.scale.setScalar(1);
}
