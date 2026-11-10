# ClimaGo

Aplicación web móvil en construcción: clima, prevención y organización cotidiana.

## Base de la aplicación
- Navegación móvil entre módulos.
- Pantallas iniciales de radar, pronóstico, alertas, prevención, agenda, vehículo, lugares y configuración.
- Registro local de trabajos y gastos del vehículo.
- Guardado local de actividades y ubicaciones.
- Base inicial de PWA: `manifest.json` y `service-worker.js`.

## Prueba
Abrir `index.html` mediante un servidor web local o un alojamiento HTTPS. Las funciones PWA y geolocalización requieren contexto seguro (HTTPS o localhost).


## Etapa 1 — Inicio y Mis lugares
- Se retiraron los accesos rápidos duplicados de Inicio para reducir el desplazamiento.
- Mis lugares permite agregar lugares por nombre y guardarlos localmente.
- Se puede elegir cuál de los lugares guardados es el principal.
- La ubicación GPS, con permiso del usuario, se guarda con sus coordenadas.
- La ubicación guardada por GPS o elegida por el usuario tiene prioridad; Córdoba queda únicamente como referencia si no se concede el permiso de ubicación y no hay coordenadas guardadas.
- Se actualizó la versión de caché del service worker para que los archivos nuevos puedan reemplazar a los anteriores.

## Límites de esta etapa
- El nombre escrito manualmente no se convierte automáticamente en coordenadas.
- Todavía no hay geocodificación, mapa interactivo ni búsqueda de direcciones.
- Los lugares y registros se guardan en el almacenamiento local del navegador/dispositivo.


## Etapa 2 — Inicio con datos reales y mapa base
- Inicio consulta condiciones actuales, UV, viento, humedad y pronóstico horario/diario mediante Open-Meteo.
- La recomendación prioritaria cambia según las condiciones consultadas y usa un símbolo relacionado con la acción sugerida.
- Se ajustó la jerarquía visual: indicadores compactos, alertas intermedias, próximas horas resumidas y recomendación destacada en lila.
- Se incorporó un mapa interactivo Leaflet con cartografía OpenStreetMap y botón GPS en Radar.
- El radar de precipitación superpuesto todavía no está conectado: falta seleccionar un proveedor apto para el uso previsto y comprobar cobertura/condiciones.
- Las alertas oficiales todavía no están conectadas; la pantalla no debe interpretarse como un sistema de avisos activo.
- Los datos meteorológicos dependen de conexión a internet. Open-Meteo requiere atribución y sus condiciones deben revisarse antes de un uso comercial.


## Actualización meteorológica
- La pantalla de inicio consulta Open-Meteo al iniciar la aplicación. Si no hay una ubicación principal guardada con coordenadas, intenta obtener la ubicación del dispositivo con permiso del navegador; si no está disponible, utiliza Córdoba como ubicación de referencia.
- Mientras la aplicación está visible, vuelve a consultar los datos cada 10 minutos. También actualiza al regresar a la aplicación si la última consulta tiene más de un minuto.
- Android y los navegadores pueden suspender una PWA en segundo plano; por eso no se garantiza una actualización exacta mientras la aplicación está cerrada. Al volver a abrirla, se solicita una consulta nueva.
- Los datos provienen de Open-Meteo y representan la información meteorológica disponible para las coordenadas consultadas; no son una observación visual directa del cielo.
- Las animaciones de nubes, reflejos solares y gotas de lluvia todavía no están implementadas.
