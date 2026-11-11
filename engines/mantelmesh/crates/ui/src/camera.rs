//! The orbit camera: Z up, turning about a target. Matrices are column-major, as GL wants them.

use mantelmesh_mesh::{V3, add, cross, normalize, scale, sub};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Orbit {
    pub target: V3,
    pub distance: f64,
    /// Degrees about Z.
    pub yaw: f64,
    /// Degrees above the ground plane.
    pub pitch: f64,
    /// Vertical field of view, degrees.
    pub fov: f64,
}

impl Default for Orbit {
    fn default() -> Self {
        Self {
            target: [0.0; 3],
            distance: 300.0,
            yaw: -35.0,
            pitch: 25.0,
            fov: 35.0,
        }
    }
}

pub type M4 = [f32; 16];

impl Orbit {
    /// From the target towards the eye.
    pub fn back(&self) -> V3 {
        let (y, p) = (self.yaw.to_radians(), self.pitch.to_radians());
        [p.cos() * y.sin(), -p.cos() * y.cos(), p.sin()]
    }
    pub fn eye(&self) -> V3 {
        add(self.target, scale(self.back(), self.distance))
    }
    fn basis(&self) -> (V3, V3, V3) {
        let back = self.back();
        let mut right = normalize(cross([0.0, 0.0, 1.0], back));
        if right == [0.0; 3] {
            right = [1.0, 0.0, 0.0];
        }
        (right, cross(back, right), back)
    }

    pub fn orbit(&mut self, dx: f64, dy: f64) {
        self.yaw -= dx * 0.4;
        self.pitch = (self.pitch + dy * 0.4).clamp(-89.0, 89.0);
    }
    pub fn pan(&mut self, dx: f64, dy: f64, viewport_height: f64) {
        let (right, up, _) = self.basis();
        let per_px = 2.0 * self.distance * (self.fov.to_radians() / 2.0).tan() / viewport_height.max(1.0);
        self.target = add(self.target, add(scale(right, -dx * per_px), scale(up, dy * per_px)));
    }
    pub fn zoom(&mut self, steps: f64) {
        self.distance = (self.distance * (1.0 - steps * 0.0015)).clamp(1.0, 1e6);
    }
    /// Frames a box so all of it is in view.
    pub fn frame(&mut self, lo: V3, hi: V3) {
        self.target = scale(add(lo, hi), 0.5);
        let r = mantelmesh_mesh::length(sub(hi, lo)) / 2.0;
        self.distance = (r / (self.fov.to_radians() / 2.0).sin() * 1.15).max(10.0);
    }

    /// Projection × view, for an aspect ratio of width / height.
    pub fn matrix(&self, aspect: f64) -> M4 {
        let (r, u, b) = self.basis();
        let e = self.eye();
        let view = [
            r[0],
            u[0],
            b[0],
            0.0,
            r[1],
            u[1],
            b[1],
            0.0,
            r[2],
            u[2],
            b[2],
            0.0,
            -dot3(r, e),
            -dot3(u, e),
            -dot3(b, e),
            1.0,
        ];
        let near = (self.distance * 0.01).max(0.05);
        let far = self.distance * 100.0;
        let f = 1.0 / (self.fov.to_radians() / 2.0).tan();
        let proj = [
            f / aspect,
            0.0,
            0.0,
            0.0,
            0.0,
            f,
            0.0,
            0.0,
            0.0,
            0.0,
            (far + near) / (near - far),
            -1.0,
            0.0,
            0.0,
            2.0 * far * near / (near - far),
            0.0,
        ];
        mul(&proj, &view).map(|x| x as f32)
    }

    /// The ray from the eye through a point of the viewport (pixels from its top-left).
    pub fn ray(&self, x: f64, y: f64, width: f64, height: f64) -> (V3, V3) {
        let (r, u, b) = self.basis();
        let t = (self.fov.to_radians() / 2.0).tan();
        let nx = (2.0 * x / width.max(1.0) - 1.0) * t * width / height.max(1.0);
        let ny = (1.0 - 2.0 * y / height.max(1.0)) * t;
        (
            self.eye(),
            normalize(add(add(scale(r, nx), scale(u, ny)), scale(b, -1.0))),
        )
    }
}

fn dot3(a: V3, b: V3) -> f64 {
    mantelmesh_mesh::dot(a, b)
}
fn mul(a: &[f64; 16], b: &[f64; 16]) -> [f64; 16] {
    let mut out = [0.0; 16];
    for c in 0..4 {
        for r in 0..4 {
            out[c * 4 + r] = (0..4).map(|k| a[k * 4 + r] * b[c * 4 + k]).sum();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_centre_ray_points_at_the_target_and_projects_to_the_centre() {
        let c = Orbit::default();
        let (o, d) = c.ray(400.0, 300.0, 800.0, 600.0);
        let to_target = normalize(sub(c.target, o));
        assert!(mantelmesh_mesh::length(sub(d, to_target)) < 1e-9);
        let m = c.matrix(800.0 / 600.0);
        let p = [c.target[0] as f32, c.target[1] as f32, c.target[2] as f32, 1.0];
        let clip: Vec<f32> = (0..4).map(|r| (0..4).map(|k| m[k * 4 + r] * p[k]).sum()).collect();
        assert!((clip[0] / clip[3]).abs() < 1e-5 && (clip[1] / clip[3]).abs() < 1e-5);
    }

    #[test]
    fn framing_fits_and_zoom_and_pitch_stay_bounded() {
        let mut c = Orbit::default();
        c.frame([-100.0, -40.0, 0.0], [100.0, 40.0, 200.0]);
        assert_eq!(c.target, [0.0, 0.0, 100.0]);
        c.orbit(0.0, 10_000.0);
        assert!(c.pitch <= 89.0);
        c.zoom(1e9);
        assert!(c.distance >= 1.0);
    }
}
