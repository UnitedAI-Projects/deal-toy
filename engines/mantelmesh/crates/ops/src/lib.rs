#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! Mesh primitives and edit operations. Each operation takes a mesh and returns a new one with a
//! report of what it made, or an error naming what was wrong with the request; none edits in
//! place, so an engine can keep the old mesh for undo.

use mantelmesh_mesh::{Mesh, V3, add, cross, edge_key, length, normalize, scale, sub};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::f64::consts::PI;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpError(pub String);
impl std::fmt::Display for OpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for OpError {}
fn err<T>(m: impl Into<String>) -> Result<T, OpError> {
    Err(OpError(m.into()))
}

/// What an operation made: the faces it created or moved, for the selection that follows it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Made {
    pub faces: Vec<u32>,
}

const MAX_SEGMENTS: u32 = 512;

fn check_faces(m: &Mesh, faces: &[u32]) -> Result<BTreeSet<u32>, OpError> {
    if faces.is_empty() {
        return err("select at least one face");
    }
    let set: BTreeSet<u32> = faces.iter().copied().collect();
    if let Some(&f) = set.iter().find(|&&f| f as usize >= m.faces.len()) {
        return err(format!("face {f} does not exist"));
    }
    Ok(set)
}
fn positive(name: &str, v: f64) -> Result<f64, OpError> {
    if v.is_finite() && v > 0.0 {
        Ok(v)
    } else {
        err(format!("{name} must be a positive number"))
    }
}
fn segments(name: &str, v: u32, min: u32) -> Result<u32, OpError> {
    if (min..=MAX_SEGMENTS).contains(&v) {
        Ok(v)
    } else {
        err(format!("{name} must be {min}–{MAX_SEGMENTS}"))
    }
}

// ---------- primitives ----------

/// A box centred on the origin, outward-facing.
pub fn cuboid(sx: f64, sy: f64, sz: f64) -> Result<Mesh, OpError> {
    let (x, y, z) = (
        positive("width", sx)? / 2.0,
        positive("depth", sy)? / 2.0,
        positive("height", sz)? / 2.0,
    );
    let mut m = Mesh::new();
    for zz in [-z, z] {
        for (xx, yy) in [(-x, -y), (x, -y), (x, y), (-x, y)] {
            m.add_vertex([xx, yy, zz]);
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
        m.faces.push(f.to_vec());
    }
    Ok(m)
}

/// A flat rectangle in the XY plane, facing +Z, split into a grid.
pub fn plane(sx: f64, sy: f64, cuts_x: u32, cuts_y: u32) -> Result<Mesh, OpError> {
    let (sx, sy) = (positive("width", sx)?, positive("depth", sy)?);
    let (nx, ny) = (segments("columns", cuts_x, 1)?, segments("rows", cuts_y, 1)?);
    let mut m = Mesh::new();
    for j in 0..=ny {
        for i in 0..=nx {
            m.add_vertex([
                sx * (i as f64 / nx as f64 - 0.5),
                sy * (j as f64 / ny as f64 - 0.5),
                0.0,
            ]);
        }
    }
    let at = |i: u32, j: u32| j * (nx + 1) + i;
    for j in 0..ny {
        for i in 0..nx {
            m.faces
                .push(vec![at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
        }
    }
    Ok(m)
}

/// A cylinder standing on the XY plane, centred on the Z axis, with n-gon caps.
pub fn cylinder(radius: f64, height: f64, sides: u32) -> Result<Mesh, OpError> {
    let (r, h, n) = (
        positive("radius", radius)?,
        positive("height", height)?,
        segments("sides", sides, 3)?,
    );
    let mut m = Mesh::new();
    for z in [0.0, h] {
        for i in 0..n {
            let a = 2.0 * PI * i as f64 / n as f64;
            m.add_vertex([r * a.cos(), r * a.sin(), z]);
        }
    }
    m.faces.push((0..n).rev().collect());
    m.faces.push((n..2 * n).collect());
    for i in 0..n {
        let j = (i + 1) % n;
        m.faces.push(vec![i, j, n + j, n + i]);
    }
    Ok(m)
}

/// A UV sphere centred on the origin: triangles at the poles, quads between.
pub fn uv_sphere(radius: f64, segments_around: u32, rings: u32) -> Result<Mesh, OpError> {
    let r = positive("radius", radius)?;
    let (n, k) = (segments("segments", segments_around, 3)?, segments("rings", rings, 2)?);
    let mut m = Mesh::new();
    let south = m.add_vertex([0.0, 0.0, -r]);
    for ring in 1..k {
        let phi = PI * ring as f64 / k as f64 - PI / 2.0;
        for i in 0..n {
            let a = 2.0 * PI * i as f64 / n as f64;
            m.add_vertex([r * phi.cos() * a.cos(), r * phi.cos() * a.sin(), r * phi.sin()]);
        }
    }
    let north = m.add_vertex([0.0, 0.0, r]);
    let at = |ring: u32, i: u32| 1 + (ring - 1) * n + (i % n);
    for i in 0..n {
        m.faces.push(vec![south, at(1, i + 1), at(1, i)]);
    }
    for ring in 1..k - 1 {
        for i in 0..n {
            m.faces
                .push(vec![at(ring, i), at(ring, i + 1), at(ring + 1, i + 1), at(ring + 1, i)]);
        }
    }
    for i in 0..n {
        m.faces.push(vec![at(k - 1, i), at(k - 1, i + 1), north]);
    }
    Ok(m)
}

// ---------- edits ----------

/// Extrudes a region of faces along its normal. The region's faces move by `distance` (negative
/// pushes in), keeping their shape; a wall of quads joins them to where they were along the
/// region's open edge. Faces sharing vertices but not edges stay separate regions only if they
/// are selected separately.
pub fn extrude(m: &Mesh, faces: &[u32], distance: f64) -> Result<(Mesh, Made), OpError> {
    let sel = check_faces(m, faces)?;
    if !distance.is_finite() || distance == 0.0 {
        return err("distance must be a non-zero number");
    }
    let mut out = m.clone();
    // Each vertex of the region moves along the average normal of its selected faces.
    let mut dir: BTreeMap<u32, V3> = BTreeMap::new();
    for &f in &sel {
        let n = m.face_normal(f);
        for &v in &m.faces[f as usize] {
            let d = dir.entry(v).or_insert([0.0; 3]);
            *d = add(*d, n);
        }
    }
    let mut moved: HashMap<u32, u32> = HashMap::new();
    for (&v, &d) in &dir {
        let n = normalize(d);
        let p = add(m.positions[v as usize], scale(n, distance));
        moved.insert(v, out.add_vertex(p));
    }
    // The region's open edges: used once by the region (in the direction that face runs).
    let mut uses: BTreeMap<(u32, u32), Vec<(u32, u32)>> = BTreeMap::new();
    for &f in &sel {
        for (a, b) in m.face_edges(f) {
            uses.entry(edge_key(a, b)).or_default().push((a, b));
        }
    }
    for &f in &sel {
        let lp = &mut out.faces[f as usize];
        for v in lp.iter_mut() {
            *v = moved[v];
        }
    }
    let mut made: Vec<u32> = sel.iter().copied().collect();
    for runs in uses.values() {
        if let [(a, b)] = runs.as_slice() {
            out.faces.push(vec![*a, *b, moved[b], moved[a]]);
            made.push((out.faces.len() - 1) as u32);
        }
    }
    out.compact();
    Ok((out, Made { faces: made }))
}

/// Insets each selected face: a smaller copy of it, `amount` of the way (0–1) towards its centre,
/// framed by a ring of quads. The inset faces are returned for the next step (extrude, delete).
pub fn inset(m: &Mesh, faces: &[u32], amount: f64) -> Result<(Mesh, Made), OpError> {
    let sel = check_faces(m, faces)?;
    if !(amount.is_finite() && amount > 0.0 && amount < 1.0) {
        return err("amount must be between 0 and 1");
    }
    let mut out = m.clone();
    let mut made = Vec::new();
    for &f in &sel {
        let c = m.face_center(f);
        let outer = m.faces[f as usize].clone();
        let inner: Vec<u32> = outer
            .iter()
            .map(|&v| {
                let p = m.positions[v as usize];
                out.add_vertex(add(p, scale(sub(c, p), amount)))
            })
            .collect();
        let n = outer.len();
        for i in 0..n {
            let j = (i + 1) % n;
            out.faces.push(vec![outer[i], outer[j], inner[j], inner[i]]);
        }
        out.faces[f as usize] = inner;
        made.push(f);
    }
    Ok((out, Made { faces: made }))
}

/// Reverses the winding of the selected faces.
pub fn flip(m: &Mesh, faces: &[u32]) -> Result<Mesh, OpError> {
    let sel = check_faces(m, faces)?;
    let mut out = m.clone();
    for f in sel {
        out.faces[f as usize].reverse();
    }
    Ok(out)
}

/// Deletes the selected faces and any vertex left unused.
pub fn delete_faces(m: &Mesh, faces: &[u32]) -> Result<Mesh, OpError> {
    let sel = check_faces(m, faces)?;
    let mut out = m.clone();
    out.faces = m
        .faces
        .iter()
        .enumerate()
        .filter(|(i, _)| !sel.contains(&(*i as u32)))
        .map(|(_, f)| f.clone())
        .collect();
    out.compact();
    Ok(out)
}

/// Merges vertices closer than `distance`, dropping faces that collapse. Returns how many merged.
pub fn merge_by_distance(m: &Mesh, distance: f64) -> Result<(Mesh, usize), OpError> {
    let d = positive("distance", distance)?;
    let cell = |p: V3| {
        [
            (p[0] / d).floor() as i64,
            (p[1] / d).floor() as i64,
            (p[2] / d).floor() as i64,
        ]
    };
    let mut grid: HashMap<[i64; 3], Vec<u32>> = HashMap::new();
    let mut target: Vec<u32> = (0..m.positions.len() as u32).collect();
    let mut merged = 0;
    for v in 0..m.positions.len() as u32 {
        let p = m.positions[v as usize];
        let c = cell(p);
        let mut found = None;
        'search: for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    for &w in grid.get(&[c[0] + dx, c[1] + dy, c[2] + dz]).into_iter().flatten() {
                        if length(sub(m.positions[w as usize], p)) <= d {
                            found = Some(w);
                            break 'search;
                        }
                    }
                }
            }
        }
        match found {
            Some(w) => {
                target[v as usize] = w;
                merged += 1;
            }
            None => grid.entry(c).or_default().push(v),
        }
    }
    let mut out = m.clone();
    out.faces = m
        .faces
        .iter()
        .filter_map(|f| {
            let mut l: Vec<u32> = Vec::with_capacity(f.len());
            for &v in f {
                let t = target[v as usize];
                if l.last() != Some(&t) {
                    l.push(t);
                }
            }
            if l.len() > 1 && l.first() == l.last() {
                l.pop();
            }
            let distinct: BTreeSet<u32> = l.iter().copied().collect();
            (l.len() >= 3 && distinct.len() == l.len()).then_some(l)
        })
        .collect();
    out.compact();
    Ok((out, merged))
}

/// Which vertices a transform moves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pick {
    All,
    Faces(Vec<u32>),
    Vertices(Vec<u32>),
}

fn picked(m: &Mesh, pick: &Pick) -> Result<BTreeSet<u32>, OpError> {
    Ok(match pick {
        Pick::All => (0..m.positions.len() as u32).collect(),
        Pick::Faces(f) => check_faces(m, f)?
            .iter()
            .flat_map(|&f| m.faces[f as usize].clone())
            .collect(),
        Pick::Vertices(v) => {
            if let Some(&bad) = v.iter().find(|&&v| v as usize >= m.positions.len()) {
                return err(format!("vertex {bad} does not exist"));
            }
            v.iter().copied().collect()
        }
    })
}

/// Moves the picked vertices by `offset`.
pub fn translate(m: &Mesh, pick: &Pick, offset: V3) -> Result<Mesh, OpError> {
    if offset.iter().any(|x| !x.is_finite()) {
        return err("offset must be finite");
    }
    let mut out = m.clone();
    for v in picked(m, pick)? {
        out.positions[v as usize] = add(out.positions[v as usize], offset);
    }
    Ok(out)
}

/// Scales the picked vertices about `center` by a factor per axis.
pub fn scale_about(m: &Mesh, pick: &Pick, center: V3, factor: V3) -> Result<Mesh, OpError> {
    if factor.iter().chain(center.iter()).any(|x| !x.is_finite()) {
        return err("scale must be finite");
    }
    let mut out = m.clone();
    for v in picked(m, pick)? {
        let p = sub(out.positions[v as usize], center);
        out.positions[v as usize] = add(center, [p[0] * factor[0], p[1] * factor[1], p[2] * factor[2]]);
    }
    // A mirror (an odd number of negative factors) turns the surface inside out: flip it back.
    if factor.iter().filter(|x| **x < 0.0).count() % 2 == 1 {
        let all = picked(m, pick)?;
        for f in &mut out.faces {
            if f.iter().all(|v| all.contains(v)) {
                f.reverse();
            }
        }
    }
    Ok(out)
}

/// Rotates the picked vertices about an axis through `center` by `degrees`.
pub fn rotate(m: &Mesh, pick: &Pick, center: V3, axis: V3, degrees: f64) -> Result<Mesh, OpError> {
    let k = normalize(axis);
    if length(k) == 0.0 || !degrees.is_finite() {
        return err("rotation needs a non-zero axis and a finite angle");
    }
    let (s, c) = degrees.to_radians().sin_cos();
    let mut out = m.clone();
    for v in picked(m, pick)? {
        let p = sub(out.positions[v as usize], center);
        // Rodrigues' rotation formula.
        let r = add(
            add(scale(p, c), scale(cross(k, p), s)),
            scale(k, mantelmesh_mesh::dot(k, p) * (1.0 - c)),
        );
        out.positions[v as usize] = add(center, r);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(m: &Mesh) {
        let r = m.check();
        assert!(r.is_closed_solid(), "{r:?}");
    }

    #[test]
    fn primitives_are_closed_solids_with_the_right_volume() {
        let c = cuboid(2.0, 3.0, 4.0).unwrap();
        solid(&c);
        assert!((c.volume() - 24.0).abs() < 1e-9);
        let cy = cylinder(1.0, 2.0, 64).unwrap();
        solid(&cy);
        assert!((cy.volume() - PI * 2.0).abs() < 0.02);
        let s = uv_sphere(1.0, 32, 16).unwrap();
        solid(&s);
        assert!((s.volume() - 4.0 / 3.0 * PI).abs() < 0.1);
        let p = plane(10.0, 5.0, 4, 2).unwrap();
        assert!(p.check().is_valid_surface());
        assert_eq!((p.positions.len(), p.faces.len()), (15, 8));
        assert!(cuboid(0.0, 1.0, 1.0).is_err());
        assert!(cylinder(1.0, 1.0, 2).is_err());
        assert!(uv_sphere(1.0, 10_000, 4).is_err());
    }

    #[test]
    fn extruding_the_top_of_a_box_makes_it_taller_and_keeps_it_closed() {
        let c = cuboid(1.0, 1.0, 1.0).unwrap();
        let (e, made) = extrude(&c, &[1], 0.5).unwrap();
        solid(&e);
        assert_eq!((e.positions.len(), e.faces.len()), (12, 10));
        assert!((e.volume() - 1.5).abs() < 1e-9);
        assert_eq!(made.faces.len(), 5, "the cap and four walls");
        // Pushing in removes volume and stays closed.
        let (i, _) = extrude(&c, &[1], -0.25).unwrap();
        solid(&i);
        assert!((i.volume() - 0.75).abs() < 1e-9);
    }

    #[test]
    fn extruding_a_region_moves_it_together() {
        let p = plane(2.0, 1.0, 2, 1).unwrap();
        let (e, made) = extrude(&p, &[0, 1], 1.0).unwrap();
        assert!(e.check().is_valid_surface(), "{:?}", e.check());
        // Two moved faces and six walls (the region's open edges), not walls between the two.
        assert_eq!(made.faces.len(), 8);
        assert_eq!(e.bounds().map(|(lo, hi)| hi[2] - lo[2]), Some(1.0));
    }

    #[test]
    fn inset_then_extrude_makes_a_recess() {
        let c = cuboid(10.0, 10.0, 10.0).unwrap();
        let (i, made) = inset(&c, &[1], 0.5).unwrap();
        solid(&i);
        assert_eq!(i.faces.len(), 6 + 4);
        let (r, _) = extrude(&i, &made.faces, -2.0).unwrap();
        solid(&r);
        // The recess is a 5 × 5 × 2 pocket.
        assert!((r.volume() - (1000.0 - 50.0)).abs() < 1e-6);
        assert!(inset(&c, &[1], 1.0).is_err());
    }

    #[test]
    fn flip_delete_and_merge() {
        let c = cuboid(1.0, 1.0, 1.0).unwrap();
        let f = flip(&c, &[0]).unwrap();
        assert_eq!(f.check().inconsistent_edges.len(), 4);
        let d = delete_faces(&c, &[1]).unwrap();
        assert_eq!(d.check().boundary_edges.len(), 4);
        assert!(delete_faces(&c, &[99]).is_err());
        // Two boxes' worth of duplicated vertices merge back into one closed box.
        let mut split = c.clone();
        let mut faces = Vec::new();
        for face in &c.faces {
            let start = split.positions.len() as u32;
            for &v in face {
                split.positions.push(c.positions[v as usize]);
            }
            faces.push((start..start + face.len() as u32).collect::<Vec<_>>());
        }
        split.faces = faces;
        split.compact();
        assert_eq!(split.check().boundary_edges.len(), 24);
        let (m, merged) = merge_by_distance(&split, 1e-6).unwrap();
        assert_eq!(merged, 16);
        solid(&m);
    }

    #[test]
    fn transforms_move_only_what_is_picked_and_mirroring_keeps_it_outward() {
        let c = cuboid(2.0, 2.0, 2.0).unwrap();
        let t = translate(&c, &Pick::Faces(vec![1]), [0.0, 0.0, 1.0]).unwrap();
        solid(&t);
        assert!((t.volume() - 12.0).abs() < 1e-9);
        let s = scale_about(&c, &Pick::All, [0.0; 3], [-1.0, 1.0, 1.0]).unwrap();
        solid(&s);
        assert!((s.volume() - 8.0).abs() < 1e-9, "mirrored, still outward");
        let r = rotate(&c, &Pick::All, [0.0; 3], [0.0, 0.0, 1.0], 90.0).unwrap();
        solid(&r);
        assert!((r.volume() - 8.0).abs() < 1e-9);
        assert!(rotate(&c, &Pick::All, [0.0; 3], [0.0; 3], 90.0).is_err());
        assert!(translate(&c, &Pick::Vertices(vec![42]), [1.0; 3]).is_err());
    }

    /// Random sequences of edits never leave a box broken.
    #[test]
    fn random_edit_sequences_keep_a_box_closed() {
        let mut seed: u64 = 0x5eed;
        let mut next = move |n: u64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) % n
        };
        for _ in 0..40 {
            let mut m = cuboid(10.0, 10.0, 10.0).unwrap();
            for _ in 0..8 {
                let f = next(m.faces.len() as u64) as u32;
                m = match next(3) {
                    0 => extrude(&m, &[f], 1.0 + next(5) as f64).unwrap().0,
                    1 => inset(&m, &[f], 0.1 + next(7) as f64 / 10.0).unwrap().0,
                    _ => rotate(
                        &m,
                        &Pick::Faces(vec![f]),
                        m.face_center(f),
                        m.face_normal(f),
                        next(90) as f64,
                    )
                    .unwrap(),
                };
                solid(&m);
            }
        }
    }
}
