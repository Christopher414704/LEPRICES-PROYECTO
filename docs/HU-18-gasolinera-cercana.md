# HU-18 – Encontrar gasolinera más cercana

Implementada en el mapa público y el mapa interno mediante el botón «Gasolinera más cercana».
Se solicita autorización del navegador solamente al pulsarlo. Si se deniega, no se envían coordenadas a la API y el mapa continúa disponible.

GET /api/publico/gasolineras/cercana?latitud=...&longitud=... valida las coordenadas y consulta PostgreSQL/PostGIS.
Calcula la distancia esférica en línea recta entre el usuario y todas las estaciones activas, visibles al público y con marca activa.
Devuelve la de menor distancia, independientemente de filtros regionales, búsqueda, área visible y límite del catálogo.
El mapa muestra la ubicación del usuario, selecciona la estación y comunica su distancia en metros o kilómetros.
Un catálogo vacío produce un mensaje informativo. Errores de ubicación o de red permiten seguir usando el mapa y reintentar.

La distancia corresponde a línea recta, no a un recorrido por carretera. La geolocalización del navegador requiere HTTPS o localhost.
Las coordenadas no se guardan y la respuesta de proximidad usa Cache-Control: no-store.

Validación: pruebas de coordenadas, consulta parametrizada, endpoint HTTP, ausencia de estaciones, autorización denegada, navegador sin soporte y timeout; además de las pruebas existentes y compilación web.
