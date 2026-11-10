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
DRAWING_FILES = {"blueprint.pdf": "application/pdf", "blueprint.dxf": "image/vnd.dxf"}
# Inside the Worker's 825 s wait for the container (src/server/cad-runtime.ts). The whole queue
# invocation, including container start-up and saving the files, must end within Cloudflare's 15 minutes.
JOB_SECONDS = 810


MODULE_KEY = re.compile(r"^[a-z][a-z0-9-]{1,39}@[0-9]{1,6}$")

# MantelCAD's headless CLI (engines/mantelcad, built by engines/build-cad-cli.sh).
CLI = Path(os.environ.get("MANTELCAD_CLI") or Path(__file__).with_name("bin") / "mantelcad-cli")
MAX_DESIGN_BYTES = 1_000_000
DESIGN_FORMAT = re.compile(r"^solidcraft/[0-9]{1,4}$")
CLI_SECONDS = 300
EDIT_SECONDS = 120
MAX_COMMANDS = 60
COMMAND = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$")
# Modelling commands only: never file, render, view, interface or settings commands (src/shared/cad-source.ts).
COMMAND_FAMILIES = {"sketch", "solid", "construct", "parameters", "timeline", "appearance", "material",
                    "body", "surface", "sheet", "component", "joint", "occurrence", "plastic"}
# Commands that read or write other files: a job's design is self-contained.
COMMAND_DENIED = re.compile(r"(export|import|insert|extract|links|edit_in_place|finish_edit|paste|break_link|replace)")


def design_of(source):
    """The MantelCAD design a source holds, or None for anything else (such as build123d Python)."""
    if not isinstance(source, str) or not source.lstrip().startswith("{"):
        return None
    try:
        value = json.loads(source)
    except ValueError:
        return None
    if isinstance(value, dict) and isinstance(value.get("format"), str) and DESIGN_FORMAT.match(value["format"]):
        return value
    return None


def run_cli(args, root: Path, timeout: int, what: str) -> str:
    """Runs mantelcad-cli in root with no environment beyond its home; returns its standard output."""
    if not CLI.is_file():
        raise ValueError("MantelCAD is not installed in this CAD runtime")
    with (root / f"{what}.out").open("w+") as out, (root / f"{what}.err").open("w+") as err:
        process = subprocess.Popen(
            [sys.executable, "-I", str(Path(__file__).with_name("limited.py")), str(timeout), str(CLI), *args],
            cwd=root, stdout=out, stderr=err, start_new_session=True,
            env={"HOME": str(root), "RAYON_NUM_THREADS": "2", "RUST_BACKTRACE": "0"})
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise ValueError(f"MantelCAD {what} exceeded its time limit") from None
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if code:
            err.seek(0)
            detail = err.read()[-2000:].strip() or f"exit status {code}"
            raise ValueError(f"MantelCAD {what} failed: {detail.removeprefix('error: ')}")
        out.seek(0)
        return out.read(2_000_000)


def _read_artifacts(root: Path, preview=False):
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


def execute_design(source: str, timeout=JOB_SECONDS):
    """Builds a MantelCAD design: MantelCAD computes and writes STEP; OCCT reads it for the other exports."""
    if len(source.encode()) > MAX_DESIGN_BYTES:
        raise ValueError("A MantelCAD design can be up to 1 MB")
    with tempfile.TemporaryDirectory(prefix="design-") as directory:
        root = Path(directory)
        (root / "design.json").write_text(source)
        (root / "out").mkdir()
        run_cli(["run", "--in", "design.json", "--out", "out/model.step", "--quiet"], root,
                min(CLI_SECONDS, timeout), "build")
        step = root / "out" / "model.step"
        if step.is_symlink() or not step.is_file() or step.stat().st_size == 0:
            raise ValueError("MantelCAD wrote no STEP file: the design has no solid body")
        with (root / "logs.txt").open("w+") as logs:
            process = subprocess.Popen(
                [sys.executable, "-I", str(Path(__file__).with_name("runner.py")),
                 str(step), str(root / "out"), "--step", "--design", str(root / "design.json")],
                cwd=root, env={"PATH": os.environ.get("PATH", ""), "HOME": str(root),
                               "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"},
                stdout=logs, stderr=logs, start_new_session=True)
            try:
                code = process.wait(timeout=max(60, timeout - CLI_SECONDS))
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise ValueError("Build exceeded its time limit") from None
            finally:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if code:
                logs.seek(0)
                raise ValueError("Build failed: " + logs.read()[-4000:])
        return _read_artifacts(root)


def execute_edit(design, commands, timeout=EDIT_SECONDS):
    """Applies MantelCAD commands to a design (or to a new one) and returns the edited design."""
    if design is not None and design_of(design) is None:
        raise ValueError("design must be a MantelCAD design")
    if design is not None and len(design.encode()) > MAX_DESIGN_BYTES:
        raise ValueError("A MantelCAD design can be up to 1 MB")
    if not isinstance(commands, list) or not 1 <= len(commands) <= MAX_COMMANDS:
        raise ValueError(f"commands must list 1 to {MAX_COMMANDS} MantelCAD commands")
    for c in commands:
        if not (isinstance(c, dict) and set(c) <= {"command", "params"} and isinstance(c.get("command"), str)
                and COMMAND.match(c["command"]) and c["command"].split(".")[0] in COMMAND_FAMILIES
                and not COMMAND_DENIED.search(c["command"])
                and isinstance(c.get("params", {}), dict)):
            raise ValueError("Each command needs a modelling command name and an object of params")
    script = json.dumps({"commands": [{"command": c["command"], "params": c.get("params", {})} for c in commands]})
    if len(script) > 200_000:
        raise ValueError("The commands exceed 200 KB")
    with tempfile.TemporaryDirectory(prefix="edit-") as directory:
        root = Path(directory)
        (root / "script.json").write_text(script)
        args = ["run", "script.json"]
        if design is not None:
            (root / "design.json").write_text(design)
            args += ["--in", "design.json"]
        output = run_cli([*args, "--save", "edited.json", "--results", "--quiet"], root, timeout, "edit")
        edited = root / "edited.json"
        if edited.is_symlink() or not edited.is_file():
            raise ValueError("MantelCAD saved no design")
        text = edited.read_text()
        if len(text.encode()) > MAX_DESIGN_BYTES:
            raise ValueError("The edited design exceeds 1 MB")
        if design_of(text) is None:
            raise ValueError("MantelCAD saved something other than a design")
        try:
            results = json.loads(output)
        except ValueError:
            results = None
        summary = json.dumps(results)
        return {"design": text, "results": results if len(summary) <= 60_000 else summary[:60_000]}


def execute(source: str, timeout=JOB_SECONDS, stop_after=None, preview=False, modules=None, check=None):
    if design_of(source) is not None:
        if stop_after is not None or preview or modules or check is not None:
            raise ValueError("MantelCAD designs build whole: view-as-of and saved actions are for Python models")
        return execute_design(source, timeout)
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
        return _read_artifacts(root, preview)


MAX_STEP_BYTES = 15 * 1024 * 1024
MAX_MEASURE_REQUEST = 21_000_000
# A design and its JSON escaping inside the request.
MAX_DESIGN_REQUEST = 2_500_000


def _target_ok(target):
    return (isinstance(target, dict) and len(target) == 1 and next(iter(target)) in ("face", "part")
            and isinstance(next(iter(target.values())), int) and not isinstance(next(iter(target.values())), bool)
            and next(iter(target.values())) >= 0)


def _step_bytes(step) -> bytes:
    try:
        data = base64.b64decode(step, validate=True) if isinstance(step, str) else b""
    except ValueError:
        data = b""
    if not 0 < len(data) <= MAX_STEP_BYTES or b"ISO-10303-21" not in data[:200]:
        raise ValueError("Expected a STEP file up to 15 MiB")
    return data


def execute_drawing(step: str, spec, timeout=JOB_SECONDS):
    """Draws a blueprint from a STEP file. No model source is accepted or run."""
    if not isinstance(spec, dict):
        raise ValueError("spec must be an object")  # noqa: TRY004 - ValueError is the 400 reply
    data = _step_bytes(step)
    with tempfile.TemporaryDirectory(prefix="drawing-") as directory:
        root = Path(directory)
        (root / "model.step").write_bytes(data)
        (root / "spec.json").write_text(json.dumps(spec))
        with (root / "logs.txt").open("w+") as logs:
            process = subprocess.Popen(
                [sys.executable, "-I", str(Path(__file__).with_name("drawing.py")),
                 str(root / "model.step"), str(root / "spec.json"), str(root / "out")],
                cwd=root, env={"PATH": os.environ.get("PATH", ""), "HOME": str(root),
                               "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"},
                stdout=logs, stderr=logs, start_new_session=True)
            try:
                code = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise ValueError("Drawing exceeded its time limit") from None
            if code:
                logs.seek(0)
                raise ValueError("Drawing failed: " + logs.read()[-2000:])
        artifacts = []
        for name, media in DRAWING_FILES.items():
            path = root / "out" / name
            if path.is_symlink() or not path.is_file():
                raise ValueError("Drawing produced no " + name)
            artifacts.append({"name": name, "mediaType": media,
                              "base64": base64.b64encode(path.read_bytes()).decode()})
        return {"artifacts": artifacts}


def execute_measure(step: str, requests, timeout=60):
    """Measures distances on a STEP file. No model source is accepted or run."""
    if not isinstance(requests, list) or not 1 <= len(requests) <= 50:
        raise ValueError("requests must list 1 to 50 measurements")
    for r in requests:
        if not (isinstance(r, dict) and isinstance(r.get("key"), str) and 0 < len(r["key"]) <= 80
                and _target_ok(r.get("a")) and _target_ok(r.get("b"))):
            raise ValueError("Each request needs a key and a and b, each one face or part index")
    data = _step_bytes(step)
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
        if self.path not in ("/build", "/measure", "/drawing", "/edit") or Handler.used:
            self.reply(409, {"error": "Container already used or invalid route"})
            return
        Handler.used = True
        try:
            length = int(self.headers.get("Content-Length", "0"))
            limit = {"/build": MAX_DESIGN_REQUEST, "/edit": MAX_DESIGN_REQUEST}.get(self.path, MAX_MEASURE_REQUEST)
            if not 0 < length <= limit:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(length))
            if self.path == "/edit":
                self.reply(200, execute_edit(payload.get("design"), payload.get("commands")))
                return
            if self.path == "/measure":
                self.reply(200, execute_measure(payload["step"], payload["requests"]))
                return
            if self.path == "/drawing":
                self.reply(200, execute_drawing(payload["step"], payload["spec"]))
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
