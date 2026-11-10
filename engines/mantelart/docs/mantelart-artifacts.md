# MantelArt artifacts

| Artifact | Format | How to use |
| --- | --- | --- |
| [Mac preview](../artifacts/MantelArt-preview-macos-arm64.zip) | ZIP containing MantelArt.app | Extract on an Apple Silicon Mac and open MantelArt.app; development build, ad-hoc signed, not notarized |
| [Welcome screen](../artifacts/mantelart-home.png) | PNG | Verified native interface |
| [About screen](../artifacts/mantelart-about.png) | PNG | Brand, icon, links and license text |
| [Drawing view](../artifacts/mantelart-drawing.png) | PNG | Existing Neon Drive document opened without warnings |
| [Icon source](../assets/app-icon/mantelart.svg) | SVG | Editable original M icon |
| [Icon exports](../assets/app-icon/) | PNG, ICNS, ICO, SVG | Web, Linux, macOS and Windows icons |
| [Example drawings](../examples/) | Native documents, SVG and scripts | Open in MantelArt; original formats remain supported |
| [Packaging sources](../packaging/) | Scripts and manifests | Build platform installers |

The preview includes the desktop and CLI executables, icons and license notices. It is a development-profile build, not a signed/notarized public release. Its source revision is recorded in Contents/Resources/BUILD-INFO.txt. Windows and Linux installers are not included.

Reproduce the Mac preview on macOS with Rust, Python 3.11+ and Xcode command-line tools:

    cargo build --locked -p mantelart -p mantelart-cli
    python3 packaging/macos/preview.py

For an optimized application bundle, use cargo xtask bundle. Historical docs/images/ screenshots show the upstream application and are not MantelArt demonstrations.

The preview ZIP is stored in Git LFS. After cloning, run git lfs pull to retrieve it. SHA-256: e1f1b6fc5f4815a966b1a0dd2be5d75a195aed1e1acb6989a70ef5298268e7e9. Both Mac mini and MacBook copies were verified; the transferred app was launched on the MacBook.
