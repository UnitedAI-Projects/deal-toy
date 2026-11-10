# MantelDocs documentation

## Start here

- [Project overview and quickstart](../README.md)
- [CLI](cli.md), [control protocol](control-protocol.md), and [MCP](mcp.md)
- [Architecture](architecture.md), [contributing](../CONTRIBUTING.md), and [contributors](contributors.md)
- [Artifacts](artifacts.md), [validation](validation.md), and [packaging and releases](releasing.md)
- [Browser hosting](../packaging/web/README.md) and [Windows installation checks](../packaging/windows/INSTALLATION.md)
- [Roadmap](../ROADMAP.md) and [inherited limitations](gaps.md)

## Project and directory names

Clone into `manteldocs/`. Paths in these guides are relative to that repository root unless stated otherwise.

```text
manteldocs/
├── apps/
│   ├── manteldocs/        # desktop app
│   ├── manteldocs-cli/    # command-line app
│   └── manteldocs-web/    # browser app
├── crates/               # libraries named manteldocs-* in Cargo
├── docs/                 # MantelDocs guides
│   └── history/          # inherited engineering records
├── assets/app-icon/      # MantelDocs artwork
├── packaging/            # platform packaging sources
└── artifacts/            # downloadable preview and sample exports
```

Use **MantelDocs** in prose and `manteldocs` in executable, package, and project-directory names. Generic filenames such as `README.md` and `architecture.md` keep their conventional names.

Original project names remain where they identify copyright holders, real upstream sources or dependencies, and legacy drawing-format identifiers such as `CADCRAFT_PLOTSTYLES`. Those identifiers preserve file compatibility.

## Historical records

The [inherited egui migration record](history/manteldocs-egui-037-migration.md) preserves earlier engineering research. Historical dates, run IDs, measurements, and missing external evidence do not establish current MantelDocs behavior. Current measured checks are in [validation.md](validation.md).
