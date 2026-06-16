import { z } from "zod";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { observable } from "@trpc/server/observable";
import { router, publicProcedure } from "../trpc.js";
import { terminalManager } from "../terminal/manager.js";
import type { TerminalEvent } from "../terminal/types.js";

const DEFAULT_CWD = process.env.PROJECTS_ROOT ?? "/var/lib/rancher/ansible/db";

export const terminalRouter = router({
  createOrAttach: publicProcedure
    .input(
      z.object({
        paneId: z.string(),
        tabId: z.string().optional(),
        workspaceId: z.string().optional(),
        scopeKey: z.string().optional(),
        cols: z.number().optional(),
        rows: z.number().optional(),
        cwd: z.string().optional(),
        initialCommands: z.array(z.string()).optional(),
      })
    )
    .mutation(({ input }) => {
      return terminalManager.createOrAttach(input);
    }),

  write: publicProcedure
    .input(
      z.object({
        paneId: z.string(),
        data: z.string(),
      })
    )
    .mutation(({ input }) => {
      terminalManager.write(input.paneId, input.data);
      return { ok: true };
    }),

  resize: publicProcedure
    .input(
      z.object({
        paneId: z.string(),
        cols: z.number(),
        rows: z.number(),
      })
    )
    .mutation(({ input }) => {
      terminalManager.resize(input.paneId, input.cols, input.rows);
      return { ok: true };
    }),

  signal: publicProcedure
    .input(
      z.object({
        paneId: z.string(),
        signal: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      terminalManager.signal(input.paneId, input.signal);
      return { ok: true };
    }),

  kill: publicProcedure
    .input(
      z.object({
        paneId: z.string(),
      })
    )
    .mutation(({ input }) => {
      terminalManager.kill(input.paneId);
      return { ok: true };
    }),

  detach: publicProcedure
    .input(
      z.object({
        paneId: z.string(),
        serializedState: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      terminalManager.detach(input.paneId, input.serializedState);
      return { ok: true };
    }),

  clearScrollback: publicProcedure
    .input(
      z.object({
        paneId: z.string(),
      })
    )
    .mutation(({ input }) => {
      terminalManager.clearScrollback(input.paneId);
      return { ok: true };
    }),

  getSession: publicProcedure.input(z.string()).query(({ input: paneId }) => {
    const session = terminalManager.getSession(paneId);
    if (!session) return null;
    return {
      paneId: session.paneId,
      workspaceId: session.workspaceId,
      scopeKey: session.scopeKey,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      lastActive: session.lastActive,
      isAlive: session.isAlive,
      serializedState: session.serializedState,
    };
  }),

  getActiveSessionCount: publicProcedure
    .input(
      z.object({
        workspaceId: z.string(),
      })
    )
    .query(({ input }) => {
      return { count: terminalManager.getActiveSessionCount(input.workspaceId) };
    }),

  getWorkspaceCwd: publicProcedure.input(z.string()).query(() => {
    return { cwd: DEFAULT_CWD };
  }),

  listDirectory: publicProcedure
    .input(
      z.object({
        dirPath: z.string(),
      })
    )
    .query(({ input }) => {
      const dirPath = resolve(input.dirPath);
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        return entries.map((entry) => {
          const fullPath = join(dirPath, entry.name);
          let size = 0;
          try {
            size = statSync(fullPath).size;
          } catch {
            // ignore stat errors
          }
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            size,
          };
        });
      } catch (err: any) {
        throw new Error(`Cannot list directory: ${err.message}`);
      }
    }),

  stream: publicProcedure.input(z.string()).subscription(({ input: paneId }) => {
    return observable<TerminalEvent>((emit) => {
      const handler = (event: TerminalEvent) => {
        emit.next(event);
        if (event.type === "exit") {
          emit.complete();
        }
      };

      const eventName = `data:${paneId}`;
      terminalManager.on(eventName, handler);

      return () => {
        terminalManager.off(eventName, handler);
      };
    });
  }),
});
