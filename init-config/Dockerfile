# Multi-stage init container that syncs config to both LibreChat and Keycloak
FROM node:20-alpine AS librechat-base

# Install dependencies for LibreChat sync
RUN apk add --no-cache bash gettext curl jq

WORKDIR /app

# Copy package files for LibreChat sync
COPY app/package.json app/package-lock.json ./
COPY app/api/package.json ./api/package.json
COPY app/packages/data-provider/package.json ./packages/data-provider/package.json
COPY app/packages/data-schemas/package.json ./packages/data-schemas/package.json
COPY app/packages/api/package.json ./packages/api/package.json

# Install dependencies
RUN npm ci --only=production

# Copy necessary LibreChat code for sync
COPY app/api ./api
COPY app/packages ./packages
COPY init-config/scripts/setup-model-access.js ./scripts/setup-model-access.js

# Copy entire config directory (includes sync scripts and config files)
COPY config ./config

# Stage 2: Add Keycloak realm generation
FROM librechat-base AS config-builder

# Copy keycloak realm generation script and template
COPY keycloak/generate_realm.sh ./keycloak/generate_realm.sh
COPY keycloak/realm-export.json.template ./keycloak/realm-export.json.template
COPY .env.local ./keycloak/.env.local

# Generate Keycloak realm from groups.yaml (already copied in previous stage)
RUN chmod +x ./keycloak/generate_realm.sh && \
    cd keycloak && \
    ./generate_realm.sh

# Stage 3: Final init container with both configs
FROM adorsys/keycloak-config-cli:latest-24.0.1 AS final

# Install modern Node.js for LibreChat sync (uses Debian-based image)
USER root
RUN apt-get update && \
    apt-get install -y curl jq ca-certificates gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy LibreChat sync components
COPY --from=librechat-base /app /app

# Copy generated Keycloak realm
COPY --from=config-builder /app/keycloak/realm-export.json /config/realm.json

# Copy and set up init script
COPY init-config/scripts/init-config-sync.sh /init-config-sync.sh
RUN chmod +x /init-config-sync.sh

WORKDIR /app

# Run the unified init script
ENTRYPOINT ["/init-config-sync.sh"]
