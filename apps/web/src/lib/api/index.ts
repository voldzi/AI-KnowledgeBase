import type { ApiClients } from "@/lib/types";

import type { AklFetch } from "./http-client";
import { getAklConfig } from "./config";
import { MockGovernanceClient } from "./mock/governance-client";
import { MockEvaluationClient } from "./mock/evaluation-client";
import { MockIngestionClient } from "./mock/ingestion-client";
import { MockRagClient } from "./mock/rag-client";
import { MockRegistryClient } from "./mock/registry-client";
import { ProductionGovernanceClient } from "./production/governance-client";
import { ProductionEvaluationClient } from "./production/evaluation-client";
import { ProductionIngestionClient } from "./production/ingestion-client";
import { ProductionRagClient } from "./production/rag-client";
import { ProductionRegistryClient } from "./production/registry-client";

export interface ApiClientFactoryOptions {
  fetcher?: AklFetch;
  env?: Record<string, string | undefined>;
}

export function createApiClients(options: ApiClientFactoryOptions = {}): ApiClients {
  const config = getAklConfig(options.env);

  if (config.apiClientMode === "mock") {
    return {
      registry: new MockRegistryClient(),
      ingestion: new MockIngestionClient(),
      rag: new MockRagClient(),
      governance: new MockGovernanceClient(),
      evaluation: new MockEvaluationClient()
    };
  }

  return {
    registry: new ProductionRegistryClient(config.serviceBaseUrls.registry, options.fetcher),
    ingestion: new ProductionIngestionClient(config.serviceBaseUrls.ingestion, options.fetcher),
    rag: new ProductionRagClient(config.serviceBaseUrls.rag, options.fetcher),
    governance: new ProductionGovernanceClient(config.serviceBaseUrls.governance, options.fetcher),
    evaluation: new ProductionEvaluationClient(config.serviceBaseUrls.evaluation, options.fetcher)
  };
}
