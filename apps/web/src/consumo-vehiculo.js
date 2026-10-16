const formato = new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 });
const mostrarNumero = (valor) => valor > 0 && valor < 0.01 ? "menos de 0.01" : formato.format(valor);

export function resumenConsumo(consumo) {
  if (!consumo?.disponible) return consumo?.mensaje ?? "No hay información suficiente para estimar el consumo.";
  return `${mostrarNumero(consumo.consumoL100Km)} L/100 km · ${mostrarNumero(consumo.rendimientoKmLitro)} km/L`;
}

function elemento(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  nodo.className = clase;
  if (texto != null) nodo.textContent = texto;
  return nodo;
}

export function crearPanelConsumo(vehiculo, solicitar) {
  const panel = elemento("section", "panel-consumo");
  const titulo = elemento("h4", "", "Consumo estimado");
  const resultado = elemento("p", "resultado-consumo", "Consultando consumo…");
  resultado.setAttribute("role", "status");
  resultado.setAttribute("aria-live", "polite");
  const fuente = elemento("p", "fuente-consumo");
  const mensaje = elemento("p", "mensaje-consumo");
  mensaje.setAttribute("role", "status");
  const reintentar = elemento("button", "boton-consumo-secundario", "Reintentar consumo");
  reintentar.type = "button";
  reintentar.hidden = true;
  const detalles = elemento("details", "medicion-consumo");
  detalles.append(elemento("summary", "", "Usar mis datos de consumo"));
  detalles.append(elemento("p", "", "Registra kilómetros recorridos y litros consumidos en el mismo intervalo. Si usas recargas, mide de un tanque lleno al siguiente tanque lleno."));
  const formulario = elemento("form", "form-consumo");
  const campos = elemento("div", "campos");
  const inputs = {};
  for (const [nombre, texto, maximo] of [["distanciaKm", "Distancia recorrida (km)", "1000000"], ["litros", "Combustible consumido (litros)", "100000"]]) {
    const label = elemento("label", "", texto);
    const input = document.createElement("input");
    input.type = "number";
    input.name = nombre;
    input.id = `consumo-${nombre}-${vehiculo.id}`;
    input.min = "0.01";
    input.max = maximo;
    input.step = "0.01";
    input.required = true;
    label.htmlFor = input.id;
    label.append(input);
    campos.append(label);
    inputs[nombre] = input;
  }
  const guardar = elemento("button", "", "Guardar medición y estimar");
  guardar.type = "submit";
  const quitar = elemento("button", "boton-consumo-secundario", "Eliminar mi medición");
  quitar.type = "button";
  quitar.hidden = true;
  const acciones = elemento("div", "acciones-consumo");
  acciones.append(guardar, quitar);
  formulario.append(campos, acciones);
  detalles.append(formulario);
  detalles.hidden = true;
  const nota = elemento("p", "nota-consumo", "Es una estimación: el tráfico, la carga y la conducción pueden cambiar el consumo. El valor por kilómetro queda disponible para futuros cálculos de rutas.");
  panel.append(titulo, resultado, fuente, mensaje, reintentar, detalles, nota);
  const ruta = `/vehiculos/${encodeURIComponent(vehiculo.id)}/consumo`;
  let ocupado = false;

  function bloquear(valor) {
    ocupado = valor;
    formulario.setAttribute("aria-busy", String(valor));
    for (const input of Object.values(inputs)) input.disabled = valor;
    guardar.disabled = quitar.disabled = reintentar.disabled = valor;
  }

  function presentar(consumo) {
    resultado.textContent = resumenConsumo(consumo);
    fuente.textContent = consumo.disponible ? consumo.fuente === "usuario"
      ? `Basado en tu medición: ${formato.format(consumo.datosUsuario.distanciaKm)} km y ${formato.format(consumo.datosUsuario.litros)} litros.`
      : "Referencia del catálogo: consumo combinado del modelo registrado, no una medición de tu automóvil." : "";
    if (consumo.datosUsuario?.actualizadoEn) {
      const fecha = new Date(consumo.datosUsuario.actualizadoEn);
      if (Number.isFinite(fecha.getTime())) fuente.textContent += ` Guardado: ${new Intl.DateTimeFormat("es-GT", { timeZone: "America/Guatemala", dateStyle: "medium" }).format(fecha)}.`;
    }
    detalles.hidden = consumo.motivo === "vehiculo_electrico";
    nota.hidden = !consumo.disponible;
    inputs.distanciaKm.value = consumo.datosUsuario?.distanciaKm ?? "";
    inputs.litros.value = consumo.datosUsuario?.litros ?? "";
    quitar.hidden = !consumo.datosUsuario;
    reintentar.hidden = true;
  }

  async function cargar() {
    if (ocupado) return;
    bloquear(true);
    mensaje.textContent = "";
    try { presentar(await solicitar(ruta)); }
    catch (error) {
      resultado.textContent = "No fue posible consultar el consumo.";
      mensaje.textContent = error.message;
      reintentar.hidden = false;
      detalles.hidden = true;
      nota.hidden = true;
    } finally { bloquear(false); }
  }

  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (ocupado) return;
    bloquear(true);
    mensaje.textContent = "Guardando medición…";
    try {
      const consumo = await solicitar(ruta, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distanciaKm: inputs.distanciaKm.value, litros: inputs.litros.value }) });
      presentar(consumo);
      mensaje.textContent = "Medición guardada. La estimación ahora utiliza tus datos.";
    } catch (error) { mensaje.textContent = error.message; }
    finally { bloquear(false); }
  });

  quitar.addEventListener("click", async () => {
    if (ocupado) return;
    bloquear(true);
    mensaje.textContent = "Eliminando medición…";
    try {
      presentar(await solicitar(ruta, { method: "DELETE" }));
      mensaje.textContent = "Medición eliminada. Se volvió a consultar la información del vehículo.";
    } catch (error) { mensaje.textContent = error.message; }
    finally { bloquear(false); }
  });
  reintentar.addEventListener("click", cargar);
  cargar();
  return panel;
}
