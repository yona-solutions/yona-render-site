#!/bin/bash
# Stop any running servers and restart

echo "🔄 Restarting development server..."

# Kill any node processes running on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

sleep 1

# Start the server
echo "🚀 Starting server..."
npm start

