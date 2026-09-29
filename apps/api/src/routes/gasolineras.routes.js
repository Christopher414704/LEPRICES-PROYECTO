import { Router } from "express";

import {
  listarGasolineras,
} from "../controllers/gasolineras.controller.js";

export const gasolinerasRouter = Router();

gasolinerasRouter.get("/", listarGasolineras);