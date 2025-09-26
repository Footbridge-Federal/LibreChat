# Model Access Control System

This document describes the comprehensive model access control system implemented for LibreChat, allowing fine-grained control over which users and groups can access specific AI models.

## Overview

The system provides:
- **User-level permissions**: Individual user access to specific models
- **Group-based permissions**: Organization and role-based model access
- **Live configuration**: Changes take effect immediately without restart
- **API key management**: Both pre-configured and user-provided keys
- **Audit logging**: Complete access logs with usage tracking
- **Keycloak integration**: Seamless SSO with permission sync

## Architecture Components

### 1. Database Schema

Four new collections store the access control data:

- **PolicyRule**: Individual permission rules for admin overrides only
- **PolicyVersion**: Cache invalidation and audit trail
- **UserApiKey**: Encrypted user-provided API keys
- **AccessLog**: Request logs with usage tracking

### 2. Policy Engine

The `PolicyEngine` class resolves effective permissions by:
1. Processing DENY rules (highest priority)
2. Processing admin override ALLOW rules from PolicyRule database
3. Processing Keycloak group attributes with highest-limit-wins merge strategy
4. Applying default DENY for unlisted models

### 3. Key Management

The `KeyVault` class securely manages:
- Pre-configured organization keys (stored encrypted)
- User-provided keys (AES-256-GCM encrypted)
- Key validation and rotation
- Usage tracking and expiration

### 4. Enforcement Middleware

All model API calls go through `enforceModelAccess` middleware that:
- Validates user permissions for the requested model
- Resolves appropriate API credentials
- Applies parameter constraints (max tokens, temperature)
- Logs all access attempts

## Quick Start

### 1. Setup Model Access Control

The model access variables have been added to your existing `.env` and `.env.secrets` files.

**Option A: Use the Setup Script (Recommended)**
```bash
# Interactive setup script that updates your existing files
node scripts/setup-model-access.js
```

This script will:
- Use your existing `.env` and `.env.secrets` files
- Collect and encrypt API keys securely
- Update organization names if needed
- Add encrypted vault entries to `.env.secrets`

**Option B: Manual Configuration**
The model access variables are already in your `.env` file. Just update:
- Organization names (`AIRWALL_ORG_NAME`, `PARTNER_ORG_NAME`)
- Model lists and limits as needed
- Add encrypted `VAULT_GROUP_*` entries to `.env.secrets`

### 2. Generate Keycloak Configuration

Use your existing workflow:

```bash
# Generate realm configuration from template
cd keycloak
./generate_realm.sh
```

This uses your existing pattern:
- Loads `.env` and `.env.secrets`
- Substitutes variables in `realm-export.json.template`
- Creates final `realm-export.json`

### 3. Import and Start

```bash
# Import the generated realm-export.json into Keycloak
# Then start the server - everything initializes automatically
npm run server
```

**That's it!** The server will automatically:
- Create database collections for model access control
- Connect to Keycloak for token validation
- Load permissions directly from JWT token claims (no sync required)

## Usage Examples

### Example 1: Multiple Group Membership with Highest-Limit-Wins

**Scenario**:
- eharmon@airwall.ai belongs to both `/org/airwall` (4000 max tokens) and `/special-projects` (8000 max tokens)
- User gets the highest limits from all their groups
- Same model permissions are merged with highest-limit-wins strategy

**Implementation**:

1. **Set up Keycloak groups** (in realm-export.json):
```json
{
  "name": "org-airwall",
  "path": "/org/airwall",
  "attributes": {
    "models_allow": ["openai/gpt-4o-mini"],
    "max_tokens_per_request": ["4000"]
  }
},
{
  "name": "special-projects",
  "path": "/special-projects",
  "attributes": {
    "models_allow": ["openai/gpt-4o-mini", "anthropic/claude-3.5"],
    "max_tokens_per_request": ["8000"],
    "temperature_max": ["0.8"]
  }
}
```

2. **User membership in both groups**:
- User's token will contain both groups in `groups` claim
- Token will have `group_attributes` with both groups' attributes
- PolicyEngine merges with highest limits: 8000 max tokens, 0.8 temperature_max

3. **Result**:
- User gets access to: `openai/gpt-4o-mini`, `anthropic/claude-3.5`
- Effective limits: 8000 max tokens (higher of 4000 vs 8000)
- Temperature limit: 0.8 (from special-projects group)

### Example 2: Admin Override Policy

**Scenario**: Admin wants to give a specific user access to premium model regardless of group membership

```bash
# Create admin override policy
curl -X POST http://localhost:3080/api/model-access/admin/policies \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_type": "user",
    "subject_id": "eharmon-user-id",
    "resource_type": "model",
    "resource_id": "openai/gpt-4o",
    "effect": "allow",
    "conditions": {
      "max_tokens": 16000,
      "temperature_max": 1.0
    },
    "key_policy": "pre_configured",
    "key_ref": "premium_model_key",
    "description": "Special access for eharmon"
  }'
```

This overrides any group-based permissions and takes precedence.

### Example 3: API Usage

```javascript
// Check what models a user can access
const availableModels = await fetch('/api/model-access/available', {
  headers: { 'Authorization': `Bearer ${userToken}` }
});

// Make a chat request (automatically enforced)
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    endpoint: 'openai',
    messages: [{ role: 'user', content: 'Hello' }],
    max_tokens: 1000
  })
});

// View usage statistics (admin only)
const usage = await fetch('/api/model-access/admin/usage?period=month', {
  headers: { 'Authorization': `Bearer ${adminToken}` }
});
```

## Security Features

### 1. Encryption
- API keys encrypted with AES-256-GCM
- Unique IV per key
- Keys never stored in plaintext
- Memory protection for decrypted keys

### 2. Access Control
- All endpoints require authentication
- Admin endpoints require specific roles
- Rate limiting and request validation
- Parameter constraints enforcement

### 3. Audit Trail
- Every access attempt logged
- Usage tracking with cost calculation
- Policy change versioning
- Failed attempt monitoring

## Live Configuration Changes

Changes to permissions take effect immediately:

1. **Admin creates/updates policy override** → Policy version bumped → Caches invalidated
2. **Keycloak group attributes changed** → Available in next user token (after login/refresh)
3. **User requests model** → Fresh policy computation (with 5-minute cache) → Authorization

No server restarts or database syncing required!

## Monitoring & Alerts

### Usage Dashboard
- Real-time usage statistics
- Cost tracking per user/model
- Rate limit monitoring
- Error rate analysis

### Access Logs
```javascript
// Example log entry
{
  user_id: "123",
  model: "gpt-4o",
  endpoint: "openai",
  tokens_in: 150,
  tokens_out: 300,
  cost_usd: 0.045,
  success: true,
  policy_rule_id: "rule_456",
  credential_source: "pre_configured",
  response_time_ms: 1200
}
```

## Troubleshooting

### Common Issues

1. **User can't access expected model**:
   - Check `/api/model-access/explain?model=X&endpoint=Y`
   - Verify Keycloak group memberships
   - Check policy rule priorities

2. **API key not found**:
   - Verify key_ref exists in vault/environment
   - Check user has provided their own key
   - Validate key_policy settings

3. **Changes not taking effect**:
   - For admin overrides: Check policy version was bumped
   - For group changes: User needs to refresh their token (re-login)
   - Verify cache TTL (5 minutes max)
   - Check for policy conflicts

### Debug Endpoints

```bash
# Explain user access
curl "/api/model-access/explain?model=gpt-4o&endpoint=openai" \
  -H "Authorization: Bearer $USER_TOKEN"

# Admin explain any user
curl -X POST "/api/model-access/admin/policies/explain" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"user_id": "123", "model": "gpt-4o", "endpoint": "openai"}'

# Check user's token claims
curl "/api/model-access/admin/token-info" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## API Reference

### User Endpoints
- `GET /api/model-access/available` - Get user's available models
- `GET /api/model-access/explain` - Explain model access decision
- `GET /api/model-access/keys` - List user's API keys
- `POST /api/model-access/keys` - Store new API key
- `DELETE /api/model-access/keys/:id` - Revoke API key

### Admin Endpoints
- `GET /api/model-access/admin/policies` - List policy rules
- `POST /api/model-access/admin/policies` - Create policy rule
- `PUT /api/model-access/admin/policies/:id` - Update policy rule
- `DELETE /api/model-access/admin/policies/:id` - Delete policy rule
- `POST /api/model-access/admin/policies/explain` - Explain access for any user
- `GET /api/model-access/admin/usage` - Get usage statistics

This system provides the exact functionality you requested: flexible, live-configurable model access control with both organizational and individual permissions, supporting both pre-configured and user-provided API keys.