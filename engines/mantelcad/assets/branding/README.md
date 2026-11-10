# MantelCAD brand assets

MantelCAD uses a geometric **M** made from two navy uprights and a teal chevron.
The mark is designed to stay recognisable at small application-icon sizes.

## Editable sources

- `../icons/app/shared/source/app_icon.rs` is the mark's geometry and colour authority.
- `export.py` exports that mark and outlines the MantelCAD wordmark from the bundled IBM Plex Sans font.
- `../icons/app/macos/source/MantelCAD.icon/` is the editable macOS Icon Composer project.
- `../platforms/macos/dmg/make_background.py` generates the disk image background.

The IBM Plex font retains its SIL Open Font License. New MantelCAD artwork and the export tool
are by Ivan Chen. Upstream brand/interface resources retain LICENSE-BRAND; Ivan has stated that
he has written permission for their use in MantelCAD. This permission is not a blanket licence
grant to downstream users. Retained historical art and resource infrastructure keep their notices.

## Colours and spacing

| Role | Colour |
|---|---|
| Wordmark / navy | `#153747` |
| Navy upright gradient | `#1d4b58` to `#0f2b3a` |
| Teal chevron gradient | `#2bc7b2` to `#0d8987` |

Preserve the mark's transparent canvas margin and its proportions. Use the mono black or white
versions when only one ink is available. SVG wordmarks are outlined paths with no external font
or network requirement.

## Finished exports

| Files | Use |
|---|---|
| `logo/mantelcad-mark.svg` | Colour vector mark |
| `logo/mantelcad-mark-mono-{black,white}.svg` | Single-colour vector mark |
| `logo/mantelcad-mark-{512,1024,2048}.png` | Transparent raster mark |
| `logo/mantelcad-wordmark.svg` | Outlined MantelCAD name |
| `logo/mantelcad-lockup-horizontal.svg` | Mark and name |
| `web/source/og.png` | 1280 × 640 social preview |

Application exports are under `../icons/app/{linux,windows,macos}/exports/`.
The browser loading image is `../styles/web/loading-logo.svg`.

## Regenerate

Run from the repository root with Rust on PATH:

```sh
python3 -m venv target/branding-python
target/branding-python/bin/pip install pillow fonttools
target/branding-python/bin/python assets/branding/export.py
target/branding-python/bin/python assets/platforms/macos/dmg/make_background.py
```

The exporter uses standalone `rustc` and does not build the CAD application.
To rebuild the macOS exports, use an Xcode release with Icon Composer support:

```sh
mkdir -p target/resources/macos-icon
xcrun actool assets/icons/app/macos/source/MantelCAD.icon \
  --compile target/resources/macos-icon --platform macosx \
  --minimum-deployment-target 11.0 --app-icon MantelCAD \
  --output-partial-info-plist target/resources/macos-icon/icon-info.plist \
  --output-format human-readable-text
cp target/resources/macos-icon/Assets.car assets/icons/app/macos/exports/Assets.car
cp target/resources/macos-icon/MantelCAD.icns assets/icons/app/macos/exports/icon.icns
```

Keep the compiled macOS pair together. Inspect the loading image, wordmark, social preview and
small icon exports after edits. Temporary previews belong in `target/resources/`.
