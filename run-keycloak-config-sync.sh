#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="us-east-2"
ENVIRONMENT=${1:-dev}

if [ "$ENVIRONMENT" != "dev" ] && [ "$ENVIRONMENT" != "prod" ]; then
  echo -e "${RED}❌ Error: Environment must be 'dev' or 'prod'${NC}"
  echo "Usage: $0 [dev|prod]"
  exit 1
fi

CLUSTER_NAME="airwallchat-${ENVIRONMENT}-cluster"
TASK_DEFINITION="airwallchat-${ENVIRONMENT}-keycloak-config-cli"

echo -e "${GREEN}🔄 Running Keycloak Config Sync${NC}"
echo -e "${YELLOW}Environment: ${ENVIRONMENT}${NC}"
echo -e "${YELLOW}Cluster: ${CLUSTER_NAME}${NC}"
echo -e "${YELLOW}Task: ${TASK_DEFINITION}${NC}"
echo ""

# Get VPC and subnet information from the cluster
echo -e "${YELLOW}📋 Getting network configuration...${NC}"

# Get the first running task from any service to extract network config
RUNNING_TASK=$(aws ecs list-tasks \
  --cluster ${CLUSTER_NAME} \
  --desired-status RUNNING \
  --region ${AWS_REGION} \
  --query 'taskArns[0]' \
  --output text)

if [ -z "$RUNNING_TASK" ] || [ "$RUNNING_TASK" == "None" ]; then
  echo -e "${RED}❌ No running tasks found in cluster. Make sure Keycloak is running first.${NC}"
  exit 1
fi

# Get network configuration from the running task
TASK_DETAILS=$(aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks ${RUNNING_TASK} \
  --region ${AWS_REGION})

SUBNETS=$(echo $TASK_DETAILS | jq -r '.tasks[0].attachments[0].details[] | select(.name=="subnetId") | .value' | tr '\n' ',' | sed 's/,$//')
SECURITY_GROUPS=$(echo $TASK_DETAILS | jq -r '.tasks[0].attachments[0].details[] | select(.name=="networkInterfaceId") | .value' | xargs -I {} aws ec2 describe-network-interfaces --network-interface-ids {} --region ${AWS_REGION} --query 'NetworkInterfaces[0].Groups[].GroupId' --output text | tr '\t' ',')

echo -e "${GREEN}✓ Subnets: ${SUBNETS}${NC}"
echo -e "${GREEN}✓ Security Groups: ${SECURITY_GROUPS}${NC}"

# Run the task
echo -e "${YELLOW}🚀 Starting Keycloak Config CLI task...${NC}"

TASK_ARN=$(aws ecs run-task \
  --cluster ${CLUSTER_NAME} \
  --task-definition ${TASK_DEFINITION} \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SECURITY_GROUPS}],assignPublicIp=DISABLED}" \
  --region ${AWS_REGION} \
  --query 'tasks[0].taskArn' \
  --output text)

if [ -z "$TASK_ARN" ]; then
  echo -e "${RED}❌ Failed to start task${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Task started: ${TASK_ARN}${NC}"
echo ""
echo -e "${YELLOW}⏳ Waiting for task to complete...${NC}"

# Wait for task to stop
aws ecs wait tasks-stopped \
  --cluster ${CLUSTER_NAME} \
  --tasks ${TASK_ARN} \
  --region ${AWS_REGION}

# Get task exit status
TASK_STATUS=$(aws ecs describe-tasks \
  --cluster ${CLUSTER_NAME} \
  --tasks ${TASK_ARN} \
  --region ${AWS_REGION} \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)

echo ""
if [ "$TASK_STATUS" == "0" ]; then
  echo -e "${GREEN}✅ Keycloak configuration sync completed successfully!${NC}"
  echo ""
  echo "View logs:"
  echo "  aws logs tail /ecs/airwallchat-${ENVIRONMENT} --follow --filter-pattern \"keycloak-config-cli\""
  exit 0
else
  echo -e "${RED}❌ Keycloak configuration sync failed with exit code: ${TASK_STATUS}${NC}"
  echo ""
  echo "View logs to see what went wrong:"
  echo "  aws logs tail /ecs/airwallchat-${ENVIRONMENT} --follow --filter-pattern \"keycloak-config-cli\""
  exit 1
fi
