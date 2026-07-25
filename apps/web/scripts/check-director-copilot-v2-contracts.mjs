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
    "c4faf33dfecc59bba1e7ef28cd2bd315183ffb6583c9a6b4da4dae4e3829bdd5",
  "director-copilot-2-response.schema.json":
    "22caad5e8dacfd9d3e0451f64c638e91c4d0deb649e091cf1e16fb12e8da51dd",
  "director-copilot-2-manifest.schema.json":
    "886d613659f7f65c2b4a739681e1fbaf2e577aaa3376ef1996b2af4f93704572",
  "director-copilot-2-error.schema.json":
    "99949d198294a947366cf099b2af7023979f538fadab8bbec48fffce8e9bdeab",
  "director-copilot-2.openapi.json":
    "b61e727a0ab9f5a7b37e01fa75fc055cf331a3849914f0db524bea1732219836",
  "director-copilot-2-manifests.json":
    "b71c94819d3e014792bd329a1a78a73e1d138d627bb88db10a478a37b6a6a3c5",
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
  `Director Copilot V2 contract 2.0.2 verified in ${fileURLToPath(repositoryContracts)}.`,
);
