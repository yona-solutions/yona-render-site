#!/bin/bash
# Quick setup script for local development

echo "Setting up local development environment..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file..."
    echo "GCP_SERVICE_ACCOUNT_KEY=$(cat gcp-service-account-key.json | tr -d '\n')" > .env
    echo "✅ .env file created with GCP credentials"
else
    echo "⚠️  .env file already exists, skipping creation"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the development server:"
echo "  npm start"
echo ""
echo "Then visit: http://localhost:3000"
