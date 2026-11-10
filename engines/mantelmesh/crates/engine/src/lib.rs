#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! The MantelMesh session: a document, its undo journal, and the registry of commands that change
//! it. Everything a person or an agent can do is a command here, described by its inputs, so the
//! interface, the CLI batch runner, a control channel and an MCP server all use the same ones.

use base64::Engine as _;
use mantelmesh_doc::{Document, Journal, PRESETS, preset};
use mantelmesh_ops as ops;
use serde_json::{Value, json};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandError(pub String);
impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for CommandError {}
type Result<T> = std::result::Result<T, CommandError>;
fn fail<T>(m: impl Into<String>) -> Result<T> {
    Err(CommandError(m.into()))
}
impl From<ops::OpError> for CommandError {
    fn from(e: ops::OpError) -> Self {
        Self(e.0)
    }
}
impl From<mantelmesh_io::IoError> for CommandError {
    fn from(e: mantelmesh_io::IoError) -> Self {
        Self(e.0)
    }
}

/// One input of a command.
pub struct Input {
    pub name: &'static str,
    pub kind: &'static str,
    pub required: bool,
    pub description: &'static str,
}
const fn input(name: &'static str, kind: &'static str, required: bool, description: &'static str) -> Input {
    Input {
        name,
        kind,
        required,
        description,
    }
}

/// A command: what it does, what it takes, whether it edits the document.
pub struct Command {
    pub name: &'static str,
    pub description: &'static str,
    pub inputs: &'static [Input],
    pub edits: bool,
}

pub const COMMANDS: &[Command] = &[
    Command {
        name: "object.add",
        description: "Add a primitive object: box, plane, cylinder or sphere, sized in millimetres.",
        edits: true,
        inputs: &[
            input(
                "shape",
                "\"box\" | \"plane\" | \"cylinder\" | \"sphere\"",
                true,
                "What to add",
            ),
            input("name", "string", false, "Its name (made unique)"),
            input(
                "size",
                "[x, y, z] mm",
                false,
                "Box size or plane width and depth (default 20 mm)",
            ),
            input("radius", "mm", false, "Cylinder or sphere radius (default 10)"),
            input("height", "mm", false, "Cylinder height (default 20)"),
            input("segments", "integer", false, "Sides or segments around (default 32)"),
            input("rings", "integer", false, "Sphere rings (default 16)"),
            input("at", "[x, y, z] mm", false, "Where to place it"),
        ],
    },
    Command {
        name: "object.delete",
        description: "Delete an object.",
        edits: true,
        inputs: &[input("object", "id", true, "The object")],
    },
    Command {
        name: "object.rename",
        description: "Rename an object.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("name", "string", true, "New name"),
        ],
    },
    Command {
        name: "object.transform",
        description: "Set an object's placement: translation (mm), rotation (degrees about X, Y, Z) and scale.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("translation", "[x, y, z] mm", false, "Position"),
            input("rotation", "[x, y, z] degrees", false, "Rotation"),
            input("scale", "[x, y, z]", false, "Scale factors"),
        ],
    },
    Command {
        name: "object.material",
        description: "Give an object a material: a preset by name, or base colour, metallic, roughness and transmission.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input(
                "preset",
                "string",
                false,
                "clay, satin-nickel, brass, gold, walnut, acrylic, marble, black-anodised",
            ),
            input("base_color", "[r, g, b, a] 0–1", false, "Linear colour"),
            input("metallic", "0–1", false, "Metalness"),
            input("roughness", "0–1", false, "Roughness"),
            input("transmission", "0–1", false, "Transmission (clear materials)"),
        ],
    },
    Command {
        name: "mesh.extrude",
        description: "Extrude a region of faces along its normal; negative distance pushes in.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("faces", "[face]", true, "The region"),
            input("distance", "mm", true, "How far"),
        ],
    },
    Command {
        name: "mesh.inset",
        description: "Inset each face: a smaller copy towards its centre framed by quads.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("faces", "[face]", true, "The faces"),
            input("amount", "0–1", true, "Fraction towards the centre"),
        ],
    },
    Command {
        name: "mesh.move",
        description: "Move faces or vertices of an object's mesh by an offset.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("faces", "[face]", false, "Faces to move"),
            input("vertices", "[vertex]", false, "Vertices to move"),
            input("offset", "[x, y, z] mm", true, "The offset"),
        ],
    },
    Command {
        name: "mesh.scale",
        description: "Scale faces or vertices about their centre.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("faces", "[face]", false, "Faces"),
            input("vertices", "[vertex]", false, "Vertices"),
            input("factor", "[x, y, z]", true, "Factors"),
        ],
    },
    Command {
        name: "mesh.rotate",
        description: "Rotate faces or vertices about an axis through their centre.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("faces", "[face]", false, "Faces"),
            input("vertices", "[vertex]", false, "Vertices"),
            input("axis", "[x, y, z]", true, "Axis"),
            input("degrees", "number", true, "Angle"),
        ],
    },
    Command {
        name: "mesh.flip",
        description: "Reverse the selected faces' winding.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("faces", "[face]", true, "Faces"),
        ],
    },
    Command {
        name: "mesh.delete",
        description: "Delete faces, and vertices left unused.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("faces", "[face]", true, "Faces"),
        ],
    },
    Command {
        name: "mesh.merge",
        description: "Merge vertices closer than a distance.",
        edits: true,
        inputs: &[
            input("object", "id", true, "The object"),
            input("distance", "mm", true, "Merge distance"),
        ],
    },
    Command {
        name: "mesh.check",
        description: "Report an object's topology: non-manifold, open and flipped edges, degenerate faces.",
        edits: false,
        inputs: &[input("object", "id", true, "The object")],
    },
    Command {
        name: "document.inspect",
        description: "Describe the scene: objects, their bounds, faces, materials and topology health.",
        edits: false,
        inputs: &[],
    },
    Command {
        name: "document.save",
        description: "The native .mmesh file, as base64.",
        edits: false,
        inputs: &[],
    },
    Command {
        name: "document.open",
        description: "Replace the scene with a .mmesh file given as base64.",
        edits: true,
        inputs: &[input("dataBase64", "base64", true, "The file")],
    },
    Command {
        name: "document.import",
        description: "Add the objects of an OBJ file given as base64.",
        edits: true,
        inputs: &[input("dataBase64", "base64", true, "The OBJ file")],
    },
    Command {
        name: "document.export",
        description: "Export the visible objects as GLB, OBJ or STL, as base64.",
        edits: false,
        inputs: &[input("format", "\"glb\" | \"obj\" | \"stl\"", true, "Format")],
    },
    Command {
        name: "edit.undo",
        description: "Undo the last edit.",
        edits: false,
        inputs: &[],
    },
    Command {
        name: "edit.redo",
        description: "Redo the last undone edit.",
        edits: false,
        inputs: &[],
    },
    Command {
        name: "engine.commands",
        description: "List every command and its inputs.",
        edits: false,
        inputs: &[],
    },
];

#[derive(Default)]
pub struct Session {
    pub doc: Document,
    pub journal: Journal,
}

fn num(p: &Value, k: &str) -> Result<Option<f64>> {
    match p.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite())
            .map(Some)
            .ok_or_else(|| CommandError(format!("{k} must be a number"))),
    }
}
fn need_num(p: &Value, k: &str) -> Result<f64> {
    num(p, k)?.ok_or_else(|| CommandError(format!("{k} is required")))
}
fn v3(p: &Value, k: &str) -> Result<Option<[f64; 3]>> {
    match p.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(a)) if a.len() == 3 => {
            let mut out = [0.0; 3];
            for (i, x) in a.iter().enumerate() {
                out[i] = x
                    .as_f64()
                    .filter(|x| x.is_finite())
                    .ok_or_else(|| CommandError(format!("{k} must be three numbers")))?;
            }
            Ok(Some(out))
        }
        _ => fail(format!("{k} must be three numbers")),
    }
}
fn ids(p: &Value, k: &str) -> Result<Option<Vec<u32>>> {
    match p.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(a)) => a
            .iter()
            .map(|x| {
                x.as_u64()
                    .and_then(|x| u32::try_from(x).ok())
                    .ok_or_else(|| CommandError(format!("{k} must be a list of indices")))
            })
            .collect::<Result<Vec<_>>>()
            .map(Some),
        _ => fail(format!("{k} must be a list of indices")),
    }
}
fn text<'a>(p: &'a Value, k: &str) -> Option<&'a str> {
    p.get(k).and_then(Value::as_str)
}
fn b64(p: &Value) -> Result<Vec<u8>> {
    let s = text(p, "dataBase64").ok_or_else(|| CommandError("dataBase64 is required".into()))?;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|_| CommandError("dataBase64 is not base64".into()))
}
fn encode(bytes: &[u8]) -> Value {
    json!({ "bytes": bytes.len(), "dataBase64": base64::engine::general_purpose::STANDARD.encode(bytes) })
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    fn object_id(&self, p: &Value) -> Result<u32> {
        let id = p
            .get("object")
            .and_then(Value::as_u64)
            .and_then(|x| u32::try_from(x).ok())
            .ok_or_else(|| CommandError("object is required".into()))?;
        if self.doc.get(id).is_none() {
            return fail(format!("object {id} does not exist"));
        }
        Ok(id)
    }

    fn pick(&self, p: &Value) -> Result<ops::Pick> {
        Ok(match (ids(p, "faces")?, ids(p, "vertices")?) {
            (Some(f), None) => ops::Pick::Faces(f),
            (None, Some(v)) => ops::Pick::Vertices(v),
            (None, None) => ops::Pick::All,
            (Some(_), Some(_)) => return fail("give faces or vertices, not both"),
        })
    }

    /// Runs a command. Edits are journalled, so `edit.undo` reverses each one.
    pub fn execute(&mut self, name: &str, params: &Value) -> Result<Value> {
        let Some(command) = COMMANDS.iter().find(|c| c.name == name) else {
            return fail(format!("unknown command {name}; run engine.commands for the list"));
        };
        let params = if params.is_null() { &json!({}) } else { params };
        if !params.is_object() {
            return fail("params must be an object");
        }
        if command.edits {
            let before = self.doc.clone();
            let result = self.run(name, params);
            match &result {
                Ok(_) if before != self.doc => self.journal.record(name, before),
                Ok(_) => {}
                Err(_) => self.doc = before,
            }
            result
        } else {
            self.run(name, params)
        }
    }

    fn mesh_edit(
        &mut self,
        p: &Value,
        f: impl FnOnce(&mantelmesh_mesh::Mesh, &Self) -> Result<(mantelmesh_mesh::Mesh, Value)>,
    ) -> Result<Value> {
        let id = self.object_id(p)?;
        let mesh = self.doc.get(id).map(|o| o.mesh.clone()).unwrap_or_default();
        let (new, out) = f(&mesh, self)?;
        let report = new.check();
        if let Some(o) = self.doc.get_mut(id) {
            o.mesh = new;
        }
        Ok(json!({ "object": id, "result": out, "check": report }))
    }

    fn run(&mut self, name: &str, p: &Value) -> Result<Value> {
        match name {
            "object.add" => {
                let shape = text(p, "shape").unwrap_or("box");
                let segs = |k: &str, d: u32| -> Result<u32> { Ok(num(p, k)?.map(|x| x as u32).unwrap_or(d)) };
                let mesh = match shape {
                    "box" => {
                        let s = v3(p, "size")?.unwrap_or([20.0; 3]);
                        ops::cuboid(s[0], s[1], s[2])?
                    }
                    "plane" => {
                        let s = v3(p, "size")?.unwrap_or([20.0, 20.0, 0.0]);
                        ops::plane(s[0], s[1], segs("segments", 1)?, segs("rings", 1)?)?
                    }
                    "cylinder" => ops::cylinder(num(p, "radius")?.unwrap_or(10.0), num(p, "height")?.unwrap_or(20.0), segs("segments", 32)?)?,
                    "sphere" => ops::uv_sphere(num(p, "radius")?.unwrap_or(10.0), segs("segments", 32)?, segs("rings", 16)?)?,
                    other => return fail(format!("unknown shape {other}")),
                };
                let label = text(p, "name").unwrap_or(match shape {
                    "box" => "Box",
                    "plane" => "Plane",
                    "cylinder" => "Cylinder",
                    _ => "Sphere",
                });
                let id = self.doc.add(label, mesh);
                if let (Some(at), Some(o)) = (v3(p, "at")?, self.doc.get_mut(id)) {
                    o.transform.translation = at;
                }
                let o = self.doc.get(id);
                Ok(json!({ "object": id, "name": o.map(|o| o.name.clone()), "faces": o.map(|o| o.mesh.faces.len()) }))
            }
            "object.delete" => {
                let id = self.object_id(p)?;
                self.doc.remove(id);
                Ok(json!({ "deleted": id }))
            }
            "object.rename" => {
                let id = self.object_id(p)?;
                let n = text(p, "name").map(str::trim).filter(|n| !n.is_empty() && n.len() <= 120).ok_or_else(|| CommandError("name must be 1–120 characters".into()))?;
                if let Some(o) = self.doc.get_mut(id) {
                    o.name = n.to_string();
                }
                Ok(json!({ "object": id, "name": n }))
            }
            "object.transform" => {
                let id = self.object_id(p)?;
                let (t, r, s) = (v3(p, "translation")?, v3(p, "rotation")?, v3(p, "scale")?);
                if s.is_some_and(|s| s.contains(&0.0)) {
                    return fail("scale factors can't be zero");
                }
                let o = self.doc.get_mut(id).ok_or_else(|| CommandError("gone".into()))?;
                if let Some(t) = t {
                    o.transform.translation = t;
                }
                if let Some(r) = r {
                    o.transform.rotation_deg = r;
                }
                if let Some(s) = s {
                    o.transform.scale = s;
                }
                Ok(json!({ "object": id, "transform": o.transform }))
            }
            "object.material" => {
                let id = self.object_id(p)?;
                let mut m = match text(p, "preset") {
                    Some(name) => preset(name).ok_or_else(|| CommandError(format!("unknown preset {name}; one of {}", PRESETS.join(", "))))?,
                    None => self.doc.get(id).map(|o| o.material.clone()).unwrap_or_default(),
                };
                if let Some(Value::Array(c)) = p.get("base_color") {
                    if c.len() != 4 {
                        return fail("base_color must be four numbers");
                    }
                    for (i, x) in c.iter().enumerate() {
                        m.base_color[i] = x.as_f64().filter(|x| (0.0..=1.0).contains(x)).ok_or_else(|| CommandError("base_color values are 0–1".into()))?;
                    }
                }
                for (k, slot) in [("metallic", &mut m.metallic), ("roughness", &mut m.roughness), ("transmission", &mut m.transmission)] {
                    if let Some(x) = num(p, k)? {
                        if !(0.0..=1.0).contains(&x) {
                            return fail(format!("{k} is 0–1"));
                        }
                        *slot = x;
                    }
                }
                if let Some(o) = self.doc.get_mut(id) {
                    o.material = m.clone();
                }
                Ok(json!({ "object": id, "material": m }))
            }
            "mesh.extrude" => self.mesh_edit(p, |m, _| {
                let (out, made) = ops::extrude(m, &ids(p, "faces")?.unwrap_or_default(), need_num(p, "distance")?)?;
                Ok((out, json!(made)))
            }),
            "mesh.inset" => self.mesh_edit(p, |m, _| {
                let (out, made) = ops::inset(m, &ids(p, "faces")?.unwrap_or_default(), need_num(p, "amount")?)?;
                Ok((out, json!(made)))
            }),
            "mesh.move" => self.mesh_edit(p, |m, s| {
                let off = v3(p, "offset")?.ok_or_else(|| CommandError("offset is required".into()))?;
                Ok((ops::translate(m, &s.pick(p)?, off)?, json!({})))
            }),
            "mesh.scale" => self.mesh_edit(p, |m, s| {
                let f = v3(p, "factor")?.ok_or_else(|| CommandError("factor is required".into()))?;
                let pick = s.pick(p)?;
                let c = center(m, &pick);
                Ok((ops::scale_about(m, &pick, c, f)?, json!({})))
            }),
            "mesh.rotate" => self.mesh_edit(p, |m, s| {
                let axis = v3(p, "axis")?.ok_or_else(|| CommandError("axis is required".into()))?;
                let pick = s.pick(p)?;
                let c = center(m, &pick);
                Ok((ops::rotate(m, &pick, c, axis, need_num(p, "degrees")?)?, json!({})))
            }),
            "mesh.flip" => self.mesh_edit(p, |m, _| Ok((ops::flip(m, &ids(p, "faces")?.unwrap_or_default())?, json!({})))),
            "mesh.delete" => self.mesh_edit(p, |m, _| Ok((ops::delete_faces(m, &ids(p, "faces")?.unwrap_or_default())?, json!({})))),
            "mesh.merge" => self.mesh_edit(p, |m, _| {
                let (out, n) = ops::merge_by_distance(m, need_num(p, "distance")?)?;
                Ok((out, json!({ "merged": n })))
            }),
            "mesh.check" => {
                let id = self.object_id(p)?;
                Ok(json!(self.doc.get(id).map(|o| o.mesh.check())))
            }
            "document.inspect" => Ok(json!({
                "objects": self.doc.objects.iter().map(|o| {
                    let w = o.world_mesh();
                    json!({
                        "id": o.id, "name": o.name, "visible": o.visible,
                        "vertices": o.mesh.positions.len(), "faces": o.mesh.faces.len(),
                        "bounds": w.bounds(), "volume_mm3": w.volume(),
                        "material": o.material.name, "closed": o.mesh.check().is_closed_solid(),
                    })
                }).collect::<Vec<_>>(),
                "bounds": self.doc.bounds(),
                "history": self.journal.labels(),
            })),
            "document.save" => Ok(encode(&mantelmesh_io::save_native(&self.doc))),
            "document.open" => {
                self.doc = mantelmesh_io::load_native(&b64(p)?)?;
                Ok(json!({ "objects": self.doc.objects.len() }))
            }
            "document.import" => {
                let bytes = b64(p)?;
                let text = String::from_utf8(bytes).map_err(|_| CommandError("the OBJ file is not text".into()))?;
                let added: Vec<u32> = mantelmesh_io::import_obj(&text)?.into_iter().map(|(n, m)| self.doc.add(&n, m)).collect();
                Ok(json!({ "objects": added }))
            }
            "document.export" => match text(p, "format") {
                Some("glb") => Ok(encode(&mantelmesh_io::export_glb(&self.doc))),
                Some("obj") => Ok(encode(mantelmesh_io::export_obj(&self.doc).as_bytes())),
                Some("stl") => Ok(encode(&mantelmesh_io::export_stl(&self.doc))),
                _ => fail("format must be glb, obj or stl"),
            },
            "edit.undo" => Ok(json!({ "undid": self.journal.undo(&mut self.doc) })),
            "edit.redo" => Ok(json!({ "redid": self.journal.redo(&mut self.doc) })),
            "engine.commands" => Ok(json!(COMMANDS.iter().map(|c| json!({
                "name": c.name, "description": c.description, "edits": c.edits,
                "inputs": c.inputs.iter().map(|i| json!({ "name": i.name, "type": i.kind, "required": i.required, "description": i.description })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>())),
            other => fail(format!("{other} is listed but not implemented")),
        }
    }
}

fn center(m: &mantelmesh_mesh::Mesh, pick: &ops::Pick) -> [f64; 3] {
    let verts: Vec<u32> = match pick {
        ops::Pick::All => (0..m.positions.len() as u32).collect(),
        ops::Pick::Faces(f) => f
            .iter()
            .filter(|&&f| (f as usize) < m.faces.len())
            .flat_map(|&f| m.faces[f as usize].clone())
            .collect(),
        ops::Pick::Vertices(v) => v
            .iter()
            .copied()
            .filter(|&v| (v as usize) < m.positions.len())
            .collect(),
    };
    if verts.is_empty() {
        return [0.0; 3];
    }
    let s = verts
        .iter()
        .fold([0.0; 3], |a, &v| mantelmesh_mesh::add(a, m.positions[v as usize]));
    mantelmesh_mesh::scale(s, 1.0 / verts.len() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listed_command_is_implemented() {
        let mut s = Session::new();
        for c in COMMANDS {
            let r = s.execute(c.name, &json!({}));
            if let Err(e) = r {
                assert!(!e.0.contains("not implemented"), "{}", c.name);
            }
        }
    }

    #[test]
    fn a_concept_blocks_out_and_exports() {
        let mut s = Session::new();
        let base = s
            .execute(
                "object.add",
                &json!({ "shape": "box", "name": "Base", "size": [200, 80, 20] }),
            )
            .unwrap()["object"]
            .as_u64()
            .unwrap();
        s.execute("object.material", &json!({ "object": base, "preset": "walnut" }))
            .unwrap();
        let tower = s
            .execute(
                "object.add",
                &json!({ "shape": "box", "name": "Tower", "size": [12, 12, 180], "at": [0, 0, 100] }),
            )
            .unwrap()["object"]
            .as_u64()
            .unwrap();
        let r = s
            .execute(
                "mesh.extrude",
                &json!({ "object": tower, "faces": [1], "distance": 16 }),
            )
            .unwrap();
        assert_eq!(r["check"]["non_manifold_edges"].as_array().map(Vec::len), Some(0));
        s.execute(
            "mesh.scale",
            &json!({ "object": tower, "faces": [1], "factor": [0.5, 0.5, 1] }),
        )
        .unwrap();
        let info = s.execute("document.inspect", &json!({})).unwrap();
        assert_eq!(info["objects"].as_array().map(Vec::len), Some(2));
        assert_eq!(info["objects"][1]["closed"], true);
        let top = info["bounds"][1][2].as_f64().unwrap();
        assert!((top - (100.0 + 90.0 + 16.0)).abs() < 1e-9, "{top}");
        let glb = s.execute("document.export", &json!({ "format": "glb" })).unwrap();
        assert!(glb["bytes"].as_u64().unwrap() > 1000);
        let saved = s.execute("document.save", &json!({})).unwrap();
        let mut again = Session::new();
        again
            .execute("document.open", &json!({ "dataBase64": saved["dataBase64"] }))
            .unwrap();
        assert_eq!(again.doc, s.doc);
    }

    #[test]
    fn edits_undo_and_failed_edits_change_nothing() {
        let mut s = Session::new();
        let id = s.execute("object.add", &json!({ "shape": "box" })).unwrap()["object"]
            .as_u64()
            .unwrap();
        let before = s.doc.clone();
        assert!(
            s.execute("mesh.extrude", &json!({ "object": id, "faces": [99], "distance": 1 }))
                .is_err()
        );
        assert_eq!(s.doc, before, "a failed edit leaves the document as it was");
        s.execute("mesh.extrude", &json!({ "object": id, "faces": [1], "distance": 5 }))
            .unwrap();
        assert_ne!(s.doc, before);
        assert_eq!(s.execute("edit.undo", &json!({})).unwrap()["undid"], "mesh.extrude");
        assert_eq!(s.doc, before);
        s.execute("edit.redo", &json!({})).unwrap();
        assert_eq!(s.doc.objects[0].mesh.faces.len(), 10);
    }

    #[test]
    fn inputs_are_checked() {
        let mut s = Session::new();
        assert!(s.execute("nope", &json!({})).is_err());
        assert!(s.execute("object.add", &json!({ "shape": "torus" })).is_err());
        assert!(
            s.execute("object.add", &json!({ "shape": "box", "size": [1, 2] }))
                .is_err()
        );
        let id = s.execute("object.add", &json!({ "shape": "box" })).unwrap()["object"]
            .as_u64()
            .unwrap();
        assert!(
            s.execute("object.material", &json!({ "object": id, "metallic": 2 }))
                .is_err()
        );
        assert!(
            s.execute("object.transform", &json!({ "object": id, "scale": [0, 1, 1] }))
                .is_err()
        );
        assert!(
            s.execute("object.rename", &json!({ "object": 999, "name": "x" }))
                .is_err()
        );
        assert!(s.execute("document.open", &json!({ "dataBase64": "!!" })).is_err());
    }
}
