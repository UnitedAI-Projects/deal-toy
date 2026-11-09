"""Regenerates the inspection records the Worker tests use, from the example fixtures.

After changing the record format or an inspection example, run
`uv run --project engine python engine/tools/gen_fixtures.py && npx prettier --write engine/tests/fixtures`.
engine/tests/test_inspect.py fails while the stored records are stale.
"""
import json
import sys
import tempfile
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ENGINE), str(ENGINE / "lib")]
from runner import build

FIXTURES = {"deal_toy_inspect": "examples/deal_toy_inspect.py", "enclosure_inspect": "examples/enclosure_inspect.py"}


def record_of(example: str) -> dict:
    with tempfile.TemporaryDirectory() as directory:
        build(ENGINE.parent / example, Path(directory))
        return json.loads((Path(directory) / "inspect.json").read_text())


if __name__ == "__main__":
    for name, example in FIXTURES.items():
        path = ENGINE / "tests" / "fixtures" / f"{name}.inspect.json"
        path.write_text(json.dumps(record_of(example), indent=1) + "\n")
        print(f"wrote {path.relative_to(ENGINE.parent)}")
