export function crearPanelInvestigacion(vehiculo, api, recargar) {
  const panel = document.createElement('section');
  const titulo = document.createElement('h4'); titulo.textContent = 'Investigación con fuentes documentadas';
  const aviso = document.createElement('p');
  aviso.textContent = 'Se usa primero la ficha del catálogo. Solo se investigan datos faltantes de la marca, modelo, año y versión registrados; verifica las referencias antes de atribuirlas a tu vehículo. Plazo máximo: tres minutos.';
  const estado = document.createElement('p'); estado.setAttribute('role', 'status'); estado.setAttribute('aria-live', 'polite');
  const boton = document.createElement('button'); boton.type = 'button'; boton.textContent = 'Investigar este vehículo';
  boton.disabled = !vehiculo.ficha?.anio;
  if (boton.disabled) estado.textContent = 'Registra el año del vehículo antes de investigar.';
  const fuentes = document.createElement('ul');
  for (const fuente of (vehiculo.ficha?.complemento?.fuentes ?? [])) {
    const item = document.createElement('li');
    try {
      const url = new URL(fuente.url);
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      const enlace = document.createElement('a'); enlace.href = url.href; enlace.target = '_blank'; enlace.rel = 'noopener noreferrer';
      enlace.textContent = fuente.titulo || url.hostname;
      item.append(enlace); fuentes.append(item);
    } catch { /* Las fuentes sin URL pública no se convierten en enlaces. */ }
  }
  const anterior = vehiculo.ficha?.complemento;
  if (anterior?.origen === 'investigacion') {
    estado.textContent = `Última investigación: ${anterior.fuentes?.length ?? 0} fuentes, ${anterior.conflictos?.length ?? 0} contradicciones y ${anterior.faltantes?.length ?? 0} campos pendientes. Referencias sujetas a revisión.`;
  }
  boton.onclick = async () => {
    boton.disabled = true; estado.textContent = 'Solicitando investigación…';
    try {
      let trabajo = await api(`/vehiculos/${encodeURIComponent(vehiculo.id)}/investigacion`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: '{}' });
      while (panel.isConnected) {
        estado.textContent = trabajo.progreso;
        if (trabajo.estado === 'error') return;
        if (trabajo.estado === 'terminada') { if (trabajo.id) await recargar(); return; }
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (!panel.isConnected) return;
        trabajo = await api(`/vehiculos/${encodeURIComponent(vehiculo.id)}/investigacion/${encodeURIComponent(trabajo.id)}`);
      }
    } catch (error) { estado.textContent = error.message || 'No fue posible consultar la investigación.'; }
    finally { boton.disabled = false; }
  };
  panel.append(titulo, aviso, boton, estado, fuentes);
  return panel;
}
