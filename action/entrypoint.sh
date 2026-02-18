#!/usr/bin/env bash
set -euo pipefail

# Build CLI args
ARGS=("${INPUT_COMMAND}")

if [[ -n "${INPUT_PLAN_FILE:-}" ]]; then
  ARGS+=("--plan" "${INPUT_PLAN_FILE}")
elif [[ -n "${INPUT_PROMPT:-}" ]]; then
  ARGS+=("${INPUT_PROMPT}")
fi

if [[ "${INPUT_RESUME}" == "true" ]]; then
  ARGS+=("--resume")
fi

if [[ -n "${INPUT_SESSION:-}" ]]; then
  ARGS+=("--session" "${INPUT_SESSION}")
fi

if [[ -n "${INPUT_RUN_ID:-}" ]]; then
  ARGS+=("--run" "${INPUT_RUN_ID}")
fi

if [[ "${INPUT_VERBOSE}" == "true" ]]; then
  ARGS+=("--verbose")
fi

# Export model overrides as env vars
if [[ -n "${INPUT_PRIMARY_MODEL:-}" ]]; then
  export PRIMARY_MODEL="${INPUT_PRIMARY_MODEL}"
fi

if [[ -n "${INPUT_REVIEW_MODEL:-}" ]]; then
  export REVIEW_MODEL="${INPUT_REVIEW_MODEL}"
fi

# TUI is always disabled in CI (no TTY), but be explicit
ARGS+=("--no-tui")

echo "::group::Copilot Swarm — ${INPUT_COMMAND}"
echo "Running: npx @copilot-swarm/core@${INPUT_VERSION} ${ARGS[*]}"

npx "@copilot-swarm/core@${INPUT_VERSION}" "${ARGS[@]}"

echo "::endgroup::"

# Set outputs
echo "output-dir=.swarm" >> "$GITHUB_OUTPUT"

# Extract run ID from the latest pointer if it exists
if [[ -f .swarm/latest ]]; then
  echo "run-id=$(cat .swarm/latest)" >> "$GITHUB_OUTPUT"
elif [[ -f .swarm/sessions/*/latest ]]; then
  # shellcheck disable=SC2012
  LATEST_FILE=$(ls .swarm/sessions/*/latest 2>/dev/null | head -1)
  if [[ -n "${LATEST_FILE}" ]]; then
    echo "run-id=$(cat "${LATEST_FILE}")" >> "$GITHUB_OUTPUT"
  fi
fi
