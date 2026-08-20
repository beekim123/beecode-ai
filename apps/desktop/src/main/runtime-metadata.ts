import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class RuntimeMetadataStore {
  constructor(private readonly path: string) {}

  async loadLastRuntimeId(): Promise<string | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
      return typeof value.lastRuntimeId === "string" && value.lastRuntimeId.length > 0
        ? value.lastRuntimeId
        : undefined;
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      return undefined;
    }
  }

  async saveLastRuntimeId(lastRuntimeId: string): Promise<void> {
    const temporaryPath = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify({ lastRuntimeId })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}
