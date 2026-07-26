#!/usr/bin/env bash
# check-bundle-freshness.sh — is the committed website.zip built from the
# current frontend source?
#
# The seeding Lambda deploys `sam/seed_s3_data/website.zip`, not the contents of
# `frontend/`. Nothing in the deploy path rebuilds it, so a change under
# `frontend/` that is committed without re-running `npm run bundle` silently
# ships stale assets — and the SAM Lambda tests, which read the zip, would also
# be testing the old build.
#
# Run by both the CI `bundle` job and scripts/local-ci.sh, so the check cannot
# drift between the two.
#
# Comparison is per-entry content, not a checksum of the zip file: zip embeds
# timestamps, so two archives built from identical inputs differ byte-for-byte.
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 2

COMMITTED_ZIP="sam/seed_s3_data/website.zip"
STAGED_DIR="build/website"

if [ ! -f "$COMMITTED_ZIP" ]; then
  echo "check-bundle-freshness: $COMMITTED_ZIP is missing" >&2
  exit 1
fi

# Preserve the committed archive: `npm run bundle` rewrites it in place, and a
# check has no business mutating the tree it is checking.
BACKUP="$(mktemp)"
cp "$COMMITTED_ZIP" "$BACKUP"
restore() { cp "$BACKUP" "$COMMITTED_ZIP"; rm -f "$BACKUP"; }
trap restore EXIT

echo "Building frontend to compare against the committed bundle..."
if ! npm run build --prefix frontend >/dev/null 2>&1; then
  echo "check-bundle-freshness: frontend build failed" >&2
  npm run build --prefix frontend
  exit 1
fi

if ! npm run verify:sri --prefix frontend; then
  echo "check-bundle-freshness: built bundle failed Subresource Integrity verification" >&2
  exit 1
fi

if [ ! -d "$STAGED_DIR" ]; then
  echo "check-bundle-freshness: expected build output at $STAGED_DIR" >&2
  exit 1
fi

python3 - "$COMMITTED_ZIP" "$STAGED_DIR" <<'PY'
import hashlib
import sys
import zipfile
from pathlib import Path

zip_path, staged_root = sys.argv[1], Path(sys.argv[2])

# Entries are stored with a leading "website/" so the Lambda's extraction path
# (/tmp/website/website) keeps working; strip it to compare against build/website.
with zipfile.ZipFile(zip_path) as archive:
    committed = {
        name[len("website/"):]: hashlib.sha256(archive.read(name)).hexdigest()
        for name in archive.namelist()
        if not name.endswith("/") and name.startswith("website/")
    }

fresh = {
    str(path.relative_to(staged_root)): hashlib.sha256(path.read_bytes()).hexdigest()
    for path in staged_root.rglob("*")
    if path.is_file()
}

only_committed = sorted(set(committed) - set(fresh))
only_fresh = sorted(set(fresh) - set(committed))
differing = sorted(k for k in set(committed) & set(fresh) if committed[k] != fresh[k])

if not (only_committed or only_fresh or differing):
    print(f"check-bundle-freshness: OK - {len(committed)} entries match a fresh build")
    sys.exit(0)

print("check-bundle-freshness: FAIL - committed website.zip is out of date", file=sys.stderr)
for name in only_committed:
    print(f"  only in committed zip: {name}", file=sys.stderr)
for name in only_fresh:
    print(f"  only in fresh build:   {name}", file=sys.stderr)
for name in differing:
    print(f"  content differs:       {name}", file=sys.stderr)
print(
    "\nRebuild and commit it:\n  cd frontend && npm run bundle\n"
    "  git add ../sam/seed_s3_data/website.zip",
    file=sys.stderr,
)
sys.exit(1)
PY
