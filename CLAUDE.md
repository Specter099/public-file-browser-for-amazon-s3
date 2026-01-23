# CLAUDE.md - AI Assistant Guide

This document provides guidance for AI assistants working with the Public File Browser for Amazon S3 codebase.

## Project Overview

Public File Browser for Amazon S3 is an AWS sample project that creates a public file repository using Amazon S3 and CloudFront. Users can browse and download files from an S3 bucket through a web interface without authentication.

### Architecture

1. Static website served via CloudFront CDN (from S3 "Website" bucket)
2. Browser obtains temporary credentials from Cognito Identity Pool (unauthenticated)
3. Cognito credentials allow listing files in the public S3 "Files" bucket
4. File downloads are served via CloudFront CDN

## Repository Structure

```
/
├── sam/                          # AWS SAM infrastructure
│   ├── template.yaml             # Main CloudFormation/SAM template
│   ├── seed_s3_data/             # Lambda function for deployment
│   │   ├── app.py                # Lambda handler code
│   │   ├── pyproject.toml        # Python dependencies (Poetry)
│   │   └── website.zip           # Pre-packaged website for deployment
│   └── tests/                    # Python unit tests
│       ├── unit/
│       │   └── test_seed_s3_data.py
│       └── pyproject.toml        # Test dependencies
├── website/                      # Static frontend website
│   ├── index.html                # Main HTML (with placeholder configs)
│   ├── js/
│   │   ├── main.js               # Core application logic
│   │   ├── aws-sdk-js-v2.*.js    # AWS SDK for browser
│   │   ├── bootstrap.*.js        # Bootstrap framework
│   │   ├── jquery-*.js           # jQuery
│   │   └── luxon.min.js          # Date/time library
│   ├── css/
│   │   ├── main.css              # Custom styles
│   │   └── bootstrap*.css        # Bootstrap styles
│   └── icon/                     # Favicons and PWA icons
├── docs/                         # Documentation images
├── README.md                     # Main documentation
├── CONTRIBUTING.md               # Contribution guidelines
├── CHANGELOG.md                  # Version history
└── LICENSE                       # MIT-0 License
```

## Key Technologies

### Backend/Infrastructure
- **AWS SAM**: Serverless Application Model for deployment
- **Python 3.13**: Lambda runtime (recently updated from 3.11)
- **Poetry**: Python dependency management
- **CloudFormation**: Infrastructure as Code

### Frontend
- **Vanilla JavaScript**: No framework, plain JS
- **jQuery 3.7.1**: DOM manipulation
- **Bootstrap 5**: UI components and styling
- **Bootstrap Icons**: Icon library
- **Luxon**: Date/time formatting
- **AWS SDK for JavaScript v2**: S3 API calls from browser

### Testing
- **pytest**: Python test framework
- **moto**: AWS service mocking
- **coverage**: Code coverage reporting

## Development Workflow

### Local Website Development

Run a local web server from the `website/` directory:

```bash
# Using local-web-server (npm package)
ws -r '/ -> index.html' '/pfb_for_s3/(.*) -> /$1' --log.format dev
```

Note: The website requires valid AWS Cognito and S3 configuration to function properly.

### Building and Deploying

1. Navigate to `./sam/` directory
2. Build: `sam build`
3. Deploy: `sam deploy --guided --capabilities CAPABILITY_NAMED_IAM`

### Re-packaging Website for Deployment

When modifying files in `./website/`, regenerate the deployment package:

```bash
# From repository root
zip -FS -x "*.DS_Store" -r ./sam/seed_s3_data/website.zip website
```

### Running Tests

```bash
cd sam/tests
poetry install
poetry run pytest
```

Or with coverage:

```bash
poetry run coverage run -m pytest
poetry run coverage report
```

## Code Conventions

### Python (Lambda Functions)

- Uses `loguru` for logging with `LOGURU_LEVEL` environment variable
- Uses `crhelper` for CloudFormation custom resource handling
- Uses `simplejson` for JSON serialization
- Security comments: `# nosec` for bandit suppressions
- Copyright header: `# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.`
- License header: `# SPDX-License-Identifier: MIT-0`

### JavaScript (Frontend)

- Global configuration via `awsConfigOptions` object in HTML
- Placeholder tokens for deployment-time replacement:
  - `###REPLACE_ME_SITE_NAME###`
  - `###REPLACE_ME_IDENTITY_POOL_ID###`
  - `###REPLACE_ME_BUCKET_NAME###`
  - `###REPLACE_ME_FILES_OPEN_MODE###`
  - `###REPLACE_ME_VISIBLE_STORAGE_CLASSES###`
- HTML escaping via `escapeHtml()` function for security
- File icons mapped by extension in `iconMap` object
- URL state management via query parameters (`?p=` for prefix, `?s=` for pagination)

### SAM Template

- Uses `cfn_nag`, `cdk_nag`, and `checkov` metadata for security scanning suppressions
- Bucket names follow pattern: `public-file-browser-{type}-{unique-id}`
- All S3 buckets have:
  - Versioning enabled
  - Encryption at rest (AES256)
  - Public access blocked
  - 90-day lifecycle for noncurrent versions
  - Access logging to logging bucket

## Important Files to Understand

### `sam/template.yaml`
The main infrastructure definition. Creates:
- 3 S3 buckets (website, files, logging)
- CloudFront distribution with two origins
- Cognito Identity Pool for unauthenticated access
- Lambda function for website seeding
- IAM roles and policies

### `sam/seed_s3_data/app.py`
CloudFormation custom resource Lambda that:
- Extracts `website.zip` on create
- Replaces placeholder tokens with actual values
- Uploads website files to S3
- Cleans up on delete

### `website/js/main.js`
Core frontend functionality:
- `reset()`: Main entry point, updates URL and renders table
- `renderTable()`: Lists S3 objects using AWS SDK
- `getRow()`: Generates HTML for each file/folder row
- `get_display_order()`: Handles sorting (folders first for <1000 items)
- `localNav()`: SPA-style navigation without page reload

## Common Tasks

### Adding a New File Type Icon
Edit `iconMap` in `website/js/main.js`:
```javascript
const iconMap = {
    '.newext': 'bi-file-earmark-xxx',
    // ...
}
```

### Modifying Deployment Parameters
Edit `Parameters` section in `sam/template.yaml`. Available parameters:
- `SiteName`: Display title
- `FilesOpenTabMode`: "In New Tab" or "In Same Tab"
- `VisibleStorageClasses`: Comma-separated S3 storage classes
- `CrossOriginRestriction`: CORS setting (use `*` initially, then CloudFront URL)

### Adding Tests
Create test files in `sam/tests/unit/` following pytest conventions. Use `@mock_s3` decorator from moto for S3 operations.

## Security Considerations

- All data in the "Files" bucket is publicly accessible via CloudFront
- Never store sensitive data in the public files bucket
- Cognito provides unauthenticated read-only access (ListBucket only)
- CORS must be configured properly after initial deployment
- TLS is enforced via CloudFront redirect

## Deployment Regions

The solution requires CloudFront Standard Log support. Check `README.md` for the current list of supported regions.

## License

MIT-0 (MIT No Attribution) - See LICENSE file
