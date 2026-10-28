"""One job per ephemeral container; no credentials or persistent project mounts."""
import base64
import json
import os
import signal
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

MAX_ARTIFACT_BYTES = 15 * 1024 * 1024
FILES = {"model.step": "application/step", "model.stl": "model/stl",
         "model.glb": "model/gltf-binary", "facts.json": "application/json"}


def execute(source: str, timeout=60):
    if not isinstance(source, str) or not 0 < len(source.encode()) <= 100000:
        raise ValueError("Expected Python source up to 100 KB")
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "model.py").write_text(source)
        with (root / "logs.txt").open("w+") as logs:
            process = subprocess.Popen(
                [sys.executable, "-I", str(Path(__file__).with_name("runner.py")),
                 str(root / "model.py"), str(root / "out")],
                cwd=root, env={"PATH": os.environ.get("PATH", ""), "HOME": str(root),
                               "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"},
                stdout=logs, stderr=logs, start_new_session=True)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise ValueError("Build exceeded its time limit") from None
            finally:
                # A script may spawn children that outlive the direct process.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if code:
                logs.seek(0)
                raise ValueError("Build failed: " + logs.read(4000))
        artifacts = []
        size = 0
        for name, media in FILES.items():
            path = root / "out" / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("Missing or unsafe artifact: " + name)
            size += path.stat().st_size
            if size > MAX_ARTIFACT_BYTES:
                raise ValueError("Build artifacts exceed 15 MiB")
            artifacts.append({"name": name, "mediaType": media,
                              "base64": base64.b64encode(path.read_bytes()).decode()})
        return {"artifacts": artifacts}


class Handler(BaseHTTPRequestHandler):
    used = False

    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200, {"ready": True})

    def do_POST(self):
        if self.path != "/build" or Handler.used:
            self.reply(409, {"error": "Container already used or invalid route"})
            return
        Handler.used = True
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 150000:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(length))
            self.reply(200, execute(payload["source"]))
        except (ValueError, KeyError) as error:
            self.reply(400, {"error": str(error)[:4000]})
        except (OSError, subprocess.SubprocessError, TypeError):
            self.reply(500, {"error": "CAD runtime failed"})


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
