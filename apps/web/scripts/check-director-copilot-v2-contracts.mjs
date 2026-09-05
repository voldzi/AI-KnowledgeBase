import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptDirectory = new URL(".", import.meta.url);
const repositoryContracts = new URL(
  "../../../contracts/director-copilot/v2/",
  scriptDirectory,
);
const runtimeContracts = new URL(
  "../src/lib/director-copilot-v2/contracts/",
  scriptDirectory,
);
const expected = {
  "director-copilot-2-request.schema.json":
    "72a41baa946ed277062c5a0ac1ff3ecf74d4ded1a9aa21760a892904e3a967fb",
  "director-copilot-2-response.schema.json":
    "22caad5e8dacfd9d3e0451f64c638e91c4d0deb649e091cf1e16fb12e8da51dd",
  "director-copilot-2-manifest.schema.json":
    "34814ed3f064def2f48bd6142eb88a975d5d5e82ed684b511a42ba5b42b7f146",
  "director-copilot-2-error.schema.json":
    "99949d198294a947366cf099b2af7023979f538fadab8bbec48fffce8e9bdeab",
  "director-copilot-2.openapi.json":
    "e0010816b8f9e570af7d753dee42898f6ac9996f858e4b3bebc768e51006d5fc",
  "director-copilot-2-manifests.json":
    "6fdb2eee077998f7c17d2d6bd6b6ff6f6a6fd8f7cd7b37c1464f7e65eb07cb0a",
};

for (const [name, expectedHash] of Object.entries(expected)) {
  const repositoryBytes = await readFile(new URL(name, repositoryContracts));
  const actualHash = createHash("sha256").update(repositoryBytes).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(
      `${name} has SHA-256 ${actualHash}, expected ${expectedHash}.`,
    );
  }
  if (name !== "director-copilot-2.openapi.json") {
    const runtimeBytes = await readFile(new URL(name, runtimeContracts));
    if (!repositoryBytes.equals(runtimeBytes)) {
      throw new Error(`${name} differs between the repository and runtime copy.`);
    }
  }
}

console.log(
  `Director Copilot V2 contract 2.0.4 verified in ${fileURLToPath(repositoryContracts)}.`,
);
