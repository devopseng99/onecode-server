import { router, publicProcedure } from "../trpc.js";

const startTime = Date.now();
const version = process.env.npm_package_version ?? "1.0.0";

export const healthRouter = router({
  check: publicProcedure.query(() => ({
    status: "ok" as const,
    version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  })),
});
