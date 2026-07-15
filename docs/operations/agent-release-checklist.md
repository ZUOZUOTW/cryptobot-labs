# Desktop Agent release checklist

Public Agent downloads are allowed only from a complete, verified GitHub release. Keep every item unchecked until independently evidenced for the release candidate.

## Before tagging

- [ ] Version and changelog identify the exact commit.
- [ ] Full workspace tests, typechecks, lint, website build, and Agent packaging pass from a clean checkout.
- [ ] `CBL_CONTROL_PLANE_ORIGIN` is the deployed HTTPS origin and contains no path, credentials, loopback, or private address.
- [ ] Apple Developer ID/notary and Windows code-signing inputs are available only to protected CI.
- [ ] No API credentials, pairing secrets, certificates, passwords, or signing logs are present in repository artifacts.
- [ ] Threat model and credential-handling review cover every changed boundary.

## CI artifacts

- [ ] macOS arm64 and x64 applications are hardened, signed, notarized, stapled, and verified with platform tools.
- [ ] Windows x64 installer and application binaries have valid Authenticode signatures and timestamp chains.
- [ ] Electron fuses disable RunAsNode, NODE_OPTIONS, inspect arguments, and code outside ASAR; ASAR integrity and cookie encryption are enabled.
- [ ] SHA256SUMS covers every downloadable artifact.
- [ ] CycloneDX SBOM, Windows `RELEASES`, nupkg, and macOS update metadata are present and internally consistent.
- [ ] `scripts/verify-agent-artifact.mjs --public` passes without bypass flags.

## Publish and website exposure

- [ ] Publish under an `agent-v*` tag only after all required jobs pass.
- [ ] Verify the website download API rejects drafts, partial releases, unsigned/internal artifacts, digest mismatches, and missing platforms.
- [ ] Verify downloads for macOS arm64, macOS x64, and Windows x64 match published SHA-256 digests.
- [ ] Verify updater metadata uses the allowlisted HTTPS origin and refuses restart while live execution is active.
- [ ] Roll out to an internal paired device before exposing the release broadly.

## Rollback

- [ ] Remove website exposure and update metadata for a compromised release.
- [ ] Revoke compromised signing material with the platform provider.
- [ ] Publish a higher, signed fixed version; never reuse or silently replace a released version.
- [ ] Notify users to stop execution and rotate WEEX keys if credential handling may be affected.
