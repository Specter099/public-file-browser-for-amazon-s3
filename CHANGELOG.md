# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- AWS CDK (Python) deployment option under `cdk/`, equivalent to the existing SAM
  template. Either may be used; they are independent stacks.
- Frontend: grid/thumbnail view, filename filtering within a folder, sortable
  columns, and a light/dark/system theme toggle.
- `frontend/scripts/verify-sri.mjs`, run by `npm run bundle`, asserting the
  build's Subresource Integrity digests match the emitted assets.
- `sam/verify.sh` now also re-computes SRI digests against the served assets and
  checks `config.json` is present, valid, and fully substituted.

### Changed
- CDK: CloudFront access logs now use **standard logging v2**
  (`AWS::Logs::DeliverySource`/`DeliveryDestination`/`Delivery`) instead of the
  distribution's legacy `Logging` block, and the logging bucket disables ACLs
  (`BUCKET_OWNER_ENFORCED`). Legacy logging delivers by granting the
  `awslogsdelivery` account a bucket ACL and so requires ACLs to stay enabled;
  v2 delivers via a bucket policy, so they can be disabled outright. The SAM
  template is unchanged and still uses legacy logging.
- **Frontend rebuilt** as a React + TypeScript single-page app (Vite, Tailwind
  CSS), replacing the vanilla HTML/CSS/JS site and its vendored jQuery,
  Bootstrap, and Luxon libraries. Deployment is still a static upload.
- Migrated from AWS SDK for JavaScript v2 to v3.
- Deploy-time settings are now substituted into a dedicated `config.json` that
  the app fetches at startup, instead of into `index.html`. Rewriting the built
  `index.html` would invalidate its Subresource Integrity digests.
- Substituted values are JSON-escaped, so a value containing quotes cannot
  corrupt `config.json` or inject additional keys.
- Fixed `site.webmanifest` icon paths, which were missing the `/pfb_for_s3/`
  prefix and resolved against the files bucket.
- Rebuilding the deployed bundle is now `cd frontend && npm run bundle` rather
  than a manual `zip` invocation.

### Removed
- The `website/` directory and its committed vendor libraries, superseded by
  `frontend/`.

## [1.0.0] - 2024-02-20
- Initial Release
