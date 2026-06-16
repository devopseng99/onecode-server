import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { pool } from "../lib/db.js";

export const chatHistoryRouter = router({
  createConversation: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectDir: z.string(),
        title: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await pool.query(
        `INSERT INTO onecode.conversations (session_id, project_dir, title)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()
         RETURNING id, session_id, project_dir, title, created_at, updated_at`,
        [input.sessionId, input.projectDir, input.title ?? null]
      );
      return result.rows[0];
    }),

  listConversations: publicProcedure
    .input(
      z.object({
        projectDir: z.string(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const result = await pool.query(
        `SELECT c.id, c.session_id, c.project_dir, c.title, c.created_at, c.updated_at,
                (SELECT COUNT(*)::int FROM onecode.messages m WHERE m.conversation_id = c.id) AS message_count
         FROM onecode.conversations c
         WHERE c.project_dir = $1
         ORDER BY c.updated_at DESC
         LIMIT $2 OFFSET $3`,
        [input.projectDir, input.limit, input.offset]
      );
      return result.rows;
    }),

  getConversation: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const convResult = await pool.query(
        `SELECT id, session_id, project_dir, title, created_at, updated_at
         FROM onecode.conversations WHERE session_id = $1`,
        [input.sessionId]
      );
      if (convResult.rows.length === 0) return null;

      const conv = convResult.rows[0];
      const msgResult = await pool.query(
        `SELECT id, role, content, metadata, created_at
         FROM onecode.messages WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conv.id]
      );

      return { ...conv, messages: msgResult.rows };
    }),

  saveMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        projectDir: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Upsert conversation first
      const convResult = await pool.query(
        `INSERT INTO onecode.conversations (session_id, project_dir)
         VALUES ($1, $2)
         ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [input.sessionId, input.projectDir]
      );
      const conversationId = convResult.rows[0].id;

      // Insert message
      const msgResult = await pool.query(
        `INSERT INTO onecode.messages (conversation_id, role, content, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING id, role, content, metadata, created_at`,
        [conversationId, input.role, input.content, JSON.stringify(input.metadata ?? {})]
      );

      return msgResult.rows[0];
    }),

  updateTitle: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        title: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await pool.query(
        `UPDATE onecode.conversations SET title = $1, updated_at = NOW()
         WHERE session_id = $2
         RETURNING id, session_id, title`,
        [input.title, input.sessionId]
      );
      return result.rows[0] ?? null;
    }),

  deleteConversation: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await pool.query(
        `DELETE FROM onecode.conversations WHERE session_id = $1 RETURNING id`,
        [input.sessionId]
      );
      return { deleted: result.rowCount ?? 0 > 0 };
    }),
});
