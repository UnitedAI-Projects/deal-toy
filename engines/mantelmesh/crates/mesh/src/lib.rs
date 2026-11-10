#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! The editable polygon mesh at the bottom of MantelMesh.
//!
//! A mesh is a list of vertex positions and a list of faces, each an ordered loop of vertex
//! indices (counter-clockwise seen from outside). Edges are not stored: they are derived from the
//! loops, so an edit can never leave edges and faces disagreeing. [`Mesh::check`] reports what a
//! modeller must not hide: edges with more than two faces, open boundaries, neighbours whose
//! windings disagree, degenerate faces and vertices nothing uses.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A position or direction in millimetres.
pub type V3 = [f64; 3];

pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn scale(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn length(a: V3) -> f64 {
    dot(a, a).sqrt()
}
/// The unit vector along `a`, or zero for a zero vector.
pub fn normalize(a: V3) -> V3 {
    let l = length(a);
    if l > 0.0 { scale(a, 1.0 / l) } else { [0.0; 3] }
}

/// Why a face could not be added.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MeshError {
    /// Fewer than three vertices.
    TooFewVertices,
    /// An index past the last vertex.
    MissingVertex(u32),
    /// The same vertex twice in one loop.
    RepeatedVertex(u32),
}

impl std::fmt::Display for MeshError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooFewVertices => write!(f, "a face needs at least three vertices"),
            Self::MissingVertex(v) => write!(f, "vertex {v} does not exist"),
            Self::RepeatedVertex(v) => write!(f, "vertex {v} appears twice in one face"),
        }
    }
}
impl std::error::Error for MeshError {}

/// One use of an edge by a face: which face, and whether the face runs along the edge from its
/// lower vertex to its higher one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EdgeUse {
    pub face: u32,
    pub forward: bool,
}

/// What [`Mesh::check`] found. An empty report is a clean, closed, consistently wound mesh.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Report {
    /// Edges used by more than two faces.
    pub non_manifold_edges: Vec<(u32, u32)>,
    /// Edges used by one face (holes in an otherwise closed surface).
    pub boundary_edges: Vec<(u32, u32)>,
    /// Edges whose two faces run along them in the same direction (one of them is flipped).
    pub inconsistent_edges: Vec<(u32, u32)>,
    /// Faces with (near) zero area.
    pub degenerate_faces: Vec<u32>,
    /// Vertices no face uses.
    pub unused_vertices: Vec<u32>,
}

impl Report {
    /// True when nothing is wrong except, possibly, open boundaries (an open sheet is fine).
    pub fn is_valid_surface(&self) -> bool {
        self.non_manifold_edges.is_empty() && self.inconsistent_edges.is_empty() && self.degenerate_faces.is_empty()
    }
    /// True for a closed, manifold, consistently wound mesh with no stray vertices.
    pub fn is_closed_solid(&self) -> bool {
        self.is_valid_surface() && self.boundary_edges.is_empty() && self.unused_vertices.is_empty()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Mesh {
    pub positions: Vec<V3>,
    pub faces: Vec<Vec<u32>>,
}

/// The edge between two vertices, lower index first.
pub fn edge_key(a: u32, b: u32) -> (u32, u32) {
    if a < b { (a, b) } else { (b, a) }
}

impl Mesh {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_vertex(&mut self, p: V3) -> u32 {
        self.positions.push(p);
        (self.positions.len() - 1) as u32
    }

    /// Adds a face after checking its loop; returns its index.
    pub fn add_face(&mut self, verts: &[u32]) -> Result<u32, MeshError> {
        self.validate_loop(verts)?;
        self.faces.push(verts.to_vec());
        Ok((self.faces.len() - 1) as u32)
    }

    fn validate_loop(&self, verts: &[u32]) -> Result<(), MeshError> {
        if verts.len() < 3 {
            return Err(MeshError::TooFewVertices);
        }
        for (i, &v) in verts.iter().enumerate() {
            if v as usize >= self.positions.len() {
                return Err(MeshError::MissingVertex(v));
            }
            if verts[..i].contains(&v) {
                return Err(MeshError::RepeatedVertex(v));
            }
        }
        Ok(())
    }

    /// The edges of face `f` in loop order.
    pub fn face_edges(&self, f: u32) -> impl Iterator<Item = (u32, u32)> + '_ {
        let l = &self.faces[f as usize];
        (0..l.len()).map(move |i| (l[i], l[(i + 1) % l.len()]))
    }

    /// Every edge and the faces using it.
    pub fn edges(&self) -> BTreeMap<(u32, u32), Vec<EdgeUse>> {
        let mut out: BTreeMap<(u32, u32), Vec<EdgeUse>> = BTreeMap::new();
        for f in 0..self.faces.len() as u32 {
            for (a, b) in self.face_edges(f) {
                out.entry(edge_key(a, b)).or_default().push(EdgeUse {
                    face: f,
                    forward: a < b,
                });
            }
        }
        out
    }

    /// Faces sharing an edge with face `f`.
    pub fn neighbours(&self, f: u32) -> Vec<u32> {
        let edges = self.edges();
        let mut out: Vec<u32> = self
            .face_edges(f)
            .flat_map(|(a, b)| edges.get(&edge_key(a, b)).cloned().unwrap_or_default())
            .map(|u| u.face)
            .filter(|&g| g != f)
            .collect();
        out.sort_unstable();
        out.dedup();
        out
    }

    /// The unnormalised area vector of face `f` (Newell's method; works for non-planar loops).
    pub fn face_area_vector(&self, f: u32) -> V3 {
        let l = &self.faces[f as usize];
        let mut n = [0.0; 3];
        for i in 0..l.len() {
            let a = self.positions[l[i] as usize];
            let b = self.positions[l[(i + 1) % l.len()] as usize];
            n[0] += (a[1] - b[1]) * (a[2] + b[2]);
            n[1] += (a[2] - b[2]) * (a[0] + b[0]);
            n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        }
        scale(n, 0.5)
    }

    pub fn face_normal(&self, f: u32) -> V3 {
        normalize(self.face_area_vector(f))
    }

    pub fn face_center(&self, f: u32) -> V3 {
        let l = &self.faces[f as usize];
        let sum = l.iter().fold([0.0; 3], |acc, &v| add(acc, self.positions[v as usize]));
        scale(sum, 1.0 / l.len() as f64)
    }

    /// The axis-aligned bounds of the used vertices, or None for an empty mesh.
    pub fn bounds(&self) -> Option<(V3, V3)> {
        let mut used = self.faces.iter().flatten().map(|&v| self.positions[v as usize]);
        let first = used.next()?;
        Some(used.fold((first, first), |(lo, hi), p| {
            (
                [lo[0].min(p[0]), lo[1].min(p[1]), lo[2].min(p[2])],
                [hi[0].max(p[0]), hi[1].max(p[1]), hi[2].max(p[2])],
            )
        }))
    }

    /// The enclosed volume (positive for outward-facing closed meshes), by the divergence theorem.
    pub fn volume(&self) -> f64 {
        self.triangles()
            .iter()
            .map(|t| {
                let [a, b, c] = t.map(|v| self.positions[v as usize]);
                dot(a, cross(b, c)) / 6.0
            })
            .sum()
    }

    /// A triangle fan per face, keeping each face's winding.
    pub fn triangles(&self) -> Vec<[u32; 3]> {
        self.faces
            .iter()
            .flat_map(|l| (1..l.len() - 1).map(move |i| [l[0], l[i], l[i + 1]]))
            .collect()
    }

    pub fn check(&self) -> Report {
        let mut r = Report::default();
        for (edge, uses) in self.edges() {
            match uses.len() {
                1 => r.boundary_edges.push(edge),
                2 => {
                    if uses[0].forward == uses[1].forward {
                        r.inconsistent_edges.push(edge);
                    }
                }
                _ => r.non_manifold_edges.push(edge),
            }
        }
        let scale_sq = self
            .bounds()
            .map(|(lo, hi)| {
                let d = length(sub(hi, lo));
                d * d
            })
            .unwrap_or(0.0);
        for f in 0..self.faces.len() as u32 {
            if length(self.face_area_vector(f)) <= 1e-12 * scale_sq.max(1.0) {
                r.degenerate_faces.push(f);
            }
        }
        let mut used = vec![false; self.positions.len()];
        for &v in self.faces.iter().flatten() {
            used[v as usize] = true;
        }
        r.unused_vertices = used
            .iter()
            .enumerate()
            .filter(|(_, u)| !**u)
            .map(|(i, _)| i as u32)
            .collect();
        r
    }

    /// Drops vertices no face uses, renumbering the rest. Returns the old-to-new map.
    pub fn compact(&mut self) -> Vec<Option<u32>> {
        let mut map = vec![None; self.positions.len()];
        let mut positions = Vec::new();
        for f in &mut self.faces {
            for v in f.iter_mut() {
                let i = *v as usize;
                let new = *map[i].get_or_insert_with(|| {
                    positions.push(self.positions[i]);
                    (positions.len() - 1) as u32
                });
                *v = new;
            }
        }
        self.positions = positions;
        map
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unit cube, outward-facing.
    fn cube() -> Mesh {
        let mut m = Mesh::new();
        for z in [0.0, 1.0] {
            for (x, y) in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] {
                m.add_vertex([x, y, z]);
            }
        }
        for f in [
            [0, 3, 2, 1],
            [4, 5, 6, 7],
            [0, 1, 5, 4],
            [1, 2, 6, 5],
            [2, 3, 7, 6],
            [3, 0, 4, 7],
        ] {
            m.add_face(&f).unwrap();
        }
        m
    }

    #[test]
    fn a_cube_is_a_closed_solid_of_unit_volume() {
        let m = cube();
        let r = m.check();
        assert!(r.is_closed_solid(), "{r:?}");
        assert_eq!(m.edges().len(), 12);
        assert!((m.volume() - 1.0).abs() < 1e-12);
        assert_eq!(m.bounds(), Some(([0.0; 3], [1.0; 3])));
        assert_eq!(m.face_normal(1), [0.0, 0.0, 1.0]);
        assert_eq!(m.neighbours(1), vec![2, 3, 4, 5]);
    }

    #[test]
    fn checks_name_what_is_wrong() {
        let mut m = cube();
        m.faces.pop();
        assert_eq!(m.check().boundary_edges.len(), 4);
        let mut m = cube();
        m.faces[1].reverse();
        assert_eq!(m.check().inconsistent_edges.len(), 4);
        let mut m = cube();
        let extra = m.add_vertex([0.5, 0.5, 2.0]);
        m.add_face(&[4, 5, extra]).unwrap();
        let r = m.check();
        assert_eq!(r.non_manifold_edges, vec![(4, 5)]);
        let mut m = cube();
        m.add_vertex([9.0; 3]);
        assert_eq!(m.check().unused_vertices, vec![8]);
    }

    #[test]
    fn refuses_bad_loops() {
        let mut m = cube();
        assert_eq!(m.add_face(&[0, 1]), Err(MeshError::TooFewVertices));
        assert_eq!(m.add_face(&[0, 1, 99]), Err(MeshError::MissingVertex(99)));
        assert_eq!(m.add_face(&[0, 1, 0]), Err(MeshError::RepeatedVertex(0)));
    }

    #[test]
    fn compact_drops_unused_vertices_and_keeps_shape() {
        let mut m = cube();
        m.positions.insert(0, [7.0; 3]);
        for f in &mut m.faces {
            for v in f.iter_mut() {
                *v += 1;
            }
        }
        m.compact();
        assert_eq!(m.positions.len(), 8);
        assert!(m.check().is_closed_solid());
        assert!((m.volume() - 1.0).abs() < 1e-12);
    }
}
