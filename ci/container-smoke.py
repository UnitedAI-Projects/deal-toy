"""Exercise the production HTTP listener as well as native exports."""
import base64
import json
import threading
import urllib.request
from pathlib import Path

from service import Handler, HTTPServer

with HTTPServer(("0.0.0.0", 0), Handler) as server:
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        origin = f"http://127.0.0.1:{server.server_port}"
        with urllib.request.urlopen(origin + "/health", timeout=5) as response:
            assert json.load(response)["ready"]
        payload = json.dumps({"source": Path("/examples/bridge.py").read_text()}).encode()
        request = urllib.request.Request(
            origin + "/build", data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
        assert {a["name"] for a in result["artifacts"]} == {
            "model.step", "model.stl", "model.glb", "facts.json"}
        print("CAD HTTP startup and STEP/STL/GLB/facts exports verified")
        # Text in the default font (Arial) must come out in an outline font with Arial's
        # metrics, not OCCT's single-line fallback or a monospace face.
        text = ("import build123d as bd\n"
                "def build():\n    return bd.extrude(bd.Text('Mantel 2026', 7.0), 1.0)\n")
        request = urllib.request.Request(
            origin + "/build", data=json.dumps({"source": text}).encode(),
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
        facts = next(a for a in result["artifacts"] if a["name"] == "facts.json")
        width = json.loads(base64.b64decode(facts["base64"]))["bounds"][0]
        assert abs(width - 37.7) < 0.8, f"default-font text is {width} mm wide, not Arial's 37.7"
        print(f"Default-font text renders with Arial metrics ({width:.2f} mm)")
    finally:
        server.shutdown()
        thread.join(timeout=5)
