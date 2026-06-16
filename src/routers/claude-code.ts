import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { router, publicProcedure } from "../trpc.js";

const HOME = process.env.HOME ?? "/home/hr1";
const CREDENTIALS_PATH = path.join(HOME, ".claude", ".credentials.json");

/**
 * Read Claude CLI credentials from ~/.claude/.credentials.json
 */
function getCliCredentials(): { accessToken: string; refreshToken: string; expiresAt: number; subscriptionType: string } | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(raw);
    const oauth = data.claudeAiOauth;
    if (oauth?.accessToken) return oauth;
  } catch {
    // No credentials file
  }
  return null;
}

/**
 * claudeCode router — implements the auth/config procedures the 1code SPA expects.
 * Instead of 21st.dev sandbox OAuth, we use the local Claude CLI credentials.
 */
export const claudeCodeRouter = router({
  /**
   * Check if user has existing CLI config — this is the key gate.
   * Returning hasConfig:true auto-skips OAuth onboarding in the SPA.
   */
  hasExistingCliConfig: publicProcedure.query(() => {
    const creds = getCliCredentials();
    return {
      hasConfig: !!creds,
      hasApiKey: !!creds?.accessToken,
      baseUrl: null,
    };
  }),

  /**
   * Check if Claude Code is connected (SPA calls this for status)
   */
  getIntegration: publicProcedure.query(() => {
    const creds = getCliCredentials();
    return {
      isConnected: !!creds,
      connectedAt: creds ? new Date().toISOString() : null,
      accountId: creds ? "local-cli" : null,
      displayName: creds ? `Claude ${creds.subscriptionType ?? "Max"}` : null,
      state: creds ? "connected" : "disconnected",
    };
  }),

  /**
   * Get the OAuth token for API calls
   */
  getToken: publicProcedure.query(() => {
    const creds = getCliCredentials();
    if (!creds) return { token: null, error: "Not connected" };
    return { token: creds.accessToken, error: null };
  }),

  /**
   * Start auth — not needed since we use CLI creds, but SPA may call it
   */
  startAuth: publicProcedure.mutation(() => {
    return {
      sandboxId: "local",
      sandboxUrl: "http://localhost:4000",
      sessionId: "local-session",
    };
  }),

  /**
   * Poll status — return success immediately since CLI is pre-authed
   */
  pollStatus: publicProcedure
    .input(z.object({ sandboxUrl: z.string(), sessionId: z.string() }))
    .query(() => {
      return { state: "success", oauthUrl: null, error: null };
    }),

  /**
   * Submit code — not needed, return success
   */
  submitCode: publicProcedure
    .input(z.object({ sandboxUrl: z.string(), sessionId: z.string(), code: z.string() }))
    .mutation(() => {
      return { success: true };
    }),

  /**
   * Open OAuth URL — noop in web (shim handles window.open)
   */
  openOAuthUrl: publicProcedure
    .input(z.string())
    .mutation(() => {
      return { success: true };
    }),

  /**
   * Import system token — read from CLI credentials
   */
  importSystemToken: publicProcedure.mutation(() => {
    const creds = getCliCredentials();
    if (!creds) throw new Error("No Claude CLI credentials found");
    return { success: true };
  }),

  /**
   * Get system token
   */
  getSystemToken: publicProcedure.query(() => {
    const creds = getCliCredentials();
    return { token: creds?.accessToken ?? null };
  }),

  /**
   * Disconnect — noop (CLI credentials remain)
   */
  disconnect: publicProcedure.mutation(() => {
    return { success: true };
  }),

  /**
   * Import token — accept and store (noop, CLI creds used directly)
   */
  importToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(() => {
      return { success: true };
    }),
});
