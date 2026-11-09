"""One job per ephemeral container; no credentials or persistent project mounts."""
import base64
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
from http.server import BaseHTTPRequestHandler
from http.server import HTTPServer as BaseHTTPServer
from pathlib import Path
from socketserver import TCPServer

MAX_ARTIFACT_BYTES = 15 * 1024 * 1024
FILES = {"model.step": "application/step", "model.stl": "model/stl",
         "model.glb": "model/gltf-binary", "facts.json": "application/json",
         "inspect.json": "application/json"}


class HTTPServer(BaseHTTPServer):
    """Internal listener: container IDs need not be valid DNS hostnames."""

    def server_bind(self):
        TCPServer.server_bind(self)
        self.server_name = "cad"
        self.server_port = self.server_address[1]


PREVIEW_FILES = ("model.glb", "facts.json")


MODULE_KEY = re.compile(r"^[a-z][a-z0-9-]{1,39}@[0-9]{1,6}$")


def execute(source: str, timeout=60, stop_after=None, preview=False, modules=None, check=None):
    if not isinstance(source, str) or not 0 < len(source.encode()) <= 100000:
        raise ValueError("Expected Python source up to 100 KB")
    if stop_after is not None and (isinstance(stop_after, bool) or not isinstance(stop_after, int)
                                   or not 1 <= stop_after <= 300):
        raise ValueError("stopAfter must be a step number from 1 to 300")
    if not isinstance(preview, bool):
        raise ValueError("preview must be true or false")  # noqa: TRY004 - ValueError is the 400 reply
    modules = {} if modules is None else modules
    if not isinstance(modules, dict) or len(modules) > 20 or not all(
            isinstance(k, str) and MODULE_KEY.match(k) and isinstance(v, str) and 0 < len(v.encode()) <= 100000
            for k, v in modules.items()):
        raise ValueError("modules must map up to 20 saved action keys (id@version) to sources up to 100 KB")
    if check is not None and check not in modules:
        raise ValueError("check must name one of the modules")
    options = (["--stop-after", str(stop_after)] if stop_after is not None else []) + (["--preview"] if preview else [])
    if check is not None:
        options += ["--check", check]
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "model.py").write_text(source)
        if modules:
            saved = root / "saved"
            saved.mkdir()
            for key, text in modules.items():
                (saved / f"{key}.py").write_text(text)
                (saved / f"{key}.py").chmod(0o444)
            saved.chmod(0o555)  # saved actions cannot write beside themselves
            options += ["--modules", str(saved)]
        with (root / "logs.txt").open("w+") as logs:
            process = subprocess.Popen(
                [sys.executable, "-I", str(Path(__file__).with_name("runner.py")),
                 str(root / "model.py"), str(root / "out"), *options],
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
            if preview and name not in PREVIEW_FILES:
                continue
            path = root / "out" / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("Missing or unsafe artifact: " + name)
            size += path.stat().st_size
            if size > MAX_ARTIFACT_BYTES:
                raise ValueError("Build artifacts exceed 15 MiB")
            artifacts.append({"name": name, "mediaType": media,
                              "base64": base64.b64encode(path.read_bytes()).decode()})
        return {"artifacts": artifacts}


MAX_STEP_BYTES = 15 * 1024 * 1024
MAX_MEASURE_REQUEST = 21_000_000


def _target_ok(target):
    return (isinstance(target, dict) and len(target) == 1 and next(iter(target)) in ("face", "part")
            and isinstance(next(iter(target.values())), int) and not isinstance(next(iter(target.values())), bool)
            and next(iter(target.values())) >= 0)


def execute_measure(step: str, requests, timeout=60):
    """Measures distances on a STEP file. No model source is accepted or run."""
    if not isinstance(requests, list) or not 1 <= len(requests) <= 50:
        raise ValueError("requests must list 1 to 50 measurements")
    for r in requests:
        if not (isinstance(r, dict) and isinstance(r.get("key"), str) and 0 < len(r["key"]) <= 80
                and _target_ok(r.get("a")) and _target_ok(r.get("b"))):
            raise ValueError("Each request needs a key and a and b, each one face or part index")
    try:
        data = base64.b64decode(step, validate=True) if isinstance(step, str) else b""
    except ValueError:
        data = b""
    if not 0 < len(data) <= MAX_STEP_BYTES or b"ISO-10303-21" not in data[:200]:
        raise ValueError("Expected a STEP file up to 15 MiB")
    with tempfile.TemporaryDirectory(prefix="measure-") as directory:
        root = Path(directory)
        (root / "model.step").write_bytes(data)
        (root / "requests.json").write_text(json.dumps(requests))
        with (root / "logs.txt").open("w+") as logs:
            process = subprocess.Popen(
                [sys.executable, "-I", str(Path(__file__).with_name("measure.py")),
                 str(root / "model.step"), str(root / "requests.json"), str(root / "out")],
                cwd=root, env={"PATH": os.environ.get("PATH", ""), "HOME": str(root),
                               "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"},
                stdout=logs, stderr=logs, start_new_session=True)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise ValueError("Measurement exceeded its time limit") from None
            if code:
                logs.seek(0)
                raise ValueError("Measurement failed: " + logs.read(2000))
        path = root / "out" / "measure.json"
        if path.is_symlink() or not path.is_file():
            raise ValueError("Measurement produced no result")
        return json.loads(path.read_text())


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
        if self.path not in ("/build", "/measure") or Handler.used:
            self.reply(409, {"error": "Container already used or invalid route"})
            return
        Handler.used = True
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= (MAX_MEASURE_REQUEST if self.path == "/measure" else 150000):
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(length))
            if self.path == "/measure":
                self.reply(200, execute_measure(payload["step"], payload["requests"]))
                return
            self.reply(200, execute(payload["source"], stop_after=payload.get("stopAfter"),
                                    preview=payload.get("preview", False), modules=payload.get("modules"),
                                    check=payload.get("check")))
        except (ValueError, KeyError) as error:
            self.reply(400, {"error": str(error)[:4000]})
        except (OSError, subprocess.SubprocessError, TypeError):
            self.reply(500, {"error": "CAD runtime failed"})


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
