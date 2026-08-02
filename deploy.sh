#!/usr/bin/env bash
# Build, push, and (re)deploy mysql-user-mgmt to the dev01 EKS cluster.
#
# Prerequisite (parked, not yet done): the ECR repo and IAM role
# (polaris-mysql-user-mgmt) referenced below need to exist first --
# see chart/values.yaml's serviceAccount.annotations and Step 3 of the plan.
set -euo pipefail

APP=mysql-user-mgmt
REGISTRY=592754518446.dkr.ecr.us-west-2.amazonaws.com
TAG=$(date +%Y.%m.%d).$(date +%H%M%S)

aws ecr get-login-password --region us-west-2 --profile infrrd-polaris-shared \
  | docker login --username AWS --password-stdin "$REGISTRY"

docker build -t "$REGISTRY/$APP:$TAG" .
docker push "$REGISTRY/$APP:$TAG"

helm upgrade --install "$APP" ./chart -n devops --kube-context dev01 \
  --set image.repository="$REGISTRY/$APP" \
  --set image.tag="$TAG"

echo "Deployed $APP:$TAG"
