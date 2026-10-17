import unittest
from simular_ruta import simular


class SimulacionTest(unittest.TestCase):
    def setUp(self):
        self.p = {"masaKg": 1500, "cda": .7, "rodadura": .01, "potenciaKw": 100,
            "tipo": "auto", "referencia": "constante", "velocidadReferencia": 80,
            "velocidadMaxima": 110, "minutosMotorEncendido": 0, "incluirRelieve": True}

    def calcular(self, velocidad=80, pendiente=0, consumo=8, p=None):
        tramo = {"sentido": "ida", "kilometros": 10,
            "velocidades": [{"inicioKm": 0, "finKm": 10, "kmh": velocidad}],
            "relieve": {"disponible": True, "perfilMotor": [{"km": 0, "alturaM": 100}, {"km": 10, "alturaM": 100 + pendiente * 10000}]}}
        return simular({"parametros": p or self.p, "l100km": consumo, "tramos": [tramo]})

    def test_referencia_conserva_consumo_y_distancia(self):
        r = self.calcular()
        # El crucero de 10 km daría 0.8 L; el arranque consume energía cinética.
        self.assertGreater(r["litros"], .8)
        self.assertAlmostEqual(r["litros"], .8, delta=.08)
        self.assertAlmostEqual(r["tramos"][0]["segundosSimulados"], 450, delta=15)

    def test_resistencia_aerodinamica_velocidades_altas(self):
        self.assertGreater(self.calcular(110)["litros"], self.calcular(80)["litros"])

    def test_techo_no_aumenta_velocidad_del_mapa(self):
        a = self.calcular(40)
        p = {**self.p, "velocidadMaxima": 80}
        self.assertEqual(a["litros"], self.calcular(40, p=p)["litros"])
        self.assertGreater(self.calcular(100, p={**p, "velocidadMaxima": 40})["tramos"][0]["segundosSimulados"], self.calcular(100, p=p)["tramos"][0]["segundosSimulados"])

    def test_subidas_bajadas_sin_litros_negativos(self):
        self.assertGreater(self.calcular(pendiente=.03)["litros"], self.calcular()["litros"])
        self.assertGreater(self.calcular(pendiente=-.03)["litros"], 0)
        self.assertLess(self.calcular(pendiente=-.03)["litros"], self.calcular()["litros"])

    def test_paradas_suman_sin_inventar_distancia(self):
        r = self.calcular(p={**self.p, "minutosMotorEncendido": 20})
        self.assertGreater(r["litrosParadas"], 0)
        self.assertAlmostEqual(r["litros"] - r["litrosParadas"], self.calcular()["litros"])

    def test_carga_extra_no_se_cancela_al_calibrar_referencia(self):
        self.assertGreater(self.calcular(p={**self.p, "cargaExtraKg": 300})["litros"], self.calcular()["litros"])

    def test_consumo_alto_no_recibe_recargo_por_marca(self):
        self.assertAlmostEqual(self.calcular(consumo=18.09)["litros"] / self.calcular(consumo=8)["litros"], 18.09 / 8)

    def test_sin_elevacion_lo_informa_y_no_inventa_pendientes(self):
        t = {"sentido": "ida", "kilometros": 10, "velocidades": [{"inicioKm": 0, "finKm": 10, "kmh": 80}], "relieve": {"disponible": False}}
        r = simular({"parametros": self.p, "l100km": 8, "tramos": [t]})
        self.assertFalse(r["tramos"][0]["relieveAplicado"])
        self.assertIn("Faltan elevaciones", r["avisos"][-1])

    def test_potencia_insuficiente_no_reporta_ruta_que_no_cumplio(self):
        with self.assertRaises(ValueError):
            self.calcular(110, pendiente=.1, p={**self.p, "potenciaKw": 5})

    def test_moto_y_referencia_combinada_funcionan(self):
        p = {**self.p, "tipo": "moto", "masaKg": 300, "potenciaKw": 25, "cda": .45, "referencia": "combinado"}
        self.assertGreater(self.calcular(60, consumo=3, p=p)["litros"], 0)


if __name__ == "__main__":
    unittest.main()
