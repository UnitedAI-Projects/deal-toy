# MantelDocs packaging and releases

MantelDocs currently provides source and a [browser preview](artifacts.md). Signed installers and automated release publishing are not configured. The inherited packaging scripts are available for platform testing; their presence does not establish that every platform has been validated.

## Version and identity

The version in `[workspace.package]` in the root [Cargo.toml](../Cargo.toml) is the source of truth. `cargo xtask version` prints it; `cargo xtask version set X.Y.Z[-pre]` changes it. Prepare version changes on a feature branch and submit a pull request.

The desktop executable is `manteldocs`, the CLI is `manteldocs-cli`, the application bundle is `MantelDocs.app`, and the app ID is `com.manteldocs.app`. Build metadata uses `MANTELDOCS_BUILD_SHA` and `MANTELDOCS_BUILD_DATE`. Packaging reads `MANTELDOCS_VERSION` when an explicit version override is needed.

## Available package sources

Run scripts from the repository root on the matching platform, after installing the prerequisites described in the script. Output defaults to `dist/release/`; set `DIST` to override it.

| Platform | Entry point | Notes |
|---|---|---|
| Browser | [packaging/web/package.sh](../packaging/web/package.sh) | Static web ZIP; see [hosting](../packaging/web/README.md) |
| macOS | [packaging/macos/package.sh](../packaging/macos/package.sh) | DMG and CLI ZIP; local packages may be ad-hoc signed, which is not Developer ID signing or notarization |
| Windows | [packaging/windows/package.ps1](../packaging/windows/package.ps1) | MantelDocs MSI and portable ZIP; see [installation checks](../packaging/windows/INSTALLATION.md) |
| Linux | [packaging/linux/package.sh](../packaging/linux/package.sh) | Inspect the script for available formats and required packaging tools |
| FreeBSD | [packaging/freebsd/package.sh](../packaging/freebsd/package.sh) | Requires a FreeBSD build environment |

Windows uses a MantelDocs-specific upgrade identity. The desktop shortcut is optional; `.dxf` and `.dwg` associations are defined in the platform packaging sources. Upgrades from the original upstream application are not claimed.

## Validation and publication

[Checks](../.github/workflows/checks.yml) runs `bash ci/run.sh` on pull requests and pushes to `main`. It validates source; it does not create installers, sign packages, regenerate contributor statistics, or publish releases. See [validation.md](validation.md) for the measured results and open failures.

Before publishing a release, pass the relevant checks on the exact revision, test the real packages on their target platforms, include licenses and attribution, and record artifact checksums. Any future release belongs to [ichen27/manteldocs](https://github.com/ichen27/manteldocs/releases). Pushing a branch named `release` does not trigger a MantelDocs release workflow.
