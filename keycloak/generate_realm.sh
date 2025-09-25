#!/usr/bin/env bash
set -a
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
. "$SCRIPT_DIR/../.env"
. "$SCRIPT_DIR/../.env.secrets"
set +a
envsubst < "$SCRIPT_DIR/realm-export.json.template" > "$SCRIPT_DIR/realm-export.json"
