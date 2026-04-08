#!/bin/bash
# One-command demo runner
# Spins up Grafana, creates service account, runs full test suite, shows results

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   Grafana k6 UI Tester — Demo Environment    ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v docker &>/dev/null; then
  echo -e "${RED}ERROR: Docker is required. Install from https://docs.docker.com/get-docker/${NC}"
  exit 1
fi

if ! command -v k6 &>/dev/null; then
  echo -e "${RED}ERROR: k6 is required. Install: brew install k6${NC}"
  exit 1
fi

COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
  if command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    echo -e "${RED}ERROR: docker compose is required${NC}"
    exit 1
  fi
fi

echo -e "${GREEN}All prerequisites met${NC}"

# Step 1: Build and start Grafana
echo -e "\n${BLUE}[1/5] Building and starting Grafana...${NC}"
$COMPOSE_CMD down -v 2>/dev/null || true
$COMPOSE_CMD build --no-cache
$COMPOSE_CMD up -d

# Step 2: Wait for Grafana to be healthy
echo -e "${BLUE}[2/5] Waiting for Grafana to be healthy...${NC}"
SECONDS_WAITED=0
MAX_WAIT=90

while [ $SECONDS_WAITED -lt $MAX_WAIT ]; do
  if curl -sf http://localhost:3000/api/health >/dev/null 2>&1; then
    echo -e "${GREEN}Grafana is ready! (${SECONDS_WAITED}s)${NC}"
    break
  fi
  sleep 2
  SECONDS_WAITED=$((SECONDS_WAITED + 2))
  printf "."
done

if [ $SECONDS_WAITED -ge $MAX_WAIT ]; then
  echo -e "\n${RED}ERROR: Grafana failed to start within ${MAX_WAIT}s${NC}"
  $COMPOSE_CMD logs
  exit 1
fi

# Brief extra wait for provisioning
sleep 3

# Step 3: Create service account
echo -e "${BLUE}[3/5] Creating service account token...${NC}"
chmod +x demo/setup-service-account.sh
TOKEN=$(GRAFANA_URL=http://localhost:3000 bash demo/setup-service-account.sh | tail -1)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "ERROR" ]; then
  echo -e "${RED}ERROR: Failed to create service account token${NC}"
  exit 1
fi
echo -e "${GREEN}Token obtained${NC}"

# Step 4: Run test suite
echo -e "\n${BLUE}[4/5] Running k6 test suite...${NC}"
echo -e "${YELLOW}This may take 1-3 minutes depending on test level...${NC}\n"

mkdir -p reports/screenshots

export GRAFANA_URL=http://localhost:3000
export GRAFANA_TOKEN="$TOKEN"
export TEST_LEVEL=full
export REPORT_DIR=./reports

chmod +x run.sh
./run.sh --url http://localhost:3000 --token "$TOKEN" --level full || true

# Step 5: Open report
echo -e "\n${BLUE}[5/5] Opening HTML report...${NC}"

if [ -f reports/report.html ]; then
  # Create symlinks for latest
  ln -sf report.html reports/latest-report.html
  ln -sf report.json reports/latest-report.json

  # Open report
  if [[ "$OSTYPE" == "darwin"* ]]; then
    open reports/report.html
  elif command -v xdg-open &>/dev/null; then
    xdg-open reports/report.html
  else
    echo -e "Open ${CYAN}reports/report.html${NC} in your browser"
  fi
fi

echo ""
echo -e "${CYAN}Demo Grafana is running at: http://localhost:3000${NC}"
echo -e "${CYAN}Login: admin / admin${NC}"
echo ""
read -p "Press Enter to tear down the demo environment (or Ctrl+C to keep it running)... "

$COMPOSE_CMD down -v
echo -e "${GREEN}Demo environment cleaned up${NC}"
