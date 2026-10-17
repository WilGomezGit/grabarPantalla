# WAG Rec — Grabador de pantalla Pro
- `web/` versión web (PWA). Sube la carpeta a cualquier hosting HTTPS (Netlify, Vercel, GitHub Pages) o usa `Iniciar-Web.bat`.
- `desktop/` versión PC (Electron). `Iniciar-PC.bat` para usar, `Crear-EXE.bat` para generar un .exe portable.
Atajos: PC Ctrl+Shift+S detener / Ctrl+Shift+P pausar. Web Alt+Shift+S / Alt+Shift+P.
Los videos se guardan localmente (IndexedDB) en cada versión; no hay nube.

## Aro de luz de la burbuja
Rojo = detenido o en pausa · Verde = grabando (el aro tipo cometa recorre el borde). En PC la burbuja es una ventana flotante propia
(arrastrable, siempre encima) que sale en el video al grabar pantalla completa; si grabas una ventana, se compone dentro del video.
