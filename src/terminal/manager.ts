import { EventEmitter } from "node:events";
import * as pty from "node-pty";
import type { TerminalSession, TerminalEvent } from "./types.js";

const DEFAULT_CWD = process.env.PROJECTS_ROOT ?? "/var/lib/rancher/ansible/db";
const DEFAULT_SHELL = process.env.SHELL ?? "/bin/bash";
const MAX_SESSIONS = 10;

export class TerminalManager extends EventEmitter {
  private sessions = new Map<string, TerminalSession>();

  get sessionCount(): number {
    return this.sessions.size;
  }

  createOrAttach(opts: {
    paneId: string;
    tabId?: string;
    workspaceId?: string;
    scopeKey?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    initialCommands?: string[];
  }): { paneId: string; isNew: boolean; serializedState?: string } {
    const existing = this.sessions.get(opts.paneId);
    if (existing && existing.isAlive) {
      existing.lastActive = Date.now();
      return {
        paneId: opts.paneId,
        isNew: false,
        serializedState: existing.serializedState,
      };
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(
        `Max concurrent terminal sessions (${MAX_SESSIONS}) reached`
      );
    }

    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;
    const cwd = opts.cwd ?? DEFAULT_CWD;
    const workspaceId = opts.workspaceId ?? "default";
    const scopeKey = opts.scopeKey ?? "default";

    const ptyProc = pty.spawn(DEFAULT_SHELL, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      } as Record<string, string>,
    });

    const session: TerminalSession = {
      pty: ptyProc,
      paneId: opts.paneId,
      workspaceId,
      scopeKey,
      cwd,
      cols,
      rows,
      lastActive: Date.now(),
      isAlive: true,
    };

    this.sessions.set(opts.paneId, session);

    ptyProc.onData((data: string) => {
      session.lastActive = Date.now();
      const event: TerminalEvent = { type: "data", data };
      this.emit(`data:${opts.paneId}`, event);
    });

    ptyProc.onExit(({ exitCode, signal }) => {
      session.isAlive = false;
      const event: TerminalEvent = { type: "exit", exitCode, signal };
      this.emit(`data:${opts.paneId}`, event);
      // Clean up after a short delay to let subscribers receive exit event
      setTimeout(() => {
        this.sessions.delete(opts.paneId);
      }, 2000);
    });

    // Send initial commands if provided
    if (opts.initialCommands?.length) {
      for (const cmd of opts.initialCommands) {
        ptyProc.write(cmd + "\r");
      }
    }

    return { paneId: opts.paneId, isNew: true };
  }

  write(paneId: string, data: string): void {
    const session = this.sessions.get(paneId);
    if (!session?.isAlive) {
      throw new Error(`No active session for pane ${paneId}`);
    }
    session.lastActive = Date.now();
    session.pty.write(data);
  }

  resize(paneId: string, cols: number, rows: number): void {
    const session = this.sessions.get(paneId);
    if (!session?.isAlive) return;
    session.cols = cols;
    session.rows = rows;
    session.pty.resize(cols, rows);
  }

  signal(paneId: string, sig?: string): void {
    const session = this.sessions.get(paneId);
    if (!session?.isAlive) return;
    // node-pty doesn't expose kill(signal) directly, send via write
    // For SIGINT, write Ctrl+C; for others, kill the process
    if (!sig || sig === "SIGINT") {
      session.pty.write("\x03");
    } else {
      session.pty.kill(sig);
    }
  }

  kill(paneId: string): void {
    const session = this.sessions.get(paneId);
    if (!session) return;
    if (session.isAlive) {
      session.pty.kill();
    }
    session.isAlive = false;
    this.sessions.delete(paneId);
  }

  detach(paneId: string, serializedState?: string): void {
    const session = this.sessions.get(paneId);
    if (!session) return;
    if (serializedState) {
      session.serializedState = serializedState;
    }
    // Detach means keep the session alive but stop streaming
    // The session stays in the map for re-attach
  }

  clearScrollback(paneId: string): void {
    const session = this.sessions.get(paneId);
    if (!session?.isAlive) return;
    // Send CSI sequence to clear scrollback
    session.pty.write("\x1b[3J\x1b[H\x1b[2J");
  }

  getSession(paneId: string): TerminalSession | undefined {
    return this.sessions.get(paneId);
  }

  getActiveSessionCount(workspaceId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && session.isAlive) {
        count++;
      }
    }
    return count;
  }

  destroyAll(): void {
    for (const [paneId, session] of this.sessions) {
      if (session.isAlive) {
        session.pty.kill();
      }
      this.sessions.delete(paneId);
    }
    this.removeAllListeners();
  }
}

// Singleton instance
export const terminalManager = new TerminalManager();

// Clean up on process exit
process.on("SIGTERM", () => terminalManager.destroyAll());
process.on("SIGINT", () => terminalManager.destroyAll());
