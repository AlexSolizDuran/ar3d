/**
 * Entry point del sitio AR.
 * Pipeline mínimo: cámara → three.js → XrController (SLAM propio, sin ARCore).
 */
import * as THREE from 'three';
import { GRUPO, moduloEscena } from './escena.js';
import { activarGestos, reset, setBloqueado } from './gestos.js';
import { activarPuente } from './puente.js';

// El módulo Threejs de 8th Wall espera THREE global.
window.THREE = THREE;

const $estado = document.getElementById('estado');
const $error = document.getElementById('error');

const $inicio = document.getElementById('inicio');
const $empezar = document.getElementById('empezar');

let videoLlegó = false;
let vigía = null;

export function estado(texto, tipo = 'info') {
  if ($estado) {
    $estado.textContent = texto;
    $estado.dataset.tipo = tipo;
  }
}

export function mostrarError(texto) {
  if (!$error) return;
  $error.textContent = texto;
  $error.style.display = 'block';
}

window.addEventListener('error', (e) => {
  mostrarError(`Error en la página: ${e.message ?? e}`);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  mostrarError(`Error no controlado: ${r?.message ?? r}`);
});

/** Estado real de la cámara: es lo que explica una pantalla negra. */
const TEXTOS_CAMARA = {
  requesting: 'Pidiendo permiso de cámara… acepta el aviso del navegador',
  hasStream: 'Cámara conectada, preparando vídeo…',
  hasVideo: 'Buscando el piso… apunta a una superficie con textura',
  failed: 'No se pudo abrir la cámara',
};

window.addEventListener('dizelf:camara', (e) => {
  const { status, detail } = e.detail ?? {};

  if (status === 'hasVideo') {
    videoLlegó = true;
    clearTimeout(vigía);
    estado(TEXTOS_CAMARA.hasVideo, 'info');
    return;
  }

  if (status === 'failed' || status === 'exception') {
    videoLlegó = true; // ya no tiene sentido el vigía
    clearTimeout(vigía);
    estado(TEXTOS_CAMARA.failed, 'error');
    mostrarError(
      `La cámara no arrancó.\n\nMotivo: ${detail ?? 'desconocido'}\n\n` +
        'Revisa: (1) el candado de la barra de direcciones → Cámara → Permitir; ' +
        '(2) que ninguna otra app esté usando la cámara; (3) recarga la página.'
    );
    return;
  }

  if (TEXTOS_CAMARA[status]) estado(TEXTOS_CAMARA[status]);
});

// Mensajes del motor y del tracking.
window.addEventListener('dizelf:mensaje', (e) => {
  const msg = e.detail ?? {};
  if (msg.tipo === 'modelo-listo') estado('Modelo listo · mueve el dedo para ajustar', 'ok');
  if (msg.tipo === 'error') {
    estado('Error', 'error');
    mostrarError(msg.motivo ?? 'Error desconocido');
  }
});
window.addEventListener('dizelf:tracking', (e) => {
  // Acepta string (versión vieja) y { valor, motivo } (nueva).
  const detalle = typeof e.detail === 'string' ? { valor: e.detail } : (e.detail ?? {});
  const { valor, motivo } = detalle;

  if (valor === 'ok') return estado('Tracking estable · camina alrededor', 'ok');
  if (motivo === 'inicializando') {
    return estado('Calibrando… mueve el teléfono de adelante hacia atrás', 'info');
  }
  return estado('Tracking limitado · más luz, más textura, movete despacio', 'perdido');
});

function esMovil() {
  try {
    return XR8.XrDevice.isDeviceBrowserCompatible({
      allowedDevices: XR8.XrConfig.device().MOBILE_AND_HEADSETS,
    });
  } catch {
    return true; // si la API no existe, no bloqueamos: que el motor decida
  }
}

function iniciar() {
  try {
    // ⚠️ CRÍTICO para el 1:1: 'absolute' devuelve la cámara en METROS.
    try {
      XR8.XrController.configure({ scale: 'absolute', enableLighting: true });
    } catch (e) {
      console.warn('configure falló, sigo con los valores por defecto', e);
    }

    const modulos = [
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(), // SLAM propio de 8th Wall
      moduloEscena(),
    ];

    // FullWindowCanvas ajusta el canvas al viewport. Si no está, el CSS lo cubre.
    if (window.XRExtras?.FullWindowCanvas?.pipelineModule) {
      modulos.unshift(XRExtras.FullWindowCanvas.pipelineModule());
    }
    // Sin este módulo, los errores del motor sólo salen en la consola.
    if (window.XRExtras?.RuntimeError?.pipelineModule) {
      modulos.push(XRExtras.RuntimeError.pipelineModule());
    }

    XR8.addCameraPipelineModules(modulos);

    activarGestos();
    activarPuente({
      reset,
      setBloqueado,
      escalar: (valor) => GRUPO.scale.setScalar(valor),
    });

    estado('Iniciando cámara…');

    // Algunos teléfonos fallan con la cámara trasera por defecto; ?cam=front lo fuerza.
    const cam = new URLSearchParams(location.search).get('cam');
    const opciones = { canvas: document.getElementById('camerafeed') };
    if (cam === 'front' || cam === 'back') opciones.cameraConfig = { direction: cam };
    if (new URLSearchParams(location.search).has('debug')) opciones.verbose = true;

    XR8.run(opciones);

    // Si en 10 s no hay ni un frame de vídeo, el problema es la cámara, no el SLAM.
    vigía = setTimeout(() => {
      if (videoLlegó) return;
      estado('La cámara no arrancó', 'error');
      mostrarError(
        (esMovil()
          ? 'El permiso de cámara no se concedió.'
          : 'Estás en una computadora: el SLAM de 8th Wall solo corre en un teléfono.') +
          '\n\nAbre esta misma URL desde Chrome en el celular.'
      );
    }, 10000);
  } catch (e) {
    estado('No se pudo iniciar el motor', 'error');
    mostrarError(`${e?.message ?? e}`);
  }
}

/**
 * El motor NO pide la cámara: su session manager aborta si el permiso todavía
 * está en 'prompt'. Hay que pedirlo aquí, con un toque del usuario.
 * Un solo getUserMedia abre el aviso del navegador; luego se suelta el stream.
 */
async function pedirPermiso() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });
  stream.getTracks().forEach((t) => t.stop());
}

const auto = new URLSearchParams(location.search).has('auto');

function arrancar() {
  if ($inicio) $inicio.hidden = true;
  iniciar();
}

async function prepararInicio() {
  if (!$inicio || !$empezar) return arrancar();

  // Si el permiso ya está concedido (segunda visita, APK), no molestamos.
  let concedido = false;
  try {
    concedido = (await navigator.permissions.query({ name: 'camera' })).state === 'granted';
  } catch {
    /* Safari viejo: sin Permissions API, que toque el botón */
  }
  if (concedido || auto) return arrancar();

  $empezar.addEventListener('click', async () => {
    $empezar.disabled = true;
    $empezar.textContent = 'Abriendo cámara…';
    estado('Pidiendo permiso de cámara…');
    try {
      await pedirPermiso();
      arrancar();
    } catch (e) {
      $empezar.disabled = false;
      $empezar.textContent = 'Reintentar';
      estado('Permiso de cámara denegado', 'error');
      mostrarError(
        `No se concedió la cámara (${e?.name ?? e}).\n\n` +
          'Toca el candado de la barra de direcciones → Permisos → Cámara → Permitir, y recarga.'
      );
    }
  });
}

function cuandoCargueElMotor() {
  if (window.XR8) {
    prepararInicio();
    return;
  }
  window.addEventListener('xrloaded', prepararInicio, { once: true });

  setTimeout(() => {
    if (!window.XR8) {
      estado('El motor AR no cargó', 'error');
      mostrarError(
        'No se encontró window.XR8. Revisa que vendor/xr.js y vendor/xr-slam.js estén servidos desde este mismo origen.'
      );
    }
  }, 15000);
}

cuandoCargueElMotor();
