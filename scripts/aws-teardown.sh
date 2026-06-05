#!/bin/bash
#
# Tear down the feature-flag platform from AWS.
#
# Deletes FfpStack, then the resources it intentionally RETAINs on delete (the
# two ECR repos and the admin-UI S3 bucket) — these survive a plain stack delete
# and otherwise (a) keep costing money and (b) block a future deploy with
# "already exists". The CDK bootstrap stack is left alone unless --bootstrap is
# passed (it's reusable and near-free).
#
# Usage:
#   scripts/aws-teardown.sh              # delete FfpStack + its retained resources
#   scripts/aws-teardown.sh --bootstrap  # also delete CDKToolkit + its staging bucket
#
# Configurable via env vars (defaults shown):
#   AWS_PROFILE=ffp
#   AWS_REGION=eu-north-1
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-ffp}"
AWS_REGION="${AWS_REGION:-eu-north-1}"
export AWS_PROFILE AWS_REGION
WITH_BOOTSTRAP=0
[ "${1:-}" = "--bootstrap" ] && WITH_BOOTSTRAP=1

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"

# Empty a versioned bucket (delete every object version + delete-marker), then
# remove it. Plain `s3 rb --force` leaves versions behind on versioned buckets.
purge_bucket() {
  local b="$1"
  aws s3api head-bucket --bucket "$b" >/dev/null 2>&1 || return 0
  echo "   purging s3://$b"
  while true; do
    local payload
    payload="$(aws s3api list-object-versions --bucket "$b" --max-items 500 --output json 2>/dev/null \
      | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: print(""); sys.exit()
objs=[{"Key":o["Key"],"VersionId":o["VersionId"]} for o in (d.get("Versions") or [])+(d.get("DeleteMarkers") or [])]
print(json.dumps({"Objects":objs,"Quiet":True}) if objs else "")')"
    [ -z "$payload" ] && break
    printf '%s' "$payload" | aws s3api delete-objects --bucket "$b" --delete file:///dev/stdin >/dev/null 2>&1
  done
  aws s3 rb "s3://$b" >/dev/null 2>&1 || true
}

echo "🗑️  Deleting FfpStack..."
if aws cloudformation describe-stacks --stack-name FfpStack >/dev/null 2>&1; then
  aws cloudformation delete-stack --stack-name FfpStack
  echo "   waiting for delete to complete (RDS/NAT teardown is slow)..."
  aws cloudformation wait stack-delete-complete --stack-name FfpStack
fi

echo "🧹 Removing RETAINed resources that survive the stack delete..."
for s in admin-api resolver; do
  aws ecr delete-repository --repository-name "ffp/${s}" --force >/dev/null 2>&1 \
    && echo "   deleted ECR ffp/${s}" || true
done
for b in $(aws s3api list-buckets \
    --query "Buckets[?contains(Name,'ffpstack') || contains(Name,'adminui')].Name" \
    --output text 2>/dev/null); do
  purge_bucket "$b"
done

if [ "$WITH_BOOTSTRAP" = "1" ]; then
  echo "🧰 Removing CDK bootstrap (CDKToolkit)..."
  purge_bucket "cdk-hnb659fds-assets-${ACCOUNT_ID}-${AWS_REGION}"
  for r in $(aws ecr describe-repositories \
      --query "repositories[?starts_with(repositoryName,'cdk-')].repositoryName" \
      --output text 2>/dev/null); do
    aws ecr delete-repository --repository-name "$r" --force >/dev/null 2>&1 || true
  done
  if aws cloudformation describe-stacks --stack-name CDKToolkit >/dev/null 2>&1; then
    aws cloudformation delete-stack --stack-name CDKToolkit
    aws cloudformation wait stack-delete-complete --stack-name CDKToolkit
  fi
fi

echo ""
echo "✅ Teardown complete. Leftover sweep:"
echo -n "   stacks: "; aws cloudformation list-stacks \
  --query "StackSummaries[?StackStatus!='DELETE_COMPLETE'].StackName" --output text
echo -n "   ffp/cdk buckets: "; aws s3api list-buckets \
  --query "Buckets[?starts_with(Name,'cdk-') || contains(Name,'ffpstack')].Name" --output text
echo -n "   ecr repos: "; aws ecr describe-repositories \
  --query "repositories[].repositoryName" --output text 2>/dev/null || echo "(none)"
