# Keycloak with custom themes
FROM quay.io/keycloak/keycloak:24.0.1

# Copy custom themes
COPY --chown=keycloak:keycloak themes/ /opt/keycloak/themes/

# All realm configuration is managed by keycloak-config-cli
