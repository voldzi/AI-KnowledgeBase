#!/usr/bin/env ruby
# Builds the root AKB OpenAPI JSON contract from service-local OpenAPI files
# and the Next.js web API route tree.
require "json"
require "yaml"
require "fileutils"

ROOT = File.expand_path("..", __dir__)
OUTPUT = File.join(ROOT, "openapi", "openapi.json")

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

def web_operation(method, path)
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
              "trace_id" => { "type" => "string" }
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

if ARGV.include?("--check")
  if !File.exist?(OUTPUT)
    warn "#{OUTPUT} does not exist"
    exit 1
  end
  current = File.read(OUTPUT)
  if current != next_content
    warn "#{OUTPUT} is not up to date; run scripts/generate_openapi_index.rb"
    exit 1
  end
  puts "#{OUTPUT} is up to date"
else
  File.write(OUTPUT, next_content)
  puts "Wrote #{OUTPUT}"
end
