import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { observable } from "@trpc/server/observable";
import { router, publicProcedure } from "../trpc.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "/var/lib/rancher/1apps/node-v24.13.0-linux-x64/bin/claude";

const activeSessions = new Map<string, ChildProcess>();

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const claudeRouter = router({
  chat: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        sessionId: z.string().optional(),
        projectDir: z.string(),
      })
    )
    .subscription(({ input }) => {
      return observable<{ type: string; data: unknown }>((emit) => {
        const sessionId = input.sessionId ?? generateSessionId();
        const args = ["-p", input.prompt, "--output-format", "stream-json", "--verbose"];

        if (input.sessionId) {
          args.push("--resume", input.sessionId);
        }

        const proc = spawn(CLAUDE_BIN, args, {
          cwd: input.projectDir,
          env: { ...process.env, HOME: process.env.HOME ?? "/home/node" },
          stdio: ["ignore", "pipe", "pipe"],
        });

        activeSessions.set(sessionId, proc);

        let buffer = "";

        proc.stdout!.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              emit.next({ type: parsed.type ?? "message", data: parsed });
            } catch {
              emit.next({ type: "text", data: { text: trimmed } });
            }
          }
        });

        proc.stderr!.on("data", (chunk: Buffer) => {
          emit.next({ type: "stderr", data: { text: chunk.toString() } });
        });

        proc.on("close", (code) => {
          activeSessions.delete(sessionId);
          emit.next({ type: "done", data: { code, sessionId } });
          emit.complete();
        });

        proc.on("error", (err) => {
          activeSessions.delete(sessionId);
          emit.error(new Error(`Claude process error: ${err.message}`));
        });

        return () => {
          if (proc.exitCode === null) {
            proc.kill("SIGTERM");
            setTimeout(() => {
              if (proc.exitCode === null) proc.kill("SIGKILL");
            }, 5000);
          }
          activeSessions.delete(sessionId);
        };
      });
    }),

  cancel: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const proc = activeSessions.get(input.sessionId);
      if (!proc) return { cancelled: false };
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }, 5000);
      activeSessions.delete(input.sessionId);
      return { cancelled: true };
    }),

  isActive: publicProcedure.query(() => {
    const entries = Array.from(activeSessions.entries());
    if (entries.length === 0) return { active: false };
    return { active: true, sessionId: entries[0][0] };
  }),
});
