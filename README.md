# dizelf AR — sitio estático

Página WebAR con **8th Wall (SLAM propio, sin ARCore)** + three.js.
Es un sitio estático puro: no hay build, no hay Node, no hay Next.

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `index.html` | Página. HUD, aviso de licencia del engine y canvas. |
| `app.js` | Entry point: configura el scale absoluto y arranca el pipeline. |
| `escena.js` | Luces, `GRUPO` (lo que mueve el dedo), demo de 1 m y carga del GLB. |
| `gestos.js` | Arrastre sobre el piso, pinza para escalar, giro de dos dedos, doble toque para recentrar. |
| `puente.js` | `postMessage` ⇄ `window.__comando`. Protocolo congelado. |
| `vendor/` | `xr.js` + `xr-slam.js` (engine con SLAM), `xrextras.js`, `LICENSE`. |
| `three/` | three.js y los loaders (GLTF + Draco) servidos desde el mismo origen. |
| `draco/` | Decoder de Draco. |
| `modelos/demo.glb` | NO se usa: el demo se genera por código (cubo de 1 m + regla de 3 m). |

## Parámetros de la URL

```
?modelo=<id>    id del modelo
?api=<base>     base del backend; si falta, carga ./modelos/<id>.glb
?token=<jwt>    token para el backend (opcional)
```

Sin parámetros → demo de 1 m.

## Desplegar en Vercel (recomendado para esta prueba)

1. Sube este directorio a un repo (o usa la CLI).
2. En Vercel: **New Project** → importa el repo → **Root Directory = `ar3d`** →
   Framework Preset: **Other** → Build Command: *(vacío)* → Output Directory: *(vacío)*.
3. Abre la URL de **producción** desde el celular (no la de preview: puede pedir login).

Los headers de cámara y CSP los pone `vercel.json`.

## Desplegar en Cloudflare Pages (gratis, sin tarjeta, uso comercial)

1. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Arrastra el contenido de `ar3d/` (o conecta el repo con Root Directory `ar3d`).
3. Los headers los pone `_headers`.

## Probar en el celular

- Debe ser **HTTPS** (Vercel y Pages ya lo dan). Por LAN con `http://192.168.x.x`
  la cámara NO abre: no es contexto seguro.
- Abre desde **Chrome en el celular**. En una PC no hay SLAM de móvil.
- Acepta el permiso de cámara y apunta a una superficie con textura (no un piso liso).
- Verifica con cinta métrica: el cubo mide **1 m** y la regla **3 m** (±5 cm).

## Cosas que NO hacer

- No meter este directorio dentro de `dizelf_front`: su `next.config.ts` envía
  `Permissions-Policy: camera=()`, que bloquea la cámara en todo el sitio.
- No cargar `xr.js` desde un CDN: rompe el modo offline del APK.
- No pasar el GLB en la URL: se pide por `?modelo=`.
- Si más adelante conectas el backend, añade su origen a `connect-src` en
  `_headers` y `vercel.json`, o el `fetch` del GLB lo bloquea el CSP.

## Atribución obligatoria

La licencia del binario exige mostrar el aviso de copyright y un enlace a la
licencia en un lugar visible. Está en el pie de `index.html`; **no lo quites**.
Al empaquetar en el APK, el mismo aviso debe estar en una pantalla *Acerca de*.
