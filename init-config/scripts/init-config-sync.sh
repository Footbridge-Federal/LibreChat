#!/bin/bash
set -e

echo "🔧 Unified Config Sync for LibreChat + Keycloak"
echo "=============================================="

# Step 1: Wait for MongoDB to be ready
echo ""
echo "1️⃣  Waiting for MongoDB..."
# Extract host from MONGO_URI (format: mongodb://host:port/database)
MONGO_HOST=$(echo $MONGO_URI | sed 's|mongodb://||' | cut -d'/' -f1 | cut -d':' -f1)
MONGO_PORT=$(echo $MONGO_URI | sed 's|mongodb://||' | cut -d'/' -f1 | cut -d':' -f2)
until timeout 2 bash -c "echo > /dev/tcp/${MONGO_HOST}/${MONGO_PORT}" 2>/dev/null; do
  echo "   ⏳ MongoDB not ready, waiting..."
  sleep 3
done
echo "   ✅ MongoDB is ready"

# Step 2: Wait for Keycloak to be ready
echo ""
echo "2️⃣  Waiting for Keycloak..."
until curl -s -o /dev/null -w "%{http_code}" ${KEYCLOAK_URL}/health | grep -q "200\|404"; do
  echo "   ⏳ Keycloak not ready, waiting..."
  sleep 5
done
echo "   ✅ Keycloak is ready"

# Step 3: Sync Keycloak realm configuration FIRST (so realm exists for LibreChat sync)
echo ""
echo "3️⃣  Syncing Keycloak realm configuration..."

# Run keycloak-config-cli to import realm
export IMPORT_PATH=/config
export IMPORT_FORCE=true
# Fully manage identity providers (add/update/remove based on config)
export IMPORT_MANAGED_IDENTITYPROVIDER=full
export IMPORT_MANAGED_IDENTITYPROVIDER_MAPPER=full
# Fully manage clients
export IMPORT_MANAGED_CLIENT=full
export KEYCLOAK_AVAILABILITYCHECK_ENABLED=true
export KEYCLOAK_AVAILABILITYCHECK_TIMEOUT=120s

java -jar /app/keycloak-config-cli.jar || {
  echo "   ❌ Keycloak config sync failed!"
  exit 1
}
echo "   ✅ Keycloak realm synced"

# Step 4: Sync LibreChat config (groups.yaml + keys.json) to MongoDB
echo ""
echo "4️⃣  Syncing LibreChat config to MongoDB..."
cd /app

# If AWS_SECRETS_ENABLED, fetch keys.json from Secrets Manager
if [ "${AWS_SECRETS_ENABLED}" = "true" ]; then
  echo "   📥 Fetching keys.json from AWS Secrets Manager..."
  aws secretsmanager get-secret-value \
    --secret-id ${AWS_SECRET_NAME_KEYS} \
    --query SecretString \
    --output text > /app/config/keys.json
  echo "   ✅ keys.json retrieved from Secrets Manager"
fi

npm run sync:config || {
  echo "   ❌ LibreChat config sync failed!"
  exit 1
}
echo "   ✅ LibreChat config synced to MongoDB"

echo ""
echo "✅ All configuration synced successfully!"
echo "   - LibreChat: groups.yaml + keys.json → MongoDB"
echo "   - Keycloak: realm configuration → Keycloak DB"
