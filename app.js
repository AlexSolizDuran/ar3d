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

export function estado(texto, tipo = 'info') {
  if ($estado) {
    $estado.textContent = texto;
    $estado.dataset.tipo = tipo;
  }
}

function mostrarError(texto) {
  if (!$error) return;
  $error.textContent = texto;
  $error.style.display = 'block';
}

window.addEventListener('error', (e) => {
  mostrarError(`Error en la página: ${e.message ?? e}`);
});
window.addEventListener('unhandledrejection', (e) => {
  mostrarError(`Error no controlado: ${e.reason?.message ?? e.reason}`);
});

// Mensajes del motor y del tracking (modo navegador, sin React Native).
window.addEventListener('dizelf:mensaje', (e) => {
  const msg = e.detail ?? {};
  if (msg.tipo === 'modelo-listo') estado('Modelo listo · mueve el dedo para ajustar', 'ok');
  if (msg.tipo === 'error') {
    estado('Error', 'error');
    mostrarError(msg.motivo ?? 'Error desconocido');
  }
});
window.addEventListener('dizelf:tracking', (e) => {
  if (e.detail === 'ok') estado('Tracking estable · camina alrededor', 'ok');
  else estado('Tracking perdido · apunta a una superficie con textura', 'perdido');
});

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
    ];

    // FullWindowCanvas ajusta el canvas al viewport. Si no está, el CSS lo cubre.
    if (window.XRExtras?.FullWindowCanvas?.pipelineModule) {
      modulos.push(XRExtras.FullWindowCanvas.pipelineModule());
    }

    modulos.push(moduloEscena());

    XR8.addCameraPipelineModules(modulos);

    activarGestos();
    activarPuente({
      reset,
      setBloqueado,
      escalar: (valor) => GRUPO.scale.setScalar(valor),
    });

    XR8.run({ canvas: document.getElementById('camerafeed') });
    estado('Buscando el piso… apunta a una superficie con textura');
  } catch (e) {
    estado('No se pudo iniciar el motor', 'error');
    mostrarError(`${e?.message ?? e}\n\nSi abriste esto en una PC, ábrelo desde el celular.`);
  }
}

function cuandoCargueElMotor() {
  if (window.XR8) {
    iniciar();
    return;
  }
  window.addEventListener('xrloaded', iniciar, { once: true });

  // Aviso si el engine no carga (script bloqueado, offline sin vendor, etc.).
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
