import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import type { Env } from "./config/env.js";

export function createApp(env: Env) {
  const app = express();
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Feature routers (chat, refunds, admin) are mounted here in later steps.

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(onError);

  return app;
}
