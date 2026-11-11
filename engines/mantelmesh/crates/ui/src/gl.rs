//! The viewport's GL drawing (WebGL2 / GLSL ES 3.00): shaded faces in their material colours,
//! the selection tinted, edges as lines and a ground grid. glow's calls are `unsafe` because they
//! talk to the GPU driver directly; each block below only passes buffers this module built and
//! sized itself, and deletes what it creates.
#![allow(unsafe_code)]

use crate::camera::M4;
use egui_glow::glow::{self, HasContext};
use mantelmesh_doc::Document;
use std::collections::BTreeSet;

const VERT: &str = r#"#version 300 es
precision highp float;
uniform mat4 u_mvp;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_color;
out vec3 v_normal;
out vec4 v_color;
void main() {
    v_normal = a_normal;
    v_color = a_color;
    gl_Position = u_mvp * vec4(a_pos, 1.0);
}"#;

const FRAG: &str = r#"#version 300 es
precision highp float;
uniform float u_lit;
in vec3 v_normal;
in vec4 v_color;
out vec4 out_color;
void main() {
    vec3 n = normalize(v_normal);
    float key = max(dot(n, normalize(vec3(-0.4, -0.7, 0.9))), 0.0);
    float fill = max(dot(n, normalize(vec3(0.8, 0.3, 0.4))), 0.0);
    float light = mix(1.0, 0.25 + 0.6 * key + 0.25 * fill, u_lit);
    out_color = vec4(v_color.rgb * light, v_color.a);
}"#;

/// What the viewport draws, built on the CPU from the document.
#[derive(Default)]
pub struct Geometry {
    /// Interleaved position (3), normal (3), colour (4) per vertex.
    pub faces: Vec<f32>,
    pub lines: Vec<f32>,
}

const SELECTED: [f32; 4] = [0.39, 0.4, 0.95, 1.0];
const EDGE: [f32; 4] = [0.1, 0.1, 0.12, 0.55];
const GRID: [f32; 4] = [0.5, 0.5, 0.5, 0.25];

fn push(v: &mut Vec<f32>, p: [f64; 3], n: [f64; 3], c: [f32; 4]) {
    v.extend_from_slice(&[
        p[0] as f32,
        p[1] as f32,
        p[2] as f32,
        n[0] as f32,
        n[1] as f32,
        n[2] as f32,
    ]);
    v.extend_from_slice(&c);
}

/// Builds the face and line buffers. `selection` is (object, faces).
pub fn geometry(doc: &Document, selection: Option<(u32, &BTreeSet<u32>)>, grid: f64) -> Geometry {
    let mut g = Geometry::default();
    for o in doc.objects.iter().filter(|o| o.visible) {
        let m = o.world_mesh();
        let c = o.material.base_color;
        let base = [c[0] as f32, c[1] as f32, c[2] as f32, 1.0];
        let picked = selection.filter(|(id, _)| *id == o.id).map(|(_, f)| f);
        for (fi, l) in m.faces.iter().enumerate() {
            let n = m.face_normal(fi as u32);
            let colour = if picked.is_some_and(|f| f.contains(&(fi as u32))) {
                SELECTED
            } else if picked.is_some() {
                [base[0] * 0.85 + 0.12, base[1] * 0.85 + 0.12, base[2] * 0.85 + 0.15, 1.0]
            } else {
                base
            };
            for i in 1..l.len().saturating_sub(1) {
                for v in [l[0], l[i], l[i + 1]] {
                    push(&mut g.faces, m.positions[v as usize], n, colour);
                }
            }
            for i in 0..l.len() {
                for v in [l[i], l[(i + 1) % l.len()]] {
                    push(&mut g.lines, m.positions[v as usize], [0.0, 0.0, 1.0], EDGE);
                }
            }
        }
    }
    // A ground grid of 10 mm squares out to `grid` mm.
    let step = 10.0;
    let n = (grid / step).ceil() as i32;
    for i in -n..=n {
        let t = i as f64 * step;
        let e = n as f64 * step;
        for (a, b) in [([t, -e, 0.0], [t, e, 0.0]), ([-e, t, 0.0], [e, t, 0.0])] {
            push(&mut g.lines, a, [0.0, 0.0, 1.0], GRID);
            push(&mut g.lines, b, [0.0, 0.0, 1.0], GRID);
        }
    }
    g
}

pub struct Renderer {
    program: glow::Program,
    vao: glow::VertexArray,
    vbo: glow::Buffer,
    mvp: Option<glow::UniformLocation>,
    lit: Option<glow::UniformLocation>,
}

impl Renderer {
    pub fn new(gl: &glow::Context) -> Result<Self, String> {
        // SAFETY: creates and links a program from the constant sources above; every handle is
        // kept in `Self` and deleted in `destroy`.
        unsafe {
            let program = gl.create_program()?;
            let mut shaders = Vec::new();
            for (kind, src) in [(glow::VERTEX_SHADER, VERT), (glow::FRAGMENT_SHADER, FRAG)] {
                let s = gl.create_shader(kind)?;
                gl.shader_source(s, src);
                gl.compile_shader(s);
                if !gl.get_shader_compile_status(s) {
                    return Err(gl.get_shader_info_log(s));
                }
                gl.attach_shader(program, s);
                shaders.push(s);
            }
            gl.link_program(program);
            if !gl.get_program_link_status(program) {
                return Err(gl.get_program_info_log(program));
            }
            for s in shaders {
                gl.detach_shader(program, s);
                gl.delete_shader(s);
            }
            let vao = gl.create_vertex_array()?;
            let vbo = gl.create_buffer()?;
            Ok(Self {
                mvp: gl.get_uniform_location(program, "u_mvp"),
                lit: gl.get_uniform_location(program, "u_lit"),
                program,
                vao,
                vbo,
            })
        }
    }

    pub fn paint(&self, gl: &glow::Context, mvp: &M4, g: &Geometry) {
        // SAFETY: uploads the f32 buffers built by `geometry` (stride 10 floats) and draws them
        // with the program and vertex array this renderer owns; GL state it changes is reset.
        unsafe {
            // egui paints without depth writes; the viewport needs them, then gives them back.
            gl.depth_mask(true);
            gl.enable(glow::DEPTH_TEST);
            gl.depth_func(glow::LEQUAL);
            gl.clear(glow::DEPTH_BUFFER_BIT);
            gl.enable(glow::BLEND);
            gl.blend_func(glow::SRC_ALPHA, glow::ONE_MINUS_SRC_ALPHA);
            gl.use_program(Some(self.program));
            gl.uniform_matrix_4_f32_slice(self.mvp.as_ref(), false, mvp);
            gl.bind_vertex_array(Some(self.vao));
            gl.bind_buffer(glow::ARRAY_BUFFER, Some(self.vbo));
            let stride = 10 * 4;
            for (loc, size, offset) in [(0, 3, 0), (1, 3, 12), (2, 4, 24)] {
                gl.enable_vertex_attrib_array(loc);
                gl.vertex_attrib_pointer_f32(loc, size, glow::FLOAT, false, stride, offset);
            }
            for (data, mode, lit) in [(&g.faces, glow::TRIANGLES, 1.0), (&g.lines, glow::LINES, 0.0)] {
                if data.is_empty() {
                    continue;
                }
                let bytes: Vec<u8> = data.iter().flat_map(|x| x.to_le_bytes()).collect();
                gl.buffer_data_u8_slice(glow::ARRAY_BUFFER, &bytes, glow::DYNAMIC_DRAW);
                gl.uniform_1_f32(self.lit.as_ref(), lit);
                if mode == glow::TRIANGLES {
                    gl.enable(glow::POLYGON_OFFSET_FILL);
                    gl.polygon_offset(1.0, 1.0);
                }
                gl.draw_arrays(mode, 0, (data.len() / 10) as i32);
                gl.disable(glow::POLYGON_OFFSET_FILL);
            }
            gl.bind_vertex_array(None);
            gl.use_program(None);
            gl.disable(glow::DEPTH_TEST);
            gl.depth_mask(false);
        }
    }

    pub fn destroy(&self, gl: &glow::Context) {
        // SAFETY: deletes only the handles this renderer created.
        unsafe {
            gl.delete_program(self.program);
            gl.delete_vertex_array(self.vao);
            gl.delete_buffer(self.vbo);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mantelmesh_engine::Session;
    use serde_json::json;

    #[test]
    fn geometry_has_a_triangle_per_fan_slice_and_tints_the_selection() {
        let mut s = Session::new();
        s.execute("object.add", &json!({ "shape": "box" })).ok();
        let sel: BTreeSet<u32> = [1].into_iter().collect();
        let g = geometry(&s.doc, Some((1, &sel)), 0.0);
        assert_eq!(g.faces.len() / 10, 6 * 2 * 3);
        let selected = g.faces.chunks(10).filter(|v| v[6..10] == SELECTED).count();
        assert_eq!(selected, 6, "the two triangles of the selected face");
        assert_eq!(g.lines.len() / 10, 6 * 4 * 2 + 4);
    }
}
