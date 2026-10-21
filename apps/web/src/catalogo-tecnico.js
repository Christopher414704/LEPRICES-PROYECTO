import { crearDatosFicha, nombreModelo } from './ficha-vehiculo.js';

export function crearVisorCatalogo({ boton, estado, resultado, consultar }) {
  let idSeleccionado = '';
  let revision = 0;

  function limpiar(mensaje = '') {
    revision++;
    resultado.replaceChildren();
    estado.textContent = mensaje;
  }

  function seleccionar(id) {
    idSeleccionado = String(id ?? '');
    boton.disabled = !idSeleccionado;
    limpiar(idSeleccionado ? 'La ficha se consulta bajo demanda y no guarda el vehículo.' : 'Selecciona una versión para consultar su ficha.');
  }

  boton.onclick = async () => {
    if (!idSeleccionado || boton.disabled) return;
    const turno = ++revision;
    boton.disabled = true;
    resultado.replaceChildren();
    estado.textContent = 'Consultando el catálogo técnico FAXCAR…';
    try {
      const ficha = await consultar(idSeleccionado);
      if (turno !== revision) return;
      const encabezado = document.createElement('p');
      encabezado.className = 'identidad-catalogo';
      encabezado.textContent = nombreModelo(ficha);
      resultado.replaceChildren(encabezado, crearDatosFicha(ficha));
      estado.textContent = 'Ficha técnica consultada. Es una referencia del modelo y no una inspección de tu unidad.';
    } catch (error) {
      if (turno !== revision) return;
      estado.textContent = error?.message || 'No se pudo consultar la ficha técnica.';
    } finally {
      if (turno === revision) boton.disabled = !idSeleccionado;
    }
  };

  seleccionar('');
  return { seleccionar, limpiar };
}
