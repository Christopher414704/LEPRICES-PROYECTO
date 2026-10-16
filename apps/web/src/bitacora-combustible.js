const numero = new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 });
const moneda = new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" });
const fecha = new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guatemala" });

export function textoRendimiento(valor) {
  return Number.isFinite(valor) && valor > 0 ? `${numero.format(valor)} km/L` : "Pendiente de otra carga con tanque lleno";
}

function elemento(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto != null) nodo.textContent = texto;
  return nodo;
}

function campo(nombre, etiqueta, atributos = {}) {
  const label = elemento("label", "", etiqueta);
  const input = document.createElement(atributos.multiline ? "textarea" : "input");
  input.name = nombre;
  for (const [clave, valor] of Object.entries(atributos)) {
    if (clave === "multiline") continue;
    if (valor === true) input.setAttribute(clave, "");
    else input.setAttribute(clave, valor);
  }
  label.append(input);
  return { label, input };
}

function ahoraLocal() {
  const actual = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return actual.toISOString().slice(0, 16);
}

export function crearPanelBitacora(vehiculo, solicitar) {
  const panel = elemento("details", "panel-bitacora");
  panel.append(elemento("summary", "", `Bitácora de combustible · ${vehiculo.alias}`));
  const estado = elemento("p", "mensaje-bitacora", "Abre esta sección para consultar tus cargas.");
  estado.setAttribute("role", "status");
  estado.setAttribute("aria-live", "polite");
  const promedio = elemento("p", "rendimiento-bitacora");
  const formulario = elemento("form", "form-bitacora");
  const campos = elemento("div", "campos campos-bitacora");
  const controles = {
    fechaCarga: campo("fechaCarga", "Fecha y hora", { type: "datetime-local", required: true }),
    kilometraje: campo("kilometraje", "Odómetro (km)", { type: "number", min: "0", max: "9999999.9", step: "0.1", required: true }),
    litros: campo("litros", "Litros cargados", { type: "number", min: "0.001", max: "10000", step: "0.001", required: true }),
    costoTotal: campo("costoTotal", "Costo total (Q, opcional)", { type: "number", min: "0.01", max: "99999999.99", step: "0.01" }),
  };
  for (const control of Object.values(controles)) campos.append(control.label);
  const lleno = elemento("label", "check-bitacora");
  const tanqueLleno = document.createElement("input");
  tanqueLleno.type = "checkbox";
  tanqueLleno.checked = true;
  lleno.append(tanqueLleno, document.createTextNode(" Tanque lleno"));
  const notas = campo("notas", "Notas (opcional)", { multiline: true, maxlength: "300", rows: "2" });
  const guardar = elemento("button", "", "Registrar carga");
  guardar.type = "submit";
  formulario.append(campos, lleno, notas.label, guardar);
  const historial = elemento("ol", "historial-cargas");
  panel.append(estado, promedio, formulario, elemento("h5", "", "Historial de cargas"), historial);
  controles.fechaCarga.input.value = ahoraLocal();
  controles.kilometraje.input.value = vehiculo.kilometrajeActual ?? vehiculo.kilometrajeInicial ?? "";
  const ruta = `/vehiculos/${encodeURIComponent(vehiculo.id)}/cargas`;
  let cargado = false;
  let ocupado = false;

  function bloquear(valor) {
    ocupado = valor;
    for (const control of Object.values(controles)) control.input.disabled = valor;
    tanqueLleno.disabled = notas.input.disabled = guardar.disabled = valor;
  }

  function mostrar(datos) {
    promedio.textContent = `Rendimiento promedio: ${textoRendimiento(datos.rendimientoPromedioKmLitro)}`;
    historial.replaceChildren();
    for (const carga of datos.cargas) {
      const item = elemento("li", "carga-bitacora");
      const instante = new Date(carga.fechaCarga);
      const titulo = Number.isFinite(instante.getTime()) ? fecha.format(instante) : "Fecha no disponible";
      item.append(elemento("strong", "", titulo));
      item.append(elemento("span", "", `${numero.format(carga.litros)} L · ${numero.format(carga.kilometraje)} km`));
      item.append(elemento("span", "", carga.costoTotal == null ? "Costo no indicado" : moneda.format(carga.costoTotal)));
      item.append(elemento("span", "", `${carga.tanqueLleno ? "Tanque lleno" : "Carga parcial"} · ${textoRendimiento(carga.rendimientoKmLitro)}`));
      if (carga.notas) item.append(elemento("small", "", carga.notas));
      historial.append(item);
    }
    if (!datos.cargas.length) historial.append(elemento("li", "carga-bitacora", "Todavía no hay cargas registradas para este vehículo."));
  }

  async function cargar() {
    if (ocupado) return;
    bloquear(true);
    estado.textContent = "Consultando bitácora…";
    try {
      const datos = await solicitar(ruta);
      mostrar(datos);
      estado.textContent = `${datos.cargas.length} carga(s) registrada(s).`;
      cargado = true;
    } catch (error) { estado.textContent = error.message; }
    finally { bloquear(false); }
  }

  panel.addEventListener("toggle", () => { if (panel.open && !cargado) cargar(); });
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (ocupado) return;
    bloquear(true);
    estado.textContent = "Guardando carga…";
    try {
      await solicitar(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        fechaCarga: new Date(controles.fechaCarga.input.value).toISOString(),
        kilometraje: controles.kilometraje.input.value,
        litros: controles.litros.input.value,
        costoTotal: controles.costoTotal.input.value || null,
        tanqueLleno: tanqueLleno.checked,
        notas: notas.input.value,
      }) });
      controles.litros.input.value = "";
      controles.costoTotal.input.value = "";
      notas.input.value = "";
      controles.fechaCarga.input.value = ahoraLocal();
      estado.textContent = "Carga registrada.";
      cargado = false;
      bloquear(false);
      await cargar();
    } catch (error) { estado.textContent = error.message; }
    finally { bloquear(false); }
  });
  return panel;
}
