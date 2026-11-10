//! Fork tangency-labs/smlib@1b016ca under `Kernel::fixes.offset_resolve_crossing_loops`
//! (WR-345 addendum): an offset face's loops winding the other way under an opening are
//! the cavity's floor.
//!
//! SolidCraft rig case shell/616 (a lid shelled 0.5 open at a rib's outer side, which
//! stands 0.15 in from the skirt's outer wall), rebuilt from the commit message: a
//! 20 x 20 x 5 block with a rib on its top, x 0.15..3.15, y 2..18, z 5..8, shelled 0.5
//! inward (extended convex edges, merged) open at the rib's outer side x = 0.15. The top's
//! offset (z = 4.5) has the rib's foot as a hole whose side along the open face stays at
//! x = 0.15 while the outer loop's side along the block's wall moves to x = 0.5. Between
//! them, under the opening, the loops wind round the other way: the cavity's floor.
//! `ResolveCrossingLoopsOfFace` kept only what the loops wind round once and the cavity
//! was left open there (`SM_ERR`, 1001); it is now kept as a reversed face.
//!
//! Closed form: the cavity is the block's (0.5..19.5)^2 x (0.5..4.5) (1444) and the
//! rib's (0.15..2.65) x (2.5..17.5) x (4.5..7.5) (112.5), of a body of 2144: a shell of
//! 587.5. The same rib standing 0.6 in (past the moved wall) has no such region and
//! shells to the same volume.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)] // test helpers

#[path = "support/offset_fixture.rs"]
mod offset_fixture;

use offset_fixture::{planar_faces_at, volume, Notifications};
use solidcore::boolean::api_brep::boolean_union;
use solidcore::error::offset::{OffsetFailure, Unsoundness};
use solidcore::error::Reason;
use solidcore::kernel::UpstreamFixes;
use solidcore::math::Point3;
use solidcore::offset::offset_executive::p1::OffsetExecutive;
use solidcore::offset::offset_executive::p2::{OffsetOptions, ShellOptions};
use solidcore::primitive::api_primitives::create_box;
use solidcore::query::api_queries::brep_is_manifold_solid;
use solidcore::topology::brep::validation::{check_brep, CheckLevel};
use solidcore::{Brep, Kernel, SolidError};

/// The block with the rib `inset` in from its outer wall x = 0.
fn ribbed(k: &mut Kernel, inset: f64) -> Brep {
    let block = create_box(k, Point3::new(0.0, 0.0, 0.0), 20.0, 20.0, 5.0).unwrap();
    let rib = create_box(k, Point3::new(inset, 2.0, 5.0), 3.0, 16.0, 3.0).unwrap();
    boolean_union(k, block, rib).unwrap()
}

fn shell_options() -> ShellOptions {
    ShellOptions {
        offset: OffsetOptions {
            distance: -0.5,
            extend_convex_edges: true,
            merge_results: true,
        },
        create_offset_solid: true,
        merge_sheet_side_walls: true,
    }
}

/// The part shelled 0.5 inward open at the rib's outer side, under `fixes`.
fn shell(fixes: &UpstreamFixes, inset: f64) -> solidcore::Result<(bool, f64)> {
    let mut k = Kernel::default();
    k.fixes.clone_from(fixes);
    let mut part = ribbed(&mut k, inset);
    part.refresh_cached_topology();
    let open = planar_faces_at(&k, &part, 0, inset);
    assert_eq!(open.len(), 1);
    let mut notifications = Notifications::new(&mut part);
    let mut wall = OffsetExecutive::shell_brep(
        &mut k,
        part,
        shell_options(),
        &open,
        &mut notifications.context(),
    )
    .result?;
    wall.refresh_cached_topology();
    assert!(solidcore::topology::integrity::check(&wall).is_ok());
    let manifold = brep_is_manifold_solid(&wall)?;
    Ok((manifold, volume(&k, &mut wall)?))
}

fn crossing(walls_touch: bool) -> UpstreamFixes {
    let mut f = UpstreamFixes::default();
    f.offset_resolve_crossing_loops = true;
    f.offset_walls_touch_refused = walls_touch;
    f
}

/// Without resolving the crossing loops, the cavity is open. The default shell
/// refuses that non-manifold result with `OffsetFailure::Unsound` rather than
/// returning it, retaining the input.
#[test]
fn default_fixes_refuse_the_open_cavity_and_retain_the_input() {
    let mut k = Kernel::default();
    let mut part = ribbed(&mut k, 0.15);
    part.refresh_cached_topology();
    let open = planar_faces_at(&k, &part, 0, 0.15);
    assert_eq!(open.len(), 1);
    let mut notifications = Notifications::new(&mut part);
    let key = part.key();
    let ids = (
        part.face_list().to_vec(),
        part.edge_list().to_vec(),
        part.vertex_list().to_vec(),
    );
    let points: Vec<_> = part
        .vertices()
        .iter()
        .map(|(id, v)| (id, v.point, v.tolerance))
        .collect();
    let outcome = OffsetExecutive::shell_brep(
        &mut k,
        part,
        shell_options(),
        &open,
        &mut notifications.context(),
    );
    let error = outcome.result.as_ref().unwrap_err();
    let SolidError::Failed(failure) = error else {
        panic!("not a refusal: {error}");
    };
    assert_eq!(
        failure.reason,
        Reason::Offset(OffsetFailure::Unsound {
            what: Unsoundness::NotManifoldSolid
        })
    );
    assert!(!outcome.input_ownership_transferred());
    let mut retained = outcome.retained_input.unwrap();
    assert_eq!(retained.key(), key);
    assert_eq!(
        (
            retained.face_list().to_vec(),
            retained.edge_list().to_vec(),
            retained.vertex_list().to_vec()
        ),
        ids
    );
    assert_eq!(
        retained
            .vertices()
            .iter()
            .map(|(id, v)| (id, v.point, v.tolerance))
            .collect::<Vec<_>>(),
        points
    );
    // Do not refresh the retained caches: the operation must leave them coherent.
    assert!(solidcore::topology::integrity::check(&retained).is_ok());
    assert!(brep_is_manifold_solid(&retained).unwrap());
    for level in [CheckLevel::Level0, CheckLevel::Level1, CheckLevel::Level2] {
        let checked = check_brep(&mut k, &mut retained, level).unwrap();
        assert!(checked.is_valid(), "{level:?}: {:?}", checked.lines());
    }
    let v = volume(&k, &mut retained).unwrap();
    // The unchanged block (2000) and rib (3 * 16 * 3), not a partially shelled body.
    assert!((v - 2144.0).abs() <= 1e-9 * 2144.0, "{v}");
}

/// The floor under the opening is kept: the shell is the closed form (with and without
/// a759622's touch refusal, which this case does not reach).
#[test]
fn floor_under_the_opening_is_kept() {
    for walls_touch in [false, true] {
        let (manifold, v) = shell(&crossing(walls_touch), 0.15).unwrap();
        assert!(manifold, "{walls_touch}");
        assert!((v - 587.5).abs() <= 1e-9 * 587.5, "{walls_touch}: {v}");
    }
}

/// Control: the rib 0.6 in, past the moved wall, has loops that do not cross; the shell
/// has the same closed form.
#[test]
fn rib_past_the_moved_wall_is_unchanged() {
    let (manifold, v) = shell(&crossing(false), 0.6).unwrap();
    assert!(manifold);
    assert!((v - 587.5).abs() <= 1e-9 * 587.5, "{v}");
}

/// A rib on a notched ring: the notch joins the two top loops into one. The
/// rib is 0.15 in from the outer wall; a 0.5 offset crosses that same loop.
fn ring_with_rib(k: &mut Kernel, notch: bool) -> Brep {
    use solidcore::boolean::api_brep::boolean_difference;
    let plate = create_box(k, Point3::new(0.0, 0.0, 0.0), 20.0, 20.0, 2.0).unwrap();
    let skirt = create_box(k, Point3::new(1.0, 1.0, 2.0), 18.0, 18.0, 3.0).unwrap();
    let mut body = boolean_union(k, plate, skirt).unwrap();
    let hollow = create_box(k, Point3::new(2.5, 2.5, 2.0), 15.0, 15.0, 4.0).unwrap();
    body = boolean_difference(k, body, hollow).unwrap();
    if notch {
        let cut = create_box(k, Point3::new(8.0, 16.0, 2.0), 4.0, 5.0, 4.0).unwrap();
        body = boolean_difference(k, body, cut).unwrap();
    }
    let rib = create_box(k, Point3::new(1.15, 4.0, 2.0), 1.6, 4.0, 8.0).unwrap();
    boolean_union(k, body, rib).unwrap()
}

fn check_ring_floor(notch: bool, expected: f64) {
    let mut k = Kernel {
        fixes: UpstreamFixes::all(),
        ..Kernel::default()
    };
    let mut body = ring_with_rib(&mut k, notch);
    body.refresh_cached_topology();
    let top = planar_faces_at(&k, &body, 2, 5.0);
    assert_eq!(top.len(), 1);
    assert_eq!(
        body.face(top[0]).unwrap().loops.len(),
        if notch { 1 } else { 2 }
    );
    let open = planar_faces_at(&k, &body, 0, 1.15);
    assert_eq!(open.len(), 1);
    let points: Vec<_> = body
        .vertices()
        .iter()
        .map(|(id, v)| (id, v.point, v.tolerance))
        .collect();
    let topology = (
        body.face_list().to_vec(),
        body.edge_list().to_vec(),
        body.vertex_list().to_vec(),
    );
    let original_volume = volume(&k, &mut body).unwrap();
    assert!((original_volume - if notch { 1114.0 } else { 1132.0 }).abs() < 1e-7);
    let mut result = offset_fixture::api_shell(&mut k, &mut body, shell_options(), &open).unwrap();
    assert_eq!(
        points,
        body.vertices()
            .iter()
            .map(|(id, v)| (id, v.point, v.tolerance))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        topology,
        (
            body.face_list().to_vec(),
            body.edge_list().to_vec(),
            body.vertex_list().to_vec()
        )
    );
    assert!(solidcore::topology::integrity::check(&body).is_ok());
    assert!((volume(&k, &mut body).unwrap() - original_volume).abs() < 1e-7);
    result.refresh_cached_topology();
    assert!(solidcore::topology::integrity::check(&result).is_ok());
    assert!(brep_is_manifold_solid(&result).unwrap());
    for level in [CheckLevel::Level0, CheckLevel::Level1, CheckLevel::Level2] {
        let checked = check_brep(&mut k, &mut result, level).unwrap();
        assert!(checked.is_valid(), "{level:?}: {:?}", checked.lines());
    }
    let actual = volume(&k, &mut result).unwrap();
    assert!((actual - expected).abs() < 1e-7, "{actual} != {expected}");
    for (_, vertex) in result.vertices().iter() {
        let p = vertex.point;
        assert!(p.x >= -1e-8 && p.x <= 20.0 + 1e-8);
        assert!(p.y >= -1e-8 && p.y <= 20.0 + 1e-8);
        assert!(p.z >= -1e-8 && p.z <= 10.0 + 1e-8);
    }
}

/// Original 1132; cavity 361 + 99 + 16.5 + 2.25 = 478.75.
#[test]
fn ring_floor_with_two_loops_is_kept() {
    check_ring_floor(false, 653.25);
}

/// The notch removes 18 from the body and 7.5 from the cavity, including its
/// two end walls: 1114 - (478.75 - 7.5) = 642.75. Every wall is >= 1.5.
#[test]
fn notched_ring_floor_with_one_loop_is_kept() {
    check_ring_floor(true, 642.75);
}
