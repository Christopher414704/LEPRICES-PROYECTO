"""Motor local, sin red ni archivos del usuario. Protocolo JSON stdin/stdout.

Se normaliza energía/km contra un ciclo de referencia: no se suma el consumo
original otra vez. Es un escenario calibrado por consumo, no una ficha física
verificada ni una calibración de carreteras guatemaltecas.
"""
import copy
import json
import math
import sys
import fastsim

TEMPLATE = fastsim.Vehicle.from_resource("2012_Ford_Fusion.yaml").to_dict()


def vehiculo(p):
    v = copy.deepcopy(TEMPLATE)
    v["name"] = "LEPRICES: escenario convencional"
    v["mass_kilograms"] = p["masaKg"]
    v["chassis"]["cargo_mass_kilograms"] = 0.0
    v["chassis"]["drag_coef"] = p["cda"]
    v["chassis"]["frontal_area_square_meters"] = 1.0
    v["chassis"]["wheel_rr_coef"] = p["rodadura"]
    v["chassis"]["num_wheels"] = 2 if p["tipo"] == "moto" else 4
    v["chassis"]["wheel_inertia_kilogram_square_meters"] = 0.2 if p["tipo"] == "moto" else 0.82
    v["pwr_aux_base_watts"] = 100.0 if p["tipo"] == "moto" else 700.0
    fc = v["pt_type"]["Conv"]["fc"]
    fc["pwr_out_max_watts"] = p["potenciaKw"] * 1000
    fc["pwr_out_max_init_watts"] = fc["pwr_out_max_watts"] / 6
    v["pt_type"]["Conv"]["fs"]["pwr_out_max_watts"] = 10_000_000.0
    result = fastsim.Vehicle.from_dict(v)
    result.set_save_interval(None)
    return result


def ciclo(tiempos, velocidades, pendientes, altura=121.92):
    return fastsim.Cycle.from_dict({"time_seconds": tiempos,
        "speed_meters_per_second": velocidades, "grade": pendientes,
        "init_elev_meters": altura})


def energia(p, c, exigir=True):
    s = fastsim.SimDrive(vehiculo(p), c)
    try:
        s.run()
    except RuntimeError as exc:
        raise ValueError("El escenario no puede reproducirse con esa potencia o tracción. Revisa los parámetros y el techo de velocidad.") from exc
    d = s.to_dict(flatten=True)
    if exigir and not d["veh.state.cyc_met_overall"]:
        raise ValueError("El escenario excede la potencia o tracción del vehículo. Revisa peso, potencia y velocidad.")
    return d["veh.pt_type.Conv.fc.state.energy_fuel_joules"], d["veh.state.dist_meters"]


def referencia(p):
    if p["referencia"] == "constante":
        velocidad = p["velocidadReferencia"] / 3.6
        # Arranque reproducible y luego 600 s en crucero. Restamos el arranque
        # para que un consumo de velocidad constante no incluya aceleración.
        segundos = math.ceil(velocidad / .6)
        t = [float(i) for i in range(segundos + 1)]
        v = [velocidad * i / segundos for i in range(segundos + 1)]
        e0, d0 = energia(p, ciclo(t, v, [0.0] * len(t)))
        t += [float(segundos + i) for i in range(1, 601)]
        v += [velocidad] * 600
        e1, d1 = energia(p, ciclo(t, v, [0.0] * len(t)))
        return e1 - e0, d1 - d0
    nombres = ["udds.csv", "hwfet.csv"] if p["referencia"] == "combinado" else ["hwfet.csv"]
    tasas = [energia(p, fastsim.Cycle.from_resource(n)) for n in nombres]
    # Ponderación por distancia 55% ciudad / 45% carretera, no media de MPG.
    tasa = .55 * tasas[0][0] / tasas[0][1] + .45 * tasas[1][0] / tasas[1][1] if len(tasas) == 2 else tasas[0][0] / tasas[0][1]
    return tasa, 1.0


def construir(tramo, p):
    """120 m máximo por paso, aceleración suave supuesta, conserva distancia.

    Velocidades por maniobra = promedio estático, no telemetría. La elección
    del usuario es un techo que solo reduce velocidades del mapa.
    """
    partes = tramo["velocidades"]
    perfil = tramo["relieve"].get("perfilMotor", [])
    usar_relieve = p["incluirRelieve"] and tramo["relieve"]["disponible"] and len(perfil) >= 2
    tiempos, velocidades, pendientes = [0.0], [0.0], [0.0]
    x, indice, altura_idx = 0.0, 0, 0
    total = tramo["kilometros"] * 1000
    while x < total - 1e-7:
        if len(tiempos) > 60_000 or tiempos[-1] > 172_800:
            raise ValueError("La simulación supera el límite de recorrido. Divide el viaje en etapas.")
        while indice < len(partes) - 1 and x >= partes[indice]["finKm"] * 1000 - 1e-7:
            indice += 1
        ds = min(120.0, total - x, max(.01, partes[indice]["finKm"] * 1000 - x))
        objetivo = min(p["velocidadMaxima"], partes[indice]["kmh"]) / 3.6
        previo = velocidades[-1]
        # Cambios hasta 1 m/s²: supuesto reproducible, nunca dato observado.
        final = min(objetivo, (previo + math.sqrt(previo * previo + 4 * ds)) / 2) if objetivo >= previo else max(objetivo, math.sqrt(max(0.0, previo * previo - 2 * ds)))
        # FASTSim integra la velocidad al final del paso (Euler hacia atrás),
        # no el promedio de extremos. Así el ciclo conserva cada metro de ruta.
        dt = ds / max(.01, final)
        pendiente = 0.0
        if usar_relieve:
            while altura_idx < len(perfil) - 2 and perfil[altura_idx + 1]["km"] * 1000 < x + ds / 2:
                altura_idx += 1
            a, b = perfil[altura_idx:altura_idx + 2]
            pendiente = (b["alturaM"] - a["alturaM"]) / max(1.0, (b["km"] - a["km"]) * 1000)
            if abs(pendiente) > .25:
                raise ValueError("El terreno del mapa contiene pendientes poco fiables (>25%). Desactiva el relieve para comparar velocidad o marca otra ruta.")
        tiempos.append(tiempos[-1] + dt)
        velocidades.append(final)
        pendientes.append(pendiente)
        x += ds
    altura = perfil[0]["alturaM"] if usar_relieve else 121.92
    return ciclo(tiempos, velocidades, pendientes, altura), tiempos[-1], usar_relieve


def simular(data):
    p, tramos = data["parametros"], data["tramos"]
    e, d = referencia(p)
    tasa = e / d
    # La carga extra modifica solo el viaje. No se recalibra la referencia
    # cargada, lo que cancelaría parte del efecto físico de llevar más peso.
    cargado = {**p, "masaKg": p["masaKg"] + p.get("cargaExtraKg", 0)}
    resultados = []
    for tramo in tramos:
        c, segundos, relieve = construir(tramo, p)
        e, distancia = energia(cargado, c)
        esperado = tramo["kilometros"] * 1000
        if abs(distancia - esperado) > max(1.0, esperado * .002):
            raise ValueError("El vehículo no reprodujo la distancia solicitada. Revisa el escenario.")
        litros = e / tasa * data["l100km"] / 100_000
        resultados.append({"sentido": tramo["sentido"], "litros": litros,
            "segundosSimulados": segundos, "velocidadMedia": tramo["kilometros"] * 3600 / segundos,
            "relieveAplicado": relieve})
    idle = 0.0
    if p["minutosMotorEncendido"]:
        e, _ = energia(p, ciclo([0.0, p["minutosMotorEncendido"] * 60.0], [0.0] * 2, [0.0] * 2))
        idle = e / tasa * data["l100km"] / 100_000
    litros = sum(t["litros"] for t in resultados) + idle
    if not math.isfinite(litros) or litros <= 0:
        raise ValueError("No se obtuvo un consumo válido.")
    return {"motor": "FASTSim 3.1.0", "litros": litros, "litrosParadas": idle,
        "tramos": resultados, "parametros": p, "calibracion": "normalizacion_energetica",
        "avisos": ["Escenario con parámetros físicos introducidos por ti y curva de motor convencional de referencia; no ficha física verificada.",
            "Velocidades medias por maniobra del mapa, con cambios suaves supuestos. No hay tráfico ni aceleraciones medidas.",
            "Consumo normalizado al ciclo elegido; falta validarlo con viajes y llenados reales en Guatemala."] +
            (["Faltan elevaciones completas en algún tramo: allí se simuló terreno llano."] if p["incluirRelieve"] and any(not t["relieveAplicado"] for t in resultados) else [])}


if __name__ == "__main__":
    try:
        entrada = json.loads(sys.stdin.buffer.read(4_000_001))
        print(json.dumps({"data": simular(entrada)}, allow_nan=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=True))
        sys.exit(1)
