<p align="center">
  <img src="assets/branding/logo/mantelcad-mark.svg" width="96" height="96" alt="MantelCAD" />
</p>

<h1 align="center">MantelCAD</h1>

A parametric 3D CAD application built in Rust. Sketch, constrain, and build solids with an editable feature timeline. MantelCAD includes a desktop application, a browser build, a command-line interface, and an MCP server that use the same modeling commands.

## Status

MantelCAD is a rebranded derivative of [SolidCraft](https://github.com/tangency-labs/solidcraft), based on revision [`f56114219b2d7f6d16de8dd58700479646948f8a`](https://github.com/tangency-labs/solidcraft/commit/f56114219b2d7f6d16de8dd58700479646948f8a), fetched on November 10, 2026. The project owner selected this current revision and reported having written permission to use its separately licensed interface material for MantelCAD. See [fork provenance and compatibility](docs/mantelcad-fork.md).

This is a source distribution. MantelCAD has no published installer, store listing, signed release, or hosted browser app yet. The version inherited from the source tree is not a MantelCAD release announcement. The CAD implementation is under active development; inherited capabilities and reference results are described in [the capabilities guide](docs/capabilities.md) and [roadmap](ROADMAP.md).

## Prerequisites

- Git, Python 3.11 or newer, and Rust 1.95 or newer through [rustup](https://rustup.rs). CI uses Rust 1.99.1.
- A native C/C++ linker. On macOS install Xcode Command Line Tools; on Windows install the Visual Studio C++ build tools.
- On Debian/Ubuntu, install the native development libraries below. A graphics-capable desktop session is needed for the GUI; the CLI can run without one.

```sh
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libudev-dev libxkbcommon-dev libwayland-dev libx11-dev libxrandr-dev libxi-dev libgl1-mesa-dev
```

Private repository access is required while this repository remains private.

## Quickstart

```sh
git clone https://github.com/ichen27/mantelcad.git
cd mantelcad
cargo run --release --locked -p mantelcad -- --sample
```

The first build compiles the Rust dependencies and the included geometry kernel. Keep the entire checkout: the `solidcore/` and `vendor/` directories are required source dependencies.

For a headless example that creates a STEP file:

```sh
cargo run --release --locked -p mantelcad-cli -- commands
cargo run --release --locked -p mantelcad-cli -- run examples/bracket.json --out bracket.step
```

The editable input is [examples/bracket.json](examples/bracket.json). More inputs and finished repository assets are indexed in [Artifacts](docs/ARTIFACTS.md).

## Usage

```sh
# Open a design or imported STEP file.
cargo run --release --locked -p mantelcad -- part.step

# Render a preview of an example.
cargo run --release --locked -p mantelcad-cli -- snapshot examples/bracket.json --out bracket.png

# Start the headless MCP server over standard input/output.
cargo run --release --locked -p mantelcad-cli -- mcp
```

The [MCP guide](docs/mcp.md), [script format](docs/scripts.md), [architecture](docs/architecture.md), and [source build guide](docs/building.md) cover advanced use. Browser builds require Trunk and the `wasm32-unknown-unknown` Rust target; see the source build guide. Package scripts are retained for future release preparation, but running them does not publish a verified release.

## Validation

```sh
bash ci/run.sh
```

This checks fork branding and compatibility markers, Rust formatting, desktop/CLI compilation, design-format migration tests, file-format registry tests, and updater tests. It is a focused gate for the rebrand, not a claim that every modeling operation has been validated. For the inherited broad suite, run `cargo xtask ci`; see [contributing](CONTRIBUTING.md) for additional checks appropriate to geometry or interface changes.

GitHub Actions is configured to use standard Ubuntu-hosted runners and the `test` check. Passing local checks, passing hosted checks, and branch-protection enforcement are separate states; see the PR for the observed validation results. No deployment or upstream maintenance automation runs from this fork.

## Contributing and issues

Use focused branches and pull requests. Include reproducible steps, expected and observed behavior, and the relevant validation results. Report problems in [MantelCAD issues](https://github.com/ichen27/mantelcad/issues). Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing file formats, geometry, artwork, or release tooling.

## License and attribution

The modeling core is licensed under **MIT OR Apache-2.0**. The upstream interface, theme, look and brand material are separately covered by [LICENSE-BRAND](LICENSE-BRAND); their original notices remain intact. The project owner reports written permission for this MantelCAD use. That statement does not grant downstream users broader rights or replace the applicable license and permission terms.

Original copyright notices and third-party licenses are retained in [LICENSE-MIT](LICENSE-MIT), [LICENSE-APACHE](LICENSE-APACHE), [NOTICE](NOTICE), [ATTRIBUTION.md](ATTRIBUTION.md), and [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt). The included SolidCore kernel retains its own notices. MantelCAD is an independent derivative and is not an official SolidCraft release or endorsed by its maintainers.
