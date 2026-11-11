#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! MantelMesh's files. The native `.mmesh` file is JSON that keeps everything a person edits (the
//! polygon faces, not triangles). GLB, OBJ and STL are exchange formats: they carry the triangulated
//! shape (and, for GLB, the materials) in millimetres, Z up as the scene is.

use mantelmesh_doc::{Document, Object};
use mantelmesh_mesh::{Mesh, V3, cross, normalize, sub};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const FORMAT: &str = "mantelmesh";
pub const VERSION: u32 = 1;
/// Largest file read, so a hostile file can't exhaust memory.
pub const MAX_READ_BYTES: usize = 200 * 1024 * 1024;
/// Geometry limits for files read, so a hostile file can't make loading slow or huge.
pub const MAX_VERTICES: usize = 5_000_000;
pub const MAX_FACES: usize = 5_000_000;
pub const MAX_OBJECTS: usize = 10_000;
pub const MAX_FACE_VERTICES: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IoError(pub String);
impl std::fmt::Display for IoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for IoError {}
fn err<T>(m: impl Into<String>) -> Result<T, IoError> {
    Err(IoError(m.into()))
}

#[derive(Serialize, Deserialize)]
struct Native {
    format: String,
    version: u32,
    document: Document,
}

pub fn save_native(doc: &Document) -> Vec<u8> {
    serde_json::to_vec_pretty(&json!({ "format": FORMAT, "version": VERSION, "document": doc })).unwrap_or_default()
}

/// Reads a `.mmesh` file, checking every face against its vertices.
pub fn load_native(bytes: &[u8]) -> Result<Document, IoError> {
    if bytes.len() > MAX_READ_BYTES {
        return err("the file is too large");
    }
    let n: Native = serde_json::from_slice(bytes).map_err(|e| IoError(format!("not a MantelMesh file: {e}")))?;
    if n.format != FORMAT {
        return err(format!("not a MantelMesh file (format {:?})", n.format));
    }
    if n.version > VERSION {
        return err(format!("made by a newer MantelMesh (file version {})", n.version));
    }
    let (mut verts, mut faces) = (0usize, 0usize);
    if n.document.objects.len() > MAX_OBJECTS {
        return err("the file has too many objects");
    }
    for o in &n.document.objects {
        verts += o.mesh.positions.len();
        faces += o.mesh.faces.len();
        if verts > MAX_VERTICES || faces > MAX_FACES {
            return err("the file has more geometry than MantelMesh opens");
        }
        for f in &o.mesh.faces {
            if f.len() > MAX_FACE_VERTICES {
                return err(format!("{}: a face has more than {MAX_FACE_VERTICES} vertices", o.name));
            }
            o.mesh
                .validate_loop(f)
                .map_err(|e| IoError(format!("{}: {e}", o.name)))?;
        }
    }
    Ok(n.document)
}

/// Flat-shaded triangles of one object, in the scene's frame.
fn flat(o: &Object) -> (Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<u32>) {
    let m = o.world_mesh();
    let (mut pos, mut nor, mut idx) = (Vec::new(), Vec::new(), Vec::new());
    for f in 0..m.faces.len() as u32 {
        let n = m.face_normal(f);
        let l = &m.faces[f as usize];
        for i in 1..l.len() - 1 {
            for v in [l[0], l[i], l[i + 1]] {
                let p = m.positions[v as usize];
                idx.push(pos.len() as u32);
                pos.push([p[0] as f32, p[1] as f32, p[2] as f32]);
                nor.push([n[0] as f32, n[1] as f32, n[2] as f32]);
            }
        }
    }
    (pos, nor, idx)
}

fn pad4(buf: &mut Vec<u8>, byte: u8) {
    while !buf.len().is_multiple_of(4) {
        buf.push(byte);
    }
}

/// A binary glTF 2.0 file of the visible objects: one mesh and one PBR material each.
pub fn export_glb(doc: &Document) -> Vec<u8> {
    let mut bin: Vec<u8> = Vec::new();
    let (mut views, mut accessors, mut meshes, mut nodes, mut materials) = (vec![], vec![], vec![], vec![], vec![]);
    let mut uses_transmission = false;
    for o in doc.objects.iter().filter(|o| o.visible && !o.mesh.faces.is_empty()) {
        let (pos, nor, idx) = flat(o);
        let mut add_view = |bytes: &[u8], target: u32| {
            pad4(&mut bin, 0);
            let offset = bin.len();
            bin.extend_from_slice(bytes);
            views.push(json!({ "buffer": 0, "byteOffset": offset, "byteLength": bytes.len(), "target": target }));
            views.len() - 1
        };
        let f32s = |v: &[[f32; 3]]| {
            v.iter()
                .flat_map(|p| p.iter().flat_map(|x| x.to_le_bytes()))
                .collect::<Vec<u8>>()
        };
        let (lo, hi) = pos.iter().fold(([f32::MAX; 3], [f32::MIN; 3]), |(lo, hi), p| {
            (
                [lo[0].min(p[0]), lo[1].min(p[1]), lo[2].min(p[2])],
                [hi[0].max(p[0]), hi[1].max(p[1]), hi[2].max(p[2])],
            )
        });
        let vp = add_view(&f32s(&pos), 34962);
        let vn = add_view(&f32s(&nor), 34962);
        let vi = add_view(&idx.iter().flat_map(|i| i.to_le_bytes()).collect::<Vec<u8>>(), 34963);
        accessors.push(json!({ "bufferView": vp, "componentType": 5126, "count": pos.len(), "type": "VEC3", "min": lo, "max": hi }));
        accessors.push(json!({ "bufferView": vn, "componentType": 5126, "count": nor.len(), "type": "VEC3" }));
        accessors.push(json!({ "bufferView": vi, "componentType": 5125, "count": idx.len(), "type": "SCALAR" }));
        let a = accessors.len();
        let mat = &o.material;
        let mut material = json!({
            "name": mat.name,
            "pbrMetallicRoughness": { "baseColorFactor": mat.base_color, "metallicFactor": mat.metallic, "roughnessFactor": mat.roughness },
            "doubleSided": false,
        });
        if mat.base_color[3] < 1.0 {
            material["alphaMode"] = json!("BLEND");
        }
        if mat.transmission > 0.0 {
            uses_transmission = true;
            material["extensions"] =
                json!({ "KHR_materials_transmission": { "transmissionFactor": mat.transmission } });
        }
        materials.push(material);
        meshes.push(json!({ "name": o.name, "primitives": [{ "attributes": { "POSITION": a - 3, "NORMAL": a - 2 }, "indices": a - 1, "material": materials.len() - 1 }] }));
        nodes.push(json!({ "name": o.name, "mesh": meshes.len() - 1 }));
    }
    pad4(&mut bin, 0);
    // glTF is Y up; the scene is Z up. A root node turns it, so viewers stand it the right way.
    let children: Vec<usize> = (0..nodes.len()).collect();
    nodes.push(json!({ "name": "MantelMesh (Z up)", "rotation": [-std::f64::consts::FRAC_1_SQRT_2, 0.0, 0.0, std::f64::consts::FRAC_1_SQRT_2], "scale": [0.001, 0.001, 0.001], "children": children }));
    let root = nodes.len() - 1;
    let mut gltf = json!({
        "asset": { "version": "2.0", "generator": "MantelMesh" },
        "scene": 0,
        "scenes": [{ "nodes": [root] }],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{ "byteLength": bin.len() }],
    });
    if uses_transmission {
        gltf["extensionsUsed"] = json!(["KHR_materials_transmission"]);
    }
    let mut text = serde_json::to_vec(&gltf).unwrap_or_default();
    pad4(&mut text, b' ');
    let total = 12 + 8 + text.len() + 8 + bin.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(text.len() as u32).to_le_bytes());
    out.extend_from_slice(b"JSON");
    out.extend_from_slice(&text);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(b"BIN\0");
    out.extend_from_slice(&bin);
    out
}

/// A binary STL of every visible object together, in millimetres.
pub fn export_stl(doc: &Document) -> Vec<u8> {
    let tris: Vec<(V3, [V3; 3])> = doc
        .objects
        .iter()
        .filter(|o| o.visible)
        .flat_map(|o| {
            let m = o.world_mesh();
            m.triangles()
                .into_iter()
                .map(|t| {
                    let p = t.map(|v| m.positions[v as usize]);
                    (normalize(cross(sub(p[1], p[0]), sub(p[2], p[0]))), p)
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let mut out = vec![0u8; 80];
    out[..21].copy_from_slice(b"MantelMesh binary STL");
    out.extend_from_slice(&(tris.len() as u32).to_le_bytes());
    for (n, p) in tris {
        for v in std::iter::once(n).chain(p) {
            for x in v {
                out.extend_from_slice(&(x as f32).to_le_bytes());
            }
        }
        out.extend_from_slice(&[0, 0]);
    }
    out
}

/// A Wavefront OBJ of the visible objects, one `o` group each, keeping polygon faces.
pub fn export_obj(doc: &Document) -> String {
    let mut s = String::from("# MantelMesh\n");
    let mut base = 1u32;
    for o in doc.objects.iter().filter(|o| o.visible) {
        let m = o.world_mesh();
        s.push_str(&format!("o {}\n", o.name.replace(['\n', '\r'], " ")));
        for p in &m.positions {
            s.push_str(&format!("v {} {} {}\n", p[0], p[1], p[2]));
        }
        for f in &m.faces {
            let l: Vec<String> = f.iter().map(|v| (v + base).to_string()).collect();
            s.push_str(&format!("f {}\n", l.join(" ")));
        }
        base += m.positions.len() as u32;
    }
    s
}

/// Reads the polygon objects of an OBJ file (positions and faces; normals and UVs are ignored).
pub fn import_obj(text: &str) -> Result<Vec<(String, Mesh)>, IoError> {
    if text.len() > MAX_READ_BYTES {
        return err("the file is too large");
    }
    let mut all: Vec<V3> = Vec::new();
    let mut out: Vec<(String, Vec<Vec<u32>>)> = vec![("Imported".into(), vec![])];
    for (n, line) in text.lines().enumerate() {
        let mut it = line.split_whitespace();
        match it.next() {
            Some("v") => {
                let c: Vec<f64> = it
                    .take(3)
                    .map(|x| x.parse::<f64>())
                    .collect::<Result<_, _>>()
                    .map_err(|_| IoError(format!("line {}: bad vertex", n + 1)))?;
                if c.len() != 3 || c.iter().any(|x| !x.is_finite()) {
                    return err(format!("line {}: bad vertex", n + 1));
                }
                all.push([c[0], c[1], c[2]]);
            }
            Some("o") | Some("g") => {
                let name = it.collect::<Vec<_>>().join(" ");
                if out.last().is_some_and(|(_, f)| f.is_empty()) {
                    out.pop();
                }
                out.push((if name.is_empty() { "Imported".into() } else { name }, vec![]));
            }
            Some("f") => {
                let mut face = Vec::new();
                for t in it {
                    let i: i64 = t
                        .split('/')
                        .next()
                        .unwrap_or("")
                        .parse()
                        .map_err(|_| IoError(format!("line {}: bad face", n + 1)))?;
                    let v = if i < 0 { all.len() as i64 + i } else { i - 1 };
                    if v < 0 || v as usize >= all.len() {
                        return err(format!("line {}: face refers to a missing vertex", n + 1));
                    }
                    face.push(v as u32);
                }
                if let Some(last) = out.last_mut() {
                    last.1.push(face);
                }
                if out.len() > MAX_OBJECTS + 1 {
                    return err("the file has too many objects");
                }
            }
            _ => {}
        }
    }
    let groups: Vec<_> = out.into_iter().filter(|(_, f)| !f.is_empty()).collect();
    if groups.len() > MAX_OBJECTS {
        return err("the file has too many objects");
    }
    if all.len() > MAX_VERTICES || groups.iter().map(|(_, f)| f.len()).sum::<usize>() > MAX_FACES {
        return err("the file has more geometry than MantelMesh opens");
    }
    let mut meshes = Vec::new();
    for (name, faces) in groups {
        // Only the vertices this group uses, renumbered.
        let mut local: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
        let mut m = Mesh::new();
        for f in faces {
            if f.len() > MAX_FACE_VERTICES {
                return err(format!("{name}: a face has more than {MAX_FACE_VERTICES} vertices"));
            }
            let lp: Vec<u32> = f
                .iter()
                .map(|&v| *local.entry(v).or_insert_with(|| m.add_vertex(all[v as usize])))
                .collect();
            m.add_face(&lp).map_err(|e| IoError(format!("{name}: {e}")))?;
        }
        meshes.push((name, m));
    }
    if meshes.is_empty() {
        return err("the file has no faces");
    }
    Ok(meshes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mantelmesh_doc::preset;

    fn scene() -> Document {
        let mut d = Document::default();
        let cube = Mesh {
            positions: (0..8)
                .map(|i| {
                    [
                        (i & 1) as f64 * 10.0,
                        ((i >> 1) & 1) as f64 * 10.0,
                        ((i >> 2) & 1) as f64 * 10.0,
                    ]
                })
                .collect(),
            faces: vec![
                vec![0, 2, 3, 1],
                vec![4, 5, 7, 6],
                vec![0, 1, 5, 4],
                vec![1, 3, 7, 5],
                vec![3, 2, 6, 7],
                vec![2, 0, 4, 6],
            ],
        };
        let id = d.add("Block", cube);
        d.get_mut(id).unwrap().material = preset("acrylic").unwrap();
        d
    }

    #[test]
    fn native_round_trips_and_refuses_bad_files() {
        // Every coordinate comes back bit for bit, not just close.
        let mut odd = Document::default();
        odd.add(
            "Odd",
            Mesh {
                positions: vec![
                    [1.9134171618254496, 0.1 + 0.2, 1e-300],
                    [std::f64::consts::PI, -0.0, 7.0],
                    [1.0, 2.0, 3.0],
                ],
                faces: vec![vec![0, 1, 2]],
            },
        );
        assert_eq!(load_native(&save_native(&odd)).unwrap(), odd);
        let d = scene();
        assert!(d.objects[0].mesh.check().is_closed_solid());
        let bytes = save_native(&d);
        assert_eq!(load_native(&bytes).unwrap(), d);
        assert!(load_native(b"{}").is_err());
        let bad = String::from_utf8(bytes)
            .unwrap()
            .replacen("\"faces\": [", "\"faces\": [[0, 1, 99],", 1);
        assert!(load_native(bad.as_bytes()).unwrap_err().0.contains("does not exist"));
        let newer = String::from_utf8(save_native(&d))
            .unwrap()
            .replacen("\"version\": 1", "\"version\": 9", 1);
        assert!(load_native(newer.as_bytes()).unwrap_err().0.contains("newer"));
    }

    #[test]
    fn glb_has_valid_chunks_and_materials() {
        let glb = export_glb(&scene());
        assert_eq!(&glb[0..4], b"glTF");
        let total = u32::from_le_bytes(glb[8..12].try_into().unwrap()) as usize;
        assert_eq!(total, glb.len());
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        assert_eq!(json_len % 4, 0);
        assert_eq!(&glb[16..20], b"JSON");
        let gltf: serde_json::Value = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        let bin_len = u32::from_le_bytes(glb[20 + json_len..24 + json_len].try_into().unwrap()) as usize;
        assert_eq!(&glb[24 + json_len..28 + json_len], b"BIN\0");
        assert_eq!(gltf["buffers"][0]["byteLength"], bin_len);
        assert_eq!(gltf["accessors"][2]["count"], 36, "12 triangles");
        assert_eq!(
            gltf["materials"][0]["extensions"]["KHR_materials_transmission"]["transmissionFactor"],
            1.0
        );
        assert_eq!(gltf["accessors"][0]["max"][2], 10.0);
    }

    #[test]
    fn stl_and_obj_carry_the_shape() {
        let d = scene();
        let stl = export_stl(&d);
        assert_eq!(u32::from_le_bytes(stl[80..84].try_into().unwrap()), 12);
        assert_eq!(stl.len(), 84 + 12 * 50);
        let obj = export_obj(&d);
        let back = import_obj(&obj).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].0, "Block");
        assert!(back[0].1.check().is_closed_solid());
        assert!((back[0].1.volume() - 1000.0).abs() < 1e-9);
        assert!(import_obj("v 0 0 0\nf 1 2 3\n").is_err());
        assert!(import_obj("# nothing\n").is_err());
        // Many groups sharing one big vertex list stay linear: each keeps only its own vertices.
        let mut big = String::new();
        for i in 0..3000 {
            big.push_str(&format!("v {i} 0 0\nv {i} 1 0\nv {i} 0 1\n"));
        }
        for g in 0..1000 {
            big.push_str(&format!("o g{g}\nf {} {} {}\n", g * 3 + 1, g * 3 + 2, g * 3 + 3));
        }
        let groups = import_obj(&big).unwrap();
        assert_eq!(groups.len(), 1000);
        assert!(groups.iter().all(|(_, m)| m.positions.len() == 3));
    }
}
