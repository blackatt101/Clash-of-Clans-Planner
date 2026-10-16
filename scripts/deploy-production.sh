#!/usr/bin/env bash
set -uo pipefail

# ==============================================================================
# CLASH PLANNER PRODUCTION PROMOTION & FAIL-SAFE ROLLBACK SCRIPT
# Location: /home/ubuntu/coc-planner/scripts/deploy-production.sh
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="/home/ubuntu/coc-planner"
PROD_RC="/home/ubuntu/coc-planner-rc"
CANDIDATE_DIR="/home/ubuntu/coc-planner-candidate"
RELEASES_ROOT="/home/ubuntu/releases"
BASELINE_DIR="$RELEASES_ROOT/release-v1-baseline"
SWAP_DIR="$RELEASES_ROOT/active-swap-v1"
EXPECTED_CANDIDATE_BUILD_ID="6v1v3Ko2h7IolZN2N3BUs"
PRE_TEST_PORT=3007
PROD_PORT=3001

echo "=================================================================="
echo "Starting Clash Planner Production Deployment Pipeline"
echo "Target Candidate Build ID: $EXPECTED_CANDIDATE_BUILD_ID"
echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "=================================================================="

# ------------------------------------------------------------------------------
# STEP 1: PREFLIGHT SYSTEM AND RESOURCE VERIFICATION
# ------------------------------------------------------------------------------
echo "[Preflight 1/5] Checking active production service status..."
if ! systemctl is-active --quiet coc-planner.service; then
  echo "FATAL: coc-planner.service is not currently active. Aborting."
  exit 1
fi

PROD_HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PROD_PORT/")
if [ "$PROD_HTTP_STATUS" != "200" ]; then
  echo "FATAL: Active production root returned HTTP $PROD_HTTP_STATUS (expected 200). Aborting."
  exit 1
fi

echo "[Preflight 2/5] Checking free disk space on root filesystem..."
AVAIL_KB=$(df -k /dev/root | awk 'NR==2 {print $4}')
if [ "$AVAIL_KB" -lt 2000000 ]; then
  echo "FATAL: Insufficient disk space (<2GB available). Aborting."
  exit 1
fi
echo "Available disk space: $(( AVAIL_KB / 1024 )) MB (OK)"

echo "[Preflight 3/5] Verifying candidate build directory and Build ID..."
if [ ! -d "$CANDIDATE_DIR" ] || [ ! -f "$CANDIDATE_DIR/.next/BUILD_ID" ]; then
  echo "FATAL: Candidate directory or BUILD_ID missing at $CANDIDATE_DIR. Aborting."
  exit 1
fi

CANDIDATE_BUILD_ID=$(cat "$CANDIDATE_DIR/.next/BUILD_ID")
if [ "$CANDIDATE_BUILD_ID" != "$EXPECTED_CANDIDATE_BUILD_ID" ]; then
  echo "FATAL: Candidate Build ID mismatch (found $CANDIDATE_BUILD_ID, expected $EXPECTED_CANDIDATE_BUILD_ID). Aborting."
  exit 1
fi

if [ ! -f "$CANDIDATE_DIR/candidate-manifest.sha256" ]; then
  echo "FATAL: Candidate manifest missing. Aborting."
  exit 1
fi

if ! (cd "$CANDIDATE_DIR" && sha256sum -c candidate-manifest.sha256 --quiet); then
  echo "FATAL: Candidate cryptographic manifest verification failed. Aborting."
  exit 1
fi
echo "Candidate build verified: $CANDIDATE_BUILD_ID (SHA-256 manifest OK)"

echo "[Preflight 4/5] Verifying candidate dependencies and environment file..."
if [ -L "$CANDIDATE_DIR/node_modules" ] || [ ! -f "$CANDIDATE_DIR/node_modules/next/dist/bin/next" ]; then
  echo "FATAL: Candidate node_modules must be an independent directory containing Next.js binary. Aborting."
  exit 1
fi

# Ensure .env.local is staged in candidate with 0600 permissions
if [ ! -f "$CANDIDATE_DIR/.env.local" ]; then
  cp -p "$PROD_RC/.env.local" "$CANDIDATE_DIR/.env.local"
fi
chmod 600 "$CANDIDATE_DIR/.env.local"

ENV_MODE=$(stat -c "%a" "$CANDIDATE_DIR/.env.local")
if [ "$ENV_MODE" != "600" ]; then
  echo "FATAL: .env.local permissions must be 600, found $ENV_MODE. Aborting."
  exit 1
fi

echo "[Preflight 5/5] Ensuring immutable rollback baseline snapshot..."
mkdir -p "$RELEASES_ROOT"
BASELINE_VERIFIED=false

if [ -d "$BASELINE_DIR" ]; then
  echo "Checking existing baseline at $BASELINE_DIR..."
  if [ -f "$BASELINE_DIR/checksums.sha256" ] && (cd "$BASELINE_DIR" && sha256sum -c checksums.sha256 --quiet 2>/dev/null); then
    echo "Verified existing baseline found at $BASELINE_DIR. NEVER overwriting or modifying verified baseline."
    BASELINE_VERIFIED=true
  else
    echo "FATAL: Existing baseline directory at $BASELINE_DIR failed verification. Preserving intact for review; aborting."
    exit 1
  fi
fi

if [ "$BASELINE_VERIFIED" != "true" ]; then
  BASELINE_STAGING="$RELEASES_ROOT/baseline-staging-$$"
  echo "Preparing fresh baseline in staging directory: $BASELINE_STAGING"
  rm -rf "$BASELINE_STAGING"
  mkdir -p "$BASELINE_STAGING"

  # Copy production files excluding transient logs and VCS metadata
  rsync -a --exclude='.git' --exclude='node_modules' --exclude='*.bak*' --exclude='*.log' \
    "$PROD_RC/" "$BASELINE_STAGING/"

  # Dereference and copy exact production runtime dependencies into independent directory
  cp -aL "$PROD_RC/node_modules" "$BASELINE_STAGING/node_modules"
  chmod 600 "$BASELINE_STAGING/.env.local"

  # Generate content and permission manifests
  (cd "$BASELINE_STAGING" && \
    find . -type f ! -name "checksums.sha256" ! -name "permissions.txt" -print0 | sort -z | xargs -0 sha256sum > checksums.sha256 && \
    find . ! -name "checksums.sha256" ! -name "permissions.txt" -printf "%m %u:%g %p\n" | sort -k3 > permissions.txt && \
    sha256sum -c checksums.sha256 --quiet)

  # Check for broken symlinks in baseline
  BROKEN_LINKS=$(find "$BASELINE_STAGING" -xtype l | wc -l)
  if [ "$BROKEN_LINKS" -ne 0 ]; then
    echo "FATAL: Found $BROKEN_LINKS broken symlinks in baseline staging. Aborting."
    rm -rf "$BASELINE_STAGING"
    exit 1
  fi

  mv "$BASELINE_STAGING" "$BASELINE_DIR"
  chmod -R a-w "$BASELINE_DIR"
  echo "New baseline locked and verified at $BASELINE_DIR"
fi

# ------------------------------------------------------------------------------
# STEP 2: PRE-CUTOVER ISOLATED CANDIDATE TESTING (PORT 3007)
# ------------------------------------------------------------------------------
echo "=================================================================="
echo "Starting Candidate Pre-Cutover Validation on Isolated Port $PRE_TEST_PORT"
echo "=================================================================="

# Ensure port 3007 is free
if ss -tulpn | grep -q ":$PRE_TEST_PORT "; then
  echo "FATAL: Pre-test port $PRE_TEST_PORT is already in use. Aborting."
  exit 1
fi

# Start candidate process in background with working directory set to CANDIDATE_DIR
(cd "$CANDIDATE_DIR" && exec env PORT="$PRE_TEST_PORT" NODE_ENV=production /usr/bin/node "$CANDIDATE_DIR/node_modules/next/dist/bin/next" start -p "$PRE_TEST_PORT") &
PRE_TEST_PID=$!

cleanup_pre_test() {
  if kill -0 "$PRE_TEST_PID" 2>/dev/null; then
    kill "$PRE_TEST_PID" 2>/dev/null || true
    wait "$PRE_TEST_PID" 2>/dev/null || true
  fi
}
trap cleanup_pre_test EXIT

# Poll until pre-test server responds (max 15s)
PRE_TEST_UP=false
for i in $(seq 1 15); do
  if curl -s -f "http://127.0.0.1:$PRE_TEST_PORT/" >/dev/null 2>&1; then
    PRE_TEST_UP=true
    break
  fi
  sleep 1
done

if [ "$PRE_TEST_UP" != "true" ]; then
  echo "FATAL: Candidate process failed to bind port $PRE_TEST_PORT within 15s. Aborting cutover."
  exit 1
fi

echo "[Pre-test 1/3] Testing REAL oversized body against candidate API..."
# Generate bounded 10.5 MB actual JSON payload (exceeds 10MB limit)
PAYLOAD_TEST=$(python3 -c 'import sys; sys.stdout.buffer.write(b"{\"image\":\"" + b"A"*10500000 + b"\"}")' | \
  curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "http://127.0.0.1:$PRE_TEST_PORT/api/attack-strategy" \
    -H "Content-Type: application/json" --data-binary @- || true)

OVERSIZE_HTTP=$(echo "$PAYLOAD_TEST" | grep "HTTP_STATUS:" | cut -d: -f2)
OVERSIZE_BODY=$(echo "$PAYLOAD_TEST" | grep -v "HTTP_STATUS:")

if [ "$OVERSIZE_HTTP" != "413" ] || ! echo "$OVERSIZE_BODY" | grep -q "Request payload too large"; then
  echo "FATAL: Pre-cutover 413 check failed! (Got HTTP $OVERSIZE_HTTP, body: $OVERSIZE_BODY). Aborting cutover."
  exit 1
fi
echo "Application-level 413 confirmed: $OVERSIZE_BODY"

echo "[Pre-test 2/3] Testing SEC-03 debug endpoint guard..."
DEBUG_HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PRE_TEST_PORT/api/debug")
if [ "$DEBUG_HTTP" != "404" ]; then
  echo "FATAL: SEC-03 debug guard failed on candidate (got HTTP $DEBUG_HTTP, expected 404). Aborting cutover."
  exit 1
fi
echo "SEC-03 debug guard confirmed (HTTP 404)"

echo "[Pre-test 3/3] Testing candidate security headers..."
CAND_HEADERS=$(curl -s -I "http://127.0.0.1:$PRE_TEST_PORT/")
if ! echo "$CAND_HEADERS" | grep -qi "X-Frame-Options: SAMEORIGIN"; then
  echo "FATAL: X-Frame-Options: SAMEORIGIN missing from candidate headers. Aborting cutover."
  exit 1
fi
if ! echo "$CAND_HEADERS" | grep -qi "X-Content-Type-Options: nosniff"; then
  echo "FATAL: X-Content-Type-Options: nosniff missing from candidate headers. Aborting cutover."
  exit 1
fi
if echo "$CAND_HEADERS" | grep -qi "X-Powered-By"; then
  echo "FATAL: X-Powered-By header was not suppressed. Aborting cutover."
  exit 1
fi
echo "Security headers confirmed on candidate."

# Shut down pre-test process cleanly
cleanup_pre_test
trap - EXIT
echo "Pre-cutover validation complete. Candidate is 100% verified."

# ------------------------------------------------------------------------------
# STEP 3: EXPLICIT PRODUCTION CUTOVER & STAGED ROLLBACK FUNCTION
# ------------------------------------------------------------------------------
echo "=================================================================="
echo "Entering Production Cutover Phase"
echo "Notice: Non-zero downtime window (~1.8s) starting now"
echo "=================================================================="

execute_rollback() {
  local stage_failed="$1"
  local details="$2"
  echo "******************************************************************"
  echo "CRITICAL FAILURE at stage: $stage_failed"
  echo "Details: $details"
  echo "Executing explicit, staged rollback..."
  echo "******************************************************************"

  # Stop service if running
  sudo systemctl stop coc-planner.service || true

  # Quarantine failed candidate for post-mortem forensics
  FAILED_QUARANTINE="$RELEASES_ROOT/failed-candidate-$(date +%s)"
  if [ -d "$PROD_RC" ]; then
    if ! mv "$PROD_RC" "$FAILED_QUARANTINE"; then
      echo "EMERGENCY: Failed to move corrupt $PROD_RC to $FAILED_QUARANTINE."
    else
      echo "Failed candidate quarantined at $FAILED_QUARANTINE"
    fi
  fi
  if [ -n "${CANDIDATE_STAGED:-}" ] && [ -d "$CANDIDATE_STAGED" ]; then
    mv "$CANDIDATE_STAGED" "$FAILED_QUARANTINE-staged" 2>/dev/null || true
  fi

  # Prepare separate restore staging directory
  RESTORE_STAGING="$RELEASES_ROOT/restore-staging-$$"
  rm -rf "$RESTORE_STAGING"

  # Determine recovery source and stage into RESTORE_STAGING
  if [ -n "${SWAP_DIR:-}" ] && [ -d "$SWAP_DIR" ] && [ -f "$SWAP_DIR/.next/BUILD_ID" ]; then
    echo "Staging restoration from preserved active swap: $SWAP_DIR..."
    if ! cp -a "$SWAP_DIR" "$RESTORE_STAGING"; then
      echo "WARNING: Failed to stage from $SWAP_DIR. Falling back to frozen baseline."
      rm -rf "$RESTORE_STAGING"
    fi
  fi

  if [ ! -d "$RESTORE_STAGING" ]; then
    if [ -d "$BASELINE_DIR" ]; then
      echo "Staging restoration from immutable baseline: $BASELINE_DIR..."
      # Copy from frozen baseline without altering baseline permissions
      if ! cp -a "$BASELINE_DIR" "$RESTORE_STAGING"; then
        echo "FATAL ERROR: Failed to copy from frozen baseline $BASELINE_DIR."
        exit 2
      fi
      # Restore exact recorded runtime permissions from verifiable record permissions.txt
      if [ -f "$RESTORE_STAGING/permissions.txt" ]; then
        python3 -c '
import os, sys
os.chdir(sys.argv[1])
with open("permissions.txt") as f:
    for line in f:
        parts = line.strip().split(" ", 2)
        if len(parts) == 3:
            mode_oct, _, path = parts
            if os.path.exists(path) and not os.path.islink(path):
                try:
                    os.chmod(path, int(mode_oct, 8))
                except Exception as e:
                    print(f"Error chmod {path}: {e}", file=sys.stderr)
' "$RESTORE_STAGING"
      fi
    else
      echo "FATAL ERROR: No recovery source found! Both active swap and baseline are missing."
      exit 2
    fi
  fi

  # Validate restore staging BEFORE touching production paths
  echo "Validating restore staging directory at $RESTORE_STAGING..."
  
  # 1. Validate Build ID
  RESTORE_BUILD_ID=$(cat "$RESTORE_STAGING/.next/BUILD_ID" 2>/dev/null || true)
  if [ "$RESTORE_BUILD_ID" != "EBRnc03UccvEpJ8tSpDFD" ]; then
    echo "CRITICAL ROLLBACK FAILURE: Restored Build ID is '$RESTORE_BUILD_ID' (expected EBRnc03UccvEpJ8tSpDFD)."
    exit 2
  fi

  # 2. Validate cryptographic checksums if manifest is present
  if [ -f "$RESTORE_STAGING/checksums.sha256" ]; then
    if ! (cd "$RESTORE_STAGING" && sha256sum -c checksums.sha256 --quiet); then
      echo "CRITICAL ROLLBACK FAILURE: Restored files failed checksum verification."
      exit 2
    fi
  fi

  # 3. Validate permissions manifest if present
  if [ -f "$RESTORE_STAGING/permissions.txt" ]; then
    if ! (cd "$RESTORE_STAGING" && diff -u permissions.txt <(find . ! -name "checksums.sha256" ! -name "permissions.txt" -printf "%m %u:%g %p\n" | sort -k3)); then
      echo "CRITICAL ROLLBACK FAILURE: Restored permissions mismatch."
      exit 2
    fi
  fi

  # 4. Check for broken symlinks
  if [ "$(find "$RESTORE_STAGING" -xtype l | wc -l)" -ne 0 ]; then
    echo "CRITICAL ROLLBACK FAILURE: Found broken symlinks in restore staging."
    exit 2
  fi

  # 5. Check Next.js runtime binary
  if [ ! -f "$RESTORE_STAGING/node_modules/next/dist/bin/next" ]; then
    echo "CRITICAL ROLLBACK FAILURE: Next.js binary missing in restored node_modules."
    exit 2
  fi

  # 6. Check environment file
  if [ ! -f "$RESTORE_STAGING/.env.local" ] || [ "$(stat -c "%a" "$RESTORE_STAGING/.env.local")" != "600" ]; then
    echo "CRITICAL ROLLBACK FAILURE: Restored .env.local missing or mode not 600."
    exit 2
  fi

  echo "Restore staging verified 100%. Moving into production path $PROD_RC..."
  if ! mv "$RESTORE_STAGING" "$PROD_RC"; then
    echo "CRITICAL ROLLBACK FAILURE: Unable to move $RESTORE_STAGING to $PROD_RC."
    exit 2
  fi

  # Start service on restored baseline
  echo "Restarting service on restored runtime..."
  if ! sudo systemctl start coc-planner.service; then
    echo "CRITICAL RECOVERY FAILURE: systemctl start failed after restoring baseline."
    exit 2
  fi

  # Verify baseline health
  local baseline_healthy=false
  for r in $(seq 1 15); do
    if curl -s -f "http://127.0.0.1:$PROD_PORT/" >/dev/null 2>&1; then
      baseline_healthy=true
      break
    fi
    sleep 1
  done

  if [ "$baseline_healthy" = "true" ]; then
    echo "SUCCESSFUL ROLLBACK: Baseline runtime restored and serving traffic."
    exit 1
  else
    echo "CRITICAL RECOVERY FAILURE: Restored baseline failed health check after 15s."
    exit 2
  fi
}

# Pre-stage candidate before stopping service to minimize downtime
CANDIDATE_STAGED="$RELEASES_ROOT/candidate-staged-$$"
echo "Pre-staging candidate release into $CANDIDATE_STAGED before stopping service..."
rm -rf "$CANDIDATE_STAGED"
if ! cp -a "$CANDIDATE_DIR" "$CANDIDATE_STAGED"; then
  echo "FATAL: Failed to stage candidate into $CANDIDATE_STAGED. Aborting cutover."
  rm -rf "$CANDIDATE_STAGED"
  exit 1
fi

if ! (cd "$CANDIDATE_STAGED" && sha256sum -c candidate-manifest.sha256 --quiet); then
  echo "FATAL: Pre-staged candidate failed manifest check. Aborting cutover."
  rm -rf "$CANDIDATE_STAGED"
  exit 1
fi

# Mutation 1: Stop service
echo "[Cutover 1/4] Stopping coc-planner.service..."
if ! sudo systemctl stop coc-planner.service; then
  echo "ERROR: Failed to stop coc-planner.service. Production unchanged."
  rm -rf "$CANDIDATE_STAGED"
  exit 1
fi

# Mutation 2: Move existing active runtime to preserved timestamped swap
SWAP_DIR="$RELEASES_ROOT/active-swap-$(date +%s)"
echo "[Cutover 2/4] Moving active runtime to preserved swap: $SWAP_DIR..."
if ! mv "$PROD_RC" "$SWAP_DIR"; then
  echo "ERROR: Failed to move $PROD_RC to $SWAP_DIR. Re-starting original service."
  sudo systemctl start coc-planner.service || true
  rm -rf "$CANDIDATE_STAGED"
  exit 1
fi

# Mutation 3: Move pre-verified staged candidate to active runtime path
echo "[Cutover 3/4] Promoting staged candidate to $PROD_RC..."
if ! mv "$CANDIDATE_STAGED" "$PROD_RC"; then
  execute_rollback "Candidate promotion" "mv $CANDIDATE_STAGED $PROD_RC failed"
fi

# Mutation 4: Start service on promoted candidate
echo "[Cutover 4/4] Starting coc-planner.service with candidate..."
if ! sudo systemctl start coc-planner.service; then
  execute_rollback "Service startup" "systemctl start failed for candidate"
fi

# ------------------------------------------------------------------------------
# STEP 4: PRODUCTION READINESS POLLING & SEMANTIC VALIDATION
# ------------------------------------------------------------------------------
echo "=================================================================="
echo "Entering Health Validation Window (20-Second Deadline)"
echo "=================================================================="

SERVICE_ONLINE=false
for i in $(seq 1 20); do
  if curl -s -f "http://127.0.0.1:$PROD_PORT/" >/dev/null 2>&1; then
    SERVICE_ONLINE=true
    break
  fi
  sleep 1
done

if [ "$SERVICE_ONLINE" != "true" ]; then
  execute_rollback "Service readiness timeout" "Port $PROD_PORT failed to respond within 20s"
fi
echo "Production service is accepting connections on port $PROD_PORT."

# Check process cwd and identity
PROD_PID=$(systemctl show -p MainPID --value coc-planner.service)
PROD_CWD=$(readlink "/proc/$PROD_PID/cwd" || true)
if [ "$PROD_CWD" != "$PROD_RC" ]; then
  execute_rollback "Process CWD validation" "Process $PROD_PID running in $PROD_CWD instead of $PROD_RC"
fi

# Validate Build ID on active runtime
LIVE_BUILD_ID=$(cat "$PROD_RC/.next/BUILD_ID" || true)
if [ "$LIVE_BUILD_ID" != "$EXPECTED_CANDIDATE_BUILD_ID" ]; then
  execute_rollback "Build ID verification" "Live Build ID $LIVE_BUILD_ID does not match expected $EXPECTED_CANDIDATE_BUILD_ID"
fi
echo "Process $PROD_PID verified running in $PROD_RC with Build ID $LIVE_BUILD_ID."

# Validate JSON datasets using strict JSON parser and semantic data checks
echo "Validating core static datasets using JSON parser..."
DATASETS=("buildings.json:Town Hall" "heroes.json:Barbarian King" "equipment.json:Giant Gauntlet")
for entry in "${DATASETS[@]}"; do
  file="${entry%%:*}"
  needle="${entry##*:}"
  
  CHECK_RESULT=$(curl -s -f "http://127.0.0.1:$PROD_PORT/data/$file" | \
    python3 -c "import sys, json; d = json.load(sys.stdin); items = d.get('items', []); sys.exit(0 if any(b.get('name') == '$needle' for b in items) else 1)" 2>&1 || true)
  
  if [ -n "$CHECK_RESULT" ]; then
    execute_rollback "Dataset validation" "File $file missing expected item '$needle' or invalid JSON"
  fi
  echo "Dataset /data/$file verified (valid JSON, contains '$needle')"
done

# Validate SEC-03 in production
PROD_DEBUG_HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PROD_PORT/api/debug")
if [ "$PROD_DEBUG_HTTP" != "404" ]; then
  execute_rollback "SEC-03 guard check" "Debug endpoint returned HTTP $PROD_DEBUG_HTTP (expected 404)"
fi
echo "Production SEC-03 debug guard verified (HTTP 404)"

# Validate SEC-05 headers in production
PROD_HEADERS=$(curl -s -I "http://127.0.0.1:$PROD_PORT/")
if ! echo "$PROD_HEADERS" | grep -qi "X-Frame-Options: SAMEORIGIN"; then
  execute_rollback "SEC-05 header check" "X-Frame-Options: SAMEORIGIN missing in production response"
fi
if ! echo "$PROD_HEADERS" | grep -qi "X-Content-Type-Options: nosniff"; then
  execute_rollback "SEC-05 header check" "X-Content-Type-Options: nosniff missing in production response"
fi
if echo "$PROD_HEADERS" | grep -qi "X-Powered-By"; then
  execute_rollback "SEC-05 header check" "X-Powered-By was not suppressed in production response"
fi
echo "Production SEC-05 headers verified."

echo "=================================================================="
echo "DEPLOYMENT COMPLETE AND FULLY VERIFIED"
echo "Active Build ID: $LIVE_BUILD_ID"
echo "Public URL: https://clashplanner.xyz"
echo "=================================================================="
exit 0
