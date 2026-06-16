import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { observable } from "@trpc/server/observable";
import { router, publicProcedure } from "../trpc.js";
import { pool } from "../lib/db.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "/var/lib/rancher/1apps/node-v24.13.0-linux-x64/bin/claude";

/** Persist a message to the chat history DB (fire-and-forget) */
async function persistMessage(
  sessionId: string,
  projectDir: string,
  role: "user" | "assistant" | "system",
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    // Upsert conversation
    const convResult = await pool.query(
      `INSERT INTO onecode.conversations (session_id, project_dir)
       VALUES ($1, $2)
       ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [sessionId, projectDir]
    );
    const conversationId = convResult.rows[0].id;

    // Insert message
    await pool.query(
      `INSERT INTO onecode.messages (conversation_id, role, content, metadata)
       VALUES ($1, $2, $3, $4)`,
      [conversationId, role, content, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.error("[chat-persist] Failed to save message:", (err as Error).message);
  }
}

/** Update conversation title from first user message */
async function updateConversationTitle(sessionId: string, title: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE onecode.conversations SET title = $1, updated_at = NOW()
       WHERE session_id = $2 AND title IS NULL`,
      [title.slice(0, 200), sessionId]
    );
  } catch (err) {
    console.error("[chat-persist] Failed to update title:", (err as Error).message);
  }
}

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

        // Persist user message
        persistMessage(sessionId, input.projectDir, "user", input.prompt);
        updateConversationTitle(sessionId, input.prompt);

        const proc = spawn(CLAUDE_BIN, args, {
          cwd: input.projectDir,
          env: { ...process.env, HOME: process.env.HOME ?? "/home/node" },
          stdio: ["ignore", "pipe", "pipe"],
        });

        activeSessions.set(sessionId, proc);

        let buffer = "";
        let assistantContent = "";

        proc.stdout!.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              // Accumulate assistant text for persistence
              if (parsed.type === "assistant" && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === "text" && block.text) {
                    assistantContent += block.text;
                  }
                }
              } else if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                assistantContent += parsed.delta.text;
              }
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
          // Persist assistant response on completion
          if (assistantContent.trim()) {
            persistMessage(sessionId, input.projectDir, "assistant", assistantContent.trim(), { exitCode: code });
          }
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
