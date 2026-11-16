/**
 * Puente web ⇄ React Native.
 *
 * Protocolo CONGELADO (no cambiar nombres, ver T5 del plan):
 *   web → RN : modelo-listo {escala} | tracking {valor} | error {motivo}
 *   RN → web : recentrar | reset | bloquear {valor} | escala {valor}
 *
 * Este módulo no importa nada de escena/gestos a propósito: las acciones las
 * inyecta app.js. Así no hay imports circulares.
 */

export function puenteEnviar(msg) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
  // También lo escucha el HUD (modo navegador, sin React Native).
  window.dispatchEvent(new CustomEvent('dizelf:mensaje', { detail: msg }));
}

/**
 * @param {{
 *   reset: () => void,
 *   setBloqueado: (v: boolean) => void,
 *   escalar: (valor: number) => void,
 * }} acciones
 */
export function activarPuente(acciones) {
  window.__comando = (comando) => {
    const { tipo, valor } = comando ?? {};
    switch (tipo) {
      case 'recentrar':
        XR8.XrController.recenter();
        break;
      case 'reset':
        acciones.reset();
        break;
      case 'bloquear':
        acciones.setBloqueado(Boolean(valor));
        break;
      case 'escala': {
        const n = Number(valor);
        if (Number.isFinite(n) && n > 0) acciones.escalar(n);
        break;
      }
      default:
        break;
    }
  };
}
