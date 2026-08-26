#!/usr/bin/env ruby
# Builds the root AKB OpenAPI JSON contract from service-local OpenAPI files
# and the Next.js web API route tree.
require "json"
require "yaml"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
OUTPUT = File.join(ROOT, "openapi", "openapi.json")

# JSON.pretty_generate changed its rendering of empty arrays and objects between
# Ruby releases. The OpenAPI files are checked into source control, so their
# representation must not depend on the Ruby version used by a developer or CI.
def stable_json(value, depth = 0)
  indent = "  " * depth
  child_indent = "  " * (depth + 1)

  case value
  when Hash
    return "{}" if value.empty?

    entries = value.map do |key, nested_value|
      "#{child_indent}#{JSON.generate(key.to_s)}: #{stable_json(nested_value, depth + 1)}"
    end
    "{\n#{entries.join(",\n")}\n#{indent}}"
  when Array
    return "[]" if value.empty?

    entries = value.map { |nested_value| "#{child_indent}#{stable_json(nested_value, depth + 1)}" }
    "[\n#{entries.join(",\n")}\n#{indent}]"
  else
    JSON.generate(value)
  end
end

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


def web_operation(method, path)
  if method == "GET" && path.match?(%r{\A/api/public/documents/\{publicSlug\}(?:/source)?\z})
    return public_document_web_operation(path)
  end

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
    { "name" => "AKB Public Documents" }
  ] + SERVICES.map { |service| { "name" => service[:title] } },
  "paths" => {},
  "components" => {
    "parameters" => {},
    "securitySchemes" => {
      "bearerAuth" => {
        "type" => "http",
        "scheme" => "bearer",
        "bearerFormat" => "JWT"
      },
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
  parameters = source.dig("components", "parameters") || {}
  ref_map = schemas.keys.to_h do |name|
    ["#/components/schemas/#{name}", "#/components/schemas/#{service[:prefix]}#{name}"]
  end
  ref_map.merge!(
    parameters.keys.to_h do |name|
      ["#/components/parameters/#{name}", "#/components/parameters/#{service[:prefix]}#{name}"]
    end
  )

  schemas.each do |name, schema|
    spec["components"]["schemas"]["#{service[:prefix]}#{name}"] = deep_rewrite_refs(schema, ref_map)
  end
  parameters.each do |name, parameter|
    spec["components"]["parameters"]["#{service[:prefix]}#{name}"] =
      deep_rewrite_refs(parameter, ref_map)
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
next_content = stable_json(spec) + "\n"
if ARGV.include?("--check")
  if !File.exist?(OUTPUT)
    warn "#{OUTPUT} does not exist"
    exit 1
  end
  if File.read(OUTPUT) != next_content
    warn "#{OUTPUT} is not up to date; run scripts/generate_openapi_index.rb"
    exit 1
  end
  puts "#{OUTPUT} is up to date"
else
  File.write(OUTPUT, next_content)
  puts "Wrote #{OUTPUT}"
end
