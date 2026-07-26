#!/usr/bin/env bash
# local-ci.sh — run this repo's CI gate locally, before opening a PR.
#
# Every required stage below mirrors a step that .github/workflows/ci.yml runs,
# so a green run here means a green run there. The mapping is annotated per
# stage and summarised by `--list-stages`; `scripts/check_ci_parity.py` fails
# the build if the two drift apart.
#
#   ./scripts/local-ci.sh                  # the CI gate
#   ./scripts/local-ci.sh --fix            # ...auto-formatting/fixing first
#   ./scripts/local-ci.sh --fast           # skip the slow stages, explicitly
#   ./scripts/local-ci.sh --list-stages    # what runs, and which CI job covers it
#   ./scripts/local-ci.sh --install-hook   # wire up as a git pre-push hook
#
# Exit 0 only if every required stage actually ran and passed.
#   required  what CI runs. If one cannot run because its tool is absent, the
#             verdict is INCOMPLETE (exit 1), never PASS: "I did not check" is
#             not "it is fine", and claiming otherwise recreates the local/CI
#             divergence this gate exists to prevent.
#   advisory  local-only extras (workflow linting). Reported, never blocking.
#   optional  needs real AWS credentials (cdk diff). Skipped when unavailable.

# pipefail only, deliberately no `-u`: under `set -u`, bash 3.2 — still
# /bin/bash on macOS — treats `${#arr[@]}` on an empty array as an unbound
# variable and aborts, which the summary block would hit on every clean run.
# No `-e` either: `run` inspects each stage's exit code itself.
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 2

FRONTEND_DIR="frontend"
INFRA_DIR="cdk"
LAMBDA_TESTS_DIR="sam/tests/"

# --- options ---------------------------------------------------------------
FAST=0 FIX=0 QUIET=0 FORMAT="text"

usage() {
  awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' \
    "${BASH_SOURCE[0]}"
  cat <<'EOF'

Options:
  --fix            auto-fix what is mechanically fixable (eslint --fix, ruff format)
  --fast           skip the slow stages (cdk synth, pip-audit, bundle freshness)
                   as an explicit opt-out — they count as skipped, not missing,
                   so PASS stays reachable. Do not use before opening a PR.
  --list-stages    print each stage and the ci.yml job that covers it, then exit
  --format github  emit ::error annotations from the stages that support them
  --install-hook   install this script as .git/hooks/pre-push
  --quiet          only print the summary and failures
  -h, --help       this text
EOF
}

# Stage → CI coverage. Read by --list-stages and by scripts/check_ci_parity.py,
# which fails if a job named here is absent from ci.yml (or vice versa).
list_stages() {
  cat <<'EOF'
ci.yml job: review   (Specter099/.github static-site-review.yml)
  eslint                  npm run lint --prefix frontend
  vitest                  npm run test --prefix frontend
  frontend build          npm run build --prefix frontend
  cdk pytest              pytest cdk/tests/
  pip-audit (infra)       pip-audit -r cdk/requirements.txt
  cdk synth               cdk synth (in cdk/)
  cdk diff                cdk diff  — needs real AWS credentials, optional locally

ci.yml job: python   (Specter099/.github python-ci.yml)
  ruff check              ruff check .
  ruff format --check     ruff format --check .
  gitleaks                secret scan over the working tree
  bandit                  bandit -r . -ll --exclude .venv,cdk.out
  lambda pytest           pytest sam/tests/

ci.yml job: bundle   (this repo — "Repo Invariants")
  ci parity               scripts/check_ci_parity.py
  bundle freshness        scripts/check-bundle-freshness.sh

local only (advisory — no CI job runs these)
  yamllint                yamllint .github/
  actionlint              actionlint .github/workflows/*.yml
  workflow invariants     Specter099/.github scripts/check_workflow_invariants.py
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --fix) FIX=1 ;;
    --fast) FAST=1 ;;
    --quiet) QUIET=1 ;;
    --format) FORMAT="${2:-text}"; shift ;;
    --list-stages) list_stages; exit 0 ;;
    --install-hook)
      hook="$REPO_ROOT/.git/hooks/pre-push"
      mkdir -p "$(dirname "$hook")"
      cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
# Installed by scripts/local-ci.sh --install-hook
root="$(git rev-parse --show-toplevel)"
# pre-push rather than pre-commit: this gate builds the frontend and synthesizes
# CDK, which is too slow to run on every commit but right before a push.
exec "$root/scripts/local-ci.sh" --quiet
HOOK
      chmod +x "$hook"
      echo "Installed pre-push hook → $hook"
      echo "Bypass a single push with: git push --no-verify"
      exit 0
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# --- output ----------------------------------------------------------------
if [ -t 1 ] && [ "$FORMAT" = "text" ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; DIM=""; RESET=""
fi

FAILED=() PASSED=() SKIPPED=() ADVISORY=() MISSING=()
START=$SECONDS

say() { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; }
hdr() { say ""; say "${BOLD}── $* ${RESET}"; }

# run <label> <required|advisory> <cmd...>
# Output is shown only when a stage fails or is advisory — a passing gate should
# be a dozen lines, not a thousand.
run() {
  local label="$1" mode="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then
    PASSED+=("$label")
    say "${GREEN}✓${RESET} $label"
  elif [ "$mode" = advisory ]; then
    ADVISORY+=("$label")
    say "${YELLOW}!${RESET} $label ${DIM}(advisory — does not block)${RESET}"
    printf '%s\n' "$out" | sed 's/^/    /'
  else
    FAILED+=("$label")
    printf '%s✗%s %s\n' "$RED" "$RESET" "$label"
    printf '%s\n' "$out" | sed 's/^/    /'
  fi
  return 0
}

# Two kinds of not-run, and conflating them is a real bug: a gate that prints
# "PASS" having never run the linter CI *does* run is worse than no gate.
#
# skip     — optional stage (needs AWS) or an explicit --fast opt-out. PASS stays
#            reachable.
# missing  — required stage whose tool is absent. Verdict becomes INCOMPLETE and
#            the exit code non-zero, because "I didn't check" is not "it's fine".
skip() { SKIPPED+=("$1"); say "${DIM}∅ $1 — $2${RESET}"; }
missing() {
  MISSING+=("$1")
  printf '%s⚠%s %s — required stage not run: %s\n' "$YELLOW" "$RESET" "$1" "$2"
}

have() { command -v "$1" >/dev/null 2>&1; }
in_dir() { local d="$1"; shift; ( cd "$d" && "$@" ); }
have_py() { python3 -c "import $1" 2>/dev/null; }

# ===========================================================================
# ci.yml job: review — static-site-review.yml
# ===========================================================================
hdr "review — frontend & infra"

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  # CI runs `npm ci`; doing that here on every invocation would wipe and
  # reinstall node_modules each time, so require it and say how to fix.
  missing "frontend deps" "npm ci --prefix $FRONTEND_DIR"
else
  if [ "$FIX" = 1 ]; then
    run "eslint --fix" required npm run lint:fix --prefix "$FRONTEND_DIR"
  fi

  run "eslint" required npm run lint --prefix "$FRONTEND_DIR"

  run "vitest" required npm run test --prefix "$FRONTEND_DIR"

  # `npm run build` is `tsc -b && vite build`, so this covers typechecking too.
  run "frontend build" required npm run build --prefix "$FRONTEND_DIR"
fi

# pytest is invoked as `python3 -m pytest` throughout: a bare `pytest` shim can
# resolve to a different interpreter than the one holding boto3/aws-cdk-lib.
# That exact drift bit during development — the shim was a uv-managed tool with
# its own venv, and the suite failed to import.
if have_py pytest && have_py aws_cdk; then
  run "cdk pytest" required python3 -m pytest "$INFRA_DIR/tests/" -q
else
  missing "cdk pytest" "pip install -r $INFRA_DIR/requirements.txt -r $INFRA_DIR/requirements-dev.txt"
fi

if [ "$FAST" = 1 ]; then
  skip "pip-audit (infra)" "--fast"
elif have pip-audit; then
  run "pip-audit (infra)" required pip-audit -r "$INFRA_DIR/requirements.txt"
else
  missing "pip-audit (infra)" "pip install pip-audit"
fi

if [ "$FAST" = 1 ]; then
  skip "cdk synth" "--fast"
elif have cdk; then
  run "cdk synth" required in_dir "$INFRA_DIR" cdk synth --quiet
else
  missing "cdk synth" "npm i -g aws-cdk"
fi

# cdk diff compares against the *deployed* stack, so unlike synth it needs real
# credentials. Optional locally; CI always has them via OIDC.
if [ "$FAST" = 1 ]; then
  skip "cdk diff" "--fast"
elif ! have cdk; then
  skip "cdk diff" "no cdk CLI"
elif have aws && aws sts get-caller-identity >/dev/null 2>&1; then
  run "cdk diff" required in_dir "$INFRA_DIR" cdk diff
else
  skip "cdk diff" "no usable AWS credentials (compares against the deployed stack)"
fi

# ===========================================================================
# ci.yml job: python — python-ci.yml
# ===========================================================================
hdr "python — lint, secrets & lambda tests"

# `python3 -m ruff` rather than a PATH `ruff`: the two can be different
# versions, and ruff's default rule set changes between minor releases.
if have_py ruff; then
  if [ "$FIX" = 1 ]; then
    run "ruff format (--fix)" required python3 -m ruff format .
  fi
  RUFF_ARGS=()
  [ "$FORMAT" = "github" ] && RUFF_ARGS+=(--output-format=github)
  run "ruff check" required python3 -m ruff check "${RUFF_ARGS[@]}" .
  run "ruff format --check" required python3 -m ruff format --check .
else
  missing "ruff" "pip install -r requirements-dev.txt"
fi

if have gitleaks; then
  run "gitleaks" required gitleaks detect --no-banner --redact
else
  missing "gitleaks" "https://github.com/gitleaks/gitleaks#installing"
fi

# CI runs `bandit -r . -ll --exclude .venv,cdk.out`. Locally the exclude list has
# to be longer: the review stage above leaves a synthesized cdk/cdk.out behind
# (full of vendored third-party Python), and node_modules exists here but never
# in CI's python job. Excluding them is what makes the local scan cover the same
# files CI actually sees — our own source under cdk/, sam/ and scripts/.
if have_py bandit; then
  run "bandit" required python3 -m bandit -r . -ll -q \
    --exclude ./.venv,./cdk.out,./cdk/cdk.out,./node_modules,./frontend/node_modules,./build
else
  missing "bandit" "pip install bandit"
fi

if have_py pytest && have_py moto; then
  run "lambda pytest" required python3 -m pytest "$LAMBDA_TESTS_DIR" -q
else
  missing "lambda pytest" "pip install -r requirements-dev.txt"
fi

# ===========================================================================
# ci.yml job: bundle — this repo ("Repo Invariants")
# ===========================================================================
hdr "bundle — repo invariants"

run "ci parity" required python3 scripts/check_ci_parity.py --quiet

if [ "$FAST" = 1 ]; then
  skip "bundle freshness" "--fast"
elif [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  missing "bundle freshness" "npm ci --prefix $FRONTEND_DIR"
else
  run "bundle freshness" required ./scripts/check-bundle-freshness.sh
fi

# ===========================================================================
# Local-only — advisory. No CI job runs these, so they can never block.
# ===========================================================================
hdr "local only (advisory)"

if have yamllint; then
  run "yamllint" advisory yamllint -d "{extends: default, rules: {line-length: disable, document-start: disable, truthy: {allowed-values: ['true', 'false', 'on']}}}" .github/
else
  skip "yamllint" "pip install yamllint"
fi

if have actionlint; then
  run "actionlint" advisory actionlint -no-color -shellcheck= .github/workflows/ci.yml .github/workflows/cd.yml
else
  skip "actionlint" "go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7"
fi

# The org's invariant checker (WF001–WF014) lives in Specter099/.github and can
# be pointed at a caller repo. Only runs when that repo is checked out nearby,
# or when ORG_GITHUB_DIR points at it.
INVARIANTS=""
for candidate in "${ORG_GITHUB_DIR:-/nonexistent}/scripts/check_workflow_invariants.py" \
                 ../.github/scripts/check_workflow_invariants.py \
                 ../org-github/scripts/check_workflow_invariants.py; do
  [ -f "$candidate" ] && INVARIANTS="$candidate" && break
done
if [ -n "$INVARIANTS" ]; then
  run "workflow invariants" advisory \
    python3 "$INVARIANTS" --path "$REPO_ROOT" --strict --fail-on-warn
else
  skip "workflow invariants" "clone Specter099/.github alongside this repo"
fi

# ===========================================================================
# Summary
# ===========================================================================
ELAPSED=$((SECONDS - START))
printf '\n%s── summary ──%s\n' "$BOLD" "$RESET"
printf '  passed   %d\n' "${#PASSED[@]}"
[ "${#ADVISORY[@]}" -gt 0 ] && printf '  advisory %d  %s(%s)%s\n' \
  "${#ADVISORY[@]}" "$YELLOW" "$(IFS=', '; echo "${ADVISORY[*]}")" "$RESET"
[ "${#SKIPPED[@]}" -gt 0 ] && printf '  skipped  %d  %s(%s)%s\n' \
  "${#SKIPPED[@]}" "$DIM" "$(IFS=', '; echo "${SKIPPED[*]}")" "$RESET"
[ "${#MISSING[@]}" -gt 0 ] && printf '  missing  %d  %s(%s)%s\n' \
  "${#MISSING[@]}" "$YELLOW" "$(IFS=', '; echo "${MISSING[*]}")" "$RESET"
[ "${#FAILED[@]}" -gt 0 ] && printf '  failed   %d  %s(%s)%s\n' \
  "${#FAILED[@]}" "$RED" "$(IFS=', '; echo "${FAILED[*]}")" "$RESET"

if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\n%sFAIL%s — %ds. Fix the above before opening a PR.\n' "$RED" "$RESET" "$ELAPSED"
  exit 1
fi
if [ "${#MISSING[@]}" -gt 0 ]; then
  printf '\n%sINCOMPLETE%s — %ds. %d required stage(s) never ran; CI will still run them.\n' \
    "$YELLOW" "$RESET" "$ELAPSED" "${#MISSING[@]}"
  printf 'Install the missing tools (hints above), or use --fast to opt out explicitly.\n'
  exit 1
fi
printf '\n%sPASS%s — %ds. Safe to open a PR.\n' "$GREEN" "$RESET" "$ELAPSED"
exit 0
