#!/bin/bash
#
# Build, push, and deploy the feature-flag platform to AWS.
#
# This codifies the one-time-fiddly bits of a first deploy:
#   1. Bootstraps the account/region if CDKToolkit isn't present yet.
#   2. Builds both service images for linux/amd64 (Fargate's arch).
#   3. Starts `cdk deploy` and pushes the images to ECR *as soon as the repos
#      exist* — the stack creates the ECR repos AND the ECS services that pull
#      them, so if the repos are empty when ECS pulls, the services never
#      stabilise and the deploy hangs. Pushing mid-deploy (while RDS/NAT are
#      still being created, ~10 min) wins the race.
#
# Usage:
#   scripts/aws-deploy.sh
#
# Configurable via env vars (defaults shown):
#   AWS_PROFILE=ffp
#   AWS_REGION=eu-north-1
#   ADMIN_EMAIL=admin@example.com   # bootstrap admin user; -c adminEmail
#
# Prereqs: AWS CLI v2 (authenticated profile), Docker running, pnpm.
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-ffp}"
AWS_REGION="${AWS_REGION:-eu-north-1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
export AWS_PROFILE AWS_REGION

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "🔎 Preflight checks..."
docker info >/dev/null 2>&1 || { echo "❌ Docker is not running."; exit 1; }
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)" \
  || { echo "❌ AWS credentials not configured for profile '$AWS_PROFILE'."; exit 1; }
REG="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
echo "   account=$ACCOUNT_ID region=$AWS_REGION profile=$AWS_PROFILE"

# 1. Bootstrap once per account/region.
if ! aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
  echo "🧰 Bootstrapping CDK (CDKToolkit not found)..."
  pnpm --filter @ffp/cdk exec cdk bootstrap "aws://${ACCOUNT_ID}/${AWS_REGION}"
fi

# 2. Build both images for the Fargate architecture.
echo "🐳 Building images (linux/amd64)..."
docker build --platform linux/amd64 -f apps/admin-api/Dockerfile -t ffp/admin-api .
docker build --platform linux/amd64 -f apps/resolver/Dockerfile  -t ffp/resolver .

# 3. Deploy, and push images the moment the ECR repos appear.
echo "🚀 Deploying FfpStack..."
( cd infra/cdk && pnpm exec cdk deploy FfpStack --require-approval never \
    -c adminEmail="$ADMIN_EMAIL" ) &
DEPLOY_PID=$!

echo "⏳ Waiting for ECR repos to be created by the deploy..."
while true; do
  n="$(aws ecr describe-repositories \
        --query "length(repositories[?starts_with(repositoryName,'ffp/')])" \
        --output text 2>/dev/null || echo 0)"
  [ "$n" = "2" ] && break
  if ! kill -0 "$DEPLOY_PID" 2>/dev/null; then
    echo "❌ Deploy exited before ECR repos appeared. See output above."
    wait "$DEPLOY_PID"; exit 1
  fi
  sleep 15
done

echo "📤 Pushing images to ECR..."
aws ecr get-login-password | docker login --username AWS --password-stdin "$REG"
for s in admin-api resolver; do
  docker tag "ffp/${s}:latest" "${REG}/ffp/${s}:latest"
  docker push "${REG}/ffp/${s}:latest"
done

echo "⏳ Waiting for the deploy to finish (ECS will now pull the images)..."
wait "$DEPLOY_PID"

echo ""
echo "✅ Deploy complete. To log in to the admin UI, fetch the bootstrap password:"
echo "   aws secretsmanager get-secret-value --profile $AWS_PROFILE \\"
echo "     --secret-id \"\$(aws cloudformation describe-stack-resources --stack-name FfpStack \\"
echo "       --query \"StackResources[?ResourceType=='AWS::SecretsManager::Secret' && contains(LogicalResourceId,'AdminPassword')].PhysicalResourceId\" \\"
echo "       --output text)\" --query SecretString --output text"
echo "   (admin email: $ADMIN_EMAIL)"
