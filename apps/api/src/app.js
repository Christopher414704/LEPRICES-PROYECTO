import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.js";
import { apiRouter } from "./routes/index.routes.js";
import { notFoundHandler } from "./middlewares/not-found.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";

export const app = express();

app.disable("x-powered-by");

app.use(helmet());

app.use(
  cors({
    origin: env.frontendUrl,
  }),
);

app.use(
  express.json({
    limit: "1mb",
  }),
);

app.use(express.urlencoded({ extended: true }));

app.use("/api", apiRouter);

app.use(notFoundHandler);

app.use(errorHandler);
