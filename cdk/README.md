# Public File Browser for Amazon S3 — AWS CDK (Python)

A CDK translation of `../sam/template.yaml`, provided as an alternative to the
SAM/CloudFormation deployment path. It creates the same resources — 3 S3
buckets (website, files, logging), a CloudFront distribution with an Origin
Access Control and a security response headers policy, a Cognito
unauthenticated identity pool, and the Lambda-backed custom resource that
seeds the website bucket — with the same naming convention and security
posture. See the root `CLAUDE.md` for the shared architecture/security
background; this file only covers what's specific to the CDK app.

The seeding Lambda's source (`app.py`) and its bundled `website.zip` are
**reused directly from `../sam/seed_s3_data/`** — there is one copy of that
code, not two.

## Prerequisites

- Python 3.11+
- Node.js (for the `aws-cdk` CLI)
- AWS CLI credentials with permission to deploy the stack

```bash
npm install -g aws-cdk
pip install -r requirements.txt -r requirements-dev.txt
```

No Docker is required. The seeding Lambda's third-party dependencies
(`crhelper`, `loguru`, `simplejson` — not part of the standard Lambda Python
runtime) are vendored at synth time by downloading pre-built wheels for the
target runtime (`python3.13`/`arm64`) directly via pip, rather than shelling
out to a container (see `pfb_cdk/lambda_bundling.py`).

## Key commands

Run these from this directory (`cdk/`):

```bash
# One-time per account/region
cdk bootstrap

# Preview the generated CloudFormation
cdk synth

# Deploy (first pass — CrossOriginRestriction defaults to "*")
cdk deploy

# Second pass: narrow CORS to the FileBrowserURL output from the first deploy,
# the same two-pass requirement as the SAM template (see root CLAUDE.md).
cdk deploy --parameters CrossOriginRestriction=https://d111111abcdef8.cloudfront.net

# Unit tests (aws_cdk.assertions against the synthesized template)
python -m pytest tests/unit -v

# Diff against a deployed stack
cdk diff
```

## Project layout

```
cdk/
├── app.py                       # CDK app entrypoint
├── cdk.json                     # CDK CLI config + feature-flag context
├── requirements.txt             # aws-cdk-lib, constructs
├── requirements-dev.txt         # pytest
├── pfb_cdk/
│   ├── pfb_stack.py             # the stack: buckets, CloudFront, Cognito, Lambda custom resource
│   └── lambda_bundling.py       # non-Docker asset bundling for the seed_s3_data Lambda
└── tests/unit/test_pfb_stack.py # aws_cdk.assertions unit tests
```

## Notes

- **Only deploy one of `sam/` or `cdk/` per environment.** They are
  independent CloudFormation stacks (the CDK app is not imported into or
  managed by the SAM stack, and vice versa); deploying both against the same
  account/region creates two separate, fully duplicate sets of buckets/
  CloudFront distributions/Cognito pools, not an update of one by the other.
- **Deletion policies match SAM, not CDK defaults.** Only the logging bucket
  is `Retain`; the website and files buckets are `Delete`. CDK's `s3.Bucket`
  default is `Retain`, so both are set explicitly. `Delete` cannot lose the
  user's files — S3 refuses to delete a non-empty bucket, so stack deletion
  fails loudly instead. `auto_delete_objects` is deliberately **not** used: it
  provisions a second Lambda with CloudWatch permissions, reintroducing the
  leftover log group this stack avoids.
- **No CloudWatch log group is created.** `cdk.json` sets
  `@aws-cdk/aws-lambda:useCdkManagedLogGroup` to `false`. Left at the
  `cdk init` default of `true`, `lambda_.Function` synthesizes a
  `Retain`-policy log group, which is exactly the uncleanable leftover the
  no-`AWSLambdaBasicExecutionRole` design exists to prevent. A unit test
  asserts the resource count stays at zero.
- One intentional IAM difference from SAM: the OAC bucket policies grant
  `s3:GetObject` but not `s3:GetObjectVersion` (CDK's
  `S3BucketOrigin.with_origin_access_control` generates the former only).
  CloudFront never issues versioned object requests through an OAC origin, so
  the narrower grant is equivalent in behavior and slightly tighter.
- Resource names use the same `public-file-browser-<kind>-<Unique>` pattern
  as the SAM template (`<Unique>` derived from the stack ID), so operational
  docs and scripts that match on that prefix work against either deployment.
- `sam/verify.sh` (headers, HSTS, XSS regression, SRI checks) works unchanged
  against a CDK-deployed stack too — it only depends on the `FileBrowserURL`.
- Test fixtures load `cdk.json`'s `context` block explicitly into the test
  `App()` (see `tests/unit/test_pfb_stack.py`) — a bare `cdk.App()` in a test
  process doesn't pick up `cdk.json` context the way the `cdk` CLI does, and
  feature flags change the synthesized output
  (`@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy` switches log delivery
  between a bucket policy and a legacy ACL grant;
  `@aws-cdk/aws-lambda:useCdkManagedLogGroup` decides whether a log group is
  emitted at all). Tests should assert against the template `cdk deploy`
  actually pushes.
- If you add stack code that depends on a new feature flag, add it to
  `cdk.json` — but audit it against this project's constraints first. The flag
  list came from `cdk init` boilerplate, and at least one of its defaults
  (`useCdkManagedLogGroup`) conflicts with the no-log-group design.
