import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

const DEFAULT_PROJECT = {
  id: "default",
  name: "my-onecode",
  path: "/var/lib/rancher/ansible/db/onecode/my-onecode",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/**
 * Minimal projects router — returns a single default project.
 * The Electron version uses SQLite; we hardcode for the self-hosted web deploy.
 */
export const projectsRouter = router({
  list: publicProcedure.query(() => {
    return [DEFAULT_PROJECT];
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      if (input.id === "default") return DEFAULT_PROJECT;
      return null;
    }),

  openFolder: publicProcedure.mutation(() => {
    return DEFAULT_PROJECT;
  }),
});
