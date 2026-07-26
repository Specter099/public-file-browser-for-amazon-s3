#!/usr/bin/env bash
# Verifies a deployed Public File Browser stack.
#
# Usage: ./verify.sh <FileBrowserURL>
# Example: ./verify.sh https://d111111abcdef8.cloudfront.net
#
# Checks:
#   1. Security response headers (HSTS, X-Content-Type-Options, Referrer-Policy, X-Frame-Options)
#   2. HSTS contents are max-age=31536000; includeSubDomains; preload
#   3. http:// redirects to https://
#   4. Reflected-XSS regression: ?p=<img src=x onerror=alert(1)>/ is not reflected literally
#   5. Subresource Integrity attributes on the bundled JS/CSS assets, and each
#      declared digest matches the asset actually served
#   6. config.json is present, fully substituted, and valid JSON
#
# Browser-only checks not covered here (run by hand):
#   - Upload an S3 object with a double-quote in the key; confirm the listing renders safely.
#   - Stack update with SiteName='</title><script>alert(1)</script>' should be rejected by AllowedPattern.
#   - Toggle the OS light/dark setting and confirm the theme follows it before any click.
#
# Note on check 4: the frontend is a client-rendered single-page app, so the
# served HTML never contains the query string at all. That makes this a weaker
# signal than it was against the pre-rebuild server-rendered markup -- it now
# confirms only that no reflection was introduced. The real breadcrumb-escaping
# regression test is `describe("security")` in frontend/src/App.test.tsx.

set -u

url="${1:-}"
if [[ -z "$url" ]]; then
  echo "Usage: $0 <FileBrowserURL>" >&2
  echo "       FileBrowserURL is the 'FileBrowserURL' output of the SAM stack." >&2
  exit 64
fi
url="${url%/}"

if [[ -t 1 ]]; then
  R=$'\033[31m'; G=$'\033[32m'; B=$'\033[1m'; N=$'\033[0m'
else
  R=""; G=""; B=""; N=""
fi

pass=0
fail=0

check() {
  local name="$1" status="$2"
  if [[ "$status" == "ok" ]]; then
    printf '%sPASS%s %s\n' "$G" "$N" "$name"
    pass=$((pass + 1))
  else
    printf '%sFAIL%s %s -- %s\n' "$R" "$N" "$name" "$status"
    fail=$((fail + 1))
  fi
}

printf '%sVerifying%s %s\n\n' "$B" "$N" "$url"

# Fetch root once for both header and HTML body checks.
hdrs_file=$(mktemp)
body_file=$(mktemp)
trap 'rm -f "$hdrs_file" "$body_file"' EXIT

if ! curl -fsSL -D "$hdrs_file" -o "$body_file" "$url/" 2>/dev/null; then
  check "fetch GET /" "could not fetch site (is it deployed and propagated?)"
  echo
  printf '%s%s%d failed, %d passed.%s\n' "$R" "$B" "$fail" "$pass" "$N"
  exit 1
fi
check "fetch GET /" ok

# 1. Required security headers
for header in strict-transport-security x-content-type-options referrer-policy x-frame-options; do
  line=$(grep -i "^$header:" "$hdrs_file" | tail -1 | tr -d '\r')
  if [[ -n "$line" ]]; then
    check "header: $line" ok
  else
    check "header: $header missing" "not present in response"
  fi
done

# 2. HSTS contents
hsts=$(grep -i '^strict-transport-security:' "$hdrs_file" | tail -1 | tr -d '\r')
if [[ "$hsts" =~ max-age=31536000 ]] && \
   grep -iq 'includesubdomains' <<<"$hsts" && \
   grep -iq 'preload' <<<"$hsts"; then
  check "HSTS = max-age=31536000; includeSubDomains; preload" ok
else
  check "HSTS = max-age=31536000; includeSubDomains; preload" "got: ${hsts:-<missing>}"
fi

# 3. http -> https redirect
http_url="http://${url#https://}"
location=$(curl -sSI "$http_url/" 2>/dev/null | awk -F': ' 'BEGIN{IGNORECASE=1} tolower($1)=="location"{print $2}' | tr -d '\r\n' | head -c 200)
if [[ "$location" =~ ^https:// ]]; then
  check "http://... redirects to $location" ok
else
  check "http://... redirects to https://" "got: ${location:-<no Location header>}"
fi

# 4. Reflected-XSS regression
xss_payload='<img src=x onerror=alert(1)>/'
encoded=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$xss_payload")
xss_body=$(curl -fsSL "$url/?p=$encoded" 2>/dev/null || true)
if [[ -z "$xss_body" ]]; then
  check "XSS regression: fetch /?p=<payload>" "no body returned"
elif grep -Fq '<img src=x onerror=alert(1)>' <<<"$xss_body"; then
  check "XSS regression: payload not reflected literally" "FOUND raw <img ...> in body -- breadcrumb may be exploitable"
else
  check "XSS regression: payload not reflected literally" ok
fi

# 5. SRI on the bundled assets, verified against what the CDN actually serves.
#    The bundle is content-hashed, so the digests must be recomputed from the
#    fetched bytes -- a stale or wrong hash makes the browser refuse to execute
#    the bundle and the page renders blank with no server-side symptom.
sri_count=$(grep -oE 'integrity="sha384-[A-Za-z0-9+/=]+"' "$body_file" | wc -l | tr -d ' ')
if [[ "$sri_count" -ge 2 ]]; then
  check "SRI: $sri_count integrity attributes on bundled assets" ok
else
  check "SRI: integrity attributes on bundled assets" "found $sri_count, expected >=2 (a JS entry and a stylesheet)"
fi

sri_mismatches=0
sri_verified=0
# Pair each asset URL with the integrity value declared on the same tag.
while read -r asset_path declared; do
  [[ -z "$asset_path" || -z "$declared" ]] && continue
  asset_body=$(mktemp)
  if curl -fsSL -o "$asset_body" "$url$asset_path" 2>/dev/null; then
    actual="sha384-$(openssl dgst -sha384 -binary "$asset_body" | openssl base64 -A)"
    if [[ "$actual" == "$declared" ]]; then
      sri_verified=$((sri_verified + 1))
    else
      sri_mismatches=$((sri_mismatches + 1))
      printf '       %s\n         declared: %s\n         actual:   %s\n' \
        "$asset_path" "$declared" "$actual" >&2
    fi
  else
    sri_mismatches=$((sri_mismatches + 1))
    printf '       %s could not be fetched\n' "$asset_path" >&2
  fi
  rm -f "$asset_body"
done < <(grep -oE '(src|href)="[^"]+"[^>]*integrity="sha384-[A-Za-z0-9+/=]+"' "$body_file" \
  | sed -E 's/^(src|href)="([^"]+)".*integrity="([^"]+)".*$/\2 \3/')

if (( sri_mismatches == 0 && sri_verified > 0 )); then
  check "SRI: $sri_verified served asset(s) match their declared digest" ok
elif (( sri_verified == 0 && sri_mismatches == 0 )); then
  check "SRI: served assets match their declared digests" "no asset/integrity pairs parsed from the HTML"
else
  check "SRI: served assets match their declared digests" "$sri_mismatches mismatch(es), see above"
fi

# 6. Runtime config.json: present, valid JSON, and fully substituted. If a
#    placeholder survives, the site loads but cannot reach the bucket.
config_body=$(mktemp)
if curl -fsSL -o "$config_body" "$url/pfb_for_s3/config.json" 2>/dev/null; then
  if grep -q '###REPLACE_ME_' "$config_body"; then
    check "config.json is fully substituted" "found an unsubstituted ###REPLACE_ME_* placeholder"
  elif ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$config_body" 2>/dev/null; then
    check "config.json is valid JSON" "could not be parsed"
  else
    missing=$(python3 - "$config_body" <<'PY'
import json, sys
required = ["siteName", "identityPoolId", "bucketName", "filesOpenInNewTab", "visibleStorageClasses"]
config = json.load(open(sys.argv[1]))
print(",".join(key for key in required if not config.get(key)))
PY
)
    if [[ -n "$missing" ]]; then
      check "config.json has all required keys" "missing or empty: $missing"
    else
      check "config.json is present, valid, and fully substituted" ok
    fi
  fi
else
  check "config.json is reachable" "could not fetch $url/pfb_for_s3/config.json"
fi
rm -f "$config_body"

echo
if (( fail == 0 )); then
  printf '%s%sAll %d checks passed.%s\n' "$G" "$B" "$pass" "$N"
  exit 0
else
  printf '%s%s%d failed, %d passed.%s\n' "$R" "$B" "$fail" "$pass" "$N"
  exit 1
fi
