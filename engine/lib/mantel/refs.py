"""Lazy references written in step calls. They are resolved when the step that uses them runs."""
from dataclasses import dataclass


@dataclass(frozen=True)
class P:
    """A numeric input taken from the script's PARAMS."""
    name: str


@dataclass(frozen=True)
class FaceRef:
    of: str
    name: str | None = None
    normal: tuple | None = None
    near: tuple | None = None

    def __str__(self):
        if self.name is not None:
            return f'face("{self.of}", "{self.name}")'
        return f'face("{self.of}", normal={self.normal}, near={self.near})'


@dataclass(frozen=True)
class EdgesRef:
    of: str
    between: tuple | None = None
    around: str | None = None

    def __str__(self):
        detail = f"between={self.between}" if self.between else f'around="{self.around}"'
        return f'edges("{self.of}", {detail})'


@dataclass(frozen=True)
class DatumRef:
    name: str

    def __str__(self):
        return f'datum("{self.name}")'


@dataclass(frozen=True)
class PartRef:
    label: str

    def __str__(self):
        return f'part("{self.label}")'


@dataclass(frozen=True)
class PointRef:
    x: float
    y: float
    z: float


REF_TYPES = {"face": FaceRef, "edges": EdgesRef, "datum": DatumRef, "part": PartRef, "point": PointRef}
