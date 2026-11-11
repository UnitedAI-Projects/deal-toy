# MantelDocs macOS installer artwork

The original geometric M appears in a teal sidebar with an ivory application area. The SVG is editable and uses no fonts. The generated TIFF includes 1x and 2x frames, and the Finder layout names MantelDocs.app.

Regenerate with ImageMagick on PATH, Pillow 12+, ds_store 1.3.3 and mac_alias 2.2.3 installed:

```sh
python3 packaging/macos/dmg/generate.py
```
