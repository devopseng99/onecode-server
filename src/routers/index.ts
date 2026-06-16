import { router } from "../trpc.js";
import { healthRouter } from "./health.js";
import { claudeRouter } from "./claude.js";
import { filesRouter } from "./files.js";
import { gitRouter } from "./git.js";
import { terminalRouter } from "./terminal.js";
import { chatHistoryRouter } from "./chat-history.js";
import { claudeCodeRouter } from "./claude-code.js";
import { projectsRouter } from "./projects.js";

export const appRouter = router({
  health: healthRouter,
  claude: claudeRouter,
  claudeCode: claudeCodeRouter,
  files: filesRouter,
  git: gitRouter,
  terminal: terminalRouter,
  chatHistory: chatHistoryRouter,
  projects: projectsRouter,
});

export type AppRouter = typeof appRouter;
