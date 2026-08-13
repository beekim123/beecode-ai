import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileBackendStore } from "../src/json-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function dataPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "beecode-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "backend.json");
}

describe("JsonFileBackendStore", () => {
  it("serializes concurrent flushes and leaves the latest snapshot on disk", async () => {
    const path = await dataPath();
    const store = new JsonFileBackendStore(path);
    await store.load();
    const first = store.createAccount(1000);
    const firstFlush = store.flush();
    const second = store.createAccount(1000);
    const secondFlush = store.flush();

    await Promise.all([firstFlush, secondFlush]);

    const reloaded = new JsonFileBackendStore(path);
    await reloaded.load();
    expect(reloaded.findAccountByToken(first.token)?.accountId).toBe(first.accountId);
    expect(reloaded.findAccountByToken(second.token)?.accountId).toBe(second.accountId);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("refuses to start from a corrupted data file", async () => {
    const path = await dataPath();
    await writeFile(path, "{broken", "utf8");

    const store = new JsonFileBackendStore(path);

    await expect(store.load()).rejects.toThrow(/Unable to load Beecode backend data/);
    expect(await readFile(path, "utf8")).toBe("{broken");
  });

  it("migrates legacy plaintext account tokens to hashes on the next flush", async () => {
    const path = await dataPath();
    await writeFile(path, JSON.stringify({
      accounts: [{
        accountId: "acct_legacy",
        token: "legacy-secret-token",
        quotaLimitTokens: 1_000,
        quotaUsedTokens: 0,
        createdAt: "2026-08-10T00:00:00.000Z",
      }],
      sessions: [],
    }), "utf8");

    const store = new JsonFileBackendStore(path);
    await store.load();
    expect(store.findAccountByToken("legacy-secret-token")?.accountId).toBe("acct_legacy");
    await store.flush();

    const persisted = JSON.parse(await readFile(path, "utf8")) as {
      accounts: Array<Record<string, unknown>>;
      accessTokens: Array<Record<string, unknown>>;
      usageLedger: unknown[];
    };
    expect(persisted.accounts[0]?.token).toBeUndefined();
    expect(persisted.accessTokens[0]?.tokenHash).toEqual(expect.any(String));
    expect(JSON.stringify(persisted)).not.toContain("legacy-secret-token");
    expect(persisted.usageLedger).toEqual([]);
  });
});
