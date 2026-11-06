"""Custom actions that describe themselves, saved for reuse and loaded by version.

A custom action is a function decorated with `@mt.action(...)`. The decorator turns its id,
summary, described inputs, created names and example into the same record shape as a built-in
catalog action, so the person and the agent read it the same way. Saved versions arrive in a build
as `saved/<id>@<version>.py` and are run with `m.custom("Name", action="<id>@<version>", ...)`.
"""
import importlib.util
import inspect
import re
from pathlib import Path

from . import geometry as g
from .model import ACTIONS, StepError

KEY = re.compile(r"^([a-z][a-z0-9-]{1,39})@([0-9]{1,6})$")
ID = re.compile(r"^[a-z][a-z0-9-]{1,39}$")
CREATED = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_SAVED: dict[str, tuple[dict, object]] = {}
_LOAD_ERRORS: dict[str, str] = {}
_LOADING: str | None = None
_CHECK: str | None = None
_CHECK_RESULT: dict | None = None

COMMON = [
    ("invalid_input", "An input is missing, has the wrong type or is out of range.",
     "Read the action's inputs with actions_describe and correct the value."),
    ("duplicate_name", "Another step or part already uses this name.", "Give the step a unique name."),
    ("internal_error", "The step raised an unexpected error.",
     "Read the message; if it persists, simplify the inputs or ask the action's author."),
]
REFERENCES = [
    ("face_not_found", "A face this step refers to no longer exists.",
     "Pick the face again, or refer to a name an earlier step created."),
    ("ambiguous_reference", "A face or edge query matched two candidates equally well.",
     "Move the reference point closer to the intended face, or pick it by a created name."),
]


# Input helpers: each returns one described property in the catalog's JSON Schema subset.
def _with_default(schema, default):
    if default is not None:
        schema["default"] = default
    return schema


def Face(description):
    return {"x-ref": "face", "description": description}


def Edges(description):
    return {"x-ref": "edges", "description": description}


def Plane(description):
    return {"x-ref": ["face", "datum"], "description": description}


def Part(description):
    return {"x-ref": "part", "description": description}


def Length(description, min=0.01, max=2000, default=None):
    return _with_default({"type": "number", "description": description, "unit": "mm",
                          "minimum": min, "maximum": max}, default)


def Angle(description, min=-360, max=360, default=None):
    return _with_default({"type": "number", "description": description, "unit": "deg",
                          "minimum": min, "maximum": max}, default)


def Count(description, min=1, max=1000, default=None):
    return _with_default({"type": "integer", "description": description, "unit": "count",
                          "minimum": min, "maximum": max}, default)


def Text(description, max_length=200, default=None):
    return _with_default({"type": "string", "description": description, "minLength": 1,
                          "maxLength": max_length}, default)


def Choice(description, options, default=None):
    return _with_default({"type": "string", "description": description, "enum": list(options)}, default)


def Flag(description, default=False):
    return {"type": "boolean", "description": description, "default": default}


def _selections(properties, required):
    out = []
    for name, prop in properties.items():
        kinds = prop.get("x-ref")
        for kind in [kinds] if isinstance(kinds, str) else (kinds or []):
            out.append({"input": name, "kind": {"edges": "edge", "datum": "plane"}.get(kind, kind),
                        "min": 1 if name in required else 0, "max": 1})
    return out


def action(*, id, summary, inputs, example, creates=None, title=None):
    """Declares a custom action. The function's docstring becomes the action's description."""

    def decorate(fn):
        properties = dict(inputs)
        required = [k for k, v in properties.items() if "default" not in v]
        uses_refs = any("x-ref" in v for v in properties.values())
        record = {
            "id": id, "version": 0, "title": title or id.replace("-", " ").capitalize(),
            "category": "Custom", "summary": summary,
            "description": inspect.cleandoc(fn.__doc__ or ""),
            "inputs": {"type": "object", "properties": properties, "required": required,
                       "additionalProperties": False},
            "selections": _selections(properties, required),
            "creates": dict(creates or {}),
            "failures": [{"code": c, "explanation": e, "fix": f}
                         for c, e, f in (REFERENCES if uses_refs else []) + COMMON],
            "preview": "none", "example": example,
        }
        fn.__mantel_record__ = record
        if _LOADING is not None:
            key_id, version = KEY.match(_LOADING).groups()
            if key_id != id:
                raise ValueError(f"The decorator declares {id!r} but this source is saved as {key_id!r}")
            _SAVED[_LOADING] = ({**record, "id": _LOADING, "version": int(version)}, fn)
        return fn
    return decorate


def record_errors(record):
    """Problems that keep a record out of the store: the description must be usable by the agent."""
    errors = []
    bare = record["id"].split("@")[0]
    if not ID.match(bare) or bare in ACTIONS:
        errors.append(f"The id {bare!r} must be lowercase words joined by hyphens and not a built-in action")
    if not record["summary"].strip() or len(record["summary"]) > 120:
        errors.append("The summary must be 1 to 120 characters")
    for name, prop in record["inputs"]["properties"].items():
        if not str(prop.get("description", "")).strip():
            errors.append(f"The input {name} needs a description")
    for name, text in record["creates"].items():
        if not CREATED.match(name) or not str(text).strip():
            errors.append(f"The created name {name!r} needs a lowercase name and a description")
    if f'action="{bare}@' not in record["example"]:
        errors.append(f'The example must call this action, as m.custom("Name", action="{bare}@1", ...)')
    return errors


def reset_saved():
    global _CHECK, _CHECK_RESULT
    _SAVED.clear()
    _LOAD_ERRORS.clear()
    _CHECK = None
    _CHECK_RESULT = None


def load_saved(directory):
    """Loads every `<id>@<version>.py` in directory. A source that fails to load is recorded, not raised."""
    global _LOADING
    for path in sorted(Path(directory).glob("*.py")):
        key = path.stem
        if not KEY.match(key):
            continue
        spec = importlib.util.spec_from_file_location(f"mantel_saved_{len(_SAVED) + len(_LOAD_ERRORS)}", path)
        _LOADING = key
        try:
            spec.loader.exec_module(importlib.util.module_from_spec(spec))
            if key not in _SAVED:
                _LOAD_ERRORS[key] = "The source has no @mt.action decorator"
        except Exception as error:  # noqa: BLE001 - a broken saved source fails only the steps that use it
            _LOAD_ERRORS[key] = f"{type(error).__name__}: {error}"[:300]
        finally:
            _LOADING = None


def saved_record(key):
    return _SAVED[key][0]


def resolve(key):
    """The (record, function) for a saved key; in check mode any version of the candidate's id resolves to it."""
    if not isinstance(key, str) or not KEY.match(key):
        raise StepError("invalid_input", "action must be a saved action as id@version, for example finger-notch@2")
    if _CHECK and key.split("@")[0] == _CHECK.split("@")[0]:
        key = _CHECK
    if key in _LOAD_ERRORS:
        raise StepError("action_rejected", f"{key} could not be loaded: {_LOAD_ERRORS[key]}")
    if key not in _SAVED:
        raise StepError("action_not_found", f"{key} is not available to this model")
    return _SAVED[key]


def set_check(key):
    """Turns on check mode for a candidate saved action, or off with None."""
    global _CHECK, _CHECK_RESULT
    _CHECK, _CHECK_RESULT = key, None


def last_check():
    return _CHECK_RESULT


def run_check(model):
    """Runs the candidate's example against the model, after its own steps. Called by Model.result()."""
    global _CHECK_RESULT
    import mantel

    key = _CHECK
    result = {"key": key}
    _CHECK_RESULT = result
    if key in _LOAD_ERRORS:
        result["error"] = _LOAD_ERRORS[key]
        return
    if key not in _SAVED:
        result["error"] = "The source has no @mt.action decorator"
        return
    record = _SAVED[key][0]
    result["record"] = record
    errors = record_errors(record)
    if errors:
        result["error"] = "; ".join(errors)[:600]
        return
    before = len(model.log)
    try:
        exec(compile(record["example"], "<example>", "exec"), {"m": model, "mt": mantel})  # noqa: S102
    except Exception as error:  # noqa: BLE001 - a broken example rejects the candidate
        result["error"] = f"The example failed: {type(error).__name__}: {error}"[:600]
        return
    ran = [entry for entry in model.log[before:] if entry["action"] == "custom"]
    if not ran:
        result["error"] = "The example did not run a custom step"
        return
    result["step"] = ran[-1]


def plane_of(faces):
    """The plane of a flat face selection, for custom actions; fails the step when it is not flat."""
    try:
        return g.plane_of(faces)
    except g.GeometryError as error:
        raise StepError(error.code, str(error)) from None
