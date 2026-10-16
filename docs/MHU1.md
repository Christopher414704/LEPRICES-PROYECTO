# MHU1 – Consultar mapa de gasolineras

**Estado:** Implementada

## Descripción

**Como:** usuario

**Quiero:** consultar las gasolineras disponibles en un mapa

**Para:** conocer su ubicación y revisar la información de cada estación.

## Implementación

La vista pública obtiene las estaciones desde PostgreSQL mediante la API y las representa dinámicamente sobre un mapa de Cesium. El flujo de datos es:

**PostgreSQL → API pública → frontend → mapa**

`GET /api/publico/gasolineras` devuelve únicamente estaciones activas y visibles, con su identificador, código, nombre, ubicación y datos necesarios para mostrarlas. El frontend crea los marcadores a partir de esta respuesta; no mantiene un catálogo fijo de estaciones.

El mapa permite:

- visualizar las gasolineras según sus coordenadas;
- agrupar marcadores cercanos para mantener legible el mapa;
- filtrar por departamento, municipio y nombre;
- seleccionar una estación desde el mapa o desde los resultados;
- centrar la cámara en la estación seleccionada;
- consultar su dirección, modalidad de servicio y precios vigentes;
- actualizar el catálogo periódicamente y cuando la ventana recupera el foco.

Si no existen estaciones para los filtros elegidos, se muestra un estado vacío informativo. Si la API o el mapa no están disponibles, la interfaz presenta un error controlado sin sustituir los datos por un catálogo estático.

## Endpoints relacionados

- `GET /api/publico/gasolineras`: catálogo público y filtros del mapa.
- `GET /api/publico/gasolineras/:codigo/precios`: precios vigentes de una estación.
- `GET /api/publico/regiones`: departamentos y municipios disponibles.
- `GET /api/publico/gasolineras/cercana`: estación más cercana a unas coordenadas.

## Verificación

Las pruebas automatizadas cubren el contrato del catálogo público, la consulta a PostgreSQL, los filtros, la búsqueda, los precios, la selección de estaciones y el manejo de respuestas inválidas o errores de red.
