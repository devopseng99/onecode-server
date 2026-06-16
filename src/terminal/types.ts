import type { IPty } from "node-pty";

export interface TerminalSession {
  pty: IPty;
  paneId: string;
  workspaceId: string;
  scopeKey: string;
  cwd: string;
  cols: number;
  rows: number;
  lastActive: number;
  serializedState?: string;
  isAlive: boolean;
}

export interface TerminalEvent {
  type: "data" | "exit";
  data?: string;
  exitCode?: number;
  signal?: number;
}
