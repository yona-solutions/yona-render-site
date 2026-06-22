#!/bin/bash

# Deploy script for Render
# Triggers a new deployment on Render using the API

set -e

# Load environment variables from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep 'RENDER_API_KEY' | xargs)
else
  echo "❌ .env file not found!"
  exit 1
fi

if [ -z "$RENDER_API_KEY" ]; then
  echo "❌ RENDER_API_KEY not found in .env file!"
  exit 1
fi

SERVICE_ID="srv-d5ndl4pr0fns73fh5b4g"

echo "🚀 Triggering deployment to Render..."
echo ""

# Trigger deployment
RESPONSE=$(curl -s -X POST "https://api.render.com/v1/services/${SERVICE_ID}/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache": "do_not_clear"}')

DEPLOY_ID=$(echo $RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); deploy=data.get('deploy', data); print(deploy.get('id', ''))" 2>/dev/null)
STATUS=$(echo $RESPONSE | python3 -c "import sys, json; data=json.load(sys.stdin); deploy=data.get('deploy', data); print(deploy.get('status', 'unknown'))" 2>/dev/null)

if [ -z "$DEPLOY_ID" ]; then
  echo "❌ Failed to trigger deployment"
  echo "$RESPONSE"
  exit 1
fi

echo "✅ Deployment triggered!"
echo "   Deploy ID: $DEPLOY_ID"
echo "   Status: $STATUS"
echo ""
echo "⏳ Monitoring deployment..."
echo ""

# Monitor deployment status
for i in {1..30}; do
  sleep 5
  
  STATUS=$(curl -s "https://api.render.com/v1/services/${SERVICE_ID}/deploys/${DEPLOY_ID}" \
    -H "Authorization: Bearer $RENDER_API_KEY" | \
    python3 -c "import sys, json; data=json.load(sys.stdin); deploy=data.get('deploy', data); print(deploy.get('status', 'unknown'))" 2>/dev/null)
  
  echo "[$(date +%H:%M:%S)] Status: $STATUS"
  
  if [ "$STATUS" = "live" ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo "🌐 Live at: https://yona-render-site.onrender.com"
    exit 0
  elif [ "$STATUS" = "build_failed" ] || [ "$STATUS" = "deactivated" ]; then
    echo ""
    echo "❌ Deployment failed!"
    echo "📊 Dashboard: https://dashboard.render.com/web/${SERVICE_ID}"
    exit 1
  fi
done

echo ""
echo "⏰ Deployment still in progress (taking longer than expected)"
echo "📊 Check status at: https://dashboard.render.com/web/${SERVICE_ID}"
