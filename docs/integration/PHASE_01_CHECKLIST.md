# Phase 01 Integration Checklist

## Repository

- [x] Repository structure reviewed
- [x] Service boundaries reviewed
- [x] Shared contracts reviewed

## Infrastructure

- [x] docker compose config passes
- [x] docker compose up starts services
- [x] required volumes are defined
- [x] required networks are defined
- [x] .env.example is complete

## Services

- [x] Document Registry API healthcheck works
- [x] Ingestion Service healthcheck works
- [x] RAG Retrieval Service healthcheck works
- [x] LLM Gateway healthcheck works
- [x] Web Frontend starts
- [x] Evaluation Service healthcheck works if implemented
- [x] Governance Service healthcheck works if implemented

## Contracts

- [x] Document contract reviewed
- [x] DocumentVersion contract reviewed
- [x] DocumentChunk contract reviewed
- [x] RetrievedChunk contract reviewed
- [x] Answer contract reviewed

## Smoke Test

- [x] Document can be created
- [x] Document version can be created
- [x] Ingestion job can be started
- [x] Chunk can be created or mocked
- [x] Retrieval can be executed
- [x] LLM Gateway can be called
- [x] Answer with citation can be returned
- [x] Audit event can be written

## Documentation

- [x] Integration report created
- [x] Open issues listed
- [x] Phase 02 recommendation written
