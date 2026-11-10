#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! The scene a person edits: named objects, each a mesh with a transform and a material, plus the
//! undo journal. The journal keeps whole snapshots; concept meshes are small, and a snapshot can't
//! drift from the state it restores.

use mantelmesh_mesh::{Mesh, V3, add, cross, dot, scale};
use serde::{Deserialize, Serialize};

/// A physically based material, as glTF describes one.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Material {
    pub name: String,
    /// Linear RGBA, 0–1.
    pub base_color: [f64; 4],
    pub metallic: f64,
    pub roughness: f64,
    /// 0 opaque, 1 fully transmissive (acrylic, glass).
    pub transmission: f64,
}

impl Default for Material {
    fn default() -> Self {
        preset("clay").unwrap_or_else(|| Material {
            name: "Clay".into(),
            base_color: [0.8, 0.8, 0.8, 1.0],
            metallic: 0.0,
            roughness: 0.6,
            transmission: 0.0,
        })
    }
}

/// The deal-toy materials MantelMesh offers by name.
pub const PRESETS: &[&str] = &[
    "clay",
    "satin-nickel",
    "brass",
    "gold",
    "walnut",
    "acrylic",
    "marble",
    "black-anodised",
];

pub fn preset(name: &str) -> Option<Material> {
    let (label, base_color, metallic, roughness, transmission) = match name {
        "clay" => ("Clay", [0.8, 0.8, 0.78, 1.0], 0.0, 0.6, 0.0),
        "satin-nickel" => ("Satin nickel", [0.66, 0.64, 0.6, 1.0], 1.0, 0.35, 0.0),
        "brass" => ("Brass", [0.89, 0.69, 0.36, 1.0], 1.0, 0.25, 0.0),
        "gold" => ("Gold", [1.0, 0.77, 0.34, 1.0], 1.0, 0.15, 0.0),
        "walnut" => ("Walnut", [0.3, 0.18, 0.1, 1.0], 0.0, 0.55, 0.0),
        "acrylic" => ("Acrylic", [0.95, 0.97, 1.0, 0.25], 0.0, 0.05, 1.0),
        "marble" => ("Marble", [0.9, 0.9, 0.88, 1.0], 0.0, 0.2, 0.0),
        "black-anodised" => ("Black anodised", [0.05, 0.05, 0.06, 1.0], 1.0, 0.4, 0.0),
        _ => return None,
    };
    Some(Material {
        name: label.into(),
        base_color,
        metallic,
        roughness,
        transmission,
    })
}

/// Placement of an object: translate, then rotate (degrees about X, Y, Z in that order), scale.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub translation: V3,
    pub rotation_deg: V3,
    pub scale: V3,
}
impl Default for Transform {
    fn default() -> Self {
        Self {
            translation: [0.0; 3],
            rotation_deg: [0.0; 3],
            scale: [1.0; 3],
        }
    }
}

fn rot(p: V3, axis: V3, deg: f64) -> V3 {
    if deg == 0.0 {
        return p;
    }
    let (s, c) = deg.to_radians().sin_cos();
    add(
        add(scale(p, c), scale(cross(axis, p), s)),
        scale(axis, dot(axis, p) * (1.0 - c)),
    )
}

impl Transform {
    /// Where a point of the object's mesh lands in the scene.
    pub fn apply(&self, p: V3) -> V3 {
        let s = [p[0] * self.scale[0], p[1] * self.scale[1], p[2] * self.scale[2]];
        let r = rot(
            rot(
                rot(s, [1.0, 0.0, 0.0], self.rotation_deg[0]),
                [0.0, 1.0, 0.0],
                self.rotation_deg[1],
            ),
            [0.0, 0.0, 1.0],
            self.rotation_deg[2],
        );
        add(r, self.translation)
    }
    /// True when the transform mirrors (and so turns windings inside out).
    pub fn mirrors(&self) -> bool {
        self.scale.iter().filter(|s| **s < 0.0).count() % 2 == 1
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Object {
    pub id: u32,
    pub name: String,
    pub mesh: Mesh,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub material: Material,
    #[serde(default = "visible")]
    pub visible: bool,
}
fn visible() -> bool {
    true
}

impl Object {
    /// The mesh with its transform applied, outward-facing.
    pub fn world_mesh(&self) -> Mesh {
        let mut m = self.mesh.clone();
        for p in &mut m.positions {
            *p = self.transform.apply(*p);
        }
        if self.transform.mirrors() {
            for f in &mut m.faces {
                f.reverse();
            }
        }
        m
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Document {
    pub objects: Vec<Object>,
    #[serde(default)]
    pub next_id: u32,
}

impl Document {
    pub fn add(&mut self, name: &str, mesh: Mesh) -> u32 {
        self.next_id += 1;
        let id = self.next_id;
        let name = self.unique_name(name);
        self.objects.push(Object {
            id,
            name,
            mesh,
            transform: Transform::default(),
            material: Material::default(),
            visible: true,
        });
        id
    }
    fn unique_name(&self, name: &str) -> String {
        let base = if name.trim().is_empty() { "Object" } else { name.trim() };
        if !self.objects.iter().any(|o| o.name == base) {
            return base.to_string();
        }
        (2..)
            .map(|i| format!("{base}.{i:03}"))
            .find(|n| !self.objects.iter().any(|o| &o.name == n))
            .unwrap_or_default()
    }
    pub fn get(&self, id: u32) -> Option<&Object> {
        self.objects.iter().find(|o| o.id == id)
    }
    pub fn get_mut(&mut self, id: u32) -> Option<&mut Object> {
        self.objects.iter_mut().find(|o| o.id == id)
    }
    pub fn remove(&mut self, id: u32) -> Option<Object> {
        let i = self.objects.iter().position(|o| o.id == id)?;
        Some(self.objects.remove(i))
    }
    /// The scene's bounds over visible objects.
    pub fn bounds(&self) -> Option<(V3, V3)> {
        self.objects
            .iter()
            .filter(|o| o.visible)
            .filter_map(|o| o.world_mesh().bounds())
            .reduce(|(alo, ahi), (blo, bhi)| {
                (
                    [alo[0].min(blo[0]), alo[1].min(blo[1]), alo[2].min(blo[2])],
                    [ahi[0].max(bhi[0]), ahi[1].max(bhi[1]), ahi[2].max(bhi[2])],
                )
            })
    }
}

/// Undo and redo by snapshot, with a bounded history.
#[derive(Debug, Clone, Default)]
pub struct Journal {
    undo: Vec<(String, Document)>,
    redo: Vec<(String, Document)>,
}

pub const HISTORY: usize = 200;

impl Journal {
    /// Records `before` as the state an edit named `label` replaced.
    pub fn record(&mut self, label: &str, before: Document) {
        self.undo.push((label.to_string(), before));
        if self.undo.len() > HISTORY {
            self.undo.remove(0);
        }
        self.redo.clear();
    }
    /// Swaps `doc` for the state before the last edit; returns that edit's label.
    pub fn undo(&mut self, doc: &mut Document) -> Option<String> {
        let (label, before) = self.undo.pop()?;
        self.redo.push((label.clone(), std::mem::replace(doc, before)));
        Some(label)
    }
    pub fn redo(&mut self, doc: &mut Document) -> Option<String> {
        let (label, after) = self.redo.pop()?;
        self.undo.push((label.clone(), std::mem::replace(doc, after)));
        Some(label)
    }
    pub fn labels(&self) -> Vec<String> {
        self.undo.iter().map(|(l, _)| l.clone()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tri() -> Mesh {
        Mesh {
            positions: vec![[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            faces: vec![vec![0, 1, 2]],
        }
    }

    #[test]
    fn names_are_unique_and_ids_never_reused() {
        let mut d = Document::default();
        let a = d.add("Tower", tri());
        let b = d.add("Tower", tri());
        assert_eq!(d.get(b).map(|o| o.name.as_str()), Some("Tower.002"));
        d.remove(b);
        let c = d.add("Tower", tri());
        assert!(c > b && a < b);
    }

    #[test]
    fn transforms_place_and_mirror_outward() {
        let t = Transform {
            translation: [10.0, 0.0, 0.0],
            rotation_deg: [0.0, 0.0, 90.0],
            scale: [2.0, 1.0, 1.0],
        };
        let p = t.apply([1.0, 0.0, 0.0]);
        assert!((p[0] - 10.0).abs() < 1e-9 && (p[1] - 2.0).abs() < 1e-9);
        let mut d = Document::default();
        let id = d.add("T", tri());
        d.get_mut(id).unwrap().transform.scale = [-1.0, 1.0, 1.0];
        let n = d.get(id).unwrap().world_mesh().face_normal(0);
        assert!((n[2] - 1.0).abs() < 1e-9, "still facing +Z after a mirror");
    }

    #[test]
    fn undo_and_redo_restore_exact_states() {
        let mut d = Document::default();
        let mut j = Journal::default();
        j.record("Add", d.clone());
        d.add("A", tri());
        let after = d.clone();
        assert_eq!(j.undo(&mut d).as_deref(), Some("Add"));
        assert!(d.objects.is_empty());
        assert_eq!(j.redo(&mut d).as_deref(), Some("Add"));
        assert_eq!(d, after);
        j.record("Second", d.clone());
        assert!(j.redo(&mut d).is_none(), "a new edit clears redo");
    }

    #[test]
    fn presets_exist() {
        for p in PRESETS {
            assert!(preset(p).is_some(), "{p}");
        }
        assert!(preset("unobtainium").is_none());
    }
}
