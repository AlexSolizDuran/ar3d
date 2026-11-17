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

/**
 * Dónde arranca el modelo: delante de la cámara, no debajo de los pies.
 *
 * Con el pivote en el origen el plano quedaba justo en la vertical del usuario
 * y no se veía nada al levantar el teléfono.
 */
export const POSICION_MODELO = new THREE.Vector3(0, 0, -1.8);

let estadoEnviado = '';
let candidato = null;
let candidatoDesde = 0;

/**
 * 8th Wall solo reporta 'NORMAL' o 'LIMITED' (no existe 'LOST'), y al arrancar
 * manda 'LIMITED' con reason 'INITIALIZING'. Sin separar los dos casos el HUD
 * acusaba "tracking perdido" desde el primer frame, incluso con todo bien.
 */
const ESTABILIDAD_MS = 700;

function motivoDeTracking(realidad) {
  if (realidad.trackingStatus === 'NORMAL') return 'ok';
  return realidad.trackingReason === 'INITIALIZING' ? 'inicializando' : 'limitado';
}

/** De dónde sale el GLB: sin `api` → demo empaquetado; con `api` → backend. */
function resolverUrlModelo() {
  const q = new URLSearchParams(location.search);
  const id = q.get('modelo') ?? 'demo';
  const api = q.get('api');
  const token = q.get('token');
  // La app móvil descarga el GLB con su `Bearer` y pasa una URL prefirmada del
  // bucket: así el JWT de sesión nunca entra a la URL del WebView (P20).
  const glb = q.get('glb');
  if (glb) return { id: 'proyecto', url: glb, esDemo: false };
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

    // P1: el editor Pascal exporta en metros. La tabla queda como salvaguarda.
    const unidad = Number(gltf.userData?.unidad ?? 1);
    if (unidad !== 1) casa.scale.setScalar(unidad);

    let tam = centrarEnPiso(casa);
    let aviso = null;

    // Un GLB en centímetros llega 100× más grande: la cámara queda adentro, el
    // `far` no alcanza y se ve "nada". Se corrige en vez de dejar el vacío.
    if (Math.max(tam.x, tam.y, tam.z) > 100) {
      casa.scale.multiplyScalar(0.01);
      tam = centrarEnPiso(casa);
      aviso = 'El modelo venía en centímetros: se muestra a escala 1/100.';
    }

    // El `far` por defecto (60 m) recorta los planos grandes por completo.
    const { camera } = XR8.Threejs.xrScene();
    camera.far = Math.max(60, Math.max(tam.x, tam.y, tam.z) * 3);
    camera.updateProjectionMatrix();

    casa.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.material) o.material.side = THREE.DoubleSide; // muros sin grosor
      }
    });

    GRUPO.add(casa);
    GRUPO.position.copy(POSICION_MODELO);

    puenteEnviar({
      tipo: 'modelo-listo',
      escala: GRUPO.scale.x,
      tam: { x: +tam.x.toFixed(2), y: +tam.y.toFixed(2), z: +tam.z.toFixed(2) },
      aviso,
    });
  } catch (e) {
    puenteEnviar({ tipo: 'error', motivo: `No se pudo cargar ${url}: ${e?.message ?? e}` });
  }
}

/** Pivote al centro del piso y base en Y = 0. Devuelve el tamaño en metros. */
function centrarEnPiso(objeto) {
  objeto.position.set(0, 0, 0);
  const caja = new THREE.Box3().setFromObject(objeto);
  const centro = caja.getCenter(new THREE.Vector3());
  objeto.position.set(-centro.x, -caja.min.y, -centro.z);
  return new THREE.Box3().setFromObject(objeto).getSize(new THREE.Vector3());
}

export const moduloEscena = () => ({
  name: 'dizelf-escena',

  onStart: () => {
    const { scene, camera, renderer } = XR8.Threejs.xrScene();

    camera.near = 0.05; // 5 cm: sin esto el modelo desaparece al acercarse
    camera.far = 200; // se amplía según el tamaño real cuando llega el GLB

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

  /**
   * El motor avisa aquí cada paso de la cámara. Sin este callback, un fallo de
   * getUserMedia se ve como pantalla negra sin explicación.
   */
  onCameraStatusChange: ({ status, detail }) => {
    window.dispatchEvent(new CustomEvent('dizelf:camara', { detail: { status, detail } }));
  },

  /** Errores internos del pipeline (sesión, WebGL, permisos). */
  onException: (e) => {
    const motivo = e?.error?.message ?? e?.message ?? String(e);
    window.dispatchEvent(new CustomEvent('dizelf:camara', { detail: { status: 'exception', detail: motivo } }));
  },

  /**
   * Reporta el estado del tracking al HUD y al puente.
   *
   * El estado oscila mientras el teléfono se mueve, así que solo se avisa
   * cuando el motivo nuevo se mantiene ESTABILIDAD_MS: sin esto el chip
   * parpadeaba entre "estable" y "perdido" a 30 fps.
   */
  onUpdate: ({ processCpuResult }) => {
    const realidad = processCpuResult?.reality;
    if (!realidad?.trackingStatus) return;

    const motivo = motivoDeTracking(realidad);
    if (motivo !== candidato) {
      candidato = motivo;
      candidatoDesde = performance.now();
      return;
    }
    if (performance.now() - candidatoDesde < ESTABILIDAD_MS) return;
    if (motivo === estadoEnviado) return;
    estadoEnviado = motivo;

    const detalle =
      motivo === 'ok'
        ? { valor: 'ok' }
        : { valor: 'perdido', motivo }; // el valor viejo se mantiene: el APK ya instalado lo entiende
    puenteEnviar({ tipo: 'tracking', ...detalle });
    window.dispatchEvent(new CustomEvent('dizelf:tracking', { detail: detalle }));
  },
});
