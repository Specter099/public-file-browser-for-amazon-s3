# CLAUDE.md

## Project Overview

**Public File Browser for Amazon S3** is a serverless AWS solution that provides a public, read-only file browsing interface for an S3 bucket. It serves a static website via Amazon CloudFront that lists and allows downloading of files stored in S3. No backend servers are required — the frontend uses AWS Cognito for temporary credentials and calls S3 directly from the browser.

## Repository Structure

```
├── website/                    # Static frontend (HTML/CSS/JS, no build step)
│   ├── index.html              # Entry point with template placeholders
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
│   └── icon/                   # Favicons and app icons
├── sam/                        # AWS SAM infrastructure
│   ├── template.yaml           # CloudFormation/SAM template (~490 lines)
│   ├── seed_s3_data/           # Lambda custom resource
│   │   ├── app.py              # Deploys website files to S3
│   │   ├── website.zip         # Bundled website for deployment
│   │   ├── pyproject.toml
│   │   └── requirements.txt
│   └── tests/
│       └── unit/
│           └── test_seed_s3_data.py  # 3 pytest tests using moto
└── docs/                       # Architecture diagram and screenshots
```

## Tech Stack

**Frontend:** Vanilla HTML/CSS/JavaScript (no framework, no transpilation)
- Bootstrap 5.3 (UI), jQuery 3.7.1 (DOM), Luxon (dates), AWS SDK v2 (S3 API)

**Infrastructure:** AWS SAM (CloudFormation)
- S3 (3 buckets: website, files, logs), CloudFront, Cognito, Lambda, IAM

**Backend:** Python 3.13 Lambda function
- boto3, crhelper, loguru, simplejson

**Tests:** pytest with moto (AWS mocking)

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

### Running Tests

```bash
# From the sam/ directory
cd sam && python -m pytest tests/unit/test_seed_s3_data.py
```

Tests use `moto` to mock AWS S3 and verify the Lambda custom resource:
- `test_seed_data` — website files are created with correct config substitutions
- `test_seed_data_with_existing_data` — idempotency (won't overwrite existing files)
- `test_delete_data_with_existing_data` — cleanup on stack deletion

## Architecture

The frontend (`website/js/main.js`) does all S3 interaction client-side:
1. Obtains temporary credentials from Cognito (unauthenticated identity pool)
2. Calls `S3.listObjectsV2()` to fetch bucket contents for the current prefix
3. Renders a file table with icons, sizes, dates, and storage classes
4. Handles pagination (>1000 objects) and breadcrumb navigation via URL parameters (`p` for prefix, `s` for start position)

The SAM template (`sam/template.yaml`) creates all infrastructure. During stack creation, a Lambda custom resource (`seed_s3_data/app.py`) extracts `website.zip`, replaces template placeholders in `index.html`, and uploads the files to the website S3 bucket.

### Template Placeholders in `index.html`

These are replaced at deploy time by the Lambda function:
- `###REPLACE_ME_SITE_NAME###`
- `###REPLACE_ME_IDENTITY_POOL_ID###`
- `###REPLACE_ME_BUCKET_NAME###`
- `###REPLACE_ME_FILES_OPEN_MODE###`
- `###REPLACE_ME_VISIBLE_STORAGE_CLASSES###`

### CloudFormation Parameters

| Parameter | Default | Description |
|---|---|---|
| SiteName | "AnyCompany Public Files" | Display title |
| FilesOpenTabMode | "In New Tab" | File open behavior |
| VisibleStorageClasses | "STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY" | Which storage classes to show |
| CrossOriginRestriction | "*" | CORS origin policy |

## Code Conventions

- **No linter or formatter configured** — there are no ESLint, Prettier, or Python linting configs
- **No CI/CD pipeline** — deployment is manual via SAM CLI
- **Security annotations** — Python test files use `# nosec` comments for bandit suppression
- **Vendor libraries are committed** — jQuery, Bootstrap, Luxon, and AWS SDK are checked into `website/js/` and `website/css/` as minified files
- **License** — MIT-0 (MIT No Attribution)

## Key Files for Common Changes

| What to change | File(s) |
|---|---|
| File listing UI, sorting, pagination | `website/js/main.js` |
| Page layout, HTML structure | `website/index.html` |
| Custom styles | `website/css/main.css` |
| AWS infrastructure (buckets, CDN, IAM) | `sam/template.yaml` |
| Deployment logic (file upload/config) | `sam/seed_s3_data/app.py` |
| Tests | `sam/tests/unit/test_seed_s3_data.py` |

## Important Notes

- After modifying files in `website/`, you must re-run `zip -FS -x "*.DS_Store" -r ./sam/seed_s3_data/website.zip website` before deploying with SAM, since the Lambda reads from the zip
- The `samconfig.toml` file (SAM deployment config) is gitignored
- S3 buckets have encryption, versioning, and lifecycle rules configured in the SAM template
- The frontend sorts folders above files only when total objects < 1000; otherwise it uses S3's lexicographic order
