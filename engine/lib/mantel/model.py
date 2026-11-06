"""Runs a model's named steps in order and records each step's health."""
import json
import time
from pathlib import Path

import build123d as bd

from . import geometry as g
from .refs import DatumRef, EdgesRef, FaceRef, P, PartRef, PointRef
from .schema import InvalidInput, check_object

CATALOG = json.loads(Path(__file__).with_name("catalog.json").read_text())
ACTIONS = {a["id"]: a for a in CATALOG["actions"]}
IMPLEMENTATIONS = {}
_LAST = None


def builtin(action_id):
    """Registers the engine implementation of a catalog action."""
    if action_id not in ACTIONS:
        raise KeyError(f"{action_id} is not in the catalog")

    def register(fn):
        IMPLEMENTATIONS[action_id] = fn
        return fn
    return register


def last_log():
    """The step log of the most recent Model, or None when the script used no Model."""
    return _LAST


def reset_log():
    global _LAST, _LAST_MODEL
    _LAST = None
    _LAST_MODEL = None


_LAST_MODEL = None


def last_model():
    """The most recent Model, so the inspection record can name the faces its steps created."""
    return _LAST_MODEL


def created_names(model):
    """(step, name, part label, signatures) for every name the model's steps created, in step order."""
    return [(step, name, label, signatures)
            for step, names in model._created.items() for name, (label, signatures) in names.items()]


_STOP_AFTER = None


def set_stop_after(count):
    """Run only the first `count` steps (None runs all). Later steps are neither run nor logged."""
    global _STOP_AFTER
    _STOP_AFTER = count


class StepError(Exception):
    """A known failure, with a code from the action's catalog record."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Blocked(Exception):
    pass


class Model:
    def __init__(self, base=None, params=None):
        global _LAST
        self.parts: dict[str, bd.Shape] = {}
        self.datums: dict[str, bd.Plane] = {}
        self.params = params or {}
        self.log: list[dict] = []
        self._created: dict[str, dict[str, tuple[str, list[g.Signature]]]] = {}
        self._unavailable: dict[str, str] = {}
        self._names: set[str] = set()
        self._warning = None
        _LAST = self.log
        global _LAST_MODEL
        _LAST_MODEL = self
        if base is None:
            return
        children = list(getattr(base, "children", None) or []) or [base]
        for i, child in enumerate(children):
            label = child.label or f"Part {i + 1}"
            if label in self.parts:
                raise ValueError(f"base() returned two parts labelled {label!r}")
            self.parts[label] = child

    # References. They are lazy; the step that uses one resolves it.
    def face(self, of, name=None, *, normal=None, near=None):
        return FaceRef(of, name, None if normal is None else tuple(normal), None if near is None else tuple(near))

    def edges(self, of, *, between=None, around=None):
        return EdgesRef(of, None if between is None else tuple(between), around)

    def datum(self, name):
        return DatumRef(name)

    def part(self, label):
        return PartRef(label)

    def point(self, x, y, z):
        return PointRef(x, y, z)

    def warn(self, message):
        """Marks the running step as needing attention without undoing it."""
        self._warning = message

    def __getattr__(self, action_id):
        if action_id.startswith("_") or action_id not in ACTIONS:
            raise AttributeError(action_id)

        def step(name, *, suppressed=False, **inputs):
            self._run(action_id, name, suppressed, inputs)
        return step

    def result(self):
        from . import saved

        if saved._CHECK:
            saved.run_check(self)
        if not self.parts:
            raise ValueError("The model has no parts; add a body step or return parts from base()")
        children = []
        for label, shape in self.parts.items():
            shape.label = label
            children.append(shape)
        return bd.Compound(children=children)

    # Resolution, used by actions.
    def _available(self, name):
        if name in self._unavailable:
            raise Blocked(f'Refers to "{name}", which {self._unavailable[name]}')

    def resolve_part(self, ref):
        self._available(ref.label)
        if ref.label not in self.parts:
            raise StepError("part_not_found", f'No part is labelled "{ref.label}"')
        return ref.label

    def resolve_faces(self, ref):
        """Returns (part label, faces) for a face reference, or fails; never guesses."""
        self._available(ref.of)
        if ref.normal is not None or ref.near is not None:
            if ref.normal is None or ref.near is None or ref.name is not None:
                raise StepError("invalid_input", "A face query needs both normal= and near=, and no name")
            if ref.of not in self.parts:
                raise StepError("face_not_found", f'No part is labelled "{ref.of}"')
            try:
                faces = g.query_face(self.parts[ref.of], ref.normal, ref.near)
            except g.GeometryError as error:
                raise StepError(error.code, str(error)) from None
            if not faces:
                raise StepError("face_not_found", f"No face of {ref.of} faces {ref.normal}")
            return ref.of, faces
        created = self._created.get(ref.of, {})
        if ref.name in created:
            label, signatures = created[ref.name]
            shape = self.parts.get(label)
            faces = [f for f in shape.faces() if any(g.matches(f, s) for s in signatures)] if shape else []
            if not faces:
                raise StepError("face_not_found", f'The {ref.name} of "{ref.of}" no longer exists')
            return label, faces
        if ref.of in self.parts and ref.name in g.SIDES:
            faces = g.side_faces(self.parts[ref.of], ref.name)
            if not faces:
                raise StepError("face_not_found", f"{ref.of} has no flat {ref.name} face")
            return ref.of, faces
        if ref.of not in self.parts and ref.of not in self._created:
            raise StepError("face_not_found", f'No part or step is named "{ref.of}"')
        raise StepError("face_not_found", f'"{ref.of}" has no face named "{ref.name}"')

    def resolve_plane(self, ref):
        """Returns (plane, part label or None, faces) for a face or datum reference."""
        if isinstance(ref, DatumRef):
            self._available(ref.name)
            if ref.name not in self.datums:
                raise StepError("datum_not_found", f'No construction plane is named "{ref.name}"')
            return self.datums[ref.name], None, []
        label, faces = self.resolve_faces(ref)
        try:
            return g.plane_of(faces), label, faces
        except g.GeometryError as error:
            raise StepError(error.code, str(error)) from None

    def resolve_edges(self, ref):
        if ref.around is not None:
            label, faces = self.resolve_faces(FaceRef(ref.of, ref.around))
            edges = _unique([e for f in faces for e in f.edges()])
        elif ref.between is not None and len(ref.between) == 2:
            label, a = self.resolve_faces(FaceRef(ref.of, ref.between[0]))
            other, b = self.resolve_faces(FaceRef(ref.of, ref.between[1]))
            shared = [e for f in b for e in f.edges()]
            edges = _unique([e for f in a for e in f.edges() if any(e == s for s in shared)])
            if other != label:
                edges = []
        else:
            raise StepError("invalid_input", "An edge selection needs between=(face, face) or around=face")
        if not edges:
            raise StepError("no_edges", f"No edges match {ref}")
        return label, edges

    def _resolve_params(self, value):
        if isinstance(value, P):
            spec = self.params.get(value.name)
            if not isinstance(spec, dict) or "value" not in spec:
                raise StepError("invalid_input", f"No parameter named {value.name}")
            return spec["value"]
        if isinstance(value, (list, tuple)):
            return [self._resolve_params(v) for v in value]
        if isinstance(value, dict):
            return {k: self._resolve_params(v) for k, v in value.items()}
        return value

    def _run(self, action_id, name, suppressed, inputs):
        if _STOP_AFTER is not None and len(self.log) >= _STOP_AFTER:
            return
        action = ACTIONS[action_id]
        entry = {"name": str(name)[:80], "action": action_id, "version": action["version"],
                 "state": "ok", "created": [], "ms": 0}
        self.log.append(entry)
        started = time.monotonic()
        saved = (dict(self.parts), dict(self.datums))
        self._warning = None
        owns_name = False  # a step with an invalid or duplicate name must not shadow another step's
        try:
            if not isinstance(name, str) or not 0 < len(name) <= 80 or any(c in name for c in '"\\\n'):
                raise StepError("invalid_input", "Step names are 1 to 80 characters without quotes, backslashes or line breaks")
            if name in self._names or name in self.parts or name in self.datums:
                raise StepError("duplicate_name", f'A step or part is already named "{name}"')
            self._names.add(name)
            owns_name = True
            if suppressed:
                entry["state"] = "suppressed"
                self._unavailable[name] = "is suppressed"
                return
            implementation = IMPLEMENTATIONS.get(action_id)
            if implementation is None:
                raise StepError("internal_error", f"{action_id} is not implemented")
            try:
                values = check_object(action["inputs"], self._resolve_params(inputs))
            except InvalidInput as error:
                raise StepError("invalid_input", str(error)) from None
            created = implementation(self, name, **values) or {}
            for label, shape in self.parts.items():
                if shape is not saved[0].get(label) and (
                        not isinstance(shape, bd.Shape) or not shape.is_valid or not shape.solids()):
                    raise StepError("invalid_geometry", f'"{label}" is not a valid solid after this step')
            self._created[name] = {key: (label, [g.signature(f) for f in faces])
                                   for key, (label, faces) in created.items() if faces}
            entry["created"] = sorted(self._created[name])
            if self._warning:
                entry["state"], entry["message"] = "warning", self._warning[:300]
        except Blocked as error:
            self.parts, self.datums = saved
            entry["state"], entry["message"] = "blocked", str(error)[:300]
        except StepError as error:
            self.parts, self.datums = saved
            entry["state"], entry["code"], entry["message"] = "failed", error.code, str(error)[:300]
        except Exception as error:  # noqa: BLE001 - any failure inside a step is that step's failure
            self.parts, self.datums = saved
            entry["state"], entry["code"] = "failed", "internal_error"
            entry["message"] = (str(error) or type(error).__name__)[:300]
        finally:
            entry["ms"] = int((time.monotonic() - started) * 1000)
        if owns_name and entry["state"] in ("failed", "blocked") and name not in self._unavailable:
            self._unavailable[name] = "failed" if entry["state"] == "failed" else "is blocked"


def _unique(edges):
    out = []
    for e in edges:
        if not any(e == o for o in out):
            out.append(e)
    return out
