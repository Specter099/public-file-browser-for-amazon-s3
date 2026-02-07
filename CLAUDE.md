# CLAUDE.md

## Project Overview

**Public File Browser for Amazon S3** is a serverless AWS solution that provides a public, read-only file browsing interface for an S3 bucket. It serves a static website via Amazon CloudFront that lists and allows downloading of files stored in S3. No backend servers are required — the frontend uses AWS Cognito for temporary credentials and calls S3 directly from the browser.

## Repository Structure

```
├── website/                    # Static frontend (HTML/CSS/JS, no build step)
│   ├── index.html              # Entry point with template placeholders + inline config
│   ├── error.html              # Custom 404 error page (served by CloudFront)
│   ├── js/
│   │   ├── main.js             # Core application logic (~340 lines)
│   │   ├── jquery-3.7.1.min.js
│   │   ├── luxon.min.js
│   │   ├── bootstrap.bundle.min.js
│   │   └── aws-sdk-js-v2.1560.0.min.js
│   ├── css/
│   │   ├── main.css            # Custom styles (~100 lines)
│   │   ├── bootstrap.min.css
│   │   └── bootstrap-icons.min.css
│   └── icon/                   # Favicons, app icons, and site.webmanifest
├── sam/                        # AWS SAM infrastructure
│   ├── template.yaml           # CloudFormation/SAM template
│   ├── seed_s3_data/           # Lambda custom resource
│   │   ├── app.py              # Deploys website files to S3
│   │   ├── website.zip         # Bundled website for deployment
│   │   ├── pyproject.toml
│   │   └── requirements.txt
│   └── tests/
│       └── unit/
│           └── test_seed_s3_data.py  # 3 pytest tests using moto
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions CI pipeline (tests on push/PR)
└── docs/                       # Architecture diagram and screenshots
```

## Tech Stack

**Frontend:** Vanilla HTML/CSS/JavaScript (no framework, no transpilation)
- Bootstrap 5.3 (UI), jQuery 3.7.1 (DOM), Luxon (dates), AWS SDK v2 (S3 API)

**Infrastructure:** AWS SAM (CloudFormation)
- S3 (3 buckets: website, files, logs), CloudFront, Cognito, Lambda, IAM, CloudWatch

**Backend:** Python 3.13 Lambda function (arm64, 30s timeout)
- boto3, crhelper, loguru, simplejson

**Tests:** pytest with moto (AWS mocking)

**CI:** GitHub Actions (`.github/workflows/ci.yml`) — runs tests on push to `main` and on pull requests

## Build and Deployment

There is **no frontend build step**. The website uses pre-minified vendor libraries and plain JS/CSS.

### Key Commands

```bash
# Build the SAM application
sam build

# Deploy (interactive)
sam deploy --guided --capabilities CAPABILITY_NAMED_IAM

# Bundle website files for deployment (run from repo root)
zip -FS -x "*.DS_Store" -r ./sam/seed_s3_data/website.zip website

# Local development server (requires local-web-server npm package)
ws -r '/ -> index.html' '/pfb_for_s3/(.*) -> /$1' --log.format dev
```

### CORS Two-Phase Deployment

The `CrossOriginRestriction` parameter has a circular dependency workaround:
1. **First deployment**: must use `*` (the default) because the CloudFront URL doesn't exist yet
2. **Second deployment**: redeploy with `CrossOriginRestriction` set to the `FileBrowserURL` output value to lock down CORS

### Running Tests

```bash
# From the sam/ directory
cd sam && python -m pytest tests/unit/test_seed_s3_data.py
```

Tests use `moto` to mock AWS S3 and verify the Lambda custom resource:
- `test_seed_data` — website files are created with correct config substitutions
- `test_seed_data_with_existing_data` — idempotency (won't overwrite existing files)
- `test_delete_data_with_existing_data` — cleanup on stack deletion

**Note:** The `test_seed_data` test calls `os.chdir('seed_s3_data')` because `app.py` reads `website.zip` from the current working directory. Tests must be run from `sam/` or they will fail with `FileNotFoundError`.

## Architecture

### CloudFront Path Routing and `pfb_for_s3/` Prefix

This prefix is central to how the site works:
- Website assets are stored in S3 under the `pfb_for_s3/` key prefix (`app.py:55`)
- CloudFront routes requests matching `pfb_for_s3/*` to the **website bucket** (`template.yaml:390`)
- All other requests (the default behavior) route to the **files bucket** for downloads (`template.yaml:377`)
- The CloudFront `DefaultRootObject` is `pfb_for_s3/index.html` (`template.yaml:383`)
- All asset references in `index.html` use `/pfb_for_s3/` paths (e.g., `/pfb_for_s3/js/main.js`)

Modifying paths or adding new assets requires understanding this routing split.

### CloudFront Security Headers

A `ResponseHeadersPolicy` (`template.yaml:43`) is attached to both cache behaviors and sets:
- **Content-Security-Policy**: restricts scripts, styles, connections, fonts, images to `'self'` (with `'unsafe-inline'` for the inline config block and Bootstrap styles); `connect-src` allows `https://*.amazonaws.com` for S3/Cognito API calls
- **Strict-Transport-Security**: 2-year max-age with `includeSubDomains` and `preload`
- **X-Content-Type-Options**: `nosniff`
- **X-Frame-Options**: `DENY`
- **Referrer-Policy**: `strict-origin-when-cross-origin`

When adding new external script or style sources, update the CSP in the `SecurityHeadersPolicy` resource.

### CloudFront Custom Error Responses

CloudFront maps 403 and 404 errors to `/pfb_for_s3/error.html` with a 404 response code (`template.yaml:395-403`). S3 returns 403 (not 404) for missing keys when the caller lacks `ListBucket` permission, so the 403 → 404 mapping is intentional.

### Frontend Code Flow

The frontend (`website/js/main.js`) does all S3 interaction client-side:

1. **Config**: `awsConfigOptions` is defined inline in `index.html:50-68` as a global object. It must be available before `main.js` loads.
2. **Init**: `$(document).ready` → `processUrl()` parses URL query params (`?p=` prefix, `?s=` start position)
3. **Navigation**: `processUrl()` → `reset(prefix, start_at)` → updates browser URL via `window.history.pushState`, updates breadcrumbs, then calls `renderTable()`
4. **Rendering**: `renderTable()` calls `S3.listObjectsV2()` with Cognito credentials → `get_display_order()` sorts results → `getRow()` builds table rows
5. **Error handling**: S3 API errors display a visible error message in the table body instead of a blank page
6. **Client-side routing**: Folder clicks call `localNav()` which uses `btoa()`/`atob()` base64 encoding for prefix/start_at values in `onclick` handlers. The `popstate` event listener re-triggers `processUrl()` for back/forward navigation.

### Sorting Behavior

The sorting logic in `get_display_order()` (`main.js:161-202`) has two modes:
- **Single-page results** (not truncated, no `StartAfter`): Folders sort above files, both groups sorted lexicographically — like a typical filesystem
- **Paginated results** (`IsTruncated` is true **OR** the request has a `StartAfter` parameter, i.e. any subsequent page): Strict lexicographic order with folders interspersed among files

Even a bucket with <1000 objects will use interspersed ordering on page 2+.

### Template Placeholders

These are replaced at deploy time by the Lambda function in `index.html`, `icon/site.webmanifest`, and `error.html` (`app.py:32`):
- `###REPLACE_ME_SITE_NAME###` — appears in all three files
- `###REPLACE_ME_IDENTITY_POOL_ID###` — `index.html` only
- `###REPLACE_ME_BUCKET_NAME###` — `index.html` only
- `###REPLACE_ME_FILES_OPEN_MODE###` — replaced with `true` or `false` based on `FilesOpenTabMode` parameter
- `###REPLACE_ME_VISIBLE_STORAGE_CLASSES###` — `index.html` only

### CloudFormation Parameters

| Parameter | Default | Description |
|---|---|---|
| SiteName | "AnyCompany Public Files" | Display title |
| FilesOpenTabMode | "In New Tab" | File open behavior (`In New Tab` → `true`, `In Same Tab` → `false`) |
| VisibleStorageClasses | "STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY" | Which storage classes to show |
| CrossOriginRestriction | "*" | CORS origin policy (see two-phase deployment above) |

### AWS Resource Naming Convention

All AWS resources use a unique suffix derived from the CloudFormation stack ID:
```yaml
!Select [ 4, !Split [ '-', !Select [ 2, !Split [ '/', !Ref 'AWS::StackId' ] ] ] ]
```
This pattern appears ~20 times in `template.yaml`. Any new resources must follow this convention to avoid name collisions across stacks.

### Infrastructure Notes

- **LoggingBucket has `DeletionPolicy: Retain`** (`template.yaml:241`) — it survives stack deletion. This is the only resource with this policy.
- **LoggingBucket lifecycle** — old versions expire after 90 days; current log objects expire after 365 days
- **Lambda logging intentionally omitted** — `AWSLambdaBasicExecutionRole` is excluded from the Lambda to prevent orphaned log groups during stack deletion (`template.yaml:457-461`)
- **Cognito unauthenticated identities** are intentionally allowed — this grants anonymous users scoped `s3:ListBucket` permission on the files bucket only
- **CloudWatch alarm** — a 5xx error rate alarm on CloudFront is conditionally created only in `us-east-1` (CloudFront metrics are only available in that region)
- **Resource tags** — all taggable resources are tagged with `Project: PublicFileBrowserForS3`
- **Cache-Control headers** — `app.py` sets `no-cache` on HTML files and `max-age=86400, public` on all other static assets during S3 upload
- **HTTP/3** — CloudFront is configured with `http2and3` for QUIC support

## Code Conventions

- **No linter or formatter configured** — there are no ESLint, Prettier, or Python linting configs
- **CI pipeline** — GitHub Actions runs pytest on push to `main` and on pull requests (`.github/workflows/ci.yml`)
- **Security scanning suppressions** — the template uses three tools with explicit suppressions, each with documented reasons:
  - **cfn_nag**: W28, W35, W57, W70, W89, W92 (in `template.yaml`)
  - **cdk_nag**: AwsSolutions-S10, CFR1, CFR2, CFR4, COG7 (in `template.yaml`)
  - **checkov**: CKV_AWS_18, CKV_AWS_68, CKV_AWS_115, CKV_AWS_116, CKV_AWS_117, CKV_AWS_173, CKV_AWS_174 (in `template.yaml`)
  - **nosemgrep**: `missing-integrity` on the AWS SDK script tag (`index.html:48`)
  - **bandit**: `# nosec` comments for `hardcoded_tmp_directory` and `assert_used` in test files
- **Vendor libraries are committed** — jQuery, Bootstrap, Luxon, and AWS SDK are checked into `website/js/` and `website/css/` as minified files
- **License** — MIT-0 (MIT No Attribution)

When adding new infrastructure resources, follow the existing pattern of adding suppression metadata with documented reasons.

## Key Files for Common Changes

| What to change | File(s) |
|---|---|
| File listing UI, sorting, pagination | `website/js/main.js` |
| Page layout, HTML structure | `website/index.html` |
| Custom error page | `website/error.html` |
| Custom styles | `website/css/main.css` |
| AWS infrastructure (buckets, CDN, IAM) | `sam/template.yaml` |
| Deployment logic (file upload/config) | `sam/seed_s3_data/app.py` |
| Tests | `sam/tests/unit/test_seed_s3_data.py` |
| CI pipeline | `.github/workflows/ci.yml` |

## Known TODOs / Technical Debt

These TODO comments exist in `website/js/main.js`:
- **Line 74** (`reset()` function): "Opportunity to clean this up, make it more flexible and not all hard-coded" — the URL parameter handling has repetitive if/else branches
- **Line 125** (`renderTable()` function): "Could look at normalizing the prefix parameter here in case a trailing slash or something gets missed in the URL"

### Future Enhancement: AWS SDK v3 Migration

The frontend uses AWS SDK for JavaScript **v2** (`aws-sdk-js-v2.1560.0.min.js`), which entered maintenance mode in September 2024. Migrating to **v3** (`@aws-sdk/client-s3`) would reduce bundle size from ~1.7MB to ~100KB and ensure continued security patches. However, SDK v3 uses ES modules and requires a bundler (webpack, rollup, etc.), which would mean adding a build step to a project that currently has none. This trade-off should be evaluated when considering the migration.

## Important Notes

- **Rebuild zip after website changes**: After modifying any files in `website/`, you must re-run `zip -FS -x "*.DS_Store" -r ./sam/seed_s3_data/website.zip website` before deploying with SAM, since the Lambda reads from the zip
- The `samconfig.toml` file (SAM deployment config) is gitignored
- S3 buckets have AES-256 encryption, versioning enabled, and lifecycle rules (delete old versions after 90 days) configured in the SAM template
