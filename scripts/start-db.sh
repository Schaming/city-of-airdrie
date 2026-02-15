#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting PostgreSQL database...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

# Check if database is already running
if docker ps --format '{{.Names}}' | grep -q '^zoningbylawairdrie$'; then
  echo -e "${GREEN}✓ Database is already running${NC}"
  exit 0
fi

# Start the database
docker-compose -f docker-compose.db.yml up -d

# Wait for database to be healthy
echo "⏳ Waiting for database to be ready..."
timeout=30
counter=0

while [ $counter -lt $timeout ]; do
  if docker-compose -f docker-compose.db.yml ps | grep -q "healthy"; then
    echo -e "${GREEN}✓ Database is ready!${NC}"
    exit 0
  fi
  sleep 1
  counter=$((counter + 1))
done

echo "❌ Database failed to start within ${timeout} seconds"
exit 1
