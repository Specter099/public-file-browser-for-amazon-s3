# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Added
- GitHub Actions CI and CD (`.github/workflows/ci.yml`, `.github/workflows/cd.yml`)
  built on the org's shared reusable workflows in `Specter099/.github`. CI runs on
  pull requests only; CD runs on push to `main` and does not re-run the CI suite.
- `scripts/local-ci.sh` — the pre-PR gate. Each required stage mirrors a CI step,
  and `scripts/check_ci_parity.py` fails the build if the two drift apart.
- `scripts/check-bundle-freshness.sh` — fails CI when the committed
  `sam/seed_s3_data/website.zip` no longer matches a fresh build of `frontend/`,
  which would otherwise deploy stale assets silently.
- ESLint (flat config, type-aware `typescript-eslint` rules) and `npm run lint`
  for the frontend; `ruff` check/format for Python, configured in `ruff.toml`.
- `.gitleaks.toml` allowlisting the vendored AWS SDK v2 bundle that was removed
  in the React rebuild but still trips the generic-api-key heuristic in git
  history. Scoped to that one path.
- AWS CDK (Python) deployment option under `cdk/`, equivalent to the existing SAM
  template. Either may be used; they are independent stacks.
- Frontend: grid/thumbnail view, filename filtering within a folder, sortable
  columns, and a light/dark/system theme toggle.
- `frontend/scripts/verify-sri.mjs`, run by `npm run bundle`, asserting the
  build's Subresource Integrity digests match the emitted assets.
- `sam/verify.sh` now also re-computes SRI digests against the served assets and
  checks `config.json` is present, valid, and fully substituted.

### Changed
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
- The seeding Lambda's tests no longer depend on the working directory or on
  `PYTHONPATH`; `python3 -m pytest sam/tests/` works from anywhere.
- Pinned TypeScript to 5.x. `typescript-eslint` has no release supporting
  TypeScript 7, and without its parser ESLint cannot read `.tsx` at all.

### Removed
- The `website/` directory and its committed vendor libraries, superseded by
  `frontend/`.

## [1.0.0] - 2024-02-20
- Initial Release
