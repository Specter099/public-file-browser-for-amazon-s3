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
#   5. Subresource Integrity attributes are present on the vendor <script> tags
#
# Browser-only checks not covered here (run by hand):
#   - Tamper one byte of a vendor JS in S3, reload, expect SRI mismatch in DevTools.
#   - Upload an S3 object with a double-quote in the key; confirm the listing renders safely.
#   - Stack update with SiteName='</title><script>alert(1)</script>' should be rejected by AllowedPattern.

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

# 5. SRI on vendor scripts
sri_count=$(grep -oE 'integrity="sha384-[A-Za-z0-9+/=]+"' "$body_file" | wc -l | tr -d ' ')
if [[ "$sri_count" -ge 4 ]]; then
  check "SRI: $sri_count integrity attributes on vendor scripts" ok
else
  check "SRI: integrity attributes on 4+ vendor scripts" "found $sri_count, expected >=4"
fi

echo
if (( fail == 0 )); then
  printf '%s%sAll %d checks passed.%s\n' "$G" "$B" "$pass" "$N"
  exit 0
else
  printf '%s%s%d failed, %d passed.%s\n' "$R" "$B" "$fail" "$pass" "$N"
  exit 1
fi
