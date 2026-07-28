# Open-source publication audit

Audit date: 2026-07-29

## Scope

The audit covered all locally reachable Git refs, the current tracked tree,
historical file names, environment examples, infrastructure definitions,
workflows, and public operational documents before repository visibility
changes.

## Secret scanning

- Gitleaks `v8.30.1` was downloaded from its official GitHub release and its
  macOS arm64 archive matched the published SHA-256 checksum. It scanned 201
  commits and reported 15 findings.
- Every Gitleaks finding was reviewed in redacted form. All were synthetic test
  fixtures: Supabase publishable-key placeholders, fixed HMAC/cookie test
  strings, or a deliberately invalid masked API-key value. Their exact
  commit/file/rule/line fingerprints are recorded in `.gitleaksignore`; no
  broad test-directory exclusion is used. The complete-history rerun reported
  zero unignored findings.
- TruffleHog `v3.96.0` was independently downloaded from its official GitHub
  release. The archive matched both the release-metadata digest and published
  checksum. It reported zero verified credentials. Six unverified/unknown
  detections were reviewed as synthetic localhost/example URIs and invalid test
  database URLs.
- Historical path inspection found no committed private-key, certificate,
  keystore, Terraform state, credential file, or environment file other than
  `.env.example`.
- A separate redacted history scan found no match for the retired Netlify
  access password. Content-email detections were synthetic test domains,
  upstream package metadata, or URL-shaped fixtures. Contributor-local paths
  were removed from the publication tree and are now covered by a regression
  test.

Scanner output was kept in a temporary local directory and was not committed.
Secret scanning reduces risk but cannot prove that no secret has ever existed;
credentials must still be rotated immediately if independent evidence of
exposure appears.

## Production topology

Concrete AWS account, instance, state-bucket, egress-IP, Cloudflare zone,
Supabase project, Netlify team/deploy, and Broker UID values were removed from
the tracked tree or moved to deployment-time configuration. The WEEX Broker ID
`WEEX111162` remains public by design because it is required in attributed
`newClientOrderId` values.

Bootstrap scripts now require an explicit 12-digit `CBL_AWS_ACCOUNT_ID` and
generate account-scoped trust/policy documents from placeholder templates.
Public `.env` and Terraform examples use RFC-reserved or example values.

## Ongoing controls

- Pull requests run the full test, lint, production build, and Gitleaks history
  scan.
- The publication branch upgraded Next.js to `16.2.12` and applies narrowly
  scoped `next>sharp=0.35.3` and `next>postcss=8.5.24` overrides. A pnpm
  production audit reports no known vulnerabilities, and CI fails on future
  high/critical production advisories.
- GitHub private vulnerability reporting and secret scanning should be enabled
  before or at publication.
- Branch protection must require the publication checks and prevent force
  pushes or deletion of `main`.
- Any real secret finding requires revocation/rotation first; deleting a file
  in a new commit is not sufficient remediation for Git history.

## Dependency licensing

- Production packages report only standard OSI-compatible, public-domain, or
  data licenses after removal of the Remotion packages. The removed packages
  used a source-available license with organization-size and evaluation limits
  that were unsuitable for unrestricted downstream open-source use.
- The complete production-and-development inventory reports no `Unknown`
  licenses. Development-only tools additionally include standard MPL-2.0,
  Python-2.0, BlueOak-1.0.0, MIT-0, and CC BY 3.0 components.
- `THIRD_PARTY_NOTICES.md` records the CC BY 4.0 browser data, LGPL
  `sharp-libvips` binaries, React Icons source sets, and explicit MIT choice for
  JSZip. Release archives include a platform-specific CycloneDX 1.6 SBOM with
  dependency-license coverage enforced by the artifact verifier.
- CryptoBot Labs software, documentation, and configuration are licensed under
  Apache-2.0. `NOTICE`, `TRADEMARKS.md`, and `BRAND_ASSETS.md` preserve
  attribution and separate reserved brand identity from the licensed Work.

## Historical identity metadata

The current tree contains no contributor-local absolute paths. Older commits
still contain a pseudonymous local-machine Git author address and obsolete QA
document paths. These are not credentials. The repository owner explicitly
chose to preserve this low-risk metadata so the audit trail and commit IDs
remain intact.

## Binary and visual assets

- Four obsolete root-level QA screenshots and the unused default Next.js
  starter SVGs were removed from the publication tree.
- Tracked PNG metadata was inspected. No creator, prompt, location, camera, or
  user-identifying fields were present; the only EXIF payload contained pixel
  dimensions.
- Original mascot PNGs are retained alongside optimized WebP delivery copies
  where they provide editable source provenance. The artwork, including one
  earlier retained iteration, is reserved under `BRAND_ASSETS.md` and excluded
  from Apache-2.0.
