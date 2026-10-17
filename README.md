# Capturo — grabador de pantalla con aro de luz

Graba tu pantalla, una ventana o **un área que tú eliges**, con tu cámara dentro de un **aro de luz animado**. Edita, recorta y exporta. Todo ocurre en tu equipo: **nada se sube a ningún servidor**.

## Probar la versión web

**https://wilgomezgit.github.io/grabarPantalla/web/**

Funciona en Chrome, Edge y otros navegadores basados en Chromium actualizados (necesita WebCodecs). La captura de pantalla exige conexión segura (https o `localhost`); desde la página publicada ya la tienes. Para usarla en local:

```bash
npx serve web            # o: python -m http.server 5173 -d web   → http://localhost:5173
```

## Versión para PC (Windows)

En la carpeta [`escritorio/`](escritorio/) está el instalador **`Capturo-Setup-1.0.1.exe`**. Se instala para tu usuario, sin permisos de administrador.

> Windows puede mostrar el aviso "Windows protegió su PC" porque el instalador no está firmado con un certificado de pago. Pulsa **Más información → Ejecutar de todas formas**. En `escritorio/LEEME.txt` tienes la huella SHA-256 para comprobar el archivo.

La versión de PC añade: barra de control que no sale en el video, **dibujo en pantalla**, **resaltado del cursor y onda al hacer clic**, **notas del orador**, capturas de pantalla al portapapeles, atajos globales configurables, bandeja del sistema y recuperación de grabaciones interrumpidas.

## Qué puedes hacer

- **Qué grabar:** pantalla + cámara, solo pantalla o solo cámara.
- **Qué compartir:** pantalla completa, **área personalizada** (16:9, 9:16, 1:1, 4:3; recuerda la última), una ventana o una pestaña.
- **Calidad:** resolución nativa, 4K, 1440p, 1080p, 720p o 480p · 24, 30 o 60 fps · MP4 (H.264) o WebM (VP9) · calidad estándar, alta o máxima. Muestra el peso estimado por minuto y avisa si tu equipo puede quedarse corto.
- **Cámara con aro de luz** (Neón, Fuego, Tóxico, Hielo, RGB) que sale dentro del video.
- **Audio:** micrófono + audio de lo que compartes, con medidor de nivel.
- **Mientras grabas:** cuenta atrás, pausa, descartar, cronómetro, tamaño y fps en vivo. En la web, mini controlador flotante con las notas del orador.
- **Biblioteca:** miniaturas, duración, filtros, búsqueda, renombrar, descargar y eliminar.
- **Editor:** línea de tiempo con recorte y exportación de una copia (web: MP4 y WebM; PC: MP4, WebM, GIF y MP3), con resolución a elegir. El original nunca se modifica.

## Privacidad

No hay cuentas, ni telemetría, ni subida de archivos. En la web, las grabaciones se guardan en el almacenamiento privado de tu navegador (puedes descargarlas desde la biblioteca). En PC, en `Vídeos\Capturo`.

## Estructura

```
web/                  versión web (HTML, CSS y JS en archivos separados)
  index.html
  css/  js/  vendor/  assets/
escritorio/           instalador para Windows
.github/workflows/    publica web/ en GitHub Pages
```

## Licencias

La codificación usa [Mediabunny](https://mediabunny.dev) (© Vanilagy y colaboradores, MPL-2.0); su licencia está en `web/vendor/mediabunny.LICENSE.txt`. La versión de PC se basa en Electron y ffmpeg.
