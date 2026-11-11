# SpaceX IPO deal toy (demo project)

The example project behind Mantel's recorded demo: a Falcon-style rocket standing on its legs on a
landing pad, on a black hexagonal base with three silver plaques. Built in MantelCAD.

This is a **simulated** demonstration for presentations. The IPO details on the plaques come from
the reference render and are placeholder copy, not facts about any offering. The Jiga quotes and
the client and supplier conversations in the demo are scripted; nothing is sent anywhere.

| File                          | What it is                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `reference-render.jpg`        | The reference render the brief starts from                                                  |
| `toy.py`                      | Generates each revision's MantelCAD command script (`python3 toy.py OUT_DIR`)               |
| `designs/r1.json` … `r5.json` | The five revisions as MantelCAD designs (open in MantelCAD)                                 |
| `concepts/*.png`              | The three concept directions and a front render of r5, rendered by `mantelcad-cli snapshot` |
| `art/*.svg`                   | The lettering and plaque layouts                                                            |
| `demo.mjs`                    | Seeds the project and its recorded demo into a Mantel (see below)                           |

Revisions: r1 base, pad and rocket · r2 engines, legs and grid fins · r3 base raised to 32 mm by
hand · r4 lettering and plaques · r5 pad widened to 104 mm by hand.

## Seed the demo

```sh
node examples/spacex-ipo/demo.mjs http://localhost:8787 work/owner-link.txt
```

The second argument is a sign-in link file from `node ci/member.mjs`. The script creates the
project, uploads the files, saves and builds the five revisions, records the phase states and saves
the demo script. Open the project from the library and it plays.
