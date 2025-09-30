#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
GROUPS_YAML="$SCRIPT_DIR/../config/groups.yaml"
TEMPLATE="$SCRIPT_DIR/realm-export.json.template"
OUTPUT="$SCRIPT_DIR/realm-export.json"

# Load environment variables
set -a
if [ -f "$SCRIPT_DIR/../.env" ]; then
  . "$SCRIPT_DIR/../.env"
fi
if [ -f "$SCRIPT_DIR/../.env.secrets" ]; then
  . "$SCRIPT_DIR/../.env.secrets"
fi
set +a

echo "🔧 Generating realm-export.json from groups.yaml and template..."

# Check if groups.yaml exists
if [ ! -f "$GROUPS_YAML" ]; then
  echo "❌ Error: groups.yaml not found at $GROUPS_YAML"
  exit 1
fi

# Parse groups.yaml and generate JSON array
# This Node.js script reads groups.yaml and outputs a JSON array of group objects
GROUPS_JSON=$(node -e "
const fs = require('fs');
const yaml = require('js-yaml');

try {
  const content = fs.readFileSync('$GROUPS_YAML', 'utf8');
  const config = yaml.load(content);

  if (!config.groups) {
    console.error('❌ Error: groups.yaml must have \"groups\" key');
    process.exit(1);
  }

  // Convert groups object to Keycloak groups array
  const groups = Object.entries(config.groups).map(([groupName, groupConfig]) => ({
    name: groupName,
    path: \`/\${groupName}\`,
    attributes: {},
    subGroups: []
  }));

  // Output as compact JSON
  console.log(JSON.stringify(groups));
  process.exit(0);
} catch (error) {
  console.error('❌ Error parsing groups.yaml:', error.message);
  process.exit(1);
}
")

# Check if groups parsing succeeded
if [ $? -ne 0 ]; then
  echo "❌ Failed to parse groups from groups.yaml"
  exit 1
fi

echo "✓ Parsed ${groups_count:-0} groups from groups.yaml"

# Read template and replace groups placeholder
TEMPLATE_CONTENT=$(cat "$TEMPLATE")

# Replace __GROUPS_PLACEHOLDER__ with actual groups JSON
# We need to escape the JSON for sed/awk, so we'll use a temp file
TEMP_FILE=$(mktemp)
echo "$TEMPLATE_CONTENT" | sed "s|__GROUPS_PLACEHOLDER__|$GROUPS_JSON|g" > "$TEMP_FILE"

# Now substitute environment variables
envsubst < "$TEMP_FILE" > "$OUTPUT"
rm "$TEMP_FILE"

echo "✓ Generated realm-export.json"
echo "  Groups: $(echo "$GROUPS_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).length)")"
echo "  Template: $TEMPLATE"
echo "  Output: $OUTPUT"
