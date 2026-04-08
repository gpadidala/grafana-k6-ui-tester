#!/bin/bash
# Grafana k6 UI Test Runner
# Usage: ./run.sh --url https://grafana.example.com --token glsa_xxx --level full

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Defaults
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
GRAFANA_TOKEN="${GRAFANA_TOKEN:-}"
TEST_LEVEL="${TEST_LEVEL:-standard}"
REPORT_DIR="${REPORT_DIR:-./reports}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --url) GRAFANA_URL="$2"; shift 2;;
    --token) GRAFANA_TOKEN="$2"; shift 2;;
    --level) TEST_LEVEL="$2"; shift 2;;
    --baseline) BASELINE_REPORT="$2"; shift 2;;
    --report-dir) REPORT_DIR="$2"; shift 2;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

# Load .env if exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Validate
if [ -z "$GRAFANA_URL" ]; then
  echo -e "${RED}ERROR: GRAFANA_URL is required${NC}"
  echo "Usage: ./run.sh --url https://grafana.example.com --token glsa_xxx --level full"
  exit 1
fi

# Create directories
mkdir -p "${REPORT_DIR}/screenshots"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║      Grafana k6 UI Testing Framework         ║"
echo "║              by Gopal Rao                     ║"
echo "╠══════════════════════════════════════════════╣"
echo -e "║  URL:   ${GRAFANA_URL}"
echo -e "║  Level: ${TEST_LEVEL}"
echo -e "║  Auth:  $([ -n "$GRAFANA_TOKEN" ] && echo "Token" || echo "None")"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# Export env vars for k6
export GRAFANA_URL
export GRAFANA_TOKEN
export TEST_LEVEL
export REPORT_DIR
[ -n "$BASELINE_REPORT" ] && export BASELINE_REPORT

# Step 1: Discovery
echo -e "${BLUE}[1/3] Running API discovery...${NC}"
k6 run scripts/discover.js \
  -e GRAFANA_URL="${GRAFANA_URL}" \
  -e GRAFANA_TOKEN="${GRAFANA_TOKEN}" \
  -e TEST_LEVEL="${TEST_LEVEL}" \
  -e REPORT_DIR="${REPORT_DIR}" 2>&1 | tail -20

# Step 2: Run test suite
echo -e "${BLUE}[2/3] Running browser test suite...${NC}"
k6 run scenarios/full-suite.js \
  -e GRAFANA_URL="${GRAFANA_URL}" \
  -e GRAFANA_TOKEN="${GRAFANA_TOKEN}" \
  -e TEST_LEVEL="${TEST_LEVEL}" \
  -e REPORT_DIR="${REPORT_DIR}" \
  ${BASELINE_REPORT:+-e BASELINE_REPORT="${BASELINE_REPORT}"}

# Step 3: Report
echo -e "${BLUE}[3/3] Reports generated${NC}"

if [ -f "${REPORT_DIR}/report.json" ]; then
  # Extract summary from JSON
  TOTAL=$(python3 -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['total'])" 2>/dev/null || echo "?")
  PASSED=$(python3 -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['passed'])" 2>/dev/null || echo "?")
  FAILED=$(python3 -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['failed'])" 2>/dev/null || echo "?")
  WARNINGS=$(python3 -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['warnings'])" 2>/dev/null || echo "?")
  PASS_RATE=$(python3 -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['pass_rate'])" 2>/dev/null || echo "?")

  RATE_NUM=$(echo "$PASS_RATE" | tr -d '%')
  if (( $(echo "$RATE_NUM >= 90" | bc -l 2>/dev/null || echo 0) )); then
    VERDICT="${GREEN}✅ PASSED${NC}"
    EXIT_CODE=0
  else
    VERDICT="${RED}❌ FAILED${NC}"
    EXIT_CODE=1
  fi

  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║       GRAFANA UI TEST RESULTS SUMMARY        ║${NC}"
  echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
  printf "${CYAN}║${NC}  Total Tests:    %-28s${CYAN}║${NC}\n" "$TOTAL"
  printf "${CYAN}║${NC}  ${GREEN}✅ Passed:${NC}      %-28s${CYAN}║${NC}\n" "$PASSED"
  printf "${CYAN}║${NC}  ${RED}❌ Failed:${NC}      %-28s${CYAN}║${NC}\n" "$FAILED"
  printf "${CYAN}║${NC}  ${YELLOW}⚠️  Warnings:${NC}   %-28s${CYAN}║${NC}\n" "$WARNINGS"
  printf "${CYAN}║${NC}  Pass Rate:     %-28s${CYAN}║${NC}\n" "$PASS_RATE"
  echo -e "${CYAN}║${NC}                                              ${CYAN}║${NC}"
  printf "${CYAN}║${NC}  Verdict: %-35b${CYAN}║${NC}\n" "$VERDICT"
  echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  JSON Report: ${REPORT_DIR}/report.json"
  echo -e "  HTML Report: ${REPORT_DIR}/report.html"
  echo ""

  exit ${EXIT_CODE}
else
  echo -e "${YELLOW}No report generated — check test output above${NC}"
  exit 1
fi
