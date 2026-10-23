"""Cuts meshes that BodyParts3D ships fused together.

Rectus abdominis: in BodyParts3D 4.0 the "external oblique" mesh is the whole anterior wall —
the tendinous intersections of the rectus are on it. The lateral border of the rectus (the
linea semilunaris) shows as a groove on the surface; measured on horizontal slices of the base
model it sits ~5 cm from the midline near the pubis, ~6.5–7 cm between the navel and the costal
arch and opens to ~9 cm at the costal margin. The cut follows that profile, at the height of the
base model.
"""
from __future__ import annotations

import numpy as np

import anatomy
import meshops
from body import Part

# (height y in m on the base model, half-width of the rectus + half the linea alba in m)
SEMILUNAR = [(0.78, 0.030), (0.82, 0.040), (0.85, 0.050), (0.91, 0.063), (0.97, 0.066),
             (1.03, 0.068), (1.09, 0.070), (1.13, 0.076), (1.16, 0.085), (1.22, 0.095)]


def semilunar_width(y: np.ndarray) -> np.ndarray:
    ys, ws = zip(*SEMILUNAR)
    return np.interp(y, ys, ws)


def split_rectus(parts: list[Part]) -> list[Part]:
    """Replaces each external oblique by the oblique proper and a rectus abdominis part."""
    out = []
    for p in parts:
        if p.base != "external-oblique":
            out.append(p)
            continue
        # positive inside the rectus; only at the front (z > 8 cm) — behind the trunk nothing is rectus
        s = semilunar_width(p.v[:, 1]) - np.abs(p.v[:, 0])
        s = np.where(p.v[:, 2] > 0.08, s, -np.abs(s) - 1e-3)
        v, f, inside = meshops.split_by_field(p.v, p.f, s)
        rv, rf = meshops.submesh(v, f, inside)
        ov, of = meshops.submesh(v, f, ~inside)
        out.append(Part(p.id, p.base, p.side, p.kind, p.label, group=p.group, v=ov, f=of, source=p.source))
        out.append(Part(f"rectus-abdominis_{p.side}", "rectus-abdominis", p.side, "muscle",
                        anatomy.label_of("rectus-abdominis"), group="abs", v=rv, f=rf, source=p.source))
    return out
