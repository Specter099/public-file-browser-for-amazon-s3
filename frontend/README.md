# Public File Browser for Amazon S3 — Frontend

The static single-page app served by CloudFront. React + TypeScript, built with
Vite, styled with Tailwind CSS, talking to S3 directly from the browser with AWS
SDK v3 and Cognito guest credentials.

There is no server: the app lists the public files bucket client-side, exactly as
the deployment's Cognito unauthenticated role allows (`s3:ListBucket` and nothing
else).

## Prerequisites

- Node.js 20+
- `zip` on `PATH` (used to produce `website.zip`)

```bash
npm install
```

## Key commands

```bash
npm run dev          # dev server (see "Local development" for config)
npm run build        # typecheck + production build into ../build/website/
npm run test         # Vitest + React Testing Library
npm run test:watch
npm run typecheck
npm run verify:sri   # assert built SRI digests match the emitted assets
npm run bundle       # build + verify:sri + rewrite ../sam/seed_s3_data/website.zip
```

`npm run bundle` is the one that matters for deployment. **After changing
anything under `frontend/`, run it and commit the regenerated
`sam/seed_s3_data/website.zip`** — the seeding Lambda reads the zip, not this
directory, so an un-rebuilt zip silently deploys stale assets.

## How configuration reaches the app

The bucket name, Cognito identity pool ID, site name, and display options are not
known until deploy time. They live in `public/config.json`, which ships with
`###REPLACE_ME_*###` placeholders that the seeding Lambda
(`../sam/seed_s3_data/app.py`) substitutes when the stack is created. The app
fetches it at startup (`src/lib/config.ts`) before rendering.

This is deliberately a separate file rather than placeholders in `index.html`:

- `index.html` is build output with content-hashed asset references and embedded
  Subresource Integrity digests. Rewriting it at deploy time would invalidate
  those digests, and the browser would then refuse to execute the bundle — a
  blank page with no server-side symptom.
- Vite copies `public/` verbatim, so `config.json` is never minified, hashed, or
  otherwise transformed, which keeps the substitution a plain string replace.

Every value in `config.json` is a JSON **string**, including the boolean-ish
`filesOpenInNewTab`. That keeps the file parseable both before and after
substitution, so local development and the tests can read the un-substituted
file. `src/lib/config.ts` coerces the types.

## Local development

`npm run dev` serves the app but `public/config.json` still holds placeholders,
so it cannot reach a bucket as-is. To develop against a real deployment, point it
at one by editing `public/config.json` locally:

```json
{
  "siteName": "Local Dev",
  "identityPoolId": "us-west-2:00000000-0000-0000-0000-000000000000",
  "bucketName": "public-file-browser-files-abc123",
  "filesOpenInNewTab": "true",
  "visibleStorageClasses": "STANDARD,STANDARD_IA,ONEZONE_IA,REDUCED_REDUNDANCY"
}
```

Do not commit that edit. The bucket's CORS rule must also allow the dev origin,
which by default it does only when `CrossOriginRestriction` is `*` (the
first-deploy value).

Downloads will 404 in dev: file links point at `/<key>`, which only resolves
through CloudFront's files-bucket origin.

## Layout

```
frontend/
├── index.html                 # app shell; SRI digests injected at build time
├── vite.config.ts             # build config + the SRI plugin
├── scripts/verify-sri.mjs     # standalone build-output SRI check
├── public/
│   ├── config.json            # deploy-time settings (templated)
│   └── icon/                  # favicons, site.webmanifest (also templated)
└── src/
    ├── main.tsx               # loads config, then mounts the app
    ├── App.tsx                # page composition and data fetching
    ├── components/            # Breadcrumbs, Toolbar, ListingTable, ListingGrid, FileIcon
    └── lib/                   # config, s3, sort, format, fileKind, hooks
```

## Notes

- **Asset base path is `/pfb_for_s3/`.** CloudFront routes `pfb_for_s3/*` to the
  website bucket and everything else to the files bucket, so every app asset must
  live under that prefix. Changing `BASE` in `vite.config.ts` requires changing
  the distribution's cache behavior to match.
- **Subresource Integrity is generated at build time**, since a bundled build has
  no fixed vendor filenames to pin by hand. Digests are computed from the files
  as written to disk, not from in-memory chunk contents, because chunk code is
  still rewritten after Vite's `generateBundle` hook runs — hashing there
  produces digests that do not match what the browser fetches. `npm run
  verify:sri` guards against that regression, and `../sam/verify.sh` re-checks
  the digests against a live distribution.
- **No `dangerouslySetInnerHTML` anywhere.** Object keys and the `?p=` prefix are
  attacker-controllable; React escapes text children, which removes the
  `escapeHtml()` discipline the pre-rebuild app depended on. Keep it that way.
- **SVG objects are not rendered as grid thumbnails**, even though they are
  images: a same-origin SVG can carry script, and anyone who can write to the
  files bucket controls that content. Raster formats only
  (`src/lib/fileKind.ts`).
- **Folders sort above files only on a complete listing page.** Once S3 truncates
  the response, ordering is strictly lexicographic. This is intentional and
  matches the pre-rebuild behavior; see the comment in `src/lib/sort.ts` and the
  FAQ in the root `README.md`.
