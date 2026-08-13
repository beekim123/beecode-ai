import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { loginWithBrowser } from "../src/auth/browser-login.js";
import type { CredentialStore } from "../src/auth/credential-store.js";
import type { CliConfig } from "../src/config.js";

class MemoryCredentialStore implements CredentialStore {
  value?: CliConfig;
  load = async () => this.value;
  save = async (config: CliConfig) => {
    this.value = config;
  };
  clear = async () => {
    this.value = undefined;
  };
}

describe("CLI browser login", () => {
  it("opens an authorization URL and persists only the exchanged tokens", async () => {
    const store = new MemoryCredentialStore();
    let authorizationUrl = "";
    const output = new PassThrough();
    let outputText = "";
    output.on("data", (chunk: Buffer) => {
      outputText += chunk.toString();
    });
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.body?.toString()).toContain("code_verifier=");
      return Response.json({
        access_token: "bca_access",
        refresh_token: "bcr_refresh",
        token_type: "Bearer",
        expires_in: 900,
        account_id: "acct_cli",
      });
    });

    await loginWithBrowser({
      backendUrl: "http://api.test",
      credentialStore: store,
      output,
      fetchImpl,
      openBrowser: async (url) => {
        authorizationUrl = url;
        return false;
      },
      createCallback: async ({ state }) => ({
        redirectUri: "http://127.0.0.1:49876/callback",
        waitForCode: async () => {
          expect(new URL(authorizationUrl).searchParams.get("state")).toBe(state);
          return "code_once";
        },
        close: async () => undefined,
      }),
    });

    const parsed = new URL(authorizationUrl);
    expect(parsed.pathname).toBe("/oauth/authorize");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.value).toMatchObject({
      token: "bca_access",
      refreshToken: "bcr_refresh",
      accountId: "acct_cli",
    });
    expect(outputText).not.toContain("bca_access");
    expect(outputText).not.toContain("bcr_refresh");
  });
});
