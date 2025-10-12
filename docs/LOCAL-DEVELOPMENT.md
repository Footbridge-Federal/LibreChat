# Local Development Setup

This guide covers setting up AirwallChat for local development.

## Prerequisites

- Docker & Docker Compose
- Git
- A text editor

**Note:** You do NOT need Node.js installed locally. All Node.js dependencies are managed inside Docker containers.

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd LibreChat
   ```

2. **Set up environment files**
   ```bash
   # Copy the local environment template
   cp .env.local.example .env.local

   # Edit .env.local and add your secrets:
   # - JWT_SECRET
   # - JWT_REFRESH_SECRET
   # - KEYCLOAK_ADMIN_PASSWORD
   # - Any API keys you need
   ```

3. **Generate SSL certificates** (for local HTTPS)
   ```bash
   mkdir -p ssl
   cd ssl

   # Generate certificate for nginx/LibreChat
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout librechat.key -out librechat.crt \
     -subj "/C=US/ST=State/L=City/O=Org/CN=airwall.local"

   # Generate certificate for Keycloak
   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
     -keyout keycloak.key -out keycloak.crt \
     -subj "/C=US/ST=State/L=City/O=Org/CN=airwall.local"

   cd ..
   ```

   **Note:** These are self-signed certificates. Your browser will show a security warning (red lock) - this is expected and safe for local development. Just click "Advanced" and "Proceed to airwall.local" to continue.

4. **Add hosts entry**
   ```bash
   # Add this line to /etc/hosts (requires sudo)
   echo "127.0.0.1 airwall.local" | sudo tee -a /etc/hosts
   ```

5. **Start the services**
   ```bash
   docker-compose up --build
   ```

6. **Access the application**
   - LibreChat: https://airwall.local (accept the security warning)
   - Keycloak Admin: https://airwall.local/keycloak
     - Username: `admin`
     - Password: `admin123` (or what you set in .env.local)

## Directory Structure

After the reorganization, the structure is:

```
/
├── app/                    # Main application code (moved from root)
│   ├── api/               # Backend API
│   ├── client/            # Frontend React app
│   ├── packages/          # Shared packages
│   └── Dockerfile         # Main app container
│
├── config/                # Shared configuration files
│   ├── groups.yaml        # Group permissions & model access
│   └── keys.json          # API keys (gitignored)
│
├── init-config/           # Init container for config sync
│   ├── Dockerfile
│   └── scripts/
│
├── keycloak/              # Keycloak configuration
│   ├── Dockerfile
│   ├── realm-export.json.template
│   └── generate_realm.sh
│
├── nginx/                 # Local reverse proxy (LOCAL DEV ONLY)
│   └── nginx.conf
│
├── ssl/                   # Self-signed certs (LOCAL DEV ONLY, gitignored)
│   ├── librechat.key
│   ├── librechat.crt
│   ├── keycloak.key
│   └── keycloak.crt
│
├── terraform/             # AWS infrastructure (PRODUCTION ONLY)
│
├── .env                   # Main config (committed, no secrets)
├── .env.example           # Template for .env
├── .env.local             # Local overrides & secrets (gitignored)
├── .env.local.example     # Template for .env.local
└── docker-compose.yml     # Local dev orchestration (LOCAL DEV ONLY)
```

## Important Notes

### What's Local-Only vs Production

**Local Development Only:**
- `docker-compose.yml` - Not used in AWS
- `nginx/` directory - AWS uses ALB instead
- `ssl/` directory - AWS uses ACM certificates
- `.env.local` - Local secrets only

**Production (AWS/ECS):**
- Infrastructure defined in `terraform/`
- Secrets stored in AWS Secrets Manager
- HTTPS handled by Application Load Balancer (ALB)
- No docker-compose, uses ECS task definitions

### Node Modules

**You should NOT have `node_modules/` at the repository root.**

- All Node.js dependencies are installed inside Docker containers
- `node_modules/` only exists inside the containers at `/app/node_modules`
- If you have a `node_modules/` directory at the root, you can safely delete it:
  ```bash
  rm -rf node_modules/
  ```

This is a leftover from before the reorganization. With the new structure, everything is in `app/` and built inside Docker.

### SSL Certificates

The self-signed certificates in `ssl/` are:
- **Generated locally** by each developer
- **Not committed to git** (ssl/ is in .gitignore)
- **Only for local development** - production uses AWS Certificate Manager

Your browser will show warnings about the self-signed certificates - this is expected. You'll see:
- Red lock icon
- "Your connection is not private" warning
- NET::ERR_CERT_AUTHORITY_INVALID

This is safe for local development. Just click through the warning.

### Environment Files

- `.env` - Main configuration, **committed to git**, contains NO secrets
- `.env.example` - Template showing all available .env options
- `.env.local` - Your local overrides and **secrets**, **gitignored**
- `.env.local.example` - Template showing what goes in .env.local

**Never commit secrets to .env!** All secrets go in `.env.local`.

## Common Tasks

### Rebuilding after code changes
```bash
docker-compose up --build
```

### Viewing logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f keycloak
docker-compose logs -f init-config
```

### Resetting the database
```bash
# Stop services
docker-compose down

# Remove MongoDB data
rm -rf data-node/

# Remove Keycloak DB data
docker volume rm librechat_keycloak_db_data

# Start fresh
docker-compose up --build
```

### Updating group permissions
1. Edit `config/groups.yaml`
2. Restart the init-config container:
   ```bash
   docker-compose restart init-config
   ```
3. The changes will be synced to both Keycloak and MongoDB

### Accessing MongoDB directly
```bash
docker exec -it chat-mongodb mongosh Airwall
```

### Accessing Postgres (Keycloak DB) directly
```bash
docker exec -it keycloak-db psql -U keycloak -d keycloak
```

## Troubleshooting

### "Address already in use" errors
Another service is using port 80 or 443:
```bash
# Find what's using the port
sudo lsof -i :443
sudo lsof -i :80

# Stop the conflicting service or change docker-compose.yml ports
```

### "Can't connect to Keycloak" errors
1. Wait a bit - Keycloak takes 30-60 seconds to start
2. Check logs: `docker-compose logs keycloak`
3. Verify it's healthy: `docker-compose ps`

### Init-config keeps failing
1. Check logs: `docker-compose logs init-config`
2. Ensure MongoDB and Keycloak are running:
   ```bash
   docker-compose ps
   ```
3. Try rebuilding:
   ```bash
   docker-compose up --build init-config
   ```

### Browser won't connect to https://airwall.local
1. Verify the hosts entry: `cat /etc/hosts | grep airwall.local`
2. Check nginx is running: `docker-compose ps nginx`
3. Verify SSL certs exist: `ls -la ssl/`
4. Accept the browser security warning

## Architecture

```
Browser (https://airwall.local)
  ↓
Nginx (reverse proxy)
  ↓
  ├─→ /keycloak/* → Keycloak (port 8080)
  └─→ /* → LibreChat API (port 3080)
         ↓
         ├─→ MongoDB (port 27017)
         └─→ Keycloak (for auth)

Init-config container (runs once on startup):
  ├─→ Syncs config/groups.yaml to Keycloak
  └─→ Syncs config to MongoDB
```

## Next Steps

- [TODO.md](../TODO.md) - Current development tasks
- [terraform/](../terraform/) - Production infrastructure
- [config/groups.yaml](../config/groups.yaml) - Group permissions configuration
