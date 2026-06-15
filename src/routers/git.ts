import { z } from "zod";
import simpleGit from "simple-git";
import { router, publicProcedure } from "../trpc.js";
import { validatePath } from "../lib/validate-path.js";

const PROJECTS_ROOT = process.env.PROJECTS_ROOT ?? "/var/lib/rancher/ansible/db";

function getGit(projectDir: string) {
  validatePath(projectDir, PROJECTS_ROOT);
  return simpleGit(projectDir);
}

export const gitRouter = router({
  status: publicProcedure
    .input(z.object({ projectDir: z.string() }))
    .query(async ({ input }) => {
      const git = getGit(input.projectDir);
      const status = await git.status();
      return {
        branch: status.current ?? "unknown",
        staged: status.staged,
        modified: status.modified,
        untracked: status.not_added,
      };
    }),

  commit: publicProcedure
    .input(z.object({ message: z.string(), projectDir: z.string() }))
    .mutation(async ({ input }) => {
      const git = getGit(input.projectDir);
      const result = await git.commit(input.message);
      return { hash: result.commit, summary: result.summary };
    }),

  log: publicProcedure
    .input(z.object({ projectDir: z.string(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      const git = getGit(input.projectDir);
      const log = await git.log({ maxCount: input.limit ?? 20 });
      return log.all.map((entry) => ({
        hash: entry.hash,
        message: entry.message,
        author: entry.author_name,
        date: entry.date,
      }));
    }),

  diff: publicProcedure
    .input(z.object({ projectDir: z.string(), file: z.string().optional() }))
    .query(async ({ input }) => {
      const git = getGit(input.projectDir);
      const diff = input.file ? await git.diff([input.file]) : await git.diff();
      return { diff };
    }),
});
