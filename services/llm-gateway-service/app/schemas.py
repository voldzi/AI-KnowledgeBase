from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MessageRole = Literal["system", "user", "assistant", "tool"]
ProviderName = Literal["mock", "ollama", "openai"]
ModelKind = Literal["chat", "embedding"]


class Usage(BaseModel):
    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    total_tokens: int = Field(default=0, ge=0)


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: MessageRole
    content: str = Field(min_length=1)


class InformationPolicyMetadata(BaseModel):
    model_config = ConfigDict(extra="allow")

    purpose: str | None = None
    policy_binding_id: str | None = None
    policy_binding_ids: list[str] = Field(default_factory=list)
    policy_version: str | None = None
    policy_hash: str | None = None
    policy_hashes: list[str] = Field(default_factory=list)
    handling_class: str | None = None
    legal_classification: str | None = None
    obligations: list[str] = Field(default_factory=list)


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1)
    messages: list[ChatMessage] = Field(min_length=1)
    temperature: float | None = Field(default=None, ge=0, le=2)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, gt=0)
    think: bool | None = None
    stream: bool = False
    metadata: InformationPolicyMetadata = Field(default_factory=InformationPolicyMetadata)


class ChatCompletionResponse(BaseModel):
    id: str
    model: str
    content: str
    finish_reason: str
    usage: Usage
    provider: ProviderName


class ChatCompletionChunk(BaseModel):
    id: str
    model: str
    delta: str
    finish_reason: str | None = None
    provider: ProviderName


class EmbeddingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1)
    input: list[str] = Field(min_length=1)
    dimensions: int | None = Field(default=None, ge=1, le=4096)
    metadata: InformationPolicyMetadata = Field(default_factory=InformationPolicyMetadata)


class EmbeddingItem(BaseModel):
    index: int = Field(ge=0)
    embedding: list[float]


class EmbeddingsResponse(BaseModel):
    model: str
    data: list[EmbeddingItem]
    provider: ProviderName


class ModelInfo(BaseModel):
    model_id: str
    provider: ProviderName
    capabilities: list[str]
    context_window: int | None = Field(default=None, ge=1)


class ModelsResponse(BaseModel):
    models: list[ModelInfo]


class ProviderInfo(BaseModel):
    name: ProviderName
    enabled: bool
    active: bool
    available: bool
    supports_chat: bool
    supports_embeddings: bool
    supports_model_pull: bool = False
    supports_model_delete: bool = False
    base_url: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class ProvidersResponse(BaseModel):
    active_provider: ProviderName
    providers: list[ProviderInfo]


class RecommendedModel(BaseModel):
    name: str
    provider: ProviderName | None = None
    recommended_for: str
    minimum_memory_gb: int | None = Field(default=None, ge=1)


class RecommendedModelsResponse(BaseModel):
    chat_models: list[RecommendedModel]
    embedding_models: list[RecommendedModel]


class ModelPullRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1)
    kind: ModelKind


class ModelPullResponse(BaseModel):
    status: Literal["completed", "started", "unsupported", "disabled"]
    provider: ProviderName
    model: str
    message: str | None = None


class ModelTestChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str | None = Field(default=None, min_length=1)
    prompt: str = Field(min_length=1)
    think: bool | None = None
    max_tokens: int | None = Field(default=None, gt=0)


class ModelTestEmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str | None = Field(default=None, min_length=1)
    input: str = Field(min_length=1)
    dimensions: int | None = Field(default=None, ge=1, le=4096)


class EffectiveConfigResponse(BaseModel):
    service: str
    version: str
    environment: str
    active_provider: ProviderName
    enabled_providers: list[ProviderName]
    default_chat_model: str
    default_embedding_model: str
    default_embedding_dimensions: int | None = None
    default_max_tokens: int
    model_provider_map: dict[str, ProviderName]
    allow_model_pull: bool
    allow_model_delete: bool
    ollama_base_url: str | None
    ollama_base_urls: list[str]
    ollama_think: bool
    openai_base_url: str | None
    openai_api_key_configured: bool


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
