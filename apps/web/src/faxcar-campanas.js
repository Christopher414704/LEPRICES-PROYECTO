export function crearPanelCampanas(vehiculo, api) {
  const panel = document.createElement('section'), titulo = document.createElement('h4');
  titulo.textContent = 'FAXCAR · Campañas oficiales de seguridad';
  const nota = document.createElement('p');
  nota.textContent = 'Mercado: Estados Unidos (NHTSA). Coincidencias por marca, modelo y año; no confirman un defecto ni una reparación pendiente de tu unidad. Verifica la aplicación a tu VIN y mercado con el fabricante.';
  const boton = document.createElement('button'); boton.type = 'button'; boton.textContent = 'Consultar campañas';
  const estado = document.createElement('p'); estado.setAttribute('role', 'status'); estado.setAttribute('aria-live', 'polite');
  const resultados = document.createElement('div');
  function enlace(texto, url) {
    const a = document.createElement('a'); a.textContent = texto; a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  boton.onclick = async () => {
    if (boton.disabled) return;
    boton.disabled = true; estado.textContent = 'Consultando NHTSA…'; resultados.replaceChildren();
    try {
      const datos = await api(vehiculo.id);
      const identidad = document.createElement('p'); identidad.textContent = `${datos.identidad.marca} ${datos.identidad.modelo} · ${datos.identidad.anio} · ${datos.mercado}`;
      resultados.append(identidad);
      estado.textContent = datos.estado === 'sin_coincidencias'
        ? 'NHTSA no devolvió campañas coincidentes con esta marca, modelo y año. Esto no certifica ausencia de defectos ni cobertura de otros mercados.'
        : `${datos.campanas.length} campaña(s) del modelo. Textos oficiales en el idioma de la fuente.`;
      for (const c of datos.campanas) {
        const bloque = document.createElement('article'), h = document.createElement('h5');
        h.textContent = `Campaña ${c.numero} · ${c.componente}`; bloque.append(h);
        for (const [nombre, valor] of [['Fecha del reporte (MM/DD/AAAA)', c.fechaReporte], ['Fabricante', c.fabricante],
          ['Resumen oficial', c.resumen], ['Consecuencia', c.consecuencia], ['Medida indicada', c.solucion], ['Notas', c.notas]]) {
          if (!valor) continue;
          const p = document.createElement('p'); p.textContent = `${nombre}: ${valor}`; bloque.append(p);
        }
        if (c.noConducir || c.estacionarAfuera) {
          const aviso = document.createElement('strong');
          aviso.textContent = [c.noConducir ? 'La campaña incluye aviso de no conducir.' : '', c.estacionarAfuera ? 'La campaña incluye aviso de estacionar afuera.' : ''].filter(Boolean).join(' ');
          bloque.append(aviso);
        }
        // Construir el enlace con el identificador evita interpretar URLs del proveedor.
        bloque.append(enlace('Ver campaña en la fuente oficial', `https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber=${encodeURIComponent(c.numero)}`));
        resultados.append(bloque);
      }
      const fecha = document.createElement('p'); fecha.textContent = `Consulta a NHTSA: ${new Date(datos.consultadoEn).toLocaleString('es-GT', { timeZone: 'America/Guatemala' })}. Los resultados pueden conservarse hasta 15 minutos.`;
      resultados.append(fecha);
    } catch (error) { estado.textContent = error.message || 'No fue posible consultar NHTSA. Reintenta más tarde.'; }
    finally { boton.disabled = false; }
  };
  panel.append(titulo, nota, boton, estado, resultados, enlace('Consultar directamente en NHTSA por VIN o modelo', 'https://www.nhtsa.gov/recalls'));
  return panel;
}
