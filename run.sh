#!/bin/bash
# Grafana k6 UI Test Runner
# Works on macOS, Linux, and Windows (Git Bash / WSL)
# Usage: ./run.sh --url https://grafana.example.com --token glsa_xxx --level full
#    or: create a .env file and just run ./run.sh

set -e

# Colors (safe for Git Bash)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Load .env file first (so CLI flags can override) ───
if [ -f .env ]; then
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    [[ "$key" =~ ^#.* ]] && continue
    [[ -z "$key" ]] && continue
    # Remove surrounding quotes from value
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    export "$key=$value"
  done < <(grep -v '^\s*$' .env | grep -v '^\s*#')
fi

# Defaults (env vars from .env take priority, then these defaults)
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
GRAFANA_TOKEN="${GRAFANA_TOKEN:-}"
TEST_LEVEL="${TEST_LEVEL:-standard}"
REPORT_DIR="${REPORT_DIR:-./reports}"

# Parse CLI arguments (override .env and defaults)
while [[ $# -gt 0 ]]; do
  case $1 in
    --url) GRAFANA_URL="$2"; shift 2;;
    --token) GRAFANA_TOKEN="$2"; shift 2;;
    --level) TEST_LEVEL="$2"; shift 2;;
    --baseline) BASELINE_REPORT="$2"; shift 2;;
    --report-dir) REPORT_DIR="$2"; shift 2;;
    --help|-h)
      echo "Usage: ./run.sh [options]"
      echo ""
      echo "Options:"
      echo "  --url <url>        Grafana URL (or set GRAFANA_URL in .env)"
      echo "  --token <token>    Service account token (or set GRAFANA_TOKEN in .env)"
      echo "  --level <level>    Test level: smoke | standard | full (default: standard)"
      echo "  --baseline <file>  Path to baseline report.json for comparison"
      echo "  --report-dir <dir> Output directory (default: ./reports)"
      echo ""
      echo "Tip: Create a .env file to avoid passing --url and --token every time:"
      echo "  cp .env.example .env && nano .env"
      exit 0;;
    *) echo "Unknown option: $1. Use --help for usage."; exit 1;;
  esac
done

# ─── Find k6 binary ───
K6_CMD=""
if command -v k6 &>/dev/null; then
  K6_CMD="k6"
elif [ -f "$HOME/k6/k6.exe" ]; then
  # Windows portable install
  K6_CMD="$HOME/k6/k6.exe"
elif [ -f "$HOME/k6/k6" ]; then
  K6_CMD="$HOME/k6/k6"
elif [ -f "$USERPROFILE/k6/k6.exe" ] 2>/dev/null; then
  K6_CMD="$USERPROFILE/k6/k6.exe"
fi

if [ -z "$K6_CMD" ]; then
  echo -e "${RED}ERROR: k6 not found.${NC}"
  echo ""
  echo "Install k6:"
  echo "  macOS:   brew install k6"
  echo "  Linux:   https://grafana.com/docs/k6/latest/set-up/install-k6/"
  echo "  Windows (no admin):"
  echo "    mkdir -p ~/k6"
  echo "    curl -sL https://github.com/grafana/k6/releases/download/v0.56.0/k6-v0.56.0-windows-amd64.zip -o ~/k6/k6.zip"
  echo "    cd ~/k6 && unzip k6.zip && mv k6-v0.56.0-windows-amd64/k6.exe ."
  echo "    export PATH=\"\$HOME/k6:\$PATH\""
  exit 1
fi

# ─── Find python (python3 or python — Windows Git Bash often only has python) ───
PY_CMD=""
if command -v python3 &>/dev/null; then
  PY_CMD="python3"
elif command -v python &>/dev/null; then
  PY_CMD="python"
fi

# Validate
if [ -z "$GRAFANA_URL" ]; then
  echo -e "${RED}ERROR: GRAFANA_URL is required${NC}"
  echo "Usage: ./run.sh --url https://grafana.example.com --token glsa_xxx --level full"
  echo "   or: set GRAFANA_URL in .env file"
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
echo -e "║  k6:    ${K6_CMD}"
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
"$K6_CMD" run scripts/discover.js \
  -e GRAFANA_URL="${GRAFANA_URL}" \
  -e GRAFANA_TOKEN="${GRAFANA_TOKEN}" \
  -e TEST_LEVEL="${TEST_LEVEL}" \
  -e REPORT_DIR="${REPORT_DIR}" 2>&1 | tail -20

# Step 2: Run test suite
echo -e "${BLUE}[2/3] Running browser test suite...${NC}"
"$K6_CMD" run scenarios/full-suite.js \
  -e GRAFANA_URL="${GRAFANA_URL}" \
  -e GRAFANA_TOKEN="${GRAFANA_TOKEN}" \
  -e TEST_LEVEL="${TEST_LEVEL}" \
  -e REPORT_DIR="${REPORT_DIR}" \
  ${BASELINE_REPORT:+-e BASELINE_REPORT="${BASELINE_REPORT}"}

# Step 3: Report
echo -e "${BLUE}[3/3] Reports generated${NC}"

if [ -f "${REPORT_DIR}/report.json" ]; then
  if [ -n "$PY_CMD" ]; then
    # Extract summary using python
    TOTAL=$("$PY_CMD" -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['total'])" 2>/dev/null || echo "?")
    PASSED=$("$PY_CMD" -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['passed'])" 2>/dev/null || echo "?")
    FAILED=$("$PY_CMD" -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['failed'])" 2>/dev/null || echo "?")
    WARNINGS=$("$PY_CMD" -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['warnings'])" 2>/dev/null || echo "?")
    PASS_RATE=$("$PY_CMD" -c "import json; r=json.load(open('${REPORT_DIR}/report.json')); print(r['summary']['pass_rate'])" 2>/dev/null || echo "?")
  else
    # Fallback: parse JSON with grep (no python available)
    TOTAL=$(grep -o '"total":[0-9]*' "${REPORT_DIR}/report.json" | head -1 | cut -d: -f2)
    PASSED=$(grep -o '"passed":[0-9]*' "${REPORT_DIR}/report.json" | head -1 | cut -d: -f2)
    FAILED=$(grep -o '"failed":[0-9]*' "${REPORT_DIR}/report.json" | head -1 | cut -d: -f2)
    WARNINGS=$(grep -o '"warnings":[0-9]*' "${REPORT_DIR}/report.json" | head -1 | cut -d: -f2)
    PASS_RATE=$(grep -o '"pass_rate":"[^"]*"' "${REPORT_DIR}/report.json" | head -1 | cut -d'"' -f4)
  fi

  # Determine verdict (works without bc)
  RATE_NUM=$(echo "$PASS_RATE" | tr -d '%')
  EXIT_CODE=1
  VERDICT="${RED}FAILED${NC}"
  if [ -n "$RATE_NUM" ] && [ "$RATE_NUM" != "?" ]; then
    # Integer comparison (works in Git Bash without bc)
    RATE_INT=${RATE_NUM%%.*}
    if [ "${RATE_INT:-0}" -ge 90 ] 2>/dev/null; then
      VERDICT="${GREEN}PASSED${NC}"
      EXIT_CODE=0
    fi
  fi

  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║       GRAFANA UI TEST RESULTS SUMMARY        ║${NC}"
  echo -e "${CYAN}╠══════════════════════════════════════════════╣${NC}"
  printf "${CYAN}║${NC}  Total Tests:    %-28s${CYAN}║${NC}\n" "$TOTAL"
  printf "${CYAN}║${NC}  Passed:         %-28s${CYAN}║${NC}\n" "$PASSED"
  printf "${CYAN}║${NC}  Failed:         %-28s${CYAN}║${NC}\n" "$FAILED"
  printf "${CYAN}║${NC}  Warnings:       %-28s${CYAN}║${NC}\n" "$WARNINGS"
  printf "${CYAN}║${NC}  Pass Rate:      %-28s${CYAN}║${NC}\n" "$PASS_RATE"
  echo -e "${CYAN}║${NC}                                              ${CYAN}║${NC}"
  printf "${CYAN}║${NC}  Verdict:        %-35b${CYAN}║${NC}\n" "$VERDICT"
  echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  JSON Report: ${REPORT_DIR}/report.json"
  echo -e "  HTML Report: ${REPORT_DIR}/report.html"
  echo ""

  # Open report (cross-platform)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    open "${REPORT_DIR}/report.html" 2>/dev/null || true
  elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    start "${REPORT_DIR}/report.html" 2>/dev/null || explorer.exe "${REPORT_DIR}/report.html" 2>/dev/null || true
  elif command -v xdg-open &>/dev/null; then
    xdg-open "${REPORT_DIR}/report.html" 2>/dev/null || true
  fi

  exit ${EXIT_CODE}
else
  echo -e "${YELLOW}No report generated — check test output above${NC}"
  exit 1
fi
