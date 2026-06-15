import path from "node:path";

export function validatePath(requestedPath: string, projectDir: string): string {
  const resolved = path.resolve(projectDir, requestedPath);
  const normalizedProject = path.resolve(projectDir);
  if (!resolved.startsWith(normalizedProject + path.sep) && resolved !== normalizedProject) {
    throw new Error("Path traversal denied");
  }
  return resolved;
}
