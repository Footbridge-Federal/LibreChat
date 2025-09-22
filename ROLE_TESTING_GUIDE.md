# Role-Based Access Control Testing Guide

## Quick Test Setup

### 1. Start LibreChat
```bash
docker-compose up -d
```

### 2. Create Test Roles via API

**Create a PREMIUM role with limited model access:**
```bash
curl -X POST http://localhost:3080/api/roles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "name": "PREMIUM",
    "displayName": "Premium User",
    "allowedModels": ["gpt-5", "llama3.2:latest"],
    "allowedEndpoints": ["openAI", "Ollama"],
    "permissions": {
      "WEB_SEARCH": { "USE": true },
      "RUN_CODE": { "USE": true },
      "AGENTS": { "USE": true, "CREATE": true }
    }
  }'
```

**Create a BASIC role with very limited access:**
```bash
curl -X POST http://localhost:3080/api/roles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "name": "BASIC",
    "displayName": "Basic User",
    "allowedModels": ["gpt-5-nano", "llama3.2:latest"],
    "allowedEndpoints": ["Ollama"],
    "permissions": {
      "WEB_SEARCH": { "USE": false },
      "RUN_CODE": { "USE": false },
      "AGENTS": { "USE": false }
    }
  }'
```

### 3. Assign Roles to Users

Connect to your MongoDB and assign roles:
```bash
# Connect to mongo
docker exec -it chat-mongodb mongosh

# Use LibreChat database
use LibreChat

# Create test users with different roles
db.users.updateOne(
  {email: "premium@test.com"},
  {$set: {roles: ["PREMIUM"]}},
  {upsert: false}
)

db.users.updateOne(
  {email: "basic@test.com"},
  {$set: {roles: ["BASIC"]}},
  {upsert: false}
)

# View user roles
db.users.find({}, {email: 1, role: 1, roles: 1})
```

### 4. Test Different User Experiences

| User Type | Available Models | Features |
|-----------|------------------|----------|
| **ADMIN** | All models (11 total) | Web Search ✅, Code Execution ✅, Agents ✅ |
| **PREMIUM** | gpt-5, llama3.2:latest (2 total) | Web Search ✅, Code Execution ✅, Agents ✅ |
| **BASIC** | gpt-5-nano, llama3.2:latest (2 total) | Web Search ❌, Code Execution ❌, Agents ❌ |

### 5. What to Look For

**In the UI as different users:**

1. **Model Dropdown:** Premium users should only see 2 models, Basic users should see 2 different models
2. **Web Search Button:** Should be missing for Basic users
3. **Code Execution:** Should be disabled for Basic users
4. **Agents Tab:** Should be hidden for Basic users
5. **Prompts:** Should be limited based on permissions

### 6. API Endpoints to Test

```bash
# List all roles
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3080/api/roles

# Get specific role
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3080/api/roles/PREMIUM

# Update role status
curl -X PATCH http://localhost:3080/api/roles/BASIC/status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{"isActive": false}'

# Delete custom role
curl -X DELETE http://localhost:3080/api/roles/PREMIUM \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## Expected Behavior

- **PREMIUM users** see limited models but full features
- **BASIC users** see only basic models and limited features
- **ADMIN users** see everything
- Model access is enforced at the API level
- Feature permissions control UI elements

## Troubleshooting

1. **Roles not working?** Check that users have `roles` array set in MongoDB
2. **Models still showing?** The model filtering needs to be integrated with the model loading logic
3. **Features still visible?** The permission system controls backend access, frontend integration needed

This demonstrates the foundation for role-based access control. The next step would be Keycloak integration to manage these roles externally.