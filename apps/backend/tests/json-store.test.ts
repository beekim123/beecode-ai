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
});
