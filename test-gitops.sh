#!/bin/bash

##############################################################################
# GitOps Testing Script
#
# This script automates the testing scenario to quickly verify the complete
# GitOps configuration workflow.
#
# Usage:
#   ./test-gitops.sh                    # Full test
#   ./test-gitops.sh --setup-only       # Just setup, no test users
#   ./test-gitops.sh --sync-only        # Just sync configs
##############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
SETUP_ONLY=false
SYNC_ONLY=false

for arg in "$@"; do
  case $arg in
    --setup-only) SETUP_ONLY=true ;;
    --sync-only) SYNC_ONLY=true ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --setup-only    Just setup configs, don't add test users"
      echo "  --sync-only     Just sync configs to database"
      echo "  --help          Show this help"
      exit 0
      ;;
  esac
done

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}GitOps Configuration Test${NC}"
echo -e "${BLUE}================================${NC}"
echo

# Step 5: Copy config files to container
echo -e "${YELLOW}[5/8] Copying configuration files to container...${NC}"

docker cp config/keys.json Airwall:/app/config/keys.json
docker cp config/groups.yaml Airwall:/app/config/groups.yaml

echo -e "${GREEN}✓ Files copied${NC}"
echo

# Step 6: Sync configurations
echo -e "${YELLOW}[6/8] Syncing configurations to database...${NC}"

docker exec Airwall npm run sync:config

echo -e "${GREEN}✓ Configuration synced${NC}"
echo

if [ "$SYNC_ONLY" = true ]; then
  echo -e "${GREEN}✓ Sync complete! (--sync-only)${NC}"
  exit 0
fi

# Step 7: Verify database
echo -e "${YELLOW}[7/8] Verifying database...${NC}"

# Check model access rules
MODEL_COUNT=$(docker exec -it chat-mongodb mongosh Airwall --quiet --eval "db.modelaccesses.countDocuments({ configSource: 'git' })" | tr -d '\r')
echo "Model access rules: ${MODEL_COUNT}"

# Check API keys
KEY_COUNT=$(docker exec -it chat-mongodb mongosh Airwall --quiet --eval "db.groupapikeys.countDocuments({ source: 'git', isActive: true })" | tr -d '\r')
echo "API keys (encrypted): ${KEY_COUNT}"

if [ "$MODEL_COUNT" -eq "0" ] || [ "$KEY_COUNT" -eq "0" ]; then
  echo -e "${YELLOW}⚠️  Warning: Some configs may not have synced properly${NC}"
else
  echo -e "${GREEN}✓ Database verified${NC}"
fi
echo

# Step 8: Display access information
echo -e "${YELLOW}[8/8] Setup complete!${NC}"
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ GitOps Configuration Test Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "${BLUE}Access Information:${NC}"
echo
echo -e "  ${YELLOW}Application:${NC}"
echo -e "    URL: ${GREEN}https://airwall.local${NC}"
echo
echo -e "  ${YELLOW}Test Users:${NC}"
echo -e "    Admin (full access):"
echo -e "      Email: ${GREEN}admin@airwall.local${NC}"
echo -e "      Password: ${GREEN}admin123${NC}"
echo -e "      Models: ${GREEN}gpt-4o-mini, claude-3.5${NC}"
echo
echo -e "    Premium (from realm-export):"
echo -e "      Email: ${GREEN}premium@airwall.local${NC}"
echo -e "      Password: ${GREEN}premium123${NC}"
echo
echo -e "  ${YELLOW}Keycloak Admin:${NC}"
echo -e "    URL: ${GREEN}https://airwall.local/keycloak/admin${NC}"
echo -e "    Username: ${GREEN}admin${NC}"
echo -e "    Password: ${GREEN}admin123${NC}"
echo
echo -e "${BLUE}Next Steps:${NC}"
echo
echo "  1. Test login as admin@airwall.local"
echo "     - Should see gpt-4o-mini and claude-3.5"
echo
echo "  2. Add test users in Keycloak:"
echo "     - Create 'demo@example.com' in /org-demo group"
echo "     - Create 'free@example.com' in /org-free group"
echo
echo "  3. Test configuration changes:"
echo "     - Edit config/groups.yaml"
echo "     - Run: docker exec Airwall npm run sync:config"
echo "     - Changes apply immediately (no restart!)"
echo
echo "  4. Monitor logs:"
echo "     - docker exec Airwall tail -f /app/api/logs/combined.log | grep KeyVault"
echo
echo -e "${BLUE}Useful Commands:${NC}"
echo
echo "  # Sync configs"
echo "  docker exec Airwall npm run sync:config"
echo
echo "  # Check database"
echo "  docker exec -it chat-mongodb mongosh Airwall"
echo
echo "  # Watch logs"
echo "  docker exec Airwall tail -f /app/api/logs/combined.log"
echo
echo "  # Restart services"
echo "  docker-compose restart"
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "For detailed testing steps, see: ${BLUE}TESTING_SCENARIO.md${NC}"
echo