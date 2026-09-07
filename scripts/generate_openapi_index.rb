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


def budget_upload_web_schemas
  text = { "type" => "string", "minLength" => 1 }
  digest = { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
  scope_id = { "type" => "string", "pattern" => "^(?:budget-global|budget:[a-z0-9][a-z0-9._-]{0,119})$" }
  object = ->(properties, required = properties.keys) {
    { "type" => "object", "additionalProperties" => false, "required" => required, "properties" => properties }
  }
  reference = ->(name) { { "$ref" => "#/components/schemas/#{name}" } }
  scope = object.call({ "type" => { "const" => "budget_scope", "type" => "string" }, "id" => scope_id })
  envelope = object.call({
    "schemaVersion" => { "type" => "string", "const" => "stratos-integration-envelope-1" },
    "organizationId" => { "type" => "string", "const" => "org_stratos" },
    "sourceSystem" => { "type" => "string", "const" => "STRATOS_BUDGET" },
    "externalRef" => text,
    "actor" => object.call({ "type" => { "type" => "string", "const" => "person" },
      "subjectId" => { "type" => "string", "pattern" => "^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,127}$" } }),
    "correlationId" => { "type" => "string", "minLength" => 8 },
    "idempotencyKey" => { "type" => "string", "minLength" => 8 },
    "policyBindingId" => { "type" => "string", "pattern" => "^(?:pol|pb)_[A-Za-z0-9_-]{8,}$" },
    "policyVersion" => { "type" => "string", "const" => "information-policy-2.0.0" },
    "policyHash" => digest,
    "classification" => object.call({
      "handlingClass" => reference.call("RegistryApiHandlingClass"),
      "legalClassification" => { "type" => "string", "const" => "NONE" },
      "tlp" => { "anyOf" => [reference.call("RegistryApiTlpLabel"), { "type" => "null" }] },
      "pap" => { "anyOf" => [reference.call("RegistryApiPapLabel"), { "type" => "null" }] }
    }, %w[handlingClass legalClassification]),
    "payload" => object.call({
      "contractId" => { "type" => "string", "pattern" => "^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$" },
      "financialScopeKey" => scope_id, "fileHash" => digest
    })
  })
  common = {
    "tenant_id" => { "type" => "string", "const" => "org_stratos" },
    "external_system" => { "type" => "string", "const" => "STRATOS_BUDGET" },
    "external_ref" => text,
    "entity_type" => { "type" => "string", "const" => "Contract" },
    "entity_id" => text,
    "file_name" => text, "file_type" => text,
    "file_size" => { "type" => "integer", "minimum" => 1, "maximum" => 104857600 },
    "information_policy" => reference.call("RegistryApiDocumentInformationPolicyBinding"),
    "governance_scope" => reference.call("WebBudgetUploadScope"),
    "parent_governed_resource_id" => text,
    "integration_envelope" => reference.call("WebBudgetUploadEnvelope")
  }
  batch_fields = %w[batch_manifest_id batch_entries_sha256 release_revision]
  metadata = {
    "allOf" => [reference.call("RegistryApiStratosBudgetUploadMetadata"), {
      "type" => "object",
      "properties" => {
        "batch_manifest_id" => { "type" => "string", "pattern" => "^[a-z0-9][a-z0-9._-]{0,127}$" },
        "batch_entries_sha256" => digest,
        "release_revision" => { "type" => "string", "pattern" => "^[a-f0-9]{40}$" }
      },
      "dependentRequired" => batch_fields.to_h { |field| [field, batch_fields - [field]] },
      "allOf" => [
        { "if" => { "properties" => { "lifecycle" => { "const" => "CURRENT" } } },
          "then" => { "properties" => { "documentType" => { "const" => "CONTRACT_PDF" }, "document_type" => { "const" => "CONTRACT_PDF" } } } },
        { "if" => { "properties" => { "lifecycle" => { "const" => "ARCHIVED" } } },
          "then" => { "properties" => { "documentType" => { "const" => "CONTRACT_ARCHIVE" }, "document_type" => { "const" => "CONTRACT_ARCHIVE" } } } }
      ]
    }],
    "description" => "Batch fields must be absent for interactive uploads or supplied together for historical_batch. Contract id, financial scope and dates are cross-checked; start date must not follow end date."
  }
  preflight = common.merge({
    "document_profile" => reference.call("RegistryApiDocumentProfileInput"),
    "document_version_profile" => reference.call("WebBudgetDocumentVersionProfileDraft"),
    "document_type" => { "type" => "string", "const" => "contract" }, "title" => text,
    "classification" => text.merge("description" => "Case-insensitive information_policy.handlingClass; PROJECT_MANAGEMENT is accepted."),
    "actor_subject_id" => text.merge("description" => "Must equal integration_envelope.actor.subjectId."),
    "owner_display_name" => { "type" => ["string", "null"], "minLength" => 1 },
    "context_tags" => { "type" => "array", "items" => text },
    "metadata" => reference.call("WebBudgetUploadMetadata"), "sha256" => digest
  })
  confirm = common.merge({
    "document_profile" => reference.call("RegistryApiDocumentVersionProfileInput"),
    "document_id" => text, "external_document_id" => text, "upload_session_id" => text,
    "upload_token" => text, "upload_receipt" => text,
    "source_file_uri" => text, "file_hash" => digest, "version_label" => text.merge("maxLength" => 80),
    "valid_from" => { "type" => ["string", "null"], "format" => "date", "minLength" => 1 },
    "valid_to" => { "type" => ["string", "null"], "format" => "date", "minLength" => 1 },
    "change_summary" => { "type" => ["string", "null"], "minLength" => 1 }
  })
  file = object.call({ "filename" => text, "mime_type" => text,
    "size_bytes" => { "type" => "integer", "minimum" => 1 }, "sha256" => digest })
  policy_refs = { "policy_binding_id" => text,
    "policy_version" => { "type" => "string", "const" => "information-policy-2.0.0" }, "policy_hash" => digest }
  preflight_response = object.call({
    "document_profile" => reference.call("RegistryApiDocumentVersionProfileInput"),
    "upload_session_id" => text,
    "upload_url" => text.merge("description" => "Canonical Document Intake content URL; resolve relative to the configured AKB origin."),
    "upload_method" => { "type" => "string", "const" => "PUT" },
    "source_file_uri" => text, "expires_at" => { "type" => "string", "format" => "date-time" },
    "required_headers" => object.call({ "Content-Type" => text, "X-AKL-Content-SHA256" => digest, "X-AKL-Upload-Token" => text }),
    "required_authentication" => object.call({
      "transport" => { "type" => "string", "const" => "server_to_server" },
      "service_bearer" => { "type" => "boolean", "const" => true },
      "actor_bearer" => { "type" => "boolean", "description" => "True for interactive; false for the signed historical_batch mode." }
    }),
    "file" => reference.call("WebDocumentIntakeFile"), "document_id" => text,
    "external_document_id" => text, "external_ref" => text, "canonical_open_url" => text
  }.merge(policy_refs))
  confirm_response = object.call({
    "document_id" => text, "document_version_id" => text, "external_document_id" => text,
    "file_id" => text, "ingestion_job_id" => text,
    "ingestion_status" => { "type" => "string", "enum" => %w[VERSION_CREATED INGESTING INDEXED FAILED PERMISSION_DENIED STALE] },
    "idempotent_replay" => { "type" => "boolean" }, "canonical_open_url" => text,
    "file_name" => text, "file_type" => text, "file_size" => { "type" => "integer", "minimum" => 1 },
    "document_version_status" => { "type" => "string", "enum" => %w[draft valid], "description" => "Actual Registry workflow status. Draft contract originals may be ingested for review; extraction does not publish them or establish legal effectivity." },
    "governance_confirmation" => reference.call("RegistryApiStratosBudgetGovernanceConfirmation")
  }.merge(policy_refs))
  {
    "WebBudgetDocumentVersionProfileDraft" => object.call({
      "lifecycle" => reference.call("RegistryApiDocumentLifecycle"),
      "domain_evidence" => { "type" => "object", "description" => "Exact closed evidence fields for the approved akb.contract catalog revision; current source authority is checked by Registry." }
    }),
    "WebBudgetUploadScope" => scope, "WebBudgetUploadEnvelope" => envelope,
    "WebBudgetUploadMetadata" => metadata, "WebDocumentIntakeFile" => file,
    "WebBudgetUploadPreflightRequest" => object.call(preflight, preflight.keys - %w[owner_display_name context_tags]),
    "WebBudgetUploadConfirmRequest" => object.call(confirm, confirm.keys - %w[valid_from valid_to change_summary]),
    "WebBudgetUploadPreflightResponse" => preflight_response,
    "WebBudgetUploadConfirmResponse" => confirm_response
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
  if method == "POST" && path == "/api/controlled-document/documents"
    operation["description"] = "Create a governed document draft with a required catalog document_profile (authorship, native provenance, owner and gestor) and explicit TLP proposal or complete document information_policy. " \
      "Missing/null TLP is rejected. TLP:RED requires explicitly selected recipient_subject_ids. " \
      "The web adds the profile owner assignment. An independent approver is required for controlled-document profiles. " \
      "Registry confirms the exact canonical root snapshot with current central authority before persistence; unavailable admission returns 503."
    operation["requestBody"] = {
      "required" => true,
      "content" => { "application/json" => { "schema" => {
        "type" => "object", "required" => %w[title document_type document_profile assignments],
        "anyOf" => [{ "required" => ["information_policy"] }, { "required" => ["tlp"] }],
        "properties" => {
          "title" => { "type" => "string", "minLength" => 1 },
          "assignments" => { "type" => "array", "minItems" => 1, "items" => { "$ref" => "#/components/schemas/RegistryApiDocumentAssignmentCreate" } },
          "document_profile" => { "$ref" => "#/components/schemas/RegistryApiDocumentProfileInput" },
          "tlp" => { "type" => "string", "enum" => %w[TLP:CLEAR TLP:GREEN TLP:AMBER TLP:AMBER+STRICT TLP:RED] },
          "recipient_subject_ids" => { "type" => "array", "items" => { "type" => "string", "minLength" => 1 }, "uniqueItems" => true },
          "information_policy" => { "$ref" => "#/components/schemas/RegistryApiDocumentInformationPolicyBinding" },
          "classification" => { "type" => "string", "enum" => %w[public internal restricted] },
          "document_type" => { "type" => "string" }, "tags" => { "type" => "string" }
        }
      } } }
    }
  end
  if method == "POST" && ["/api/controlled-document/upload/preflight", "/api/controlled-document/ingestion"].include?(path)
    preflight = path.end_with?("/preflight")
    operation["description"] = preflight ?
      "Prepare an upload only after current document authority and complete version lifecycle/domain evidence match the current root revision. The server signs document_profile and the current expected_current_ingestion_job_id (string or explicit null); this predecessor is never supplied by the browser. Catalog formats without an admitted extraction adapter are rejected." :
      "Confirm an uploaded original only when the required nested document_profile exactly matches the signed proposal. Current root revision and authority are checked before persisted content is read. The signed expected_current_ingestion_job_id must be present; missing predecessors return 409 UPLOAD_PREDECESSOR_REQUIRED. Registry transactionally reserves the verified intake session, records immutable version lineage and a fresh central snapshot confirmation. Exact retries reuse that version and its deterministic ingestion job; HTTP 201 means created and 200 means authorized replay. Pending authorization/claiming receives one bounded activation retry, then 503 INGESTION_ACTIVATION_FAILED."
    operation["description"] += " Budget, ProjectFlow and ArchFlow documents require their dedicated authenticated source intake; the native boundary rejects them before reading upload bytes."
    fields = preflight ? %w[document_id file_name file_size sha256 document_profile] : %w[document_id upload_session_id upload_token upload_receipt source_file_uri file_hash version_label document_profile]
    properties = fields.to_h { |name| [name, { "type" => "string" }] }
    properties["document_profile"] = { "$ref" => "#/components/schemas/RegistryApiDocumentVersionProfileInput" }
    properties["file_size"] = { "type" => "integer", "minimum" => 1 } if preflight
    operation["requestBody"] = { "required" => true, "content" => { "application/json" => { "schema" => {
      "type" => "object", "required" => fields, "properties" => properties
    } } } }
    unless preflight
      response_schema = { "type" => "object", "required" => %w[version job], "properties" => {
        "version" => { "$ref" => "#/components/schemas/RegistryApiDocumentVersionResponse" },
        "job" => { "$ref" => "#/components/schemas/IngestionServiceIngestionJobResponse", "description" => "Exact deterministic ingestion job for controlled:{document_version_id}; validated against the signed predecessor and delegated actor." }
      } }
      { "200" => "Authorized replay of the original version and ingestion job", "201" => "New version and ingestion job created" }.each do |code, description|
        operation["responses"][code] = { "description" => description, "content" => { "application/json" => { "schema" => response_schema } } }
      end
    end
  end
  if method == "PUT" && path == "/api/documents/{documentId}/assignments"
    operation["description"] = "Replace responsibilities atomically with a complete root document_profile and expected_root_metadata_revision. Registry confirms a fresh revision; historical version snapshots remain unchanged. A stale revision returns 409."
    operation["requestBody"] = { "required" => true, "content" => { "application/json" => { "schema" => {
      "type" => "object", "required" => %w[assignments document_profile expected_root_metadata_revision], "properties" => {
        "assignments" => { "type" => "array", "items" => { "$ref" => "#/components/schemas/RegistryApiDocumentAssignmentCreate" } },
        "document_profile" => { "$ref" => "#/components/schemas/RegistryApiDocumentProfileInput" },
        "expected_root_metadata_revision" => { "type" => "string", "minLength" => 1 }
      }
    } } } }
  end
  if method == "POST" && path == "/api/public-sources/sync"
    operation["description"] = "Sync an official source selected from current centrally approved collections. " \
      "Fresh STRATOS source preparation supplies exact per-document provenance, explicit PUBLIC/TLP:CLEAR policy and complete root/version profiles before source bytes are downloaded. " \
      "Registry admits or freshly revalidates the current root; changed root metadata returns 409 and requires an explicit compare-and-swap update. Browser authority/policy/profile fields are rejected. " \
      "Regulations require verified effective_from (Czech legal URLs can supply their exact version date). " \
      "Capture time is provenance, never a substitute for legal effectivity. Missing central contract/configuration returns 503; the local discovery catalog is never approval."
    operation["requestBody"] = {
      "required" => true,
      "content" => { "application/json" => { "schema" => {
        "type" => "object", "additionalProperties" => false, "required" => %w[collection_id collection_revision source_url title],
        "properties" => {
          "collection_id" => { "type" => "string" }, "source_url" => { "type" => "string", "format" => "uri" },
          "collection_revision" => { "type" => "string", "minLength" => 1, "description" => "Exact currently selected STRATOS approved collection revision; prepared again before every import." },
          "canonical_url" => { "type" => "string", "format" => "uri" }, "title" => { "type" => "string" },
          "version_label" => { "type" => "string" }, "effective_from" => { "type" => "string", "format" => "date" },
          "effective_to" => { "type" => ["string", "null"], "format" => "date" }
        }
      } } }
    }
  end
  if method == "GET" && path == "/api/public-sources/collections"
    operation["description"] = "Return the authenticated actor's current centrally approved official-source collection display projection (no-store). " \
      "A selection is not an admission proof. Sync prepares and revalidates every concrete source before downloading. " \
      "Returns 503 when AKL_STRATOS_OFFICIAL_SOURCES_URL is unset, the upstream V1 contract is unavailable or its strict response is invalid; no local approved fallback."
    operation["responses"]["200"]["content"] = { "application/json" => { "schema" => {
      "type" => "object", "required" => ["collections"], "additionalProperties" => false,
      "properties" => { "collections" => { "type" => "array", "maxItems" => 100, "items" => {
        "type" => "object", "additionalProperties" => false,
        "required" => %w[collectionId revision displayName authorityDisplayName ownerDisplayName gestorDisplayName reviewRuleLabel profile tlp],
        "properties" => %w[collectionId revision displayName authorityDisplayName ownerDisplayName gestorDisplayName reviewRuleLabel].to_h { |key| [key, { "type" => "string", "minLength" => 1 }] }.merge(
          "profile" => { "type" => "object", "required" => %w[id revision], "additionalProperties" => false,
            "properties" => { "id" => { "const" => "akb.official-public-reference" }, "revision" => { "const" => "1" } } },
          "tlp" => { "const" => "TLP:CLEAR" }
        )
      } } }
    } } }
  end
  if method == "POST" && path == "/api/intelligence/quality/runs"
    operation["requestBody"]["required"] = true
    operation["requestBody"]["content"]["application/json"]["schema"] = {
      "$ref" => "#/components/schemas/WebEvaluationRunRequest"
    }
  end
  if method == "POST" && path == "/api/assistant/chat"
    operation["description"] = "Routes governed rules, Registry metadata, live STRATOS queries and cited document answers. " \
      "Explicit personal AKB workflow questions use the current subject's authorized tasks or managed documents, with a bounded preview and a Registry-provided total. " \
      "The personal workflow is read-only, reauthorizes access before returning records and never falls back to RAG on denial or outage. " \
      "Personal task/document previews are not persisted or shared: conversation history stores only a neutral refresh receipt."
  end
  if method == "GET" && path == "/api/documents/source/preview"
    operation["description"] = "Build a bounded text preview from an authorized immutable source. OOXML preview supports single-volume non-encrypted ZIP entries with stored/deflate compression, at most 4096 entries, 8 MiB per expanded XML part and 32 MiB total XML. Embedded binary parts are not inflated. Malformed or oversized content returns 422 without a partial preview."
    operation["responses"]["422"] = {
      "description" => "SOURCE_PREVIEW_REJECTED: unsupported, malformed or oversized OOXML expansion; use the authorized original or PDF rendition.",
      "content" => { "application/json" => { "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" } } }
    }
  end
  if method == "PUT" && path == "/api/document-intake/v1/sessions/{sessionId}/content"
    operation["summary"] = "Accept an authorized document binary through quarantine and scanning"
    operation["description"] = "The signed upload token is required together with current authorization before body reads. " \
      "Controlled uploads require the same interactive actor and document.version.create. Budget uploads are server-to-server: " \
      "Authorization carries the exact service bearer and X-STRATOS-Actor-Authorization carries a separate current person bearer in interactive mode; " \
      "historical_batch requires service-only credentials and exact approved batch lineage. Official collection uses the internal core. " \
      "Content-Type must exactly match the signed MIME type. Old content aliases are removed."
    operation["security"] = [
      { "uploadToken" => [], "webSession" => [] },
      { "uploadToken" => [], "bearerAuth" => [] },
      { "uploadToken" => [], "bearerAuth" => [], "stratosActorBearer" => [] }
    ]
    operation["parameters"] << {
      "name" => "X-AKL-Content-SHA256", "in" => "header", "required" => true,
      "description" => "Must equal the signed file hash; the received bytes are verified independently.",
      "schema" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
    }
    operation["requestBody"] = {
      "required" => true,
      "description" => "Exact bounded file bytes using the MIME type returned by preflight.",
      "content" => { "*/*" => { "schema" => { "type" => "string", "format" => "binary" } } }
    }
    operation["responses"].delete("200")
    operation["responses"]["201"] = {
      "description" => "Authorized content accepted; confirmation must return the opaque upload receipt.",
      "headers" => { "Cache-Control" => { "schema" => { "type" => "string", "const" => "private, no-store" } } },
      "content" => { "application/json" => { "schema" => {
        "type" => "object",
        "required" => %w[uploaded intake_status upload_receipt upload_session_id source_file_uri file content_security],
        "properties" => {
          "uploaded" => { "type" => "boolean", "const" => true },
          "intake_status" => { "type" => "string", "enum" => %w[clean accepted_without_external_scan],
            "description" => "Production requires clean; unscanned acceptance exists only in explicitly non-required development mode." },
          "upload_receipt" => { "type" => "string", "description" => "Opaque, short-lived signed receipt; never log or use as authorization." },
          "upload_session_id" => { "type" => "string" },
          "source_file_uri" => { "type" => "string" },
          "file" => { "type" => "object", "required" => %w[filename mime_type size_bytes sha256], "properties" => {
            "filename" => { "type" => "string" }, "mime_type" => { "type" => "string" },
            "size_bytes" => { "type" => "integer", "minimum" => 1 },
            "sha256" => { "type" => "string", "pattern" => "^sha256:[a-f0-9]{64}$" }
          } },
          "content_security" => { "type" => "object", "required" => %w[status engine engine_version signature_version scanned_at duration_ms], "properties" => {
            "status" => { "type" => "string", "enum" => %w[clean not_performed] },
            "engine" => { "type" => "string", "enum" => %w[clamav disabled] },
            "engine_version" => { "type" => ["string", "null"] },
            "signature_version" => { "type" => ["string", "null"] },
            "scanned_at" => { "type" => "string", "format" => "date-time" },
            "duration_ms" => { "type" => "number", "minimum" => 0 }
          } }
        }
      } } }
    }
    {
      "400" => "Session or signed request metadata mismatch",
      "401" => "Missing, invalid or expired token/current credential",
      "403" => "Current actor, upload authority, service, scope or policy denied",
      "409" => "Policy, source lineage or signed workflow changed",
      "413" => "File exceeds the applicable intake limit",
      "415" => "Content-Type does not match the signed MIME type",
      "422" => "Malware or a rejected document-content signature",
      "502" => "Registry authorization returned conflicting coordinates",
      "503" => "Current policy verification or content-security service unavailable/invalid"
    }.each do |code, description|
      operation["responses"][code] = {
        "description" => description,
        "content" => { "application/json" => { "schema" => { "$ref" => "#/components/schemas/AkbErrorResponse" } } }
      }
    end
  end
  if method == "POST" && ["/api/stratos/budget-upload/preflight", "/api/stratos/budget-upload/sessions/{sessionId}/confirm"].include?(path)
    preflight = path.end_with?("/preflight")
    schema_prefix = preflight ? "WebBudgetUploadPreflight" : "WebBudgetUploadConfirm"
    operation["description"] = "Budget-only server-to-server workflow. Authorization requires the exact Budget service bearer. " \
      "Interactive mode additionally requires a fresh X-STRATOS-Actor-Authorization person bearer matching the envelope actor; " \
      "historical_batch forbids that header and requires complete approved batch lineage. " \
      "Preflight selects the mode from actor-header presence and complete batch metadata; confirmation preserves the signed mode. " \
      "All identity, scope, policy hash and immutable envelope references must match. " \
      "Preflight returns required_authentication and the canonical Document Intake URL. Confirmation requires the signed token, clean receipt and persisted source."
    operation["security"] = [{ "bearerAuth" => [] }, { "bearerAuth" => [], "stratosActorBearer" => [] }]
    operation["requestBody"] = {
      "required" => true,
      "content" => { "application/json" => { "schema" => { "$ref" => "#/components/schemas/#{schema_prefix}Request" } } }
    }
    success = {
      "description" => preflight ? "Signed upload session; 200 is exact document registration replay, 201 is new registration." : "Confirmed immutable version and activated ingestion; 200 is exact version replay, 201 is a new version.",
      "content" => { "application/json" => { "schema" => { "$ref" => "#/components/schemas/#{schema_prefix}Response" } } }
    }
    if preflight
      success["headers"] = { "Cache-Control" => { "schema" => { "type" => "string", "const" => "private, no-store" } } }
    end
    operation["responses"]["200"] = success
    operation["responses"]["201"] = success
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
      "uploadToken" => { "type" => "apiKey", "in" => "header", "name" => "X-AKL-Upload-Token" },
      "stratosActorBearer" => { "type" => "apiKey", "in" => "header", "name" => "X-STRATOS-Actor-Authorization",
        "description" => "Separate current person credential, including the Bearer prefix; never the service credential." },
      "webSession" => { "type" => "apiKey", "in" => "cookie", "name" => "akl_session",
        "description" => "Opaque AKB browser session. State-changing cookie requests require the configured same-origin checks." },
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

spec["components"]["schemas"].merge!(budget_upload_web_schemas)

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

# Source connector schemas are generated from the actual Registry request models.
source_intake = JSON.parse(File.read(File.join(ROOT, "contracts/stratos/source-document-intake/openapi.json")))
spec["components"]["schemas"].merge!(source_intake.fetch("components").fetch("schemas"))
spec["components"]["securitySchemes"].merge!(source_intake.fetch("components").fetch("securitySchemes"))
source_intake.fetch("paths").each do |path, item|
  raise "Source intake route is missing: #{path}" unless spec["paths"].key?(path)
  spec["paths"][path] = item.merge("servers" => web_servers_for(path))
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
