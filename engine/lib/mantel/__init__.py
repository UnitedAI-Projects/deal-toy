"""Mantel's modeling actions for build123d scripts.

A model in the standard layout builds `m = mt.Model(base(), params=PARAMS)`, runs one
`m.<action>("Name", ...)` call per step between the `# mantel:steps` markers, and returns
`m.result()`. Each step's state is reported in the build facts.
"""
from . import (  # noqa: F401
    actions,
    refs,
    schema,
)
from .model import (
    ACTIONS,
    CATALOG,
    Model,
    StepError,
    builtin,
    last_log,
    reset_log,
    set_stop_after,
)
from .refs import P
from .saved import (
    Angle,
    Choice,
    Count,
    Edges,
    Face,
    Flag,
    Length,
    Part,
    Plane,
    Text,
    action,
    last_check,
    load_saved,
    plane_of,
    record_errors,
    reset_saved,
    saved_record,
    set_check,
)

__all__ = [
    "ACTIONS", "CATALOG", "Angle", "Choice", "Count", "Edges", "Face", "Flag", "Length", "Model", "P", "Part",
    "Plane", "StepError", "Text", "action", "builtin", "last_check", "last_log", "load_saved", "plane_of",
    "record_errors", "reset_log", "reset_saved", "saved_record", "set_check", "set_stop_after",
]
