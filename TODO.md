# AirwallChat Production Readiness TODO

**Last Updated:** 2025-10-12
**Current Status:** Pre-production cleanup and CI/CD implementation

---

## 🧹 Phase 0: Repository Cleanup & Organization

### 0.1 Remove Unused Files and References ✅ COMPLETED
- [x] **Deleted unused scripts:**
  - `scripts/startup.sh` - Old startup flow (not used)
  - `run-keycloak-config-sync.sh` - Replaced by init-config

- [x] **Reorganized directory structure:**
  ```
  OLD STRUCTURE (messy root):       NEW STRUCTURE (clean):
  /api/                         →   /app/api/
  /client/                      →   /app/client/
  /packages/                    →   /app/packages/
  /Dockerfile                   →   /app/Dockerfile
  /package.json                 →   /app/package.json
  /scripts/                     →   /init-config/scripts/
  /Dockerfile.init-config       →   /init-config/Dockerfile

  STAYED IN ROOT:
  /config/          - Shared configuration
  /keycloak/        - Keycloak service
  /terraform/       - Infrastructure as code
  /nginx/           - Local dev only
  /ssl/             - Local dev only
  /docker-compose.yml - Updated to reference new paths
  ```

- [x] **Updated docker-compose.yml:**
  - `api` service now builds from `./app` context
  - `init-config` service now uses `init-config/Dockerfile`

- [x] **Updated init-config/Dockerfile:**
  - All COPY commands now reference `app/` for application code
  - Scripts referenced from `init-config/scripts/`
  - ✅ Validated with `docker-compose config`

- [x] **Moved airwallconfig.yaml to app/:**
  - Application config file now in `app/airwallconfig.yaml`
  - Path resolution automatically works with new structure

- [x] **Cleaned up .env files:**
  - ❌ Deleted `.env.secrets` (redundant - same content as `.env.local`)
  - ✅ Kept `.env` - Main application config (no secrets)
  - ✅ Kept `.env.example` - Template for `.env`
  - ✅ Kept `.env.local` - Local dev secrets (gitignored via `.env*` pattern)
  - ✅ Kept `.env.local.example` - Template for local secrets
  - Updated `.env` to reference `.env.local` instead of `.env.secrets`
  - **Structure now clear:**
    - `.env` + `.env.local` = complete local dev config
    - AWS uses Secrets Manager (no .env files)

- [x] Remove `rag_api` from `.gitignore` - directory doesn't exist

- [x] **Restored local HTTPS configuration:**
  - ⚠️ REVERTED: Restored HTTPS references (HTTP change was a mistake)
  - ✅ Updated `.env` and `.env.example` to use `https://airwall.local`
  - ✅ Restored port 443 to nginx in `docker-compose.yml`
  - ✅ Restored SSL volume mounts to nginx and keycloak
  - ✅ Restored Keycloak HTTPS URLs
  - ✅ Added `ssl/` to `.gitignore` (self-signed certs are environment-specific)
  - **Note:** `ssl/` directory NOT restored - developers generate their own self-signed certs
  - **Result:** Local dev uses HTTPS with self-signed certs (browser warnings expected and OK)
  - **Production:** AWS ALB handles HTTPS with ACM certificates

- [x] **Fixed .gitignore issues:**
  - ✅ Added `!**/.env.local.example` to unignore pattern (was being ignored incorrectly)
  - ✅ Added `ssl/` to gitignore (self-signed certs shouldn't be committed)

- [ ] **🚨 CRITICAL: Remove secrets from .env file and fix Dockerfile anti-patterns**
  - **Problem 1: Secrets in committed .env file:**
    - `OPENID_CLIENT_SECRET=librechat-secret-123` (line 36) - OAuth client secret
    - `OPENID_SESSION_SECRET=your-session-secret-change-in-production` (line 38) - Session encryption
    - These are hardcoded "dummy" values but still shouldn't be committed

  - **Problem 2: .env.local copied into init-config Docker image:**
    - `init-config/Dockerfile:33` has `COPY .env.local ./keycloak/.env.local`
    - This bakes secrets into the image (VERY BAD - secrets visible in image layers)
    - Image becomes environment-specific instead of portable

  - **Problem 3: app/Dockerfile could copy .env:**
    - `app/Dockerfile:37` has `COPY . .` which would copy any .env in app/
    - Build context is `./app`, so root .env won't be copied (good)
    - But need to ensure no .env exists in app/

  - **Solution:**
    1. Move `OPENID_CLIENT_SECRET` to `.env.local` (gitignored)
    2. Move `OPENID_SESSION_SECRET` to `.env.local` (gitignored)
    3. Update `.env` to have comments showing they should be in .env.local
    4. Fix `init-config/Dockerfile` to NOT copy .env.local
       - Realm generation should happen at runtime, not build time
       - Secrets should be injected via ECS task environment variables (AWS)
       - For local dev, mount .env.local as volume or use docker-compose env_file
    5. Add `.env` to app/.dockerignore to prevent accidental copying
    6. Audit .env for any other secrets

  - **What these secrets do:**
    - `OPENID_CLIENT_SECRET`: Used by LibreChat to authenticate with Keycloak (OAuth2 flow)
    - `OPENID_SESSION_SECRET`: Used to encrypt/sign user session cookies in LibreChat

- [ ] **Remove root `node_modules/` directory:**
  - ⚠️ There's a `node_modules/` at the root level (leftover from pre-reorganization)
  - Should be removed: `rm -rf node_modules/`
  - With Docker, all dependencies are installed inside containers at `/app/node_modules`
  - Local node_modules not needed for Docker-based development

- [ ] Audit and potentially remove Redis dependencies from `package.json` and `api/package.json`
  - File: `app/api/cache/redisClients.js` exists but may be unused
  - Check if LibreChat actually uses Redis for caching

- [x] **Created `docs/LOCAL-DEVELOPMENT.md`:**
  - ✅ Documents local setup vs production
  - ✅ Explains node_modules should NOT exist at root
  - ✅ Documents SSL certificate generation
  - ✅ Documents all local-dev-only files (docker-compose.yml, nginx/, ssl/)
  - ✅ Explains environment file structure

### 0.2 Repository Rename & Remote Update
**Current:** `https://bbogan-ff@github.com/Footbridge-Federal/LibreChat.git`
**Target:** TBD (decide new name/org)

- [ ] Decide on new repository name (e.g., `airwall-chat`, `airwallchat`)
- [ ] Decide on GitHub organization (Airwall vs Footbridge-Federal)
- [ ] Rename repository on GitHub
- [ ] Update git remote:
  ```bash
  git remote set-url origin <new-url>
  git remote -v  # verify
  ```
- [ ] Update any CI/CD configs with new repo URL
- [ ] Update README with new repo references

### 0.3 Documentation Improvements
- [x] Create `docs/LOCAL-DEVELOPMENT.md` ✅ - Documents local setup vs production
- [ ] Create/update `docs/ARCHITECTURE.md` - Explain ECS deployment vs local dev
- [ ] Consolidate Keycloak docs:
  - [ ] Merge `terraform/projects/airwallchat/KEYCLOAK-SETUP.md` and `KEYCLOAK-UPDATES.md`
  - [ ] Create single `docs/KEYCLOAK.md` with clear sections
- [ ] Update main `README.md` with production deployment info
- [ ] Add `docs/TROUBLESHOOTING.md` for common issues

---

## 🔐 Phase 1: Keycloak Production Hardening

### 1.1 Verify Production Mode Configuration
**Status:** ✅ Already using `start` command in ECS (not `start-dev`)
**Location:** `terraform/projects/airwallchat/dev/ecs-services.tf:257`

- [ ] Verify all Keycloak production settings in ECS task definition:
  - [ ] `KC_DB=postgres` ✅ (using external Postgres)
  - [ ] `KC_PROXY_HEADERS=xforwarded` ✅ (behind ALB)
  - [ ] `KC_HOSTNAME_STRICT=false` ⚠️ (should be `true` in prod)
  - [ ] No `KC_DEV_*` flags present ✅
- [ ] Review security settings:
  - [ ] `KC_HOSTNAME_STRICT_HTTPS` - Should be `true` in prod
  - [ ] `sslRequired=external` in realm config ✅
  - [ ] Brute force protection enabled ✅ (in realm-export.json:20)

### 1.2 Keycloak Admin Password Management
**Current:** Stored in AWS Secrets Manager (`keycloak-admin-password`) ✅
**Issue:** Hardcoded as `admin123` in docker-compose.yml (acceptable for local dev)

- [x] Document in `docs/LOCAL-DEVELOPMENT.md` that `admin123` is for local dev only ✅
- [ ] Verify ECS task pulls admin password from Secrets Manager ✅ (already done)
- [ ] Consider rotating Keycloak admin password in Secrets Manager
- [ ] Add to runbook: "How to rotate Keycloak admin password"

### 1.3 Keycloak Database Security
**Current:** Hardcoded password `keycloak123` in both docker-compose and ECS

- [ ] Move Keycloak DB password to AWS Secrets Manager
- [ ] Update `ecs-services.tf` to inject secret:
  ```hcl
  secrets = [
    {
      name      = "KC_DB_PASSWORD"
      valueFrom = module.secrets.secret_arns["keycloak-db-password"]
    }
  ]
  ```
- [ ] Add to `terraform/projects/airwallchat/dev/main.tf` secrets module:
  ```hcl
  keycloak-db-password = {
    description = "Keycloak database password"
    value       = var.keycloak_db_password
  }
  ```
- [ ] Update terraform.tfvars to use strong generated password

---

## 🔑 Phase 2: Externalize Identity Provider Secrets

**Problem:** Azure/Microsoft IdP credentials hardcoded in `keycloak/realm-export.json:177-178`
**Risk:** Secrets visible in git history and ECR images

### 2.1 Update realm-export.json.template
- [ ] Replace hardcoded Azure credentials with environment variables:
  ```json
  {
    "identityProviders": [
      {
        "alias": "microsoft",
        "config": {
          "clientId": "${AZURE_CLIENT_ID}",
          "clientSecret": "${AZURE_CLIENT_ID_SECRET}",
          "tokenUrl": "https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token",
          "issuer": "https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0",
          "jwksUrl": "https://login.microsoftonline.com/${AZURE_TENANT_ID}/discovery/v2.0/keys",
          "authorizationUrl": "https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/authorize",
          "userInfoUrl": "https://graph.microsoft.com/oidc/userinfo"
        }
      }
    ]
  }
  ```

### 2.2 Update generate_realm.sh Script
- [ ] Ensure `generate_realm.sh` uses `envsubst` for Azure variables
- [ ] Verify it sources environment variables from ECS task
- [ ] Test locally with `.env.local` file

### 2.3 Update Dockerfile.init-config
- [ ] Keep multi-stage build structure
- [ ] Ensure realm generation happens at **runtime**, not build time:
  ```dockerfile
  # Don't generate realm in build stage anymore
  # Move to init-config-sync.sh runtime script
  ```

### 2.4 Update init-config-sync.sh
- [ ] Add realm regeneration step at runtime:
  ```bash
  # Step 0: Generate realm with actual secrets
  echo "0️⃣  Generating Keycloak realm with injected secrets..."
  cd /app/keycloak
  ./generate_realm.sh
  cp realm-export.json /config/realm.json
  cd /app
  ```

### 2.5 Update ECS Task Definition
**File:** `terraform/projects/airwallchat/dev/ecs-init-config.tf`

- [ ] Add Azure secrets to init-config task:
  ```hcl
  secrets = [
    {
      name      = "AZURE_CLIENT_ID"
      valueFrom = module.secrets.secret_arns["azure-client-id"]
    },
    {
      name      = "AZURE_CLIENT_ID_SECRET"
      valueFrom = module.secrets.secret_arns["azure-client-id-secret"]
    },
    {
      name      = "AZURE_TENANT_ID"
      valueFrom = module.secrets.secret_arns["azure-tenant-id"]
    }
  ]
  ```

### 2.6 Clean Up Git History (CRITICAL)
- [ ] **Remove hardcoded secrets from git history:**
  ```bash
  # Use BFG Repo Cleaner or git filter-repo
  git filter-repo --path keycloak/realm-export.json --invert-paths
  # OR use BFG:
  # bfg --delete-files realm-export.json
  ```
- [ ] Force push to remote (coordinate with team first!)
- [ ] Rotate exposed Azure credentials in Azure Portal
- [ ] Update secrets in AWS Secrets Manager

---

## 🚀 Phase 3: CI/CD Automation

### 3.1 Create ECR Repository for Init-Config
- [ ] Add to `terraform/projects/airwall-ecr/main.tf`:
  ```hcl
  resource "aws_ecr_repository" "airwallchat_init_config" {
    name                 = "airwallchat-init-config"
    image_tag_mutability = "MUTABLE"
    image_scanning_configuration {
      scan_on_push = true
    }
    encryption_configuration {
      encryption_type = "AES256"
    }
  }
  ```
- [ ] Run terraform apply in airwall-ecr project

### 3.2 GitHub Actions: Config Sync Workflow
**File:** `.github/workflows/sync-config.yml`

- [ ] Create workflow that triggers on:
  - Push to `main` branch affecting:
    - `config/groups.yaml`
    - `keycloak/realm-export.json.template`
    - `Dockerfile.init-config`
    - `scripts/init-config-sync.sh`
  - Manual workflow_dispatch with environment selector
- [ ] Workflow steps:
  1. Build init-config Docker image
  2. Push to ECR with git SHA tag
  3. Get ECS cluster/subnet/SG info
  4. Run init-config ECS task
  5. Wait for task completion
  6. Check exit code and logs
  7. Notify on success/failure

### 3.3 Setup GitHub Secrets
- [ ] `AWS_ACCESS_KEY_ID` - For CI/CD user
- [ ] `AWS_SECRET_ACCESS_KEY` - For CI/CD user
- [ ] `AWS_REGION` - us-east-2

### 3.4 Create CI/CD IAM User
- [ ] Create dedicated IAM user: `github-actions-airwallchat`
- [ ] Attach policies:
  - ECR push (GetAuthorizationToken, BatchCheckLayerAvailability, etc.)
  - ECS run task (RunTask, DescribeTasks, etc.)
  - EC2 describe (for subnet/SG lookup)
  - CloudWatch Logs read (for debugging)
- [ ] Generate access keys
- [ ] Store in GitHub secrets

### 3.5 Update Terraform to Use Latest Init-Config
- [ ] Update `terraform/projects/airwallchat/dev/variables.tf`:
  ```hcl
  variable "init_config_image" {
    description = "Init config container image"
    type        = string
    default     = "<account>.dkr.ecr.us-east-2.amazonaws.com/airwallchat-init-config:latest"
  }
  ```
- [ ] Reference in `ecs-init-config.tf:15`

### 3.6 Test End-to-End
- [ ] Make a test change to `config/groups.yaml`
- [ ] Commit and push to feature branch
- [ ] Merge to main
- [ ] Verify GitHub Action runs
- [ ] Verify init-config task executes
- [ ] Verify Keycloak realm updated
- [ ] Verify LibreChat config synced to MongoDB

---

## 📊 Phase 4: Monitoring & Observability (Optional)

### 4.1 EventBridge Periodic Sync
**File:** `terraform/projects/airwallchat/dev/eventbridge-config-sync.tf`

- [ ] Create EventBridge rule to run init-config every 6 hours
- [ ] Create IAM role for EventBridge to run ECS tasks
- [ ] Test scheduled execution

### 4.2 CloudWatch Alarms
- [ ] Alarm: Init-config task failures
- [ ] Alarm: Keycloak unhealthy for > 5 minutes
- [ ] Alarm: LibreChat unhealthy for > 5 minutes
- [ ] SNS topic for alerts

### 4.3 Logging Improvements
- [ ] Ensure all services log to CloudWatch
- [ ] Create CloudWatch Insights queries:
  - Init-config execution history
  - Keycloak realm sync events
  - LibreChat config sync events
- [ ] Create dashboard showing:
  - Last config sync time
  - Service health
  - Error rates

---

## 📝 Phase 5: Documentation & Runbooks

### 5.1 Runbooks
- [ ] Create `docs/runbooks/UPDATE-CONFIG.md`:
  - How to update group permissions
  - How to add new models
  - How to update IdP configuration
- [ ] Create `docs/runbooks/ROTATE-SECRETS.md`:
  - Keycloak admin password
  - Azure IdP credentials
  - Database passwords
  - API keys
- [ ] Create `docs/runbooks/TROUBLESHOOTING.md`:
  - Config sync failures
  - Keycloak realm issues
  - LibreChat not seeing updated config

### 5.2 Architecture Documentation
- [ ] Document configuration flow:
  ```
  groups.yaml (git) → init-config image → ECS task → MongoDB
  realm-export.json.template (git) → init-config image → ECS task → Keycloak DB
  ```
- [ ] Create architecture diagrams (use Mermaid or diagrams.net)
- [ ] Document secrets management strategy

---

## ✅ Pre-Production Checklist

**Before deploying to production:**

### Security
- [ ] All secrets externalized (no hardcoded credentials)
- [ ] Keycloak in production mode (not dev mode)
- [ ] Strong passwords for all services
- [ ] Secrets rotated after removing from git history
- [ ] SSL/TLS enforced everywhere
- [ ] Security groups properly configured

### Keycloak
- [ ] Realm imported and verified
- [ ] Groups configured correctly
- [ ] IdP (Microsoft/Azure AD) working
- [ ] Test users can log in
- [ ] Group mappings working (e.g., @airwall.ai → /airwall)
- [ ] Admin password secure and documented

### LibreChat
- [ ] Config synced to MongoDB
- [ ] Model access working per group
- [ ] Rate limits enforced
- [ ] API keys loaded from Secrets Manager
- [ ] File uploads working (if enabled)

### CI/CD
- [ ] GitHub Actions workflow tested
- [ ] Manual config sync tested
- [ ] Rollback procedure documented
- [ ] Periodic sync working (if enabled)

### Monitoring
- [ ] CloudWatch logs working
- [ ] Alarms configured
- [ ] Dashboard created
- [ ] On-call rotation defined

### Documentation
- [ ] README updated
- [ ] Runbooks written
- [ ] Architecture documented
- [ ] Team trained on new processes

---

## 🎯 Current Sprint Focus

**Sprint Goal:** Complete Phases 0, 1, and 2

### This Week
- [ ] Phase 0.1: Repository cleanup
- [ ] Phase 0.2: Rename repository
- [ ] Phase 1.2: Document admin password handling
- [ ] Phase 1.3: Move Keycloak DB password to Secrets Manager

### Next Week
- [ ] Phase 2: Complete externalization of Azure IdP secrets
- [ ] Phase 2.6: Clean up git history and rotate secrets
- [ ] Begin Phase 3.1-3.2: ECR repo and GitHub Actions setup

### Following Week
- [ ] Complete Phase 3: Full CI/CD automation
- [ ] Test end-to-end workflow
- [ ] Begin Phase 5: Documentation

---

## 📌 Notes & Decisions

### Key Decisions Made
1. **Local dev vs Production:** Keep docker-compose.yml for local dev, ECS for production
2. **Keycloak mode:** Already using production mode in ECS ✅
3. **Secrets management:** All secrets in AWS Secrets Manager, never in git
4. **Config sync:** Automated via GitHub Actions + init-config ECS task

### Outstanding Questions
1. New repository name? (airwall-chat vs airwallchat vs keep LibreChat?)
2. GitHub organization? (Airwall vs Footbridge-Federal?)
3. Schedule for periodic config sync? (6 hours? Daily? Disabled?)
4. Rotate Azure credentials immediately or after git cleanup?

### Technical Debt
1. 🚨 **Secrets in committed .env file** - OPENID_CLIENT_SECRET and OPENID_SESSION_SECRET
2. 🚨 **.env.local copied into Docker image** - init-config/Dockerfile:33 (anti-pattern)
3. **Root `node_modules/` directory exists** - Should be removed (Docker handles all deps)
4. Redis dependencies still in package.json (unused?)
5. Multiple .md files in terraform/projects/airwallchat/ should be consolidated
6. No automated testing for config sync process

---

## 🔗 Related Documents

- [Local Development Guide](docs/LOCAL-DEVELOPMENT.md) - **START HERE** for local setup
- [CI/CD Plan](terraform/CI-CD-PLAN.md) - Detailed implementation plan
- [Keycloak Setup](terraform/projects/airwallchat/KEYCLOAK-SETUP.md) - Current docs
- [Deployment Guide](terraform/projects/airwallchat/DEPLOYMENT-GUIDE.md) - ECS deployment
- [Main README](README.md) - Project overview

---

**Status Legend:**
- ✅ Completed
- ⚠️ Needs attention
- 🚧 In progress
- ❌ Blocked
