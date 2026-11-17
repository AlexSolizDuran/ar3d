/**
 * Vista 3D del plano: sobrevuela el modelo como en un juego, sin cámara.
 *
 * Es una vista **aparte** de la AR (`index.html`): acá no hay SLAM ni 8th Wall,
 * solo three.js. Sirve para revisar un plano que en la AR es difícil de leer
 * (un plano acostado en el piso, visto desde 1,4 m, casi no se ve).
 *
 * Reglas:
 *  - La cámara vuela libre y ATRAVIESA los objetos: no hay colisiones.
 *  - La única física es el piso: `y` nunca baja de PISO_MIN.
 *  - El arrastre del dedo mira; los mandos de la esquina mueven.
 */
import * as THREE from 'three';
import { GLTFLoader } from './three/loaders/GLTFLoader.js';
import { DRACOLoader } from './three/loaders/DRACOLoader.js';

const $canvas = document.getElementById('vista');
const $estado = document.getElementById('estado');
const $error = document.getElementById('error');
const $tam = document.getElementById('tam');

/** Altura mínima de la cámara: el piso está en y = 0. */
const PISO_MIN = 0.25;
const VELOCIDAD = 3.2;      // m/s en el plano horizontal
const VELOCIDAD_Y = 2.0;    // m/s al subir/bajar
const OJO = 1.6;            // altura de arranque, en metros
const SENSIBILIDAD = 0.0032;

function estado(texto, tipo = 'info') {
  $estado.textContent = texto;
  $estado.dataset.tipo = tipo;
}

function mostrarError(texto) {
  $error.textContent = texto;
  $error.style.display = 'block';
}

/** De dónde sale el modelo: `?glb=` (URL prefirmada) o `?modelo=demo`. */
function resolverModelo() {
  const q = new URLSearchParams(location.search);
  const glb = q.get('glb');
  if (glb) return { url: glb, demo: false };

  const api = q.get('api');
  const token = q.get('token');
  const id = q.get('modelo');
  if (api && id) {
    const base = api.replace(/\/$/, '');
    const url =
      `${base}/proyectos/${encodeURIComponent(id)}/modelo` +
      (token ? `?token=${encodeURIComponent(token)}` : '');
    return { url, demo: false };
  }

  return { url: null, demo: true };
}

// --- Escena ----------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ canvas: $canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x070d18, 1);

const escena = new THREE.Scene();
escena.fog = new THREE.Fog(0x070d18, 35, 120);

const camara = new THREE.PerspectiveCamera(65, 1, 0.05, 400);
camara.rotation.order = 'YXZ';

escena.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.15));

const sol = new THREE.DirectionalLight(0xffffff, 1.25);
sol.position.set(6, 14, 5);
escena.add(sol);

/** Piso oscuro + rejilla de 1 m: da referencia de escala sin tapar el plano. */
const piso = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x0b1320, roughness: 1 })
);
piso.rotation.x = -Math.PI / 2;
piso.position.y = -0.004;
escena.add(piso);

let rejilla = null;
function ponerRejilla(tamano) {
  if (rejilla) {
    escena.remove(rejilla);
    rejilla.geometry.dispose();
    rejilla.material.dispose();
  }
  const lado = Math.max(10, Math.ceil(tamano / 5) * 5); // múltiplos de 5 m
  rejilla = new THREE.GridHelper(lado, lado, 0x1e3a4a, 0x152431);
  rejilla.position.y = 0;
  escena.add(rejilla);
}
ponerRejilla(20);

// --- Casa de demo (sin GLB): sirve para probar la vista en el navegador ---

function casaDeDemo() {
  const grupo = new THREE.Group();
  const ancho = 9;
  const fondo = 7;
  const alto = 2.7;

  const materialMuro = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const materialPiso = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 1 });

  const suelo = new THREE.Mesh(new THREE.BoxGeometry(ancho, 0.08, fondo), materialPiso);
  suelo.position.y = -0.04;
  grupo.add(suelo);

  const muro = (x, z, largo, girado) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(largo, alto, 0.12),
      materialMuro
    );
    m.position.set(x, alto / 2, z);
    if (girado) m.rotation.y = Math.PI / 2;
    grupo.add(m);
  };

  muro(0, fondo / 2, ancho, false);
  muro(0, -fondo / 2, ancho, false);
  muro(ancho / 2, 0, fondo, true);
  muro(-ancho / 2, 0, fondo, true);
  muro(-1, 0.6, 4.4, true); // tabique interior

  const mesa = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.75, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, roughness: 0.5 })
  );
  mesa.position.set(2.2, 0.375, 1.2);
  grupo.add(mesa);

  return grupo;
}

// --- Estado de la cámara ---------------------------------------------------

const posicion = new THREE.Vector3(0, OJO, 6);
let yaw = 0;
let pitch = -0.06;
let limite = 40;

const mover = {
  adelante: false,
  atras: false,
  izquierda: false,
  derecha: false,
  subir: false,
  bajar: false,
};

/** Último tamaño conocido: lo usa el botón «Centrar». */
const tamActual = new THREE.Vector3(8, 3, 8);

/**
 * Encuadre inicial: vista aérea en tres cuartos sobre una esquina del modelo.
 *
 * Arrancar a la altura del ojo y de frente dejaba la cámara fuera de la casa y
 * con una pared gris ocupando toda la pantalla: el plano no se entendía.
 */
function centrarVista(tam) {
  const mayor = Math.max(tam.x, tam.z, 4);
  const distancia = mayor * 1.15 + 3;

  posicion.set(distancia * 0.55, Math.max(4, tam.y * 1.6 + 3), distancia * 0.72);

  const objetivo = new THREE.Vector3(0, Math.max(0.4, tam.y * 0.35), 0);
  const dir = objetivo.sub(posicion).normalize();
  yaw = Math.atan2(-dir.x, -dir.z);
  pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));

  limite = Math.max(30, mayor * 2.5);
  tamActual.copy(tam);
}

// --- Carga del modelo ------------------------------------------------------

function medir(objeto) {
  const caja = new THREE.Box3().setFromObject(objeto);
  return caja.getSize(new THREE.Vector3());
}

function formatTam(tam) {
  const f = (n) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
  return `Modelo ${f(tam.x)} × ${f(tam.y)} × ${f(tam.z)} m`;
}

async function cargar() {
  const { url, demo } = resolverModelo();

  if (demo) {
    const casa = casaDeDemo();
    escena.add(casa);
    const tam = medir(casa);
    ponerRejilla(Math.max(tam.x, tam.z));
    centrarVista(tam);
    $tam.textContent = `${formatTam(tam)} · casa de ejemplo`;
    estado('Vista 3D · arrastrá para mirar', 'ok');
    return;
  }

  const draco = new DRACOLoader().setDecoderPath('./draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);

  estado('Descargando el modelo…');

  try {
    const gltf = await loader.loadAsync(url);
    const casa = gltf.scene;

    // Base en el piso y centro en el origen, igual que en la AR: así el
    // `Centrar` y el tope del piso significan lo mismo en las dos vistas.
    const caja = new THREE.Box3().setFromObject(casa);
    const centro = caja.getCenter(new THREE.Vector3());
    casa.position.set(-centro.x, -caja.min.y, -centro.z);

    // Escala 1:1: el export del editor sale en metros, no se reescala nunca.
    const tam = medir(casa);

    casa.traverse((o) => {
      if (o.isMesh && o.material) o.material.side = THREE.DoubleSide;
    });

    escena.add(casa);
    ponerRejilla(Math.max(tam.x, tam.z));
    centrarVista(tam);
    $tam.textContent = formatTam(tam);
    estado('Vista 3D · arrastrá para mirar', 'ok');
  } catch (e) {
    estado('No se pudo cargar el modelo', 'error');
    mostrarError(
      `Falló la descarga del GLB.\n\n${e?.message ?? e}\n\n` +
        'Si el enlace venció, volvé a abrir la vista desde la app.'
    );
  }
}

// --- Entrada ---------------------------------------------------------------

const teclas = document.querySelectorAll('[data-mover]');
for (const tecla of teclas) {
  const accion = tecla.dataset.mover;
  const activar = (v) => {
    mover[accion] = v;
    tecla.dataset.activo = v ? '1' : '0';
  };
  tecla.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tecla.setPointerCapture?.(e.pointerId);
    activar(true);
  });
  for (const evento of ['pointerup', 'pointercancel', 'pointerleave']) {
    tecla.addEventListener(evento, () => activar(false));
  }
}

document.getElementById('reiniciar').addEventListener('click', () => {
  centrarVista(tamActual);
});

// Arrastrar para mirar.
let arrastre = null;
$canvas.addEventListener('pointerdown', (e) => {
  arrastre = { id: e.pointerId, x: e.clientX, y: e.clientY };
  $canvas.setPointerCapture?.(e.pointerId);
});
$canvas.addEventListener('pointermove', (e) => {
  if (!arrastre || arrastre.id !== e.pointerId) return;
  const dx = e.clientX - arrastre.x;
  const dy = e.clientY - arrastre.y;
  arrastre.x = e.clientX;
  arrastre.y = e.clientY;
  yaw -= dx * SENSIBILIDAD;
  pitch -= dy * SENSIBILIDAD;
  pitch = THREE.MathUtils.clamp(pitch, -1.45, 1.45);
});
const soltarArrastre = (e) => {
  if (arrastre && arrastre.id === e.pointerId) arrastre = null;
};
$canvas.addEventListener('pointerup', soltarArrastre);
$canvas.addEventListener('pointercancel', soltarArrastre);

// Teclado, para probar en la computadora.
const MAPA_TECLAS = {
  KeyW: 'adelante',
  ArrowUp: 'adelante',
  KeyS: 'atras',
  ArrowDown: 'atras',
  KeyA: 'izquierda',
  ArrowLeft: 'izquierda',
  KeyD: 'derecha',
  ArrowRight: 'derecha',
  Space: 'subir',
  ShiftLeft: 'bajar',
};
window.addEventListener('keydown', (e) => {
  const accion = MAPA_TECLAS[e.code];
  if (!accion) return;
  e.preventDefault();
  mover[accion] = true;
});
window.addEventListener('keyup', (e) => {
  const accion = MAPA_TECLAS[e.code];
  if (accion) mover[accion] = false;
});

// --- Bucle -----------------------------------------------------------------

function redimensionar() {
  const ancho = window.innerWidth;
  const alto = window.innerHeight;
  renderer.setSize(ancho, alto, false);
  camara.aspect = ancho / alto;
  camara.updateProjectionMatrix();
}
window.addEventListener('resize', redimensionar);
redimensionar();

const reloj = new THREE.Clock();

function paso() {
  const dt = Math.min(reloj.getDelta(), 0.05);

  // Adelante/atrás sobre el plano XZ, sin inclinarse aunque mires al piso.
  const seno = Math.sin(yaw);
  const coseno = Math.cos(yaw);

  let avance = 0;
  let lado = 0;
  if (mover.adelante) avance += 1;
  if (mover.atras) avance -= 1;
  if (mover.derecha) lado += 1;
  if (mover.izquierda) lado -= 1;

  if (avance || lado) {
    const norma = Math.hypot(avance, lado) || 1;
    const v = (VELOCIDAD * dt) / norma;
    posicion.x += (-seno * avance + coseno * lado) * v;
    posicion.z += (-coseno * avance - seno * lado) * v;
  }

  if (mover.subir) posicion.y += VELOCIDAD_Y * dt;
  if (mover.bajar) posicion.y -= VELOCIDAD_Y * dt;

  // Única física: el piso. Los objetos se atraviesan a propósito.
  posicion.y = Math.max(PISO_MIN, posicion.y);
  posicion.x = THREE.MathUtils.clamp(posicion.x, -limite, limite);
  posicion.z = THREE.MathUtils.clamp(posicion.z, -limite, limite);

  camara.position.copy(posicion);
  camara.rotation.set(pitch, yaw, 0);

  renderer.render(escena, camara);
  requestAnimationFrame(paso);
}

paso();
cargar();
