# CLAUDE.md

## Project Overview

**Public File Browser for Amazon S3** is a serverless AWS solution that provides a public, read-only file browsing interface for an S3 bucket. It serves a static website via Amazon CloudFront that lists and allows downloading of files stored in S3. No backend servers are required — the frontend uses AWS Cognito for temporary credentials and calls S3 directly from the browser.

## Repository Structure

```
├── frontend/                   # React + TypeScript SPA (Vite, Tailwind, AWS SDK v3)
│   ├── index.html              # App shell; SRI digests injected at build time
│   ├── vite.config.ts          # Build config + the build-time SRI plugin
│   ├── scripts/verify-sri.mjs  # Standalone SRI check over the build output
│   ├── public/
│   │   ├── config.json         # Deploy-time settings (templated placeholders)
│   │   └── icon/               # Favicons, app icons, site.webmanifest (also templated)
│   └── src/
│       ├── main.tsx            # Loads config.json, then mounts the app
│       ├── App.tsx             # Page composition + data fetching
│       ├── components/         # Breadcrumbs, Toolbar, ListingTable, ListingGrid, FileIcon
│       └── lib/                # config, s3, sort, format, fileKind, hooks (+ *.test.ts)
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

**Frontend:** React 19 + TypeScript, built with Vite, styled with Tailwind CSS 4
- AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/credential-provider-cognito-identity`)
- No UI component library, no icon font — icons are inline SVG (`src/components/FileIcon.tsx`)
- Tests: Vitest + React Testing Library (jsdom)

**Infrastructure:** AWS SAM (CloudFormation), with an AWS CDK (Python) equivalent under `cdk/`
- S3 (3 buckets: website, files, logs), CloudFront (+ Response Headers Policy, Origin Access Control), Cognito Identity Pool, Lambda, IAM

**Backend:** Python 3.13 Lambda function (arm64)
- boto3, crhelper, loguru, simplejson

**Tests:** pytest with moto (AWS mocking)

## Build and Deployment

The frontend **does** have a build step (Vite). Its built output is committed as
`sam/seed_s3_data/website.zip`, which is what actually gets deployed.

### Key Commands

```bash
# Frontend: build + verify SRI + rewrite sam/seed_s3_data/website.zip
cd frontend
npm install
npm run bundle          # do this BEFORE sam build / cdk deploy, and commit the zip
npm run dev             # local dev server
npm run test            # Vitest + React Testing Library
npm run typecheck

# Build and deploy (run from the sam/ directory)
cd sam
sam build
sam deploy --guided --capabilities CAPABILITY_NAMED_IAM

# Verify a deployed stack (headers, HSTS, redirect, XSS, SRI digests, config.json)
./verify.sh https://d111111abcdef8.cloudfront.net
```

Deployment is intentionally a **two-pass** process: deploy once with `CrossOriginRestriction=*`, then redeploy with the parameter set to the `FileBrowserURL` stack output. The CORS rule on the files bucket cannot reference the CloudFront distribution directly without a circular dependency.

### Running Tests

```bash
# From the sam/ directory. PYTHONPATH=.. is REQUIRED — the tests import `sam.seed_s3_data.app`,
# so the repo root must be on sys.path.
cd sam && PYTHONPATH=.. python -m pytest tests/unit/test_seed_s3_data.py -v
```

Tests use `moto` to mock AWS S3 and verify the Lambda custom resource (7 tests):
- `test_seed_data` — `config.json` gets the correct substituted values
- `test_seed_data_leaves_bundled_index_html_untouched` — the seeding step must not rewrite `index.html`, or its SRI digests break
- `test_seed_data_sets_same_tab_mode` — `In Same Tab` maps to `"false"`
- `test_seed_data_escapes_values_for_json` — a value containing quotes cannot corrupt or inject keys into `config.json`
- `test_seed_data_with_existing_data` — idempotency (won't overwrite existing files)
- `test_seed_data_preserves_sitename_verbatim` — permitted SiteName passes through and no `###REPLACE_ME_*###` markers leak through
- `test_delete_data_with_existing_data` — cleanup on stack deletion

The tests chdir into `seed_s3_data` (so the Lambda can find `website.zip` by relative path) and write to `/tmp/website/`. They must be run from `sam/`. The chdir helper is idempotent, so unlike before they are **not** order-dependent — a single test by node id works.

Because they read `website.zip`, these tests exercise the **committed built frontend**. If you change `frontend/` without re-running `npm run bundle`, they test stale assets.

### Frontend tests

```bash
cd frontend && npm run test    # 81 tests across 5 files
```

Covers `lib/` units (config parsing, S3 listing/pagination/storage-class filtering, sort/filter semantics, formatting) and `App.tsx` integration against a fake S3 client — navigation, breadcrumbs, filtering, sorting, view toggle, pagination, theme, and a security group asserting XSS payloads render inert and `target="_blank"` always carries `rel="noopener noreferrer"`.

### Other checks used in review

```bash
cd frontend && npm run typecheck   # tsc; no ESLint is configured
cd frontend && npm run verify:sri  # built SRI digests match emitted assets
cfn-lint sam/template.yaml         # template lint; some pre-existing warnings are expected
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

The frontend does all S3 interaction client-side:
1. `main.tsx` fetches `/pfb_for_s3/config.json` and only then mounts the app — the bucket name and identity pool ID are not known until deploy time.
2. `lib/s3.ts` obtains guest credentials via `fromCognitoIdentityPool` (unauthenticated identity pool). The AWS region is derived from the identity pool ID prefix.
3. Calls `ListObjectsV2Command` with `Delimiter: "/"` for the current prefix, maps `CommonPrefixes` to folders and `Contents` to files, and drops objects whose storage class isn't in `visibleStorageClasses`.
4. `App.tsx` filters (search box) then sorts (`lib/sort.ts`) and renders either `ListingTable` or `ListingGrid`.
5. Pagination (>1000 objects, via `StartAfter`) and navigation use URL parameters (`p` for prefix, `s` for start position) — unchanged from the pre-rebuild app, so old links keep working. `useBrowserLocation` handles `history.pushState` and `popstate`.

The SAM template (`sam/template.yaml`) creates all infrastructure. During stack creation, a Lambda custom resource (`seed_s3_data/app.py`) extracts `website.zip`, substitutes placeholders into `config.json` and `icon/site.webmanifest`, and uploads the files under the `pfb_for_s3/` key prefix in the website S3 bucket. CloudFront serves `pfb_for_s3/*` from the website bucket and everything else from the files bucket, so file URLs look like `/<object key>`.

**The `/pfb_for_s3/` prefix is load-bearing.** It's the Vite `base` (see `BASE` in `frontend/vite.config.ts`), the CloudFront cache-behavior path pattern, and the `DefaultRootObject` (`pfb_for_s3/index.html`). Changing one requires changing all three.

The Lambda is deliberately **not** granted `AWSLambdaBasicExecutionRole` — CloudWatch log group creation during stack deletion would leave an uncleanable resource behind. This means the function produces no CloudWatch logs; debug deploy-time failures via the CloudFormation events and the custom resource response instead.

### Template Placeholders

Replaced at deploy time by the Lambda, in **both** `config.json` and `icon/site.webmanifest` (both JSON; values are JSON-escaped on substitution). Notably **not** in `index.html` — that's build output carrying SRI digests, and rewriting it would invalidate them:
- `###REPLACE_ME_SITE_NAME###`
- `###REPLACE_ME_IDENTITY_POOL_ID###`
- `###REPLACE_ME_BUCKET_NAME###`
- `###REPLACE_ME_FILES_OPEN_MODE###` (mapped from "In New Tab"/"In Same Tab" to the **strings** `"true"`/`"false"`)
- `###REPLACE_ME_VISIBLE_STORAGE_CLASSES###`

Every value in `config.json` is a JSON string, including `filesOpenInNewTab`, so the file parses both before and after substitution (local dev and the frontend tests read the un-substituted file). `lib/config.ts` coerces the types and treats anything other than `"false"` as new-tab, so an unsubstituted placeholder degrades to the documented default instead of silently flipping behavior.

### CloudFormation Parameters

| Parameter | Default | Notes |
|---|---|---|
| SiteName | "AnyCompany Public Files" | Display title. 1–80 chars, `AllowedPattern` restricts to alphanumerics plus `. , ' - _ : ( )` to block HTML/JS injection at deploy time |
| FilesOpenTabMode | "In New Tab" | `In New Tab` or `In Same Tab` |
| VisibleStorageClasses | "STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY" | Which storage classes to show; `AllowedPattern` `^[A-Z_]+(,[A-Z_]+)*$` |
| CrossOriginRestriction | "*" | CORS origin. `*` on first deploy, then the `FileBrowserURL` output (no trailing slash) |

## Security Posture

The security-hardening work in commit `27af432` established conventions that the React rebuild preserves (by different means in some cases):

- **Never use `dangerouslySetInnerHTML`.** Object keys and the `?p=` prefix are attacker-controllable. The pre-rebuild app concatenated markup and depended on calling `escapeHtml()` on every interpolated value; React escapes text children automatically, which removes that whole class of bug — but only as long as nothing reaches for `dangerouslySetInnerHTML`. There are currently zero uses in the codebase. `frontend/src/App.test.tsx` has a `describe("security")` block asserting a `<img src=x onerror=...>` prefix renders as inert text.
- **`target="_blank"` always carries `rel="noopener noreferrer"`.** Asserted in tests for both table and grid views.
- **Object keys are percent-encoded per path segment** before going into an `href` (`objectUrl` in `lib/s3.ts`).
- **SVG objects are never rendered as inline thumbnails**, even though they're images — a same-origin SVG can carry script, and whoever administers the files bucket controls its contents. See `isThumbnailable` in `lib/fileKind.ts`.
- **Subresource Integrity is generated at build time**, not hand-maintained — a bundled build has no fixed vendor filenames to pin. `frontend/vite.config.ts` computes sha384 digests for every emitted JS/CSS asset and injects them into `index.html`.
  - Digests are hashed from the files **as written to disk** (`closeBundle`), not from chunk contents in `generateBundle`: chunk code is still rewritten after that hook, so hashing there yields digests that don't match what the browser fetches, and the page then renders blank with no server-side symptom. This was a real bug caught during the rebuild — don't "simplify" it back.
  - `public/` files are deliberately excluded, because `icon/site.webmanifest` is rewritten at deploy time.
  - `npm run verify:sri` guards the invariant locally; `sam/verify.sh` re-checks digests against a live distribution.
- **CloudFront response headers.** `SecurityResponseHeadersPolicy` in `template.yaml` sets HSTS (1y, includeSubDomains, preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `X-Frame-Options: DENY`, attached to both cache behaviors.
- **Deploy-time input validation.** `AllowedPattern`/length bounds on the CFN parameters that flow into the page.
- **`sam/verify.sh`** re-checks the above against a live distribution and is the expected smoke test after a deploy that touches security-relevant code.

Known items intentionally deferred (they change behavior or deploy semantics and want explicit review): `Content-Disposition` on the files origin; resolving the CORS circular dependency; adding a Content-Security-Policy header; custom domain + TLS 1.2_2021; opt-in WAF; Lambda CloudWatch Logs.

The rebuild removed the main obstacle to a CSP: there is no longer an inline `<script>` config block (settings come from `config.json` at runtime) and no inline theme-bootstrap script (the default theme comes from a `prefers-color-scheme` media query in CSS, with `.dark`/`.light` classes only for explicit overrides). Adding a CSP to `SecurityResponseHeadersPolicy` should no longer require `'unsafe-inline'` for scripts — but Tailwind's build still emits a stylesheet only, so verify `style-src` behavior before enabling.

## Code Conventions

- **No linter or formatter configured** — there are no ESLint, Prettier, or Python linting configs. TypeScript runs in strict mode (plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`), so `npm run typecheck` is the closest thing to a lint gate. Match surrounding style: 2-space indent and double quotes in TS/TSX, 4-space in Python.
- **No CI/CD pipeline** — build, test, and deployment are manual.
- **Security annotations** — Python files use `# nosec` comments for bandit suppression (`hardcoded_tmp_directory`, `assert_used`). Keep them when moving that code.
- **Infrastructure suppressions** — `template.yaml` resources carry `cfn_nag` / `cdk_nag` / `checkov` suppression metadata with written justifications. Preserve the reasons if you touch those resources.
- **Frontend dependencies come from npm** — `frontend/node_modules/` is gitignored and `package-lock.json` is committed. The pre-rebuild practice of committing vendored minified libraries is gone.
- **Resource naming** — every named AWS resource uses a `${Unique}` suffix derived from the stack ID (`!Select [4, !Split ['-', !Select [2, !Split ['/', !Ref 'AWS::StackId']]]]`). Follow the same pattern for new named resources.
- **License** — MIT-0 (MIT No Attribution). Source files carry the Amazon copyright + `SPDX-License-Identifier: MIT-0` header.

## Key Files for Common Changes

| What to change | File(s) |
|---|---|
| File listing UI (table/grid), search, sort | `frontend/src/App.tsx`, `frontend/src/components/`, `frontend/src/lib/sort.ts` |
| S3 calls, pagination, breadcrumb/URL helpers | `frontend/src/lib/s3.ts`, `frontend/src/lib/useBrowserLocation.ts` |
| Runtime config schema/parsing | `frontend/public/config.json`, `frontend/src/lib/config.ts` |
| Page shell, build config, SRI generation | `frontend/index.html`, `frontend/vite.config.ts` |
| Theme, colors, global styles | `frontend/src/styles.css`, `frontend/src/lib/useTheme.ts` |
| File type icons / thumbnail policy | `frontend/src/components/FileIcon.tsx`, `frontend/src/lib/fileKind.ts` |
| AWS infrastructure (buckets, CDN, IAM, headers policy) — SAM | `sam/template.yaml` |
| AWS infrastructure — CDK | `cdk/pfb_cdk/pfb_stack.py` |
| Deployment logic (file upload/config substitution) | `sam/seed_s3_data/app.py` (shared by both SAM and CDK) |
| Tests — frontend | `frontend/src/**/*.test.ts(x)` |
| Tests — SAM Lambda | `sam/tests/unit/test_seed_s3_data.py` |
| Tests — CDK stack | `cdk/tests/unit/test_pfb_stack.py` |
| Post-deploy verification | `sam/verify.sh` (works against either deployment) |

## Important Notes

- **After modifying anything under `frontend/`, run `npm run bundle` from `frontend/` and commit the regenerated `sam/seed_s3_data/website.zip`.** The Lambda reads the zip, not the source tree, so an un-rebuilt zip silently deploys stale assets — and the SAM pytest suite will be testing stale assets too. `npm run bundle` builds, verifies SRI digests, and rewrites the zip in one step.
- The seeding Lambda is **create-only and non-destructive**: if the website bucket already has any object it returns early. Stack *updates* are a no-op (`@helper.update`). To push new website assets to an existing stack, upload to the `public-file-browser-website-*` bucket yourself and create a CloudFront invalidation.
- The `samconfig.toml` file (SAM deployment config) and `.aws-sam/` are gitignored.
- S3 buckets have encryption, versioning, and a 90-day noncurrent-version expiry configured in the SAM template. The logging bucket has `DeletionPolicy: Retain`.
- The frontend sorts folders above files only when the listing is a single un-truncated page (<1000 objects); otherwise it uses S3's lexicographic order. This is deliberate — see the comment in `sortEntries()` in `frontend/src/lib/sort.ts` and the FAQ in `README.md`. An explicit user sort (clicking a column header) does regroup folders even on a truncated page, since the user asked for that ordering. Key comparison is by byte value, matching S3's own ordering — deliberately not `localeCompare`, which would diverge from S3's pagination order.
- Version skew to be aware of: the Lambda `Runtime` is `python3.13` in `template.yaml`, while both `pyproject.toml` files still pin `python = "~3.11"` and `README.md` lists Python 3.11 as a prerequisite. `seed_s3_data/requirements.txt` uses `python_version >= "3.13"` markers; `tests/requirements.txt` still uses `>= "3.11", < "3.12"`.
- `CHANGELOG.md` follows Keep a Changelog; the last released version is 1.0.0.
- `cdk/pfb_cdk/lambda_bundling.py`'s local bundler drops those `python_version` markers before installing (otherwise pip evaluates them against the synth host and resolves to an empty install on anything older than 3.13), skips `sys_platform`-gated non-Linux requirements, and cross-installs wheels for `manylinux2014_aarch64`/Python 3.13 regardless of the host — this is what lets `cdk synth`/tests work with no Docker daemon available.
- CDK test fixtures load `cdk/cdk.json`'s `context` block explicitly (a bare `cdk.App()` doesn't pick it up outside the `cdk` CLI). Feature flags change synthesized output, so **audit new flags against this project's constraints** — the list came from `cdk init` boilerplate, and `@aws-cdk/aws-lambda:useCdkManagedLogGroup` ships as `true`, which synthesizes exactly the `Retain`-policy CloudWatch log group the no-`AWSLambdaBasicExecutionRole` design exists to avoid. It is set to `false`, with a test asserting zero `AWS::Logs::LogGroup` resources.
- CDK bucket removal policies are set explicitly to match SAM (logging bucket `Retain`, website + files `Delete`) because CDK's `s3.Bucket` default is `Retain`. `Delete` can't lose user data — S3 refuses to delete a non-empty bucket. `auto_delete_objects` is deliberately unused: it adds a second Lambda with CloudWatch permissions.
