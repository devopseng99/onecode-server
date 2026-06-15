import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { router, publicProcedure } from "../trpc.js";
import { validatePath } from "../lib/validate-path.js";

const IGNORED_DIRS = ["node_modules", ".git", "dist", "build", "__pycache__"];

export const filesRouter = router({
  readFile: publicProcedure
    .input(z.object({ path: z.string(), projectDir: z.string() }))
    .query(async ({ input }) => {
      const resolved = validatePath(input.path, input.projectDir);
      const content = await fs.readFile(resolved, "utf-8");
      return { content, encoding: "utf-8" };
    }),

  writeFile: publicProcedure
    .input(z.object({ path: z.string(), content: z.string(), projectDir: z.string() }))
    .mutation(async ({ input }) => {
      const resolved = validatePath(input.path, input.projectDir);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, input.content, "utf-8");
      return { success: true };
    }),

  listDirectory: publicProcedure
    .input(
      z.object({
        path: z.string(),
        projectDir: z.string(),
        recursive: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const resolved = validatePath(input.path, input.projectDir);
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const results: Array<{ name: string; type: "file" | "dir"; size: number }> = [];

      for (const entry of entries) {
        if (IGNORED_DIRS.includes(entry.name)) continue;
        const entryPath = path.join(resolved, entry.name);
        const stat = await fs.stat(entryPath).catch(() => null);
        if (!stat) continue;

        results.push({
          name: entry.name,
          type: entry.isDirectory() ? "dir" : "file",
          size: stat.size,
        });

        if (input.recursive && entry.isDirectory()) {
          const subEntries = await fs.readdir(entryPath, { withFileTypes: true }).catch(() => []);
          for (const sub of subEntries) {
            if (IGNORED_DIRS.includes(sub.name)) continue;
            const subPath = path.join(entryPath, sub.name);
            const subStat = await fs.stat(subPath).catch(() => null);
            if (!subStat) continue;
            results.push({
              name: path.join(entry.name, sub.name),
              type: sub.isDirectory() ? "dir" : "file",
              size: subStat.size,
            });
          }
        }
      }

      return results;
    }),

  search: publicProcedure
    .input(
      z.object({
        query: z.string(),
        projectDir: z.string(),
        glob: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const pattern = input.glob ?? "**/*";
      const files = await glob(pattern, {
        cwd: input.projectDir,
        nodir: true,
        ignore: IGNORED_DIRS.map((d) => `**/${d}/**`),
        absolute: true,
      });

      const results: Array<{ path: string; line: number; content: string }> = [];

      for (const file of files.slice(0, 100)) {
        try {
          const content = await fs.readFile(file, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(input.query)) {
              results.push({
                path: path.relative(input.projectDir, file),
                line: i + 1,
                content: lines[i].trim(),
              });
            }
          }
        } catch {
          // skip binary/unreadable files
        }
      }

      return results.slice(0, 200);
    }),
});
