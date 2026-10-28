"""Exercise the production HTTP listener as well as native exports."""
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
    finally:
        server.shutdown()
        thread.join(timeout=5)
