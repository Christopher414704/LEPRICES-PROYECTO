import { Router } from "express";

import { getHealth } from "../controllers/health.controller.js";
import { crearPublicoRouter } from "./publico.routes.js";
import { gasolinerasRouter } from "./gasolineras.routes.js";

export const apiRouter = Router();

apiRouter.get("/health", getHealth);
apiRouter.use("/publico", crearPublicoRouter());
apiRouter.use("/gasolineras", gasolinerasRouter);
