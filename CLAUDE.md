# CLAUDE.md

## Project Overview

**Public File Browser for Amazon S3** is a serverless AWS solution that provides a public, read-only file browsing interface for an S3 bucket. It serves a static website via Amazon CloudFront that lists and allows downloading of files stored in S3. No backend servers are required — the frontend uses AWS Cognito for temporary credentials and calls S3 directly from the browser.

## Repository Structure

```
├── website/                    # Static frontend (HTML/CSS/JS, no build step)
│   ├── index.html              # Entry point with template placeholders + inline config + SRI tags
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
│   └── icon/                   # Favicons, app icons, site.webmanifest (also templated)
├── sam/                        # AWS SAM infrastructure
│   ├── template.yaml           # CloudFormation/SAM template (~515 lines)
│   ├── verify.sh               # Post-deploy security verification script
│   ├── seed_s3_data/           # Lambda custom resource
│   │   ├── app.py              # Deploys website files to S3
│   │   ├── website.zip         # Bundled website for deployment
│   │   ├── pyproject.toml      # poetry deps for the Lambda
│   │   └── requirements.txt    # exported deps SAM actually installs
│   └── tests/
│       ├── pyproject.toml      # poetry deps for the test suite
│       ├── requirements.txt
│       └── unit/
│           └── test_seed_s3_data.py  # 4 pytest tests using moto
├── cdk/                        # AWS CDK (Python) — alternative to sam/, same infra
│   ├── app.py                  # CDK app entrypoint
│   ├── cdk.json                # CDK CLI config + feature-flag context
│   ├── pfb_cdk/
│   │   ├── pfb_stack.py        # the stack: buckets, CloudFront, Cognito, Lambda custom resource
│   │   └── lambda_bundling.py  # non-Docker asset bundling for the seed_s3_data Lambda
│   └── tests/unit/
│       └── test_pfb_stack.py   # 29 pytest tests using aws_cdk.assertions
└── docs/                       # Architecture diagram and screenshots
```

`sam/` and `cdk/` are two independent implementations of the *same*
infrastructure — pick one per deployment, don't deploy both against the same
account/region (see `cdk/README.md`). `cdk/` reuses `sam/seed_s3_data/app.py`
and `website.zip` directly rather than duplicating them.

## Tech Stack

**Frontend:** Vanilla HTML/CSS/JavaScript (no framework, no transpilation)
- Bootstrap 5.3 (UI), jQuery 3.7.1 (DOM), Luxon (dates), AWS SDK v2 (S3 API)

**Infrastructure:** AWS SAM (CloudFormation), with an AWS CDK (Python) equivalent under `cdk/`
- S3 (3 buckets: website, files, logs), CloudFront (+ Response Headers Policy, Origin Access Control), Cognito Identity Pool, Lambda, IAM

**Backend:** Python 3.13 Lambda function (arm64)
- boto3, crhelper, loguru, simplejson

**Tests:** pytest with moto (AWS mocking)

## Build and Deployment

There is **no frontend build step**. The website uses pre-minified vendor libraries and plain JS/CSS.

### Key Commands

```bash
# Bundle website files for deployment (run from repo root, BEFORE sam build)
zip -FS -x "*.DS_Store" -r ./sam/seed_s3_data/website.zip website

# Build and deploy (run from the sam/ directory)
cd sam
sam build
sam deploy --guided --capabilities CAPABILITY_NAMED_IAM

# Verify a deployed stack (headers, HSTS, redirect, XSS regression, SRI)
./verify.sh https://d111111abcdef8.cloudfront.net

# Local development server (requires the local-web-server npm package; run from website/)
ws -r '/ -> index.html' '/pfb_for_s3/(.*) -> /$1' --log.format dev
```

Deployment is intentionally a **two-pass** process: deploy once with `CrossOriginRestriction=*`, then redeploy with the parameter set to the `FileBrowserURL` stack output. The CORS rule on the files bucket cannot reference the CloudFront distribution directly without a circular dependency.

### Running Tests

```bash
# From the sam/ directory. PYTHONPATH=.. is REQUIRED — the tests import `sam.seed_s3_data.app`,
# so the repo root must be on sys.path.
cd sam && PYTHONPATH=.. python -m pytest tests/unit/test_seed_s3_data.py -v
```

Tests use `moto` to mock AWS S3 and verify the Lambda custom resource:
- `test_seed_data` — website files are created with correct config substitutions
- `test_seed_data_with_existing_data` — idempotency (won't overwrite existing files)
- `test_seed_data_preserves_sitename_verbatim` — SiteName is substituted verbatim and no `###REPLACE_ME_*###` markers leak through
- `test_delete_data_with_existing_data` — cleanup on stack deletion

The tests `os.chdir("seed_s3_data")` (so the Lambda can find `website.zip` by relative path) and write to `/tmp/website/`. They must be run from `sam/`, and they are order-dependent — run the module as a whole rather than a single test by node id.

### Other checks used in review

```bash
node --check website/js/main.js   # JS syntax check (no linter is configured)
cfn-lint sam/template.yaml        # template lint; some pre-existing warnings are expected
```

### CDK (alternative to SAM)

`cdk/` is a from-scratch Python CDK translation of `sam/template.yaml` — same
resources, naming convention, and security posture, deployed as its own
CloudFormation stack (not integrated with the SAM stack). See `cdk/README.md`
for full details; summary:

```bash
cd cdk
pip install -r requirements.txt -r requirements-dev.txt
cdk bootstrap        # once per account/region
cdk synth             # no Docker required — see pfb_cdk/lambda_bundling.py
cdk deploy
python -m pytest tests/unit -v   # 29 tests via aws_cdk.assertions
```

The same two-pass `CrossOriginRestriction` deploy applies. `sam/verify.sh`
works unchanged against a CDK-deployed stack.

## Architecture

The frontend (`website/js/main.js`) does all S3 interaction client-side:
1. Obtains temporary credentials from Cognito (unauthenticated identity pool). The AWS region is derived from the identity pool ID prefix.
2. Calls `S3.listObjectsV2()` with `Delimiter: '/'` to fetch bucket contents for the current prefix
3. Renders a file table with icons, sizes, dates, and storage classes
4. Handles pagination (>1000 objects, via `StartAfter`) and breadcrumb navigation via URL parameters (`p` for prefix, `s` for start position). In-page navigation goes through `localNav()`, which base64-encodes the prefix in the `onclick` attribute and uses `history.pushState`.

The SAM template (`sam/template.yaml`) creates all infrastructure. During stack creation, a Lambda custom resource (`seed_s3_data/app.py`) extracts `website.zip`, replaces template placeholders, and uploads the files under the `pfb_for_s3/` key prefix in the website S3 bucket. CloudFront serves `pfb_for_s3/*` from the website bucket and everything else from the files bucket, so file URLs look like `/<object key>`.

The Lambda is deliberately **not** granted `AWSLambdaBasicExecutionRole` — CloudWatch log group creation during stack deletion would leave an uncleanable resource behind. This means the function produces no CloudWatch logs; debug deploy-time failures via the CloudFormation events and the custom resource response instead.

### Template Placeholders

Replaced at deploy time by the Lambda, in **both** `index.html` and `icon/site.webmanifest`:
- `###REPLACE_ME_SITE_NAME###`
- `###REPLACE_ME_IDENTITY_POOL_ID###`
- `###REPLACE_ME_BUCKET_NAME###`
- `###REPLACE_ME_FILES_OPEN_MODE###` (mapped from "In New Tab"/"In Same Tab" to `true`/`false`)
- `###REPLACE_ME_VISIBLE_STORAGE_CLASSES###`

### CloudFormation Parameters

| Parameter | Default | Notes |
|---|---|---|
| SiteName | "AnyCompany Public Files" | Display title. 1–80 chars, `AllowedPattern` restricts to alphanumerics plus `. , ' - _ : ( )` to block HTML/JS injection at deploy time |
| FilesOpenTabMode | "In New Tab" | `In New Tab` or `In Same Tab` |
| VisibleStorageClasses | "STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY" | Which storage classes to show; `AllowedPattern` `^[A-Z_]+(,[A-Z_]+)*$` |
| CrossOriginRestriction | "*" | CORS origin. `*` on first deploy, then the `FileBrowserURL` output (no trailing slash) |

## Security Posture

The security-hardening work in commit `27af432` established conventions that changes should preserve:

- **Escape everything interpolated into HTML.** `main.js` builds markup by string concatenation. Every interpolated value — breadcrumb path segments, `objLink`, `objKey`, sizes, dates, storage class, `title` mouseover text — goes through `escapeHtml()`. If you add a column or a link, escape it.
- **`target="_blank"` always carries `rel="noopener noreferrer"`.**
- **Subresource Integrity.** All four vendor `<script>` tags in `index.html` have `integrity="sha384-..."`. If you change or upgrade a vendored library, regenerate its hash:
  ```bash
  openssl dgst -sha384 -binary website/js/<file>.js | openssl base64 -A
  ```
- **CloudFront response headers.** `SecurityResponseHeadersPolicy` in `template.yaml` sets HSTS (1y, includeSubDomains, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: DENY`, attached to both cache behaviors.
- **Deploy-time input validation.** `AllowedPattern`/length bounds on the CFN parameters that flow into the page.
- **`sam/verify.sh`** re-checks the above against a live distribution and is the expected smoke test after a deploy that touches security-relevant code.

Known items intentionally deferred (they change behavior or deploy semantics and want explicit review): `Content-Disposition` on the files origin; resolving the CORS circular dependency; refactoring the inline `<script>` config so a CSP can drop `'unsafe-inline'`; custom domain + TLS 1.2_2021; opt-in WAF; Lambda CloudWatch Logs.

## Code Conventions

- **No linter or formatter configured** — there are no ESLint, Prettier, or Python linting configs. Match surrounding style (4-space indent, `let`/`const`, `snake_case` for some JS helpers alongside `camelCase` — the file is inconsistent by history).
- **No CI/CD pipeline** — build, test, and deployment are manual.
- **Security annotations** — Python files use `# nosec` comments for bandit suppression (`hardcoded_tmp_directory`, `assert_used`). Keep them when moving that code.
- **Infrastructure suppressions** — `template.yaml` resources carry `cfn_nag` / `cdk_nag` / `checkov` suppression metadata with written justifications. Preserve the reasons if you touch those resources.
- **Vendor libraries are committed** — jQuery, Bootstrap, Luxon, and AWS SDK are checked into `website/js/` and `website/css/` as minified files.
- **Resource naming** — every named AWS resource uses a `${Unique}` suffix derived from the stack ID (`!Select [4, !Split ['-', !Select [2, !Split ['/', !Ref 'AWS::StackId']]]]`). Follow the same pattern for new named resources.
- **License** — MIT-0 (MIT No Attribution). Source files carry the Amazon copyright + `SPDX-License-Identifier: MIT-0` header.

## Key Files for Common Changes

| What to change | File(s) |
|---|---|
| File listing UI, sorting, pagination | `website/js/main.js` |
| Page layout, HTML structure, vendor script tags/SRI | `website/index.html` |
| Custom styles | `website/css/main.css` |
| AWS infrastructure (buckets, CDN, IAM, headers policy) — SAM | `sam/template.yaml` |
| AWS infrastructure — CDK | `cdk/pfb_cdk/pfb_stack.py` |
| Deployment logic (file upload/config substitution) | `sam/seed_s3_data/app.py` (shared by both SAM and CDK) |
| Tests — SAM Lambda | `sam/tests/unit/test_seed_s3_data.py` |
| Tests — CDK stack | `cdk/tests/unit/test_pfb_stack.py` |
| Post-deploy verification | `sam/verify.sh` (works against either deployment) |

## Important Notes

- **After modifying anything under `website/`, re-run `zip -FS -x "*.DS_Store" -r ./sam/seed_s3_data/website.zip website` from the repo root and commit the updated zip.** The Lambda reads the zip, not the source tree, so an un-rebuilt zip silently deploys stale assets.
- The seeding Lambda is **create-only and non-destructive**: if the website bucket already has any object it returns early. Stack *updates* are a no-op (`@helper.update`). To push new website assets to an existing stack, upload to the `public-file-browser-website-*` bucket yourself and create a CloudFront invalidation.
- The `samconfig.toml` file (SAM deployment config) and `.aws-sam/` are gitignored.
- S3 buckets have encryption, versioning, and a 90-day noncurrent-version expiry configured in the SAM template. The logging bucket has `DeletionPolicy: Retain`.
- The frontend sorts folders above files only when the listing is a single un-truncated page (<1000 objects); otherwise it uses S3's lexicographic order. This is deliberate — see the comment in `get_display_order()` and the FAQ in `README.md`.
- Version skew to be aware of: the Lambda `Runtime` is `python3.13` in `template.yaml`, while both `pyproject.toml` files still pin `python = "~3.11"` and `README.md` lists Python 3.11 as a prerequisite. `seed_s3_data/requirements.txt` uses `python_version >= "3.13"` markers; `tests/requirements.txt` still uses `>= "3.11", < "3.12"`.
- `CHANGELOG.md` follows Keep a Changelog; the last released version is 1.0.0.
- `cdk/pfb_cdk/lambda_bundling.py`'s local bundler drops those `python_version` markers before installing (otherwise pip evaluates them against the synth host and resolves to an empty install on anything older than 3.13), skips `sys_platform`-gated non-Linux requirements, and cross-installs wheels for `manylinux2014_aarch64`/Python 3.13 regardless of the host — this is what lets `cdk synth`/tests work with no Docker daemon available.
- CDK test fixtures load `cdk/cdk.json`'s `context` block explicitly (a bare `cdk.App()` doesn't pick it up outside the `cdk` CLI). Feature flags change synthesized output, so **audit new flags against this project's constraints** — the list came from `cdk init` boilerplate, and `@aws-cdk/aws-lambda:useCdkManagedLogGroup` ships as `true`, which synthesizes exactly the `Retain`-policy CloudWatch log group the no-`AWSLambdaBasicExecutionRole` design exists to avoid. It is set to `false`, with a test asserting zero `AWS::Logs::LogGroup` resources.
- CDK bucket removal policies are set explicitly to match SAM (logging bucket `Retain`, website + files `Delete`) because CDK's `s3.Bucket` default is `Retain`. `Delete` can't lose user data — S3 refuses to delete a non-empty bucket. `auto_delete_objects` is deliberately unused: it adds a second Lambda with CloudWatch permissions.
