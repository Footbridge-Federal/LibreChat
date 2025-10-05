#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
GROUPS_YAML="$SCRIPT_DIR/../config/groups.yaml"
TEMPLATE="$SCRIPT_DIR/realm-export.json.template"
OUTPUT="$SCRIPT_DIR/realm-export.json"

# Load environment variables
set -a
if [ -f "$SCRIPT_DIR/.env.local" ]; then
  . "$SCRIPT_DIR/.env.local"
fi
set +a

echo "🔧 Generating realm-export.json from groups.yaml and template..."

# Check if groups.yaml exists
if [ ! -f "$GROUPS_YAML" ]; then
  echo "❌ Error: groups.yaml not found at $GROUPS_YAML"
  exit 1
fi

# Extract group names from groups.yaml using grep and sed
# This looks for lines like "  airwall:" or "  partner:" under the "groups:" section
GROUPS_JSON="["
FIRST=true

# Parse groups from YAML (simple parsing for "groupname:" pattern under groups:)
IN_GROUPS=false
while IFS= read -r line; do
  # Detect when we enter the groups: section
  if [[ "$line" =~ ^groups: ]]; then
    IN_GROUPS=true
    continue
  fi

  # If we're in groups section and line is not indented (new top-level section), exit
  if [[ "$IN_GROUPS" == true ]] && [[ "$line" =~ ^[a-zA-Z] ]] && [[ ! "$line" =~ ^[[:space:]] ]]; then
    break
  fi

  # Match group name (e.g., "  airwall:" or "  partner:")
  if [[ "$IN_GROUPS" == true ]] && [[ "$line" =~ ^[[:space:]]+([a-zA-Z0-9_-]+):$ ]]; then
    GROUP_NAME="${BASH_REMATCH[1]}"

    # Add comma if not first
    if [ "$FIRST" = false ]; then
      GROUPS_JSON="${GROUPS_JSON},"
    fi
    FIRST=false

    # Build JSON object for this group
    GROUPS_JSON="${GROUPS_JSON}{\"name\":\"${GROUP_NAME}\",\"path\":\"/${GROUP_NAME}\",\"attributes\":{},\"subGroups\":[]}"
  fi
done < "$GROUPS_YAML"

GROUPS_JSON="${GROUPS_JSON}]"

echo "✓ Parsed groups from groups.yaml"
echo "  Groups JSON: $GROUPS_JSON"

# Read template
if [ ! -f "$TEMPLATE" ]; then
  echo "❌ Error: Template not found at $TEMPLATE"
  exit 1
fi

TEMPLATE_CONTENT=$(cat "$TEMPLATE")

# Replace __GROUPS_PLACEHOLDER__ with actual groups JSON
TEMPLATE_CONTENT="${TEMPLATE_CONTENT//__GROUPS_PLACEHOLDER__/$GROUPS_JSON}"

# Now substitute environment variables using envsubst
echo "$TEMPLATE_CONTENT" | envsubst > "$OUTPUT"

echo "✓ Generated realm-export.json"
echo "  Template: $TEMPLATE"
echo "  Output: $OUTPUT"
