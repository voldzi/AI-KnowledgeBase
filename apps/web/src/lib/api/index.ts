import type { ApiClients } from "@/lib/types";

import type { AklFetch } from "./http-client";
import { getAklConfig } from "./config";
import { MockIngestionClient } from "./mock/ingestion-client";
import { MockRagClient } from "./mock/rag-client";
import { MockRegistryClient } from "./mock/registry-client";
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
      rag: new MockRagClient()
    };
  }

  return {
    registry: new ProductionRegistryClient(config.serviceBaseUrls.registry, options.fetcher),
    ingestion: new ProductionIngestionClient(config.serviceBaseUrls.ingestion, options.fetcher),
    rag: new ProductionRagClient(config.serviceBaseUrls.rag, options.fetcher)
  };
}
