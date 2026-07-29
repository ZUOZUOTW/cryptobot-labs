# Third-party notices

CryptoBot Labs uses open-source packages and data sets maintained by third
parties. Each component remains governed by its own license; the project's
license does not replace those terms.

CryptoBot Labs original software is licensed under Apache-2.0. Reserved Brand
Assets are governed separately by `BRAND_ASSETS.md`.

An installed production dependency inventory can be generated with:

```bash
pnpm licenses list --prod
```

Agent releases also include a CycloneDX SBOM named
`agent-sbom-<platform>.cdx.json` for each published platform.

## Attribution and reciprocal-license components

### caniuse-lite

- Project: [Browserslist / caniuse-lite](https://github.com/browserslist/caniuse-lite)
- License: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Use: browser compatibility data consumed by the build toolchain.

### libvips binaries used by sharp

- Package family: `@img/sharp-libvips-*`
- Projects:
  [sharp-libvips](https://github.com/lovell/sharp-libvips) and
  [libvips](https://github.com/libvips/libvips)
- License: LGPL-3.0-or-later
- Use: platform-specific image-processing libraries installed for `sharp`.

Upstream source, build scripts, and license information are available from the
linked projects. Distributors of binaries must preserve the applicable notices
and satisfy the LGPL terms for the exact libraries they distribute.

### React Icons and embedded icon sets

- Wrapper project: [React Icons](https://github.com/react-icons/react-icons),
  MIT
- Feather (`react-icons/fi`):
  [Feather Icons](https://github.com/feathericons/feather), MIT
- Heroicons 2 (`react-icons/hi2`):
  [Heroicons](https://github.com/tailwindlabs/heroicons), MIT
- Flat Color Icons (`react-icons/fc`):
  [Icons8 Flat Color Icons](https://github.com/icons8/flat-color-icons), MIT
- Simple Icons (`react-icons/si`):
  [Simple Icons](https://github.com/simple-icons/simple-icons), CC0-1.0

Names and logos represented by icons may be protected trademarks. Open-source
icon licenses do not grant trademark rights.

### Dual- or combined-license packages

- [JSZip](https://github.com/Stuk/jszip) is available under either MIT or
  GPL-3.0-or-later; this project uses it under the MIT option.
- [pako](https://github.com/nodeca/pako) contains code under the MIT and zlib
  licenses; both upstream notices remain applicable.

## Complete dependency notices

The entries above highlight packages that need attribution, reciprocal-license
attention, or an explicit license choice. They are not a replacement for the
license files shipped inside every installed dependency. Preserve those files
when redistributing dependency source or binaries, and regenerate the inventory
and SBOM whenever dependency versions change.
