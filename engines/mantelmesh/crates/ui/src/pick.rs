//! Which face of which object is under the pointer: a ray against every visible triangle.

use mantelmesh_doc::Document;
use mantelmesh_mesh::{V3, cross, dot, sub};

/// The nearest visible face the ray hits: (object id, face, distance).
pub fn pick(doc: &Document, origin: V3, dir: V3) -> Option<(u32, u32, f64)> {
    let mut best: Option<(u32, u32, f64)> = None;
    for o in doc.objects.iter().filter(|o| o.visible) {
        let m = o.world_mesh();
        for (f, l) in m.faces.iter().enumerate() {
            for i in 1..l.len().saturating_sub(1) {
                let [a, b, c] = [l[0], l[i], l[i + 1]].map(|v| m.positions[v as usize]);
                if let Some(t) = hit(origin, dir, a, b, c)
                    && best.is_none_or(|(_, _, d)| t < d)
                {
                    best = Some((o.id, f as u32, t));
                }
            }
        }
    }
    best
}

/// Möller–Trumbore ray–triangle intersection; both sides count.
fn hit(o: V3, d: V3, a: V3, b: V3, c: V3) -> Option<f64> {
    let (e1, e2) = (sub(b, a), sub(c, a));
    let p = cross(d, e2);
    let det = dot(e1, p);
    if det.abs() < 1e-12 {
        return None;
    }
    let inv = 1.0 / det;
    let s = sub(o, a);
    let u = dot(s, p) * inv;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = cross(s, e1);
    let v = dot(d, q) * inv;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let t = dot(e2, q) * inv;
    (t > 1e-9).then_some(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mantelmesh_engine::Session;
    use serde_json::json;

    #[test]
    fn picks_the_nearest_face_from_above() {
        let mut s = Session::new();
        s.execute("object.add", &json!({ "shape": "box", "size": [10, 10, 10] }))
            .ok();
        s.execute(
            "object.add",
            &json!({ "shape": "box", "size": [10, 10, 10], "at": [0, 0, -30] }),
        )
        .ok();
        let (obj, face, t) = pick(&s.doc, [0.0, 0.0, 100.0], [0.0, 0.0, -1.0]).unwrap_or((0, 0, 0.0));
        assert_eq!((obj, face), (1, 1), "the top face of the upper box");
        assert!(
            (t - 90.0).abs() < 1e-9,
            "the box stands on the ground, its top at 10 mm"
        );
        assert!(pick(&s.doc, [50.0, 50.0, 100.0], [0.0, 0.0, -1.0]).is_none());
    }
}
