"""Mantel's modeling actions for build123d scripts.

A model in the standard layout builds `m = mt.Model(base(), params=PARAMS)`, runs one
`m.<action>("Name", ...)` call per step between the `# mantel:steps` markers, and returns
`m.result()`. Each step's state is reported in the build facts.
"""
from . import actions  # noqa: F401  (registers the built-in actions)
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

__all__ = ["ACTIONS", "CATALOG", "Model", "P", "StepError", "builtin", "last_log", "reset_log", "set_stop_after"]
