# STRATOS Semantic Registry Snapshot V1

The snapshot is a local, immutable and attributable copy of the Czech
Government Semantic Vocabulary (SSP) used by AKB for Czech concept
normalization.

Binding rules:

- all imported SSP concepts are available as local semantic context;
- only entries present in the reviewed bindings file may affect source or
  metric routing;
- an SSP concept never supplies a capability, scope, identity, classification,
  Information Policy decision or data value;
- a user message and persisted conversation state cannot create a binding;
- every snapshot carries its source metadata, generation time, counts and a
  SHA-256 digest over concepts and approved bindings.

The binding source is:

`apps/web/src/lib/director-copilot/data/semantic-registry-bindings.json`

The generated runtime snapshot is:

`apps/web/src/lib/director-copilot/data/ssp-cs.snapshot.json`

The binding file is code-reviewed. The generated snapshot is verified in CI
without contacting the external endpoint.

Schema:

`contracts/semantic-registry/v1/snapshot.schema.json`
