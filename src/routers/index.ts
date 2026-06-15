import { router } from "../trpc.js";
import { healthRouter } from "./health.js";
import { claudeRouter } from "./claude.js";
import { filesRouter } from "./files.js";
import { gitRouter } from "./git.js";

export const appRouter = router({
  health: healthRouter,
  claude: claudeRouter,
  files: filesRouter,
  git: gitRouter,
});

export type AppRouter = typeof appRouter;
