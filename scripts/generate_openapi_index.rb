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
STRATOS_AIIP_UPLOAD_PREFLIGHT_PATH = "/api/stratos/upload/preflight"
STRATOS_AIIP_UPLOAD_CONTENT_PATH = "/api/stratos/upload/sessions/{sessionId}/content"
STRATOS_AIIP_UPLOAD_CONFIRM_PATH = "/api/stratos/upload/sessions/{sessionId}/confirm"

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
CHAT_WEB_SERVER = {
  "url" => "https://chat.zeleznalady.cz",
  "description" => "Production standalone AKB chat API"
}.freeze
CHAT_WEB_API_PREFIXES = [
  "/api/assistant",
  "/api/auth/callback",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/health",
  "/api/ready",
  "/api/v1/profile/settings"
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

def public_document_web_operation(path)
  source = path.end_with?("/source")
  parameters = [
    {
      "name" => "publicSlug",
      "in" => "path",
      "required" => true,
      "description" => "Opaque immutable public publication slug.",
      "schema" => { "type" => "string", "minLength" => 1 }
    }
  ]
  if source
    parameters.concat([
      {
        "name" => "Range",
        "in" => "header",
        "required" => false,
        "description" => "Optional single RFC 9110 byte range.",
        "schema" => { "type" => "string" }
      },
      {
        "name" => "If-None-Match",
        "in" => "header",
        "required" => false,
        "description" => "Strong immutable-source ETag validator.",
        "schema" => { "type" => "string" }
      },
      {
        "name" => "If-Range",
        "in" => "header",
        "required" => false,
        "description" => "Deliver the requested range only when this strong ETag matches.",
        "schema" => { "type" => "string" }
      }
    ])
  end
  success_content = if source
    {
      "application/octet-stream" => {
        "schema" => { "type" => "string", "format" => "binary" }
      }
    }
  else
    {
      "application/json" => {
        "schema" => { "$ref" => "#/components/schemas/RegistryApiPublicDocumentMetadataResponse" }
      }
    }
  end
  responses = {
    "200" => {
      "description" => source ?
        "Verified bytes for the exact immutable public document version." :
        "Sanitized immutable public metadata after a fresh central public_read decision.",
      "headers" => {
        "Cache-Control" => {
          "description" => "Always no-store.",
          "schema" => { "type" => "string", "const" => "no-store" }
        }
      },
      "content" => success_content
    }
  }
  if source
    responses["200"]["headers"].merge!({
      "Accept-Ranges" => {
        "description" => "Byte-range delivery is supported.",
        "schema" => { "type" => "string", "const" => "bytes" }
      },
      "ETag" => {
        "description" => "Strong ETag derived from the verified immutable SHA-256.",
        "schema" => { "type" => "string" }
      }
    })
    responses["206"] = Marshal.load(Marshal.dump(responses["200"]))
    responses["206"]["description"] = "Verified byte range for the exact immutable public document version."
    responses["206"]["headers"]["Content-Range"] = {
      "description" => "Exact delivered byte range and total immutable size.",
      "schema" => { "type" => "string" }
    }
    responses["304"] = {
      "description" => "The freshly authorized immutable source still matches If-None-Match.",
      "headers" => responses["200"]["headers"]
    }
    responses["416"] = {
      "description" => "Requested byte range is not satisfiable.",
      "headers" => {
        "Content-Range" => {
          "description" => "Total immutable source size (`bytes */size`).",
          "schema" => { "type" => "string" }
        }
      },
      "content" => {
        "application/json" => {
          "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" }
        }
      }
    }
  end
  {
    "429" => "Per-client/publicSlug or global rate/concurrency capacity reached",
    "404" => "Publication missing, denied, revoked, stale, mismatched, or locally invalid",
    "502" => "Registry response did not match the strict public allowlist",
    "503" => "Central public policy verification or private source delivery unavailable"
  }.each do |status, description|
    responses[status] = {
      "description" => description,
      "content" => {
        "application/json" => {
          "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" }
        }
      }
    }
  end
  responses["429"]["headers"] = {
    "Retry-After" => {
      "description" => "Seconds before the fixed delivery-capacity window should be retried.",
      "schema" => { "type" => "integer", "minimum" => 1 }
    }
  }
  {
    "tags" => ["AKB Public Documents"],
    "summary" => source ? "Download a verified immutable public document source" : "Read sanitized immutable public document metadata",
    "description" => source ?
      "Anonymous delivery. The web boundary requests a fresh central public_download decision through the private Registry resolver, verifies size and SHA-256 with bounded-memory I/O before streaming, supports Range/ETag, and never exposes the storage URI. Per-client/publicSlug and global rate limits plus held-through-stream concurrency limits return 429 when exceeded." :
      "Anonymous delivery. The Registry performs a fresh central public_read decision and the web boundary applies an exact metadata allowlist. No document body, extracted text, chunk, embedding, prompt, answer, RAG output, or storage URI is returned.",
    "operationId" => source ? "web_download_public_document_source" : "web_get_public_document_metadata",
    "security" => [],
    "parameters" => parameters,
    "responses" => responses
  }
end

def stratos_aiip_upload_error_responses(statuses)
  statuses.to_h do |status, description|
    [
      status,
      {
        "description" => description,
        "content" => {
          "application/json" => {
            "schema" => { "$ref" => "#/components/schemas/StratosUploadErrorResponse" }
          }
        }
      }
    ]
  end
end

def stratos_aiip_dual_identity_security
  [{ "bearerAuth" => [], "aiipActorAuthorization" => [] }]
end

def stratos_aiip_upload_operation(method, path)
  if method == "POST" && path == STRATOS_AIIP_UPLOAD_PREFLIGHT_PATH
    return {
      "tags" => ["AKB Governed AIIP Upload"],
      "summary" => "Create a governed AIIP upload session",
      "description" => "Authenticates the dedicated aiip-service transport bearer and the independent current-person bearer carried by X-AIIP-Actor-Authorization, confirms the exact current AIIP source lineage centrally, and returns a policy- and lineage-bound upload session. The opaque upload token is returned only in required_headers.",
      "operationId" => "web_create_governed_aiip_upload_preflight",
      "security" => stratos_aiip_dual_identity_security,
      "requestBody" => {
        "required" => true,
        "content" => {
          "application/json" => {
            "schema" => { "$ref" => "#/components/schemas/StratosUploadPreflightRequest" }
          }
        }
      },
      "responses" => {
        "201" => {
          "description" => "Exact centrally confirmed upload session created before binary transfer",
          "content" => {
            "application/json" => {
              "schema" => { "$ref" => "#/components/schemas/StratosUploadPreflightResponse" }
            }
          }
        }
      }.merge(stratos_aiip_upload_error_responses({
        "400" => "Malformed JSON or invalid file metadata",
        "401" => "Missing or invalid transport or actor credential",
        "403" => "Wrong service identity, route grant, actor, capability, or governed scope",
        "409" => "External identity or immutable lineage conflict",
        "413" => "JSON body or declared file size exceeds its configured bound",
        "415" => "File extension or media type is unsupported",
        "422" => "Strict request, Information Policy, or integration-envelope validation failed",
        "502" => "Registry or central governance confirmation was invalid",
        "503" => "Registry, identity, or central governance verification is unavailable"
      }))
    }
  end

  if method == "PUT" && path == STRATOS_AIIP_UPLOAD_CONTENT_PATH
    return {
      "tags" => ["AKB Governed AIIP Upload"],
      "summary" => "Upload the exact preflight-bound binary",
      "description" => "Accepts only the signed upload token returned in preflight required_headers, reads no more than the signed size, verifies the exact SHA-256, persists the immutable object, and returns an opaque upload receipt required by confirm.",
      "operationId" => "web_upload_governed_aiip_content",
      "security" => [{ "uploadTokenAuth" => [] }],
      "parameters" => web_path_parameters(path) + [
        {
          "name" => "X-AKL-Content-SHA256",
          "in" => "header",
          "required" => true,
          "description" => "Exact lowercase sha256: digest returned by preflight required_headers.",
          "schema" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
        }
      ],
      "requestBody" => {
        "required" => true,
        "description" => "Raw binary bytes. The wire Content-Type must equal the signed Content-Type returned by preflight required_headers.",
        "content" => {
          "*/*" => {
            "schema" => { "type" => "string", "format" => "binary" }
          }
        }
      },
      "responses" => {
        "201" => {
          "description" => "Exact binary persisted and a confirmation-bound receipt issued",
          "content" => {
            "application/json" => {
              "schema" => { "$ref" => "#/components/schemas/StratosUploadContentResponse" }
            }
          }
        }
      }.merge(stratos_aiip_upload_error_responses({
        "400" => "Session, size, hash, or signed metadata mismatch",
        "401" => "Missing, malformed, or invalid signed upload token",
        "410" => "Signed upload token has expired",
        "413" => "Binary body exceeds the signed or configured size bound",
        "415" => "Content-Type is missing, unsupported, or does not equal the signed media type",
        "500" => "Immutable object persistence failed"
      }))
    }
  end

  if method == "POST" && path == STRATOS_AIIP_UPLOAD_CONFIRM_PATH
    success_content = {
      "application/json" => {
        "schema" => { "$ref" => "#/components/schemas/StratosUploadConfirmResponse" }
      }
    }
    return {
      "tags" => ["AKB Governed AIIP Upload"],
      "summary" => "Confirm a governed AIIP upload idempotently",
      "description" => "Requires the original signed upload token and the opaque receipt issued only after exact binary persistence. It re-authenticates both identities, re-confirms the current AIIP lineage, creates or replays the immutable version and ingestion job, then advances current only by compare-and-swap.",
      "operationId" => "web_confirm_governed_aiip_upload",
      "security" => stratos_aiip_dual_identity_security,
      "parameters" => web_path_parameters(path),
      "requestBody" => {
        "required" => true,
        "content" => {
          "application/json" => {
            "schema" => { "$ref" => "#/components/schemas/StratosUploadConfirmRequest" }
          }
        }
      },
      "responses" => {
        "200" => {
          "description" => "Exact immutable version and ingestion lifecycle replayed without duplication",
          "content" => success_content
        },
        "201" => {
          "description" => "Immutable document version and ingestion lifecycle created",
          "content" => success_content
        }
      }.merge(stratos_aiip_upload_error_responses({
        "400" => "Malformed JSON, invalid receipt, or upload metadata mismatch",
        "401" => "Missing or invalid transport, actor, upload-token, or receipt credential",
        "403" => "Wrong service identity, route grant, actor, capability, or governed scope",
        "409" => "Stale current pointer, changed lineage, or immutable identity conflict",
        "410" => "Signed upload token has expired",
        "413" => "JSON body exceeds its configured bound",
        "422" => "Strict request, Information Policy, or integration-envelope validation failed",
        "502" => "Registry or central governance confirmation was invalid",
        "503" => "Registry, ingestion, identity, or central governance verification is unavailable"
      }))
    }
  end

  nil
end

def web_operation(method, path)
  return aiip_web_operation(path) if method == "POST" && AIIP_PUBLIC_PATHS.include?(path)
  if method == "GET" && path.match?(%r{\A/api/public/documents/\{publicSlug\}(?:/source)?\z})
    return public_document_web_operation(path)
  end
  governed_aiip_upload = stratos_aiip_upload_operation(method, path)
  return governed_aiip_upload if governed_aiip_upload

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
  parameters = web_path_parameters(path)
  operation["parameters"] = parameters unless parameters.empty?
  operation["requestBody"] = {
    "content" => {
      "application/json" => {
        "schema" => { "$ref" => "#/components/schemas/GenericJson" }
      }
    }
  } if %w[POST PUT PATCH].include?(method)
  if method == "POST" && path == "/api/intelligence/quality/runs"
    operation["requestBody"]["required"] = true
    operation["requestBody"]["content"]["application/json"]["schema"] = {
      "$ref" => "#/components/schemas/WebEvaluationRunRequest"
    }
  end
  operation
end

def add_common_system_paths(spec)
  all_servers = SERVICES.flat_map { |service| service[:servers] } + WEB_SERVERS + [CHAT_WEB_SERVER]
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

def web_servers_for(path)
  available_on_chat = CHAT_WEB_API_PREFIXES.any? do |prefix|
    path == prefix || path.start_with?("#{prefix}/")
  end
  available_on_chat ? WEB_SERVERS + [CHAT_WEB_SERVER] : WEB_SERVERS
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

def stratos_aiip_governance_confirmation_schema(resource_type)
  source_version_schema =
    if resource_type == "document-version"
      { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
    else
      { "type" => "string", "minLength" => 1, "maxLength" => 160 }
    end
  {
    "type" => "object",
    "additionalProperties" => false,
    "required" => [
      "parent_source_resource",
      "governed_resource",
      "document_policy_binding_id",
      "document_policy_version",
      "document_policy_hash",
      "actor_subject_id",
      "correlation_id",
      "idempotency_key"
    ],
    "properties" => {
      "parent_source_resource" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => [
          "governed_resource_id",
          "application",
          "resource_type",
          "resource_id",
          "source_version",
          "scope"
        ],
        "properties" => {
          "governed_resource_id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "application" => { "type" => "string", "const" => "AIIP" },
          "resource_type" => { "type" => "string", "const" => "idea" },
          "resource_id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "source_version" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "scope" => { "$ref" => "#/components/schemas/StratosAiipGovernanceScope" }
        }
      },
      "governed_resource" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => [
          "id",
          "application",
          "resource_type",
          "resource_id",
          "source_version",
          "parent_id",
          "scope",
          "policy_assignment",
          "explicit_policy_binding_id",
          "inherited_from_resource_id",
          "effective_policy",
          "registered_by_subject_id",
          "confirmed_by_subject_id"
        ],
        "properties" => {
          "id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "application" => { "type" => "string", "const" => "AKB" },
          "resource_type" => { "type" => "string", "const" => resource_type },
          "resource_id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "source_version" => source_version_schema,
          "parent_id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "scope" => { "$ref" => "#/components/schemas/StratosAiipGovernanceScope" },
          "policy_assignment" => { "type" => "string", "const" => "INHERITED" },
          "explicit_policy_binding_id" => { "type" => "null" },
          "inherited_from_resource_id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "effective_policy" => {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["policy_binding_id", "policy_version", "policy_hash"],
            "properties" => {
              "policy_binding_id" => { "type" => "string", "pattern" => "^(?:pol|pb)_[A-Za-z0-9_-]{8,}$" },
              "policy_version" => { "type" => "string", "const" => "information-policy-2.0.0" },
              "policy_hash" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
            }
          },
          "registered_by_subject_id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "confirmed_by_subject_id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 }
        }
      },
      "document_policy_binding_id" => { "type" => "string", "pattern" => "^(?:pol|pb)_[A-Za-z0-9_-]{8,}$" },
      "document_policy_version" => { "type" => "string", "const" => "information-policy-2.0.0" },
      "document_policy_hash" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
      "actor_subject_id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
      "correlation_id" => { "type" => "string", "minLength" => 8, "maxLength" => 200 },
      "idempotency_key" => { "type" => "string", "minLength" => 8, "maxLength" => 200 }
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
    { "url" => "https://stratos.zeleznalady.cz/akb", "description" => "Production AKB web frontend" },
    { "url" => "https://chat.zeleznalady.cz", "description" => "Production standalone AKB chat frontend" }
  ],
  "security" => [
    { "bearerAuth" => [] },
    {}
  ],
  "tags" => [
    { "name" => "System" },
    { "name" => "AKB Web API" },
    {
      "name" => "AKB Governed AIIP Upload",
      "description" => "Dedicated dual-identity, centrally governed AIIP document upload with signed binary transfer and receipt-bound confirmation."
    },
    { "name" => "AKB Public Documents" }
  ] + SERVICES.map { |service| { "name" => service[:title] } },
  "paths" => {},
  "components" => {
    "securitySchemes" => {
      "bearerAuth" => {
        "type" => "http",
        "scheme" => "bearer",
        "bearerFormat" => "JWT"
      },
      "aiipActorAuthorization" => {
        "type" => "apiKey",
        "in" => "header",
        "name" => "X-AIIP-Actor-Authorization",
        "description" => "Independent fresh current-person bearer. It must be formatted as Bearer <token> and must not equal the aiip-service transport bearer."
      },
      "uploadTokenAuth" => {
        "type" => "apiKey",
        "in" => "header",
        "name" => "X-AKL-Upload-Token",
        "description" => "Opaque signed upload token returned only in preflight required_headers."
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
      "WebEvaluationRunRequest" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["dataset_id"],
        "properties" => {
          "dataset_id" => {
            "type" => "string",
            "minLength" => 1,
            "pattern" => "^[A-Za-z0-9_.:-]+$"
          },
          "case_ids" => {
            "type" => "array",
            "maxItems" => 200,
            "uniqueItems" => true,
            "items" => {
              "type" => "string",
              "minLength" => 1,
              "pattern" => "^[A-Za-z0-9_.:-]+$"
            }
          },
          "max_cases" => {
            "type" => "integer",
            "minimum" => 1,
            "maximum" => 200
          }
        }
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
      "StratosAiipGovernanceScope" => {
        "oneOf" => [
          {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["type", "ownerSubjectId"],
            "properties" => {
              "type" => { "type" => "string", "const" => "own" },
              "ownerSubjectId" => { "type" => "string", "minLength" => 1, "maxLength" => 160 }
            }
          },
          {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["type", "id"],
            "properties" => {
              "type" => { "type" => "string", "const" => "organization" },
              "id" => { "type" => "string", "const" => "org_stratos" }
            }
          },
          {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["type", "id"],
            "properties" => {
              "type" => {
                "type" => "string",
                "enum" => ["organization_unit", "budget_scope", "portfolio", "project", "document", "recipient_set"]
              },
              "id" => { "type" => "string", "minLength" => 1, "maxLength" => 160 }
            }
          }
        ]
      },
      "StratosAiipIntegrationEnvelope" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => [
          "schemaVersion",
          "organizationId",
          "sourceSystem",
          "externalRef",
          "actor",
          "sourceResource",
          "correlationId",
          "idempotencyKey",
          "policyBindingId",
          "policyVersion",
          "policyHash",
          "classification",
          "payload"
        ],
        "properties" => {
          "schemaVersion" => { "type" => "string", "const" => "stratos-integration-envelope-1" },
          "organizationId" => { "type" => "string", "const" => "org_stratos" },
          "sourceSystem" => { "type" => "string", "const" => "STRATOS_AIIP" },
          "externalRef" => { "type" => "string", "minLength" => 1, "maxLength" => 240 },
          "actor" => {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["type", "subjectId"],
            "properties" => {
              "type" => { "type" => "string", "const" => "person" },
              "subjectId" => { "type" => "string", "minLength" => 1, "maxLength" => 160 }
            }
          },
          "sourceResource" => {
            "type" => "object",
            "additionalProperties" => false,
            "required" => [
              "governedResourceId",
              "application",
              "resourceType",
              "resourceId",
              "sourceVersion",
              "scope"
            ],
            "properties" => {
              "governedResourceId" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
              "application" => { "type" => "string", "const" => "AIIP" },
              "resourceType" => { "type" => "string", "const" => "idea" },
              "resourceId" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
              "sourceVersion" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
              "scope" => { "$ref" => "#/components/schemas/StratosAiipGovernanceScope" }
            }
          },
          "correlationId" => { "type" => "string", "minLength" => 8, "maxLength" => 200 },
          "idempotencyKey" => { "type" => "string", "minLength" => 8, "maxLength" => 200 },
          "policyBindingId" => { "type" => "string", "pattern" => "^(?:pol|pb)_[A-Za-z0-9_-]{8,}$" },
          "policyVersion" => { "type" => "string", "const" => "information-policy-2.0.0" },
          "policyHash" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "classification" => {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["handlingClass", "legalClassification", "tlp", "pap"],
            "properties" => {
              "handlingClass" => { "type" => "string", "enum" => ["PUBLIC", "INTERNAL", "RESTRICTED"] },
              "legalClassification" => { "type" => "string", "const" => "NONE" },
              "tlp" => {
                "type" => ["string", "null"],
                "enum" => ["TLP:RED", "TLP:AMBER+STRICT", "TLP:AMBER", "TLP:GREEN", "TLP:CLEAR", nil]
              },
              "pap" => {
                "type" => ["string", "null"],
                "enum" => ["PAP:RED", "PAP:AMBER", "PAP:GREEN", "PAP:CLEAR", nil]
              }
            }
          },
          "payload" => {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["operation", "entityType", "entityId", "sourceDocumentId", "sha256"],
            "properties" => {
              "operation" => { "type" => "string", "const" => "document_upload" },
              "entityType" => {
                "type" => "string",
                "enum" => ["InnovationRequest", "InnovationRequestImport"]
              },
              "entityId" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
              "sourceDocumentId" => { "type" => "string", "minLength" => 1, "maxLength" => 300 },
              "sha256" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
            }
          }
        }
      },
      "StratosAiipSourceLocation" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["kind", "sha256", "path"],
        "properties" => {
          "kind" => {
            "type" => "string",
            "enum" => ["url", "uploaded_file", "object_storage", "generated_text", "external_repository"]
          },
          "uri" => { "type" => ["string", "null"], "maxLength" => 2048 },
          "file_name" => { "type" => ["string", "null"], "maxLength" => 300 },
          "content_type" => { "type" => ["string", "null"], "maxLength" => 160 },
          "sha256" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "storage_ref" => { "type" => ["string", "null"], "maxLength" => 1024 },
          "captured_at" => { "type" => ["string", "null"], "format" => "date-time" },
          "display_url" => { "type" => ["string", "null"], "maxLength" => 2048 },
          "repository" => { "type" => ["string", "null"], "maxLength" => 200 },
          "path" => { "type" => "string", "minLength" => 1, "maxLength" => 1024 },
          "version" => { "type" => ["string", "null"], "maxLength" => 160 }
        }
      },
      "StratosUploadPreflightRequest" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => [
          "tenant_id",
          "external_system",
          "external_ref",
          "entity_type",
          "entity_id",
          "document_type",
          "title",
          "classification",
          "source_location",
          "file_name",
          "file_type",
          "file_size",
          "sha256",
          "information_policy",
          "governance_scope",
          "integration_envelope"
        ],
        "properties" => {
          "tenant_id" => { "type" => "string", "const" => "org_stratos" },
          "external_system" => { "type" => "string", "const" => "STRATOS_AIIP" },
          "external_ref" => { "type" => "string", "minLength" => 1, "maxLength" => 240 },
          "entity_type" => {
            "type" => "string",
            "enum" => ["InnovationRequest", "InnovationRequestImport"]
          },
          "entity_id" => { "type" => "string", "minLength" => 1, "maxLength" => 128 },
          "document_type" => {
            "type" => "string",
            "enum" => [
              "ai_intake",
              "ai_requirement_card",
              "ai_security_appendix",
              "ai_governance_evidence",
              "knowledge_base_article",
              "project_documentation",
              "attachment",
              "other"
            ]
          },
          "title" => { "type" => "string", "minLength" => 1, "maxLength" => 300 },
          "classification" => { "type" => "string", "enum" => ["public", "internal", "restricted"] },
          "owner_actor_id" => {
            "type" => ["string", "null"],
            "minLength" => 1,
            "maxLength" => 160,
            "description" => "Optional consistency claim only; when present it must equal integration_envelope.actor.subjectId and never grants authority."
          },
          "context_tags" => {
            "type" => "array",
            "items" => { "type" => "string", "minLength" => 1 }
          },
          "source_location" => { "$ref" => "#/components/schemas/StratosAiipSourceLocation" },
          "citation_base_url" => { "type" => ["string", "null"], "maxLength" => 512 },
          "preview_url" => { "type" => ["string", "null"], "maxLength" => 2048 },
          "file_name" => { "type" => "string", "minLength" => 1, "maxLength" => 300 },
          "file_type" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "file_size" => { "type" => "integer", "minimum" => 1 },
          "sha256" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "information_policy" => { "$ref" => "#/components/schemas/RegistryApiInformationPolicyBinding" },
          "governance_scope" => { "$ref" => "#/components/schemas/StratosAiipGovernanceScope" },
          "integration_envelope" => { "$ref" => "#/components/schemas/StratosAiipIntegrationEnvelope" }
        }
      },
      "StratosUploadRequiredHeaders" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["Content-Type", "X-AKL-Content-SHA256", "X-AKL-Upload-Token"],
        "properties" => {
          "Content-Type" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "X-AKL-Content-SHA256" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "X-AKL-Upload-Token" => {
            "type" => "string",
            "minLength" => 16,
            "description" => "Opaque signed token; it is never exposed as a top-level response field."
          }
        }
      },
      "StratosUploadFile" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["filename", "mime_type", "size_bytes", "sha256"],
        "properties" => {
          "filename" => { "type" => "string", "minLength" => 1, "maxLength" => 300 },
          "mime_type" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "size_bytes" => { "type" => "integer", "minimum" => 1 },
          "sha256" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
        }
      },
      "StratosUploadPreflightResponse" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => [
          "upload_session_id",
          "upload_url",
          "upload_method",
          "source_file_uri",
          "expires_at",
          "required_headers",
          "bucket",
          "object_key",
          "policy_binding_id",
          "policy_version",
          "policy_hash",
          "file",
          "limits",
          "document_id",
          "external_document_id",
          "external_ref",
          "governance_confirmation",
          "canonical_open_url"
        ],
        "properties" => {
          "upload_session_id" => { "type" => "string", "pattern" => "^upl_[A-Za-z0-9_-]+$" },
          "upload_url" => { "type" => "string", "minLength" => 1 },
          "upload_method" => { "type" => "string", "const" => "PUT" },
          "source_file_uri" => { "type" => "string", "pattern" => "^s3://[^/]+/.+$" },
          "expires_at" => { "type" => "string", "format" => "date-time" },
          "required_headers" => { "$ref" => "#/components/schemas/StratosUploadRequiredHeaders" },
          "bucket" => { "type" => "string", "minLength" => 1 },
          "object_key" => { "type" => "string", "minLength" => 1 },
          "policy_binding_id" => { "type" => "string", "pattern" => "^(?:pol|pb)_[A-Za-z0-9_-]{8,}$" },
          "policy_version" => { "type" => "string", "const" => "information-policy-2.0.0" },
          "policy_hash" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "file" => { "$ref" => "#/components/schemas/StratosUploadFile" },
          "limits" => {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["max_file_bytes", "accepted_mime_types"],
            "properties" => {
              "max_file_bytes" => { "type" => "integer", "minimum" => 1 },
              "accepted_mime_types" => {
                "type" => "array",
                "uniqueItems" => true,
                "items" => { "type" => "string", "minLength" => 1 }
              }
            }
          },
          "document_id" => { "type" => "string", "minLength" => 1, "maxLength" => 64 },
          "external_document_id" => { "type" => "string", "minLength" => 1, "maxLength" => 64 },
          "external_ref" => { "type" => "string", "minLength" => 1, "maxLength" => 240 },
          "governance_confirmation" => { "$ref" => "#/components/schemas/StratosAiipDocumentGovernanceConfirmation" },
          "canonical_open_url" => { "type" => "string", "minLength" => 1 }
        }
      },
      "StratosUploadContentResponse" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["uploaded", "upload_session_id", "source_file_uri", "upload_receipt", "file"],
        "properties" => {
          "uploaded" => { "type" => "boolean", "const" => true },
          "upload_session_id" => { "type" => "string", "pattern" => "^upl_[A-Za-z0-9_-]+$" },
          "source_file_uri" => { "type" => "string", "pattern" => "^s3://[^/]+/.+$" },
          "upload_receipt" => {
            "type" => "string",
            "minLength" => 16,
            "description" => "Opaque confirmation credential bound to the persisted session, object key, exact size, and SHA-256."
          },
          "file" => { "$ref" => "#/components/schemas/StratosUploadFile" }
        }
      },
      "StratosUploadConfirmRequest" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => [
          "upload_token",
          "upload_receipt",
          "document_id",
          "external_document_id",
          "tenant_id",
          "external_system",
          "external_ref",
          "source_file_uri",
          "file_hash",
          "file_name",
          "file_type",
          "file_size",
          "information_policy",
          "governance_scope",
          "integration_envelope"
        ],
        "properties" => {
          "upload_token" => { "type" => "string", "minLength" => 16 },
          "upload_receipt" => { "type" => "string", "minLength" => 16 },
          "document_id" => { "type" => "string", "minLength" => 1, "maxLength" => 64 },
          "external_document_id" => { "type" => "string", "minLength" => 1, "maxLength" => 64 },
          "tenant_id" => { "type" => "string", "const" => "org_stratos" },
          "external_system" => { "type" => "string", "const" => "STRATOS_AIIP" },
          "external_ref" => { "type" => "string", "minLength" => 1, "maxLength" => 240 },
          "version_label" => { "type" => ["string", "null"], "minLength" => 1, "maxLength" => 80 },
          "source_file_uri" => { "type" => "string", "pattern" => "^s3://[^/]+/.+$" },
          "file_hash" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "file_name" => { "type" => "string", "minLength" => 1, "maxLength" => 300 },
          "file_type" => { "type" => "string", "minLength" => 1, "maxLength" => 160 },
          "file_size" => { "type" => "integer", "minimum" => 1 },
          "valid_from" => { "type" => ["string", "null"], "format" => "date" },
          "valid_to" => { "type" => ["string", "null"], "format" => "date" },
          "change_summary" => { "type" => ["string", "null"], "minLength" => 1, "maxLength" => 2000 },
          "parser_profile" => { "type" => ["string", "null"], "minLength" => 1, "maxLength" => 80 },
          "ocr_enabled" => { "type" => "boolean" },
          "chunking_strategy" => { "type" => ["string", "null"], "minLength" => 1, "maxLength" => 80 },
          "embedding_profile" => { "type" => ["string", "null"], "minLength" => 1, "maxLength" => 80 },
          "information_policy" => { "$ref" => "#/components/schemas/RegistryApiInformationPolicyBinding" },
          "governance_scope" => { "$ref" => "#/components/schemas/StratosAiipGovernanceScope" },
          "integration_envelope" => { "$ref" => "#/components/schemas/StratosAiipIntegrationEnvelope" }
        }
      },
      "StratosUploadConfirmResponse" => {
        "type" => "object",
        "additionalProperties" => false,
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
          "policy_hash",
          "governance_confirmation"
        ],
        "properties" => {
          "document_id" => { "type" => "string", "minLength" => 1, "maxLength" => 64 },
          "document_version_id" => { "type" => "string", "minLength" => 1, "maxLength" => 64 },
          "external_document_id" => { "type" => "string", "minLength" => 1, "maxLength" => 64 },
          "file_id" => { "type" => "string", "minLength" => 1, "maxLength" => 64 },
          "ingestion_job_id" => { "type" => ["string", "null"], "minLength" => 1, "maxLength" => 128 },
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
          "canonical_open_url" => { "type" => "string", "minLength" => 1 },
          "policy_binding_id" => { "type" => "string", "pattern" => "^(?:pol|pb)_[A-Za-z0-9_-]{8,}$" },
          "policy_version" => { "type" => "string", "const" => "information-policy-2.0.0" },
          "policy_hash" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" },
          "governance_confirmation" => { "$ref" => "#/components/schemas/StratosAiipDocumentVersionGovernanceConfirmation" }
        }
      },
      "StratosAiipDocumentGovernanceConfirmation" => stratos_aiip_governance_confirmation_schema("document"),
      "StratosAiipDocumentVersionGovernanceConfirmation" => stratos_aiip_governance_confirmation_schema("document-version"),
      "StratosUploadErrorResponse" => {
        "type" => "object",
        "additionalProperties" => false,
        "required" => ["error"],
        "properties" => {
          "error" => {
            "type" => "object",
            "additionalProperties" => false,
            "required" => ["code", "message", "trace_id"],
            "properties" => {
              "code" => { "type" => "string", "minLength" => 1 },
              "message" => { "type" => "string", "minLength" => 1 },
              "details" => { "type" => "object", "additionalProperties" => true },
              "trace_id" => { "type" => "string", "minLength" => 1 }
            }
          }
        }
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
  source.dig("components", "securitySchemes")&.each do |name, scheme|
    existing = spec["components"]["securitySchemes"][name]
    next if existing
    spec["components"]["securitySchemes"][name] = scheme
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

  item = spec["paths"][path] ||= { "servers" => web_servers_for(path) }
  item["servers"] ||= web_servers_for(path)
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
