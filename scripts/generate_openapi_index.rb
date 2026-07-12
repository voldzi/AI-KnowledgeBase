#!/usr/bin/env ruby
# Builds the root AKB OpenAPI JSON contract from service-local OpenAPI files
# and the Next.js web API route tree.
require "json"
require "yaml"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
OUTPUT = File.join(ROOT, "openapi", "openapi.json")
AIIP_OUTPUT = File.join(ROOT, "openapi", "aiip-application-api.v1.json")
AIIP_PUBLIC_PATHS = [
  "/api/integrations/aiip/v1/harmonize",
  "/api/integrations/aiip/v1/duplicates/search"
].freeze

SERVICES = [
  {
    id: "registry-api",
    title: "Registry API",
    prefix: "RegistryApi",
    yaml: "services/registry-api/openapi.yaml",
    servers: [
      { "url" => "http://localhost:8001", "description" => "Local direct Registry API" },
      { "url" => "http://localhost:8080/registry", "description" => "Local reverse proxy Registry API" }
    ]
  },
  {
    id: "ingestion-service",
    title: "Ingestion Service",
    prefix: "IngestionService",
    yaml: "services/ingestion-service/openapi.yaml",
    servers: [
      { "url" => "http://localhost:8090", "description" => "Local direct Ingestion Service" },
      { "url" => "http://localhost:8080/ingestion", "description" => "Local reverse proxy Ingestion Service" }
    ]
  },
  {
    id: "rag-retrieval-service",
    title: "RAG Retrieval Service",
    prefix: "RagRetrievalService",
    yaml: "services/rag-retrieval-service/openapi.yaml",
    servers: [
      { "url" => "http://localhost:8082", "description" => "Local direct RAG Retrieval Service" },
      { "url" => "http://localhost:8080/rag", "description" => "Local reverse proxy RAG Retrieval Service" }
    ]
  },
  {
    id: "llm-gateway-service",
    title: "LLM Gateway Service",
    prefix: "LlmGatewayService",
    yaml: "services/llm-gateway-service/openapi.yaml",
    servers: [
      { "url" => "http://localhost:8083", "description" => "Local direct LLM Gateway Service" },
      { "url" => "http://localhost:8080/llm-gateway", "description" => "Local reverse proxy LLM Gateway Service" }
    ]
  },
  {
    id: "evaluation-service",
    title: "Evaluation Service",
    prefix: "EvaluationService",
    yaml: "services/evaluation-service/openapi.yaml",
    servers: [
      { "url" => "http://localhost:8084", "description" => "Local direct Evaluation Service" },
      { "url" => "http://localhost:8080/evaluation", "description" => "Local reverse proxy Evaluation Service" }
    ]
  },
  {
    id: "governance-service",
    title: "Governance Service",
    prefix: "GovernanceService",
    yaml: "services/governance-service/openapi.yaml",
    servers: [
      { "url" => "http://localhost:8085", "description" => "Local direct Governance Service" },
      { "url" => "http://localhost:8080/governance", "description" => "Local reverse proxy Governance Service" }
    ]
  }
].freeze

WEB_API_ROOT = File.join(ROOT, "apps", "web", "src", "app", "api")
WEB_SERVERS = [
  { "url" => "http://localhost:3002", "description" => "Local AKB web API" },
  { "url" => "https://stratos.zeleznalady.cz/akb", "description" => "Production AKB web API" }
].freeze

METHOD_RE = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/.freeze

def deep_rewrite_refs(value, ref_map)
  case value
  when Hash
    value.each_with_object({}) do |(key, inner), result|
      result[key] =
        if key == "$ref" && inner.is_a?(String)
          ref_map.fetch(inner, inner)
        else
          deep_rewrite_refs(inner, ref_map)
        end
    end
  when Array
    value.map { |inner| deep_rewrite_refs(inner, ref_map) }
  else
    value
  end
end

def operation_id_prefix(service_id)
  service_id.tr("-", "_")
end

def rewrite_operation(operation, service)
  rewritten = operation.dup
  existing = Array(rewritten["tags"])
  rewritten["tags"] = ([service[:title]] + existing).uniq
  if rewritten["operationId"]
    rewritten["operationId"] = "#{operation_id_prefix(service[:id])}_#{rewritten["operationId"]}"
  end
  rewritten
end

def web_path_for(route_file)
  relative = route_file.sub("#{WEB_API_ROOT}/", "")
  parts = relative.split("/")
  parts.pop
  path_parts = parts.map do |part|
    match = part.match(/^\[(.+)\]$/)
    match ? "{#{match[1]}}" : part
  end
  "/api/#{path_parts.join("/")}"
end

def web_path_parameters(path)
  path.scan(/\{([^}]+)\}/).flatten.map do |name|
    {
      "name" => name,
      "in" => "path",
      "required" => true,
      "schema" => { "type" => "string" }
    }
  end
end

def aiip_header_parameters
  [
    ["X-Request-ID", "Stable request identifier"],
    ["X-Correlation-ID", "Stable end-to-end correlation identifier"],
    ["Idempotency-Key", "Stable idempotency key retained for 24 hours"]
  ].map do |name, description|
    {
      "name" => name,
      "in" => "header",
      "required" => true,
      "description" => description,
      "schema" => { "type" => "string", "minLength" => 8, "maxLength" => 128 }
    }
  end
end

def aiip_web_operation(path)
  harmonize = path.end_with?("/harmonize")
  request_schema = harmonize ? "RagRetrievalServiceAiipHarmonizeRequest" : "RagRetrievalServiceAiipDuplicateSearchRequest"
  response_schema = harmonize ? "AiipHarmonizeResponse" : "AiipDuplicateSearchResponse"
  responses = {
    "200" => {
      "description" => "Completed response. Exact idempotent replays return the same body and Idempotency-Replayed: true.",
      "headers" => {
        "Idempotency-Replayed" => {
          "description" => "Present with value true for an exact replay.",
          "schema" => { "type" => "string", "const" => "true" }
        }
      },
      "content" => {
        "application/json" => {
          "schema" => { "$ref" => "#/components/schemas/#{response_schema}" }
        }
      }
    }
  }
  {
    "400" => "Malformed JSON, header, or request identifier",
    "401" => "Missing, expired, or invalid bearer token",
    "403" => "Wrong service identity, role, audience, or disallowed classification",
    "409" => "Idempotency key conflict or another matching request is processing",
    "413" => "Request body exceeds 64 kB",
    "422" => "Schema validation or structured model output failure",
    "429" => "Rate or concurrency limit exceeded",
    "502" => "AKB dependency failed",
    "503" => "AKB application processing or identity validation unavailable"
  }.each do |status, description|
    response = {
      "description" => description,
      "content" => {
        "application/json" => {
          "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" }
        }
      }
    }
    if status == "429"
      response["headers"] = {
        "Retry-After" => {
          "description" => "Minimum delay in seconds before retrying with the same idempotency key.",
          "schema" => { "type" => "integer", "minimum" => 1 }
        }
      }
    end
    responses[status] = response
  end
  {
    "tags" => ["AIIP Application API"],
    "summary" => harmonize ? "Propose normalized AIIP fields" : "Search authorized AIIP duplicate candidates",
    "description" => harmonize ?
      "Returns advisory field suggestions only; it never mutates the AIIP record." :
      "Runs tenant-scoped, authorization-filtered hybrid retrieval and returns citations without vectors.",
    "operationId" => harmonize ? "aiip_harmonize_v1" : "aiip_duplicates_search_v1",
    "security" => [{ "bearerAuth" => [] }],
    "parameters" => aiip_header_parameters,
    "requestBody" => {
      "required" => true,
      "content" => {
        "application/json" => {
          "schema" => { "$ref" => "#/components/schemas/#{request_schema}" }
        }
      }
    },
    "responses" => responses
  }
end

def web_operation(method, path)
  return aiip_web_operation(path) if method == "POST" && AIIP_PUBLIC_PATHS.include?(path)

  operation_id = "web_#{method.downcase}_#{path.gsub(%r{[^a-zA-Z0-9]+}, "_").gsub(/^_|_$/, "")}"
  responses = {
    "200" => {
      "description" => "Successful response",
      "content" => {
        "application/json" => {
          "schema" => { "$ref" => "#/components/schemas/GenericJson" }
        }
      }
    },
    "default" => {
      "description" => "Error response",
      "content" => {
        "application/json" => {
          "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" }
        }
      }
    }
  }
  operation = {
    "tags" => ["AKB Web API"],
    "summary" => "#{method} #{path}",
    "operationId" => operation_id,
    "responses" => responses
  }
  if method == "POST" && path == "/api/stratos/upload/sessions/{sessionId}/confirm"
    operation["summary"] = "Confirm a STRATOS upload idempotently"
    operation["responses"] = {
      "200" => {
        "description" => "Existing version and ingestion lifecycle returned without creating duplicates",
        "content" => {
          "application/json" => {
            "schema" => { "$ref" => "#/components/schemas/StratosUploadConfirmResponse" }
          }
        }
      },
      "201" => {
        "description" => "Document version and ingestion lifecycle created",
        "content" => {
          "application/json" => {
            "schema" => { "$ref" => "#/components/schemas/StratosUploadConfirmResponse" }
          }
        }
      },
      "409" => {
        "description" => "External identity mismatch or version label reused with a different SHA-256",
        "content" => {
          "application/json" => {
            "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" }
          }
        }
      },
      "default" => responses["default"]
    }
  elsif method == "POST" && path == "/api/stratos/upload/preflight"
    operation["summary"] = "Validate policy and create a STRATOS upload session"
    operation["responses"] = {
      "201" => {
        "description" => "Policy-bound upload session created before binary transfer",
        "content" => {
          "application/json" => {
            "schema" => { "$ref" => "#/components/schemas/StratosUploadPreflightResponse" }
          }
        }
      },
      "default" => responses["default"]
    }
  end
  parameters = web_path_parameters(path)
  operation["parameters"] = parameters unless parameters.empty?
  request_schema =
    if method == "POST" && path == "/api/stratos/upload/sessions/{sessionId}/confirm"
      { "$ref" => "#/components/schemas/StratosUploadConfirmRequest" }
    elsif method == "POST" && path == "/api/stratos/upload/preflight"
      { "$ref" => "#/components/schemas/StratosUploadPreflightRequest" }
    else
      { "$ref" => "#/components/schemas/GenericJson" }
    end
  operation["requestBody"] = {
    "content" => {
      "application/json" => {
        "schema" => request_schema
      }
    }
  } if %w[POST PUT PATCH].include?(method)
  operation
end

def add_common_system_paths(spec)
  all_servers = SERVICES.flat_map { |service| service[:servers] } + WEB_SERVERS
  spec["paths"]["/health"] = {
    "servers" => all_servers,
    "get" => {
      "tags" => ["System"],
      "summary" => "Health",
      "operationId" => "platform_health",
      "responses" => {
        "200" => {
          "description" => "Service is healthy",
          "content" => {
            "application/json" => {
              "schema" => { "$ref" => "#/components/schemas/HealthResponse" }
            }
          }
        }
      }
    }
  }
  spec["paths"]["/ready"] = {
    "servers" => all_servers,
    "get" => {
      "tags" => ["System"],
      "summary" => "Readiness",
      "operationId" => "platform_ready",
      "responses" => {
        "200" => {
          "description" => "Service is ready",
          "content" => {
            "application/json" => {
              "schema" => { "$ref" => "#/components/schemas/ReadinessResponse" }
            }
          }
        },
        "503" => {
          "description" => "Service is not ready",
          "content" => {
            "application/json" => {
              "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" }
            }
          }
        }
      }
    }
  }
end

def referenced_schema_names(value)
  case value
  when Hash
    value.flat_map do |key, inner|
      if key == "$ref" && inner.is_a?(String) && inner.start_with?("#/components/schemas/")
        [inner.delete_prefix("#/components/schemas/")]
      else
        referenced_schema_names(inner)
      end
    end
  when Array
    value.flat_map { |inner| referenced_schema_names(inner) }
  else
    []
  end
end

def aiip_fragment(spec)
  paths = AIIP_PUBLIC_PATHS.to_h { |path| [path, spec.fetch("paths").fetch(path)] }
  pending = referenced_schema_names(paths).uniq
  schemas = {}
  until pending.empty?
    name = pending.shift
    next if schemas.key?(name)

    schema = spec.dig("components", "schemas", name)
    raise "Missing AIIP schema reference: #{name}" unless schema

    schemas[name] = schema
    pending.concat(referenced_schema_names(schema).reject { |candidate| schemas.key?(candidate) })
  end
  {
    "openapi" => "3.1.0",
    "info" => {
      "title" => "AKB AIIP Application API",
      "version" => "1.0.0",
      "description" => "Versioned public application contract for AIIP harmonization and duplicate search."
    },
    "servers" => [{ "url" => "https://stratos.zeleznalady.cz/akb", "description" => "Production AKB" }],
    "security" => [{ "bearerAuth" => [] }],
    "tags" => [{ "name" => "AIIP Application API" }],
    "paths" => paths,
    "components" => {
      "securitySchemes" => { "bearerAuth" => spec.dig("components", "securitySchemes", "bearerAuth") },
      "schemas" => schemas.sort.to_h
    }
  }
end

spec = {
  "openapi" => "3.1.0",
  "info" => {
    "title" => "AKB Platform REST API",
    "version" => "0.1.0",
    "description" => "Root JSON-first OpenAPI contract for AKB platform REST surfaces. Service-local schemas are merged from services/*/openapi.yaml; Next.js web bridge paths are indexed from apps/web/src/app/api."
  },
  "servers" => [
    { "url" => "http://localhost:8080", "description" => "Local reverse proxy" },
    { "url" => "http://localhost:3002", "description" => "Local AKB web frontend" },
    { "url" => "https://stratos.zeleznalady.cz/akb", "description" => "Production AKB web frontend" }
  ],
  "security" => [
    { "bearerAuth" => [] },
    {}
  ],
  "tags" => [
    { "name" => "System" },
    { "name" => "AKB Web API" }
  ] + SERVICES.map { |service| { "name" => service[:title] } },
  "paths" => {},
  "components" => {
    "securitySchemes" => {
      "bearerAuth" => {
        "type" => "http",
        "scheme" => "bearer",
        "bearerFormat" => "JWT"
      }
    },
    "responses" => {
      "Error" => {
        "description" => "AKB error response",
        "content" => {
          "application/json" => {
            "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" }
          }
        }
      }
    },
    "schemas" => {
      "GenericJson" => {
        "description" => "Route-specific schema is defined by the service-local contract or handler documentation.",
        "type" => "object",
        "additionalProperties" => true
      },
      "HealthResponse" => {
        "type" => "object",
        "required" => ["status", "service"],
        "properties" => {
          "status" => { "type" => "string" },
          "service" => { "type" => "string" },
          "version" => { "type" => "string" }
        },
        "additionalProperties" => true
      },
      "ReadinessResponse" => {
        "type" => "object",
        "required" => ["status"],
        "properties" => {
          "status" => { "type" => "string", "enum" => ["ready", "not_ready"] },
          "service" => { "type" => "string" },
          "checks" => { "type" => "object", "additionalProperties" => true },
          "dependencies" => { "type" => "object", "additionalProperties" => true }
        },
        "additionalProperties" => true
      },
      "AiipHarmonizeResponse" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["schema_version", "request_id", "correlation_id", "audit_event_id", "status", "result", "warnings", "model", "prompt_template_version", "usage", "latency_ms"],
        "properties" => {
          "schema_version" => { "type" => "string", "const" => "1.0" },
          "request_id" => { "type" => "string" },
          "correlation_id" => { "type" => "string" },
          "audit_event_id" => { "type" => "string" },
          "status" => { "type" => "string", "const" => "completed" },
          "result" => { "$ref" => "#/components/schemas/RagRetrievalServiceAiipHarmonizeResult" },
          "warnings" => { "type" => "array", "items" => { "type" => "string" } },
          "model" => { "$ref" => "#/components/schemas/RagRetrievalServiceAiipModelMetadata" },
          "prompt_template_version" => { "type" => "string" },
          "retrieval_index_version" => { "type" => ["string", "null"] },
          "usage" => { "$ref" => "#/components/schemas/RagRetrievalServiceAiipUsage" },
          "latency_ms" => { "type" => "integer", "minimum" => 0 }
        }
      },
      "AiipDuplicateSearchResponse" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["schema_version", "request_id", "correlation_id", "audit_event_id", "status", "result", "warnings", "model", "prompt_template_version", "retrieval_index_version", "usage", "latency_ms"],
        "properties" => {
          "schema_version" => { "type" => "string", "const" => "1.0" },
          "request_id" => { "type" => "string" },
          "correlation_id" => { "type" => "string" },
          "audit_event_id" => { "type" => "string" },
          "status" => { "type" => "string", "const" => "completed" },
          "result" => { "$ref" => "#/components/schemas/RagRetrievalServiceAiipDuplicateSearchResult" },
          "warnings" => { "type" => "array", "items" => { "type" => "string" } },
          "model" => { "$ref" => "#/components/schemas/RagRetrievalServiceAiipModelMetadata" },
          "prompt_template_version" => { "type" => "string" },
          "retrieval_index_version" => { "type" => "string" },
          "usage" => { "$ref" => "#/components/schemas/RagRetrievalServiceAiipUsage" },
          "latency_ms" => { "type" => "integer", "minimum" => 0 }
        }
      },
      "StratosUploadConfirmRequest" => {
        "type" => "object",
        "required" => [
          "upload_token",
          "document_id",
          "external_document_id",
          "source_file_uri",
          "file_hash",
          "file_name",
          "file_size",
          "information_policy"
        ],
        "properties" => {
          "upload_token" => { "type" => "string" },
          "document_id" => { "type" => "string" },
          "external_document_id" => { "type" => "string" },
          "tenant_id" => { "type" => "string" },
          "external_system" => { "type" => "string" },
          "external_ref" => { "type" => "string" },
          "version_label" => { "type" => "string" },
          "source_file_uri" => { "type" => "string" },
          "file_hash" => { "type" => "string", "pattern" => "^sha256:[a-fA-F0-9]{64}$" },
          "file_name" => { "type" => "string" },
          "file_type" => { "type" => ["string", "null"] },
          "file_size" => { "type" => "integer", "minimum" => 0 },
          "valid_from" => { "type" => "string", "format" => "date" },
          "valid_to" => { "type" => ["string", "null"], "format" => "date" },
          "change_summary" => { "type" => "string" },
          "information_policy" => { "$ref" => "#/components/schemas/RegistryApiInformationPolicyBinding" }
        },
        "additionalProperties" => true
      },
      "StratosUploadConfirmResponse" => {
        "type" => "object",
        "required" => [
          "document_id",
          "document_version_id",
          "external_document_id",
          "file_id",
          "ingestion_job_id",
          "ingestion_status",
          "idempotent_replay",
          "canonical_open_url",
          "policy_binding_id",
          "policy_version",
          "policy_hash"
        ],
        "properties" => {
          "document_id" => { "type" => "string" },
          "document_version_id" => { "type" => "string" },
          "external_document_id" => { "type" => "string" },
          "file_id" => { "type" => "string" },
          "ingestion_job_id" => { "type" => "string" },
          "ingestion_status" => {
            "type" => "string",
            "enum" => [
              "REGISTERED",
              "VERSION_CREATED",
              "UPLOADING",
              "INGESTING",
              "INDEXED",
              "FAILED",
              "PERMISSION_DENIED",
              "STALE"
            ]
          },
          "idempotent_replay" => { "type" => "boolean" },
          "canonical_open_url" => { "type" => "string" },
          "policy_binding_id" => { "type" => "string" },
          "policy_version" => { "type" => "string", "const" => "information-policy-2.0.0" },
          "policy_hash" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
        },
        "additionalProperties" => false
      },
      "StratosUploadPreflightRequest" => {
        "type" => "object",
        "required" => [
          "file_name",
          "file_size",
          "sha256",
          "information_policy",
          "integration_envelope"
        ],
        "properties" => {
          "file_name" => { "type" => "string" },
          "file_size" => { "type" => "integer", "minimum" => 0 },
          "file_type" => { "type" => ["string", "null"] },
          "sha256" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "information_policy" => { "$ref" => "#/components/schemas/RegistryApiInformationPolicyBinding" },
          "integration_envelope" => { "$ref" => "#/components/schemas/RegistryApiIntegrationEnvelope" }
        },
        "additionalProperties" => true
      },
      "StratosUploadPreflightResponse" => {
        "type" => "object",
        "required" => [
          "document_id",
          "external_document_id",
          "upload_session_id",
          "upload_token",
          "policy_binding_id",
          "policy_version",
          "policy_hash",
          "canonical_open_url"
        ],
        "properties" => {
          "document_id" => { "type" => "string" },
          "external_document_id" => { "type" => "string" },
          "upload_session_id" => { "type" => "string" },
          "upload_token" => { "type" => "string" },
          "policy_binding_id" => { "type" => "string" },
          "policy_version" => { "type" => "string", "const" => "information-policy-2.0.0" },
          "policy_hash" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "canonical_open_url" => { "type" => "string" }
        },
        "additionalProperties" => true
      },
      "AkbErrorResponse" => {
        "type" => "object",
        "required" => ["error"],
        "properties" => {
          "error" => {
            "type" => "object",
            "required" => ["code", "message", "trace_id"],
            "properties" => {
              "code" => { "type" => "string" },
              "message" => { "type" => "string" },
              "details" => { "type" => "object", "additionalProperties" => true },
              "trace_id" => { "type" => "string" },
              "request_id" => { "type" => "string" },
              "correlation_id" => { "type" => "string" },
              "audit_event_id" => { "type" => ["string", "null"] }
            },
            "additionalProperties" => true
          }
        }
      }
    }
  }
}

add_common_system_paths(spec)

SERVICES.each do |service|
  service_file = File.join(ROOT, service[:yaml])
  next unless File.exist?(service_file)

  source = YAML.load_file(service_file)
  schemas = source.dig("components", "schemas") || {}
  ref_map = schemas.keys.to_h do |name|
    ["#/components/schemas/#{name}", "#/components/schemas/#{service[:prefix]}#{name}"]
  end

  schemas.each do |name, schema|
    spec["components"]["schemas"]["#{service[:prefix]}#{name}"] = deep_rewrite_refs(schema, ref_map)
  end

  source.fetch("paths", {}).each do |path, path_item|
    next if ["/health", "/ready"].include?(path)

    raise "Duplicate path in merged OpenAPI: #{path}" if spec["paths"].key?(path)

    rewritten_item = deep_rewrite_refs(path_item, ref_map)
    rewritten_item["servers"] = service[:servers]
    rewritten_item.each do |method, operation|
      next unless operation.is_a?(Hash)
      next unless %w[get post put patch delete options head trace].include?(method)

      rewritten_item[method] = rewrite_operation(operation, service)
    end
    spec["paths"][path] = rewritten_item
  end
end

Dir.glob(File.join(WEB_API_ROOT, "**", "route.ts")).sort.each do |route_file|
  path = web_path_for(route_file)
  methods = File.readlines(route_file).map do |line|
    match = line.match(METHOD_RE)
    match && match[1]
  end.compact.uniq
  next if methods.empty?

  item = spec["paths"][path] ||= { "servers" => WEB_SERVERS }
  item["servers"] ||= WEB_SERVERS
  methods.each do |method|
    key = method.downcase
    raise "Duplicate web operation in merged OpenAPI: #{method} #{path}" if item.key?(key)

    item[key] = web_operation(method, path)
  end
end

FileUtils.mkdir_p(File.dirname(OUTPUT))
next_content = JSON.pretty_generate(spec) + "\n"
next_aiip_content = JSON.pretty_generate(aiip_fragment(spec)) + "\n"

if ARGV.include?("--check")
  [[OUTPUT, next_content], [AIIP_OUTPUT, next_aiip_content]].each do |path, content|
    if !File.exist?(path)
      warn "#{path} does not exist"
      exit 1
    end
    if File.read(path) != content
      warn "#{path} is not up to date; run scripts/generate_openapi_index.rb"
      exit 1
    end
  end
  puts "#{OUTPUT} and #{AIIP_OUTPUT} are up to date"
else
  File.write(OUTPUT, next_content)
  File.write(AIIP_OUTPUT, next_aiip_content)
  puts "Wrote #{OUTPUT}"
  puts "Wrote #{AIIP_OUTPUT}"
end
