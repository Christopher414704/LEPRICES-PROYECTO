import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCatalogoVehiculos, normalizarFicha } from "../src/services/catalogo-vehiculos.service.js";

const ejemplo = { id: "41217", year: "2020", make: "Toyota", model: "Corolla", displ: "1.8", cylinders: "4",
  trany: "Automatic (variable gear ratios)", drive: "Front-Wheel Drive", fuelType1: "Regular Gasoline",
  city08: "30", highway08: "38", comb08: "33" };

test("convierte MPG estadounidenses a L/100 km y no convierte MPGe en combustible", () => {
  const ficha = normalizarFicha(ejemplo);
  assert.equal(ficha.motorLitros, 1.8);
  assert.equal(ficha.consumo.ciudad, 7.84);
  assert.equal(ficha.consumo.carretera, 6.19);
  assert.equal(ficha.consumo.combinado, 7.13);
  const electrico = normalizarFicha({ ...ejemplo, fuelType1: "Electricity", displ: "", cylinders: "" });
  assert.equal(electrico.consumo.combinado, null);
  assert.equal(electrico.motorLitros, null);
  assert.equal(normalizarFicha({ ...ejemplo, comb08: "0" }).consumo.combinado, null);
});

test("menús admiten un solo resultado y codifican marcas y modelos sin alterar la URL", async () => {
  let url;
  const catalogo = crearCatalogoVehiculos({ solicitar: async (destino) => {
    url = destino;
    return Response.json({ menuItem: { value: "41217", text: "1.8 L" } });
  } });
  assert.deepEqual(await catalogo.menu("options", { anio: "2020", marca: "Toyota & otra", modelo: "Corolla/Hybrid" }), [{ nombre: "1.8 L", valor: "41217" }]);
  assert.equal(url.origin, "https://www.fueleconomy.gov");
  assert.equal(url.searchParams.get("make"), "Toyota & otra");
  assert.equal(url.searchParams.get("model"), "Corolla/Hybrid");
});

test("rechaza parámetros inválidos antes de llamar al proveedor", async () => {
  const catalogo = crearCatalogoVehiculos({ solicitar: () => { throw new Error("No debe consultar"); } });
  for (const [nivel, datos] of [["invalido", {}], ["make", { anio: "1900" }], ["model", { anio: "2020", marca: {} }]]) {
    await assert.rejects(catalogo.menu(nivel, datos), { statusCode: 400 });
  }
  await assert.rejects(catalogo.ficha("../menu/year"), { statusCode: 400 });
});

test("comparte consultas concurrentes, almacena resultados y reintenta tras fallo", async () => {
  let llamadas = 0;
  let fallo = true;
  const catalogo = crearCatalogoVehiculos({ solicitar: async () => {
    llamadas++;
    if (fallo) throw new Error("Sin conexión");
    return Response.json(ejemplo);
  } });
  await assert.rejects(catalogo.ficha("41217"), { statusCode: 503 });
  fallo = false;
  const [a, b] = await Promise.all([catalogo.ficha("41217"), catalogo.ficha("41217")]);
  assert.deepEqual(a, b);
  await catalogo.ficha("41217");
  assert.equal(llamadas, 2);
});

test("rechaza fichas distintas al ID solicitado y fichas incompletas", async () => {
  const catalogo = crearCatalogoVehiculos({ solicitar: async () => Response.json(ejemplo) });
  await assert.rejects(catalogo.ficha("41218"), { statusCode: 502 });
  assert.throws(() => normalizarFicha({ id: "41217" }), { statusCode: 502 });
});
