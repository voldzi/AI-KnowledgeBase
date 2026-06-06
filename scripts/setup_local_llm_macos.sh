#!/usr/bin/env bash
set -euo pipefail

OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
CHAT_MODEL="${AKL_LLM_DEFAULT_CHAT_MODEL:-${AKL_OLLAMA_CHAT_MODEL:-gemma4:12b}}"
EMBEDDING_MODEL="${AKL_LLM_DEFAULT_EMBEDDING_MODEL:-${AKL_OLLAMA_EMBEDDING_MODEL:-bge-m3}}"

echo "AKL local LLM setup for macOS"
echo "Ollama URL: ${OLLAMA_BASE_URL}"
echo "Recommended chat model: ${CHAT_MODEL}"
echo "Recommended embedding model: ${EMBEDDING_MODEL}"
echo

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama CLI is not installed."
  echo "Install Ollama from https://ollama.com/download and start the Ollama app, then rerun this script."
  exit 1
fi

if ! curl -fsS "${OLLAMA_BASE_URL}/api/tags" >/dev/null; then
  echo "Ollama is installed, but ${OLLAMA_BASE_URL} is not reachable."
  echo "Start the Ollama app or run: ollama serve"
  exit 1
fi

echo "OK Ollama is reachable."
echo
echo "The next step can download large model files."
read -r -p "Pull '${CHAT_MODEL}' and '${EMBEDDING_MODEL}' now? [y/N] " answer

case "${answer}" in
  y|Y|yes|YES)
    ollama pull "${CHAT_MODEL}"
    ollama pull "${EMBEDDING_MODEL}"
    ;;
  *)
    echo "Skipping model downloads."
    ;;
esac

cat <<EOF

Use these values in .env for host-native macOS Ollama:

AKL_LLM_DEFAULT_PROVIDER=ollama
AKL_LLM_ENABLED_PROVIDERS=ollama
AKL_LLM_MODEL_PROVIDER_MAP={"${CHAT_MODEL}":"ollama","${EMBEDDING_MODEL}":"ollama"}
AKL_LLM_DEFAULT_CHAT_MODEL=${CHAT_MODEL}
AKL_LLM_DEFAULT_EMBEDDING_MODEL=${EMBEDDING_MODEL}
AKL_LLM_ALLOW_MODEL_PULL=true
AKL_LLM_ALLOW_MODEL_DELETE=false
AKL_OLLAMA_BASE_URL=http://host.docker.internal:11434

For a gateway running directly on the host, use:

AKL_OLLAMA_BASE_URL=${OLLAMA_BASE_URL}
EOF
