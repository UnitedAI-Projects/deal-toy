"""Validates step inputs against the catalog's JSON Schema subset.

The Worker validates the same schemas before it writes a step; the engine checks again because
a script can also be edited by hand or by the agent.
"""
import math

from .refs import REF_TYPES


class InvalidInput(Exception):
    pass


def _label(path):
    return path or "inputs"


def _check(schema, value, path):
    kinds = schema.get("x-ref")
    if kinds is not None:
        kinds = [kinds] if isinstance(kinds, str) else kinds
        if "fn" in kinds and callable(value):
            return value
        if not any(isinstance(value, REF_TYPES[k]) for k in kinds if k != "fn"):
            raise InvalidInput(f"{_label(path)} must be a {' or '.join(kinds)} reference")
        return value
    if "const" in schema:
        if value != schema["const"]:
            raise InvalidInput(f"{_label(path)} must be {schema['const']!r}")
        return value
    if "oneOf" in schema:
        passed = []
        for branch in schema["oneOf"]:
            try:
                passed.append(_check(branch, value, path))
            except InvalidInput:
                pass
        if len(passed) != 1:
            raise InvalidInput(f"{_label(path)} does not match exactly one allowed form")
        return passed[0]
    kind = schema.get("type")
    if kind in ("number", "integer"):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise InvalidInput(f"{_label(path)} must be a number")
        if kind == "integer" and value != int(value):
            raise InvalidInput(f"{_label(path)} must be a whole number")
        unit = f" {schema['unit']}" if schema.get("unit") not in (None, "count") else ""
        if "minimum" in schema and value < schema["minimum"]:
            raise InvalidInput(f"{_label(path)} must be at least {schema['minimum']}{unit}")
        if "maximum" in schema and value > schema["maximum"]:
            raise InvalidInput(f"{_label(path)} must be at most {schema['maximum']}{unit}")
    elif kind == "string":
        if not isinstance(value, str):
            raise InvalidInput(f"{_label(path)} must be text")
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", math.inf):
            raise InvalidInput(f"{_label(path)} must be {schema.get('minLength', 0)} to {schema.get('maxLength')} characters")
    elif kind == "boolean":
        if not isinstance(value, bool):
            raise InvalidInput(f"{_label(path)} must be true or false")
    elif kind == "array":
        if not isinstance(value, (list, tuple)):
            raise InvalidInput(f"{_label(path)} must be a list")
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", math.inf):
            count = schema.get("minItems") if schema.get("minItems") == schema.get("maxItems") else \
                f"{schema.get('minItems', 0)} to {schema.get('maxItems')}"
            raise InvalidInput(f"{_label(path)} must have {count} items")
        item = schema.get("items")
        if item:
            value = [_check(item, v, f"{path}[{i}]") for i, v in enumerate(value)]
    elif kind == "object":
        if not isinstance(value, dict):
            raise InvalidInput(f"{_label(path)} must be an object")
        return check_object(schema, value, path)
    if "enum" in schema and value not in schema["enum"]:
        raise InvalidInput(f"{_label(path)} must be one of {', '.join(map(str, schema['enum']))}")
    return value


def check_object(schema, value, path=""):
    props = schema.get("properties", {})
    out = dict(value)
    for key, prop in props.items():
        if key not in out and "default" in prop:
            out[key] = prop["default"]
    for key in schema.get("required", []):
        if key not in out:
            raise InvalidInput(f"{_join(path, key)} is required")
    for condition in schema.get("allOf", []):
        test = condition["if"]["properties"]
        if all(out.get(k) == v["const"] for k, v in test.items()):
            for key in condition["then"].get("required", []):
                if key not in out:
                    field, wanted = next(iter(test.items()))
                    raise InvalidInput(f"{_join(path, key)} is required when {field} is {wanted['const']}")
    for key, item in out.items():
        if key in props:
            out[key] = _check(props[key], item, _join(path, key))
        elif not schema.get("additionalProperties", False):
            raise InvalidInput(f"{_join(path, key)} is not an input of this action")
    return out


def _join(path, key):
    return f"{path}.{key}" if path else key
