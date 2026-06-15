import Fastify from "fastify";
import cors from "@fastify/cors";
import ws from "@fastify/websocket";
import {
  fastifyTRPCPlugin,
  type FastifyTRPCPluginOptions,
} from "@trpc/server/adapters/fastify";
import { appRouter, type AppRouter } from "./routers/index.js";
import { createContext } from "./trpc.js";

const PORT = parseInt(process.env.PORT ?? "4000", 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "https://onecode.istayintek.com";
const LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";

const server = Fastify({
  logger: { level: LOG_LEVEL },
  maxParamLength: 5000,
});

async function main() {
  await server.register(cors, {
    origin: CORS_ORIGIN,
    credentials: true,
  });

  await server.register(ws);

  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    useWSS: true,
    trpcOptions: {
      router: appRouter,
      createContext,
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  server.get("/health", async () => ({
    status: "ok",
    version: process.env.npm_package_version ?? "1.0.0",
    uptime: Math.floor(process.uptime()),
  }));

  await server.listen({ port: PORT, host: "0.0.0.0" });
  server.log.warn(`onecode-server listening on port ${PORT}`);

  const shutdown = async () => {
    server.log.warn("Shutting down...");
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
