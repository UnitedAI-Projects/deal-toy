#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
//! Still renders of a scene, drawn on the CPU so they come out the same in the browser, the CLI
//! and an agent's container: flat-shaded faces with a key and a fill light, a soft ground shadow
//! line, and the materials' base colours (metals are tinted by a fixed studio reflection).

use mantelmesh_doc::Document;
use mantelmesh_mesh::{V3, add, cross, dot, length, normalize, scale, sub};

/// Where the camera looks from: azimuth and elevation in degrees around the scene's centre.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct View {
    pub azimuth: f64,
    pub elevation: f64,
}
/// The three-quarter view concept cards use.
pub const CARD: View = View {
    azimuth: -35.0,
    elevation: 22.0,
};
pub const MAX_PIXELS: u32 = 4096 * 4096;

pub struct Image {
    pub width: u32,
    pub height: u32,
    /// RGBA, row by row from the top.
    pub rgba: Vec<u8>,
}

fn srgb(linear: f64) -> u8 {
    let c = linear.clamp(0.0, 1.0);
    let s = if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round() as u8
}

/// Renders the visible objects, framed to fit, on a warm studio background.
pub fn render(doc: &Document, width: u32, height: u32, view: View) -> Result<Image, String> {
    if width == 0 || height == 0 || width.saturating_mul(height) > MAX_PIXELS {
        return Err(format!("image size must be 1–{MAX_PIXELS} pixels"));
    }
    let (w, h) = (width as usize, height as usize);
    let bg = [0.86, 0.86, 0.83];
    let mut rgba = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        // A gentle vertical gradient.
        let t = y as f64 / h as f64;
        for _ in 0..w {
            rgba.extend_from_slice(&[
                srgb(bg[0] - 0.06 * t),
                srgb(bg[1] - 0.06 * t),
                srgb(bg[2] - 0.05 * t),
                255,
            ]);
        }
    }
    let Some((lo, hi)) = doc.bounds() else {
        return Ok(Image { width, height, rgba });
    };
    let center = scale(add(lo, hi), 0.5);
    let radius = (length(sub(hi, lo)) / 2.0).max(1e-6);
    let (az, el) = (view.azimuth.to_radians(), view.elevation.to_radians());
    // Camera basis: Z up, looking at the centre from the given angles.
    let back = [el.cos() * az.sin(), -el.cos() * az.cos(), el.sin()];
    let right = normalize(cross([0.0, 0.0, 1.0], back));
    let right = if length(right) == 0.0 { [1.0, 0.0, 0.0] } else { right };
    let up = cross(back, right);
    let fov = 30f64.to_radians();
    let dist = radius / (fov / 2.0).sin() * 1.08;
    let eye = add(center, scale(back, dist));
    let focal = (h.min(w) as f64 / 2.0) / (fov / 2.0).tan();
    let project = |p: V3| -> Option<(f64, f64, f64)> {
        let d = sub(p, eye);
        let z = -dot(d, back);
        if z <= 1e-6 {
            return None;
        }
        Some((
            w as f64 / 2.0 + dot(d, right) * focal / z,
            h as f64 / 2.0 - dot(d, up) * focal / z,
            z,
        ))
    };
    let key = normalize([-0.4, -0.7, 0.9]);
    let fill = normalize([0.8, 0.3, 0.4]);
    let mut depth = vec![f64::INFINITY; w * h];
    for o in doc.objects.iter().filter(|o| o.visible) {
        let m = o.world_mesh();
        let mat = &o.material;
        for f in 0..m.faces.len() as u32 {
            let n = m.face_normal(f);
            let facing = dot(n, back);
            if facing <= 0.0 {
                continue; // back face
            }
            let diffuse = 0.18 + 0.62 * dot(n, key).max(0.0) + 0.22 * dot(n, fill).max(0.0);
            // Metals: their colour carries the light; a fixed studio reflection brightens faces
            // turned towards the camera.
            let spec = mat.metallic * (0.35 * facing.powf(8.0) + 0.15);
            let shade = |c: f64| (c * (diffuse * (1.0 - 0.4 * mat.metallic) + spec)).min(1.0);
            let alpha = mat.base_color[3].clamp(0.05, 1.0);
            let colour = [
                shade(mat.base_color[0]),
                shade(mat.base_color[1]),
                shade(mat.base_color[2]),
            ];
            let l = &m.faces[f as usize];
            for i in 1..l.len() - 1 {
                let tri = [l[0], l[i], l[i + 1]].map(|v| project(m.positions[v as usize]));
                let [Some(a), Some(b), Some(c)] = tri else { continue };
                raster(&mut rgba, &mut depth, w, h, [a, b, c], colour, alpha);
            }
        }
    }
    Ok(Image { width, height, rgba })
}

fn raster(
    rgba: &mut [u8],
    depth: &mut [f64],
    w: usize,
    h: usize,
    t: [(f64, f64, f64); 3],
    colour: [f64; 3],
    alpha: f64,
) {
    let [(x0, y0, z0), (x1, y1, z1), (x2, y2, z2)] = t;
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if area.abs() < 1e-12 {
        return;
    }
    let (minx, maxx) = (
        x0.min(x1).min(x2).floor().max(0.0) as usize,
        x0.max(x1).max(x2).ceil().min(w as f64 - 1.0) as usize,
    );
    let (miny, maxy) = (
        y0.min(y1).min(y2).floor().max(0.0) as usize,
        y0.max(y1).max(y2).ceil().min(h as f64 - 1.0) as usize,
    );
    if minx > maxx || miny > maxy {
        return;
    }
    let px = [srgb(colour[0]), srgb(colour[1]), srgb(colour[2])];
    for y in miny..=maxy {
        for x in minx..=maxx {
            let (sx, sy) = (x as f64 + 0.5, y as f64 + 0.5);
            let w0 = ((x1 - sx) * (y2 - sy) - (x2 - sx) * (y1 - sy)) / area;
            let w1 = ((x2 - sx) * (y0 - sy) - (x0 - sx) * (y2 - sy)) / area;
            let w2 = 1.0 - w0 - w1;
            if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 {
                continue;
            }
            let z = w0 * z0 + w1 * z1 + w2 * z2;
            let i = y * w + x;
            if z >= depth[i] {
                continue;
            }
            if alpha >= 0.999 {
                depth[i] = z;
            }
            for c in 0..3 {
                let old = rgba[i * 4 + c] as f64;
                rgba[i * 4 + c] = (old * (1.0 - alpha) + px[c] as f64 * alpha).round() as u8;
            }
        }
    }
}

/// The image as a PNG file.
pub fn png(image: &Image) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, image.width, image.height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&image.rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mantelmesh_mesh::Mesh;

    fn cube_doc() -> Document {
        let mut d = Document::default();
        let m = Mesh {
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
        d.add("Cube", m);
        d
    }

    #[test]
    fn draws_the_object_in_the_middle_and_leaves_the_corners_as_background() {
        let img = render(&cube_doc(), 64, 48, CARD).unwrap();
        assert_eq!(img.rgba.len(), 64 * 48 * 4);
        let at = |x: usize, y: usize| &img.rgba[(y * 64 + x) * 4..(y * 64 + x) * 4 + 3];
        let corner = at(0, 0).to_vec();
        assert_ne!(at(32, 24), corner.as_slice(), "the cube covers the centre");
        let bytes = png(&img).unwrap();
        assert_eq!(&bytes[1..4], b"PNG");
    }

    #[test]
    fn an_empty_scene_is_background_and_sizes_are_bounded() {
        assert!(render(&Document::default(), 8, 8, CARD).is_ok());
        assert!(render(&cube_doc(), 0, 8, CARD).is_err());
        assert!(render(&cube_doc(), 100_000, 100_000, CARD).is_err());
    }
}
