import { writeFile } from "node:fs/promises";
import { phase2OpenApiDocument } from "../packages/protocol/src/openapi.js";

const outputPath = new URL(
  "../apps/ios/Packages/BeecodeAPI/Sources/BeecodeAPI/openapi.json",
  import.meta.url,
);

await writeFile(outputPath, `${JSON.stringify(phase2OpenApiDocument, null, 2)}\n`, "utf8");
