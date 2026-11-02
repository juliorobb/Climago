# ClimaGo

Aplicación web móvil en construcción: clima, prevención y organización cotidiana.

## Primera entrega
- Navegación móvil entre módulos.
- Pantalla de inicio con datos meteorológicos de demostración.
- Pantallas iniciales de radar, pronóstico, alertas, prevención, agenda, vehículo, lugares y configuración.
- Registro local de trabajos y gastos del vehículo.
- Guardado local de actividades y ubicaciones.
- Base inicial de PWA: `manifest.json` y `service-worker.js`.

## Importante
Los datos meteorológicos son ilustrativos. No hay conexión a servicios meteorológicos ni alertas oficiales en esta versión.

## Prueba
Abrir `index.html` mediante un servidor web local o un alojamiento HTTPS. Las funciones PWA y geolocalización requieren contexto seguro (HTTPS o localhost).


## Etapa 1 — Inicio y Mis lugares
- Se retiraron los accesos rápidos duplicados de Inicio para reducir el desplazamiento.
- Mis lugares permite agregar lugares por nombre y guardarlos localmente.
- Se puede elegir cuál de los lugares guardados es el principal.
- La ubicación GPS, con permiso del usuario, se guarda con sus coordenadas.
- Se eliminó la ubicación fija de demostración de Córdoba.
- Se actualizó la versión de caché del service worker para que los archivos nuevos puedan reemplazar a los anteriores.

## Límites de esta etapa
- El nombre escrito manualmente no se convierte automáticamente en coordenadas.
- Todavía no hay geocodificación, mapa interactivo ni búsqueda de direcciones.
- Los datos meteorológicos continúan siendo ilustrativos; esta etapa no incorpora un proveedor meteorológico.
- Los lugares y registros se guardan en el almacenamiento local del navegador/dispositivo.
