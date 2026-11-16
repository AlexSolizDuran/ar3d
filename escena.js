/**
 * Escena three.js del sitio AR.
 *
 * Reglas que NO se tocan (ver PLAN-AR-RN-8THWALL.md):
 *  - GRUPO es lo único que mueve el dedo. La cámara la controla el SLAM.
 *  - Todo el contenido va por encima de Y = 0 (lo exige 8th Wall).
 *  - El GLB del editor Pascal viene en metros: scale = 1.
 */
import * as THREE from 'three';
import { GLTFLoader } from './three/loaders/GLTFLoader.js';
import { DRACOLoader } from './three/loaders/DRACOLoader.js';
import { puenteEnviar } from './puente.js';

export const GRUPO = new THREE.Group();
GRUPO.name = 'dizelf-grupo';

let ultimoEstado = null;
let estadoEnviado = '';

/** De dónde sale el GLB: sin `api` → demo empaquetado; con `api` → backend. */
function resolverUrlModelo() {
  const q = new URLSearchParams(location.search);
  const id = q.get('modelo') ?? 'demo';
  const api = q.get('api');
  const token = q.get('token');
  if (!api) return { id, url: `./modelos/${id}.glb`, esDemo: id === 'demo' };
  const base = api.replace(/\/$/, '');
  const url =
    `${base}/proyectos/${encodeURIComponent(id)}/modelo` +
    (token ? `?token=${encodeURIComponent(token)}` : '');
  return { id, url, esDemo: false };
}

function crearDemo() {
  const demo = new THREE.Group();
  demo.name = 'demo-1m';

  // Cubo de 1 m, apoyado en el piso.
  const cubo = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.28,
      roughness: 0.35,
      metalness: 0,
    })
  );
  cubo.position.set(0, 0.5, 0);
  cubo.name = 'cubo-1m';
  demo.add(cubo);

  const aristas = new THREE.LineSegments(
    new THREE.EdgesGeometry(cubo.geometry),
    new THREE.LineBasicMaterial({ color: 0x67e8f9 })
  );
  aristas.position.copy(cubo.position);
  demo.add(aristas);

  // Regla de 3 m en el piso, con marcas cada metro.
  const regla = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.01, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.9 })
  );
  regla.position.set(0, 0.005, 1.2);
  demo.add(regla);

  const marcaMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  for (let m = 0; m <= 3; m++) {
    const marca = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.22), marcaMat);
    marca.position.set(-1.5 + m, 0.006, 1.2);
    demo.add(marca);
  }

  demo.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return demo;
}

async function cargarModelo({ url, esDemo }) {
  if (esDemo) {
    GRUPO.add(crearDemo());
    puenteEnviar({ tipo: 'modelo-listo', escala: GRUPO.scale.x });
    return;
  }

  const draco = new DRACOLoader().setDecoderPath('./draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);

  try {
    const gltf = await loader.loadAsync(url);
    const casa = gltf.scene;

    // Pivote al centro del piso y base en Y = 0.
    const box = new THREE.Box3().setFromObject(casa);
    const centro = box.getCenter(new THREE.Vector3());
    casa.position.set(-centro.x, -box.min.y, -centro.z);

    // P1: el editor Pascal exporta en metros. La tabla queda como salvaguarda.
    const unidad = Number(gltf.userData?.unidad ?? 1);
    if (unidad !== 1) casa.scale.setScalar(unidad);

    const caja = new THREE.Box3().setFromObject(casa);
    const tam = caja.getSize(new THREE.Vector3());
    const mayor = Math.max(tam.x, tam.y, tam.z);
    if (mayor < 1 || mayor > 100) {
      puenteEnviar({
        tipo: 'error',
        motivo: `Dimensiones fuera de rango: ${mayor.toFixed(2)} m. ¿Unidades del GLB?`,
      });
    }

    casa.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) o.material.side = THREE.DoubleSide; // muros sin grosor
      }
    });

    GRUPO.add(casa);
    puenteEnviar({ tipo: 'modelo-listo', escala: GRUPO.scale.x });
  } catch (e) {
    puenteEnviar({ tipo: 'error', motivo: `No se pudo cargar ${url}: ${e?.message ?? e}` });
  }
}

export const moduloEscena = () => ({
  name: 'dizelf-escena',

  onStart: () => {
    const { scene, camera, renderer } = XR8.Threejs.xrScene();

    camera.near = 0.05; // 5 cm: sin esto el modelo desaparece al acercarse
    camera.far = 60;

    scene.add(GRUPO);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.2));

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(4, 10, 6);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 30;
    scene.add(dir);

    renderer.shadowMap.enabled = true;

    cargarModelo(resolverUrlModelo());
  },

  /** Reporta el estado del tracking al HUD y al puente. */
  onUpdate: ({ processCpuResult }) => {
    const realidad = processCpuResult?.reality;
    if (!realidad) return;
    const estado = realidad.trackingStatus;
    if (!estado || estado === ultimoEstado) return;
    ultimoEstado = estado;

    const valor = estado === 'NORMAL' ? 'ok' : 'perdido';
    if (valor === estadoEnviado) return;
    estadoEnviado = valor;
    puenteEnviar({ tipo: 'tracking', valor });
    window.dispatchEvent(new CustomEvent('dizelf:tracking', { detail: valor }));
  },
});
