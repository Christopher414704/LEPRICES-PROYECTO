import { Viewer, ArcGisMapServerImageryProvider, ImageryLayer, SceneMode, Rectangle,
  Cartesian3, Cartographic, Math as CesiumMath, Color, ScreenSpaceEventType,
  PolylineDashMaterialProperty, LabelStyle, VerticalOrigin, Cartesian2, CustomDataSource } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

export async function iniciarMapaRutas(alMarcar) {
  const visor = new Viewer('mapaRuta', { baseLayer: false, baseLayerPicker: false, animation: false,
    timeline: false, geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
    sceneMode: SceneMode.SCENE2D, requestRenderMode: true, maximumRenderTimeChange: Infinity });
  visor.camera.setView({ destination: Rectangle.fromDegrees(-92.3, 13.5, -88, 18.1) });
  visor.scene.globe.baseColor = Color.fromCssColorString('#273445');
  const gasolineras = new CustomDataSource('gasolineras-rutas');
  await visor.dataSources.add(gasolineras);
  gasolineras.clustering.enabled = true; gasolineras.clustering.pixelRange = 35; gasolineras.clustering.minimumClusterSize = 3;
  gasolineras.clustering.clusterEvent.addEventListener((entidades, grupo) => {
    grupo.billboard.show = false; grupo.point.show = true; grupo.point.pixelSize = 24;
    grupo.point.color = Color.fromCssColorString('#d71920'); grupo.point.outlineColor = Color.WHITE; grupo.point.outlineWidth = 2;
    grupo.label.show = true; grupo.label.text = String(entidades.length); grupo.label.font = 'bold 13px sans-serif';
    grupo.label.fillColor = Color.WHITE; grupo.label.pixelOffset = new Cartesian2(0, 0);
  });
  let seleccion = 'destino', puntos = {}, rutaActual = null;
  visor.screenSpaceEventHandler.setInputAction(({ position }) => {
    const estacion = visor.scene.pick(position)?.id?.ubicacionRuta;
    if (estacion) return alMarcar(seleccion, estacion);
    const p = visor.camera.pickEllipsoid(position, visor.scene.globe.ellipsoid);
    if (!p) return;
    const c = Cartographic.fromCartesian(p);
    alMarcar(seleccion, { latitud: +CesiumMath.toDegrees(c.latitude).toFixed(6), longitud: +CesiumMath.toDegrees(c.longitude).toFixed(6) });
  }, ScreenSpaceEventType.LEFT_CLICK);
  // Un fallo de las imágenes no desactiva coordenadas, puntos ni cálculo.
  ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', { enablePickFeatures: false })
    .then(p => { visor.imageryLayers.add(new ImageryLayer(p)); visor.scene.requestRender(); })
    .catch(() => { document.getElementById('estadoMapaRuta').textContent = 'Imágenes del mapa no disponibles. Puedes elegir ciudades o escribir coordenadas.'; });
  function actualizar(origen, destino) {
    puntos = { origen, destino };
    for (const id of ['origen', 'destino', 'conexion']) visor.entities.removeById(id);
    for (const [id, p] of Object.entries(puntos)) {
      if (!Number.isFinite(p.latitud) || !Number.isFinite(p.longitud)) continue;
      visor.entities.add({ id, position: Cartesian3.fromDegrees(p.longitud, p.latitud),
        point: { pixelSize: 18, color: id === 'origen' ? Color.fromCssColorString('#283444') : Color.RED, outlineWidth: 3, outlineColor: Color.WHITE },
        label: { text: id === 'origen' ? 'A' : 'B', font: 'bold 18px sans-serif', fillColor: Color.WHITE,
          style: LabelStyle.FILL_AND_OUTLINE, outlineWidth: 3, outlineColor: Color.BLACK, verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian2(0, -16), disableDepthTestDistance: Infinity } });
    }
    if ([origen.latitud, origen.longitud, destino.latitud, destino.longitud].every(Number.isFinite)) {
      visor.entities.add({ id: 'conexion', polyline: { positions: Cartesian3.fromDegreesArray([origen.longitud, origen.latitud, destino.longitud, destino.latitud]), width: 3,
        material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString('#ff6a74') }) } });
    }
    visor.scene.requestRender();
  }
  function recorrido(ruta) {
    for (const id of ['ruta-ida', 'ruta-vuelta']) visor.entities.removeById(id);
    rutaActual = ruta;
    if (ruta) {
      visor.entities.removeById('conexion');
      // Regreso primero: la ida azul queda visible cuando ambos sentidos coinciden.
      for (const t of [...ruta.tramos].reverse()) visor.entities.add({ id: `ruta-${t.sentido}`, polyline: {
        positions: Cartesian3.fromDegreesArray(t.puntos.flatMap(p => [p.longitud, p.latitud])), width: t.sentido === 'ida' ? 4 : 7,
        material: Color.fromCssColorString(t.sentido === 'ida' ? '#3fafff' : '#ef3443') } });
    } else if (puntos.origen && puntos.destino) actualizar(puntos.origen, puntos.destino);
    visor.scene.requestRender();
  }
  function centrar() {
    const a = puntos.origen, b = puntos.destino;
    if (!a || !b || ![a.latitud, a.longitud, b.latitud, b.longitud].every(Number.isFinite)) return;
    let oeste = Math.min(a.longitud, b.longitud), este = Math.max(a.longitud, b.longitud), sur = Math.min(a.latitud, b.latitud), norte = Math.max(a.latitud, b.latitud);
    for (const t of rutaActual?.tramos ?? []) for (const p of t.puntos) { oeste = Math.min(oeste, p.longitud); este = Math.max(este, p.longitud); sur = Math.min(sur, p.latitud); norte = Math.max(norte, p.latitud); }
    visor.camera.flyTo({ destination: Rectangle.fromDegrees(oeste - .05, sur - .05, este + .05, norte + .05), duration: .7 });
  }
  function estaciones(lista) {
    gasolineras.entities.removeAll();
    for (const e of lista) {
      const entidad = gasolineras.entities.add({ id: `estacion-${e.codigo}`, position: Cartesian3.fromDegrees(e.ubicacion.longitud, e.ubicacion.latitud),
        billboard: { image: '/images/ubicacion.png', width: 26, height: 34, verticalOrigin: VerticalOrigin.BOTTOM } });
      entidad.ubicacionRuta = e.ubicacion;
    }
    visor.scene.requestRender();
  }
  return { actualizar, recorrido, centrar, estaciones, seleccionar: punto => { seleccion = punto; } };
}
