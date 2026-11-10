# A notched ring needs a reversed floor from its own loop

The MantelCAD action-matrix case `corpus/issue-616-lid-ribs :: Lid/F8:-x ::
face.shell` exposes a missing construction in `crossing_loops.rs`. Shelling
inward by 0.5 through the rib's outer side fails the final loop-orientation
check. Moving the face pick to the previous baseline's point does not help.

The earlier saved kernel case with the same issue number has a solid skirt,
whereas the corpus design has a hollow skirt and a rear notch. Its passing
result is therefore not an independent expectation for this input.

## Reduction and direct expectation

The integration test constructs only boxes and booleans:

- plate: [0,20] × [0,20] × [0,2];
- skirt: [1,19] × [1,19] × [2,5], hollowed by
  [2.5,17.5] × [2.5,17.5] × [2,6];
- notch: [8,12] × [16,21] × [2,6];
- rib: [1.15,2.75] × [4,8] × [2,10].

Open the rib side x=1.15 and shell inward by 0.5. The skirt is 1.5
thick, plate 2, and rib 1.6: these are all greater than twice the offset.
The 0.15 shoulder is an inset of the opening, not an opposing pair of walls.

Without the notch, the original volume is 1132 and the cavity is
361 + 99 + 16.5 + 2.25 = 478.75, so shell material is 653.25.
The notch removes 4 × 1.5 × 3 = 18 from the original and
5 × 0.5 × 3 = 7.5 from the cavity (including its two end walls).
The correct notched shell is therefore 1114 − 471.25 = **642.75**.

The notch joins the skirt top's outer and inner boundaries into one loop.
The original routine only compared different loops and returned immediately
for a single loop. The negative-winding region under the opening was never
rebuilt as the reversed cavity floor. The no-notch control took the existing
two-loop construction and passed.

## Construction and limits

Chen and McMains, “Polygon Offsetting by Computing Winding Numbers,”
DETC2005-85513 ([paper](https://mcmains.me.berkeley.edu/pubs/DAC05OffsetPolygon.pdf)),
describe resolving offset contours through their intersection arrangement and
winding. Here the existing cavity-floor test additionally decides whether a
negative region must be retained as a reversed face.

The new construction admits one exact planar loop of at most 256 straight
trim edges and 512 split stretches (at most 130816 post-split pair checks).
Larger arrangements receive a typed refusal. It enumerates nonadjacent transverse intersections, splits the
directed stretches, and uses the kernel's existing planar cycle decomposition.
Adjacent joints must have one intersection at the shared topological endpoint,
certified against the existing edge/vertex tolerance balls. Collinear overlap,
backtracking, ambiguous joints, nested/overlapping cycles and undecidable
winding are refused.

Classification polygons use one common point per arrangement node, with every
endpoint displaced by at most the mapped face tolerance. Every closed segment
pair is checked, including pairs within one cycle: nonincident edges need
clearance greater than twice that bound; incident edges may meet only at their
common endpoint. Their area
and separation decisions include the endpoint-motion and arithmetic bounds.
The actual construction curves are not moved. The positive cycles must be
interior-disjoint before they can each become an outer boundary. Negative
cycles remain subject to the existing cavity-floor predicate. No tolerance,
validator, compatibility flag or baseline is weakened. Curved single-loop
arrangements remain outside this construction.

## Regression evidence

The new notched integration test failed before the change with the reported
bad-loop-orientation error; the control passed. After the change, all five
tests in `fork_1b016ca_cavity_floor_under_opening` pass, along with nine
`single_loop_tests` covering opposite winding, a rotated/scaled/translated
arrangement, zero/uncertain area, overlap, nesting, adjacent backtracking, internal crossings, and uncertain nonadjacent clearance.
The integration checks include the analytic volumes, manifold closedness,
topological integrity, all three validation levels, bounded nondegenerate
output, and unchanged source topology/vertex tolerances/volume.

These first green runs used the goldens profile with a command-line
`profile.goldens.opt-level=0` override for diagnosis; no repository profile
was changed. The normal ci-profile CLI also passes the exact historical
selection with validation at every step: one closed shell, 110 faces, and
3810.779465666421 mm³. Its reduced replay measures 642.7500000000005 mm³.
[Editable inputs, matching before/after pictures, and concise measurements](assets/notched-rib-shell/README.md)
are retained with this finding. Before means the solid input; the old shell
operation refused it.

Optimized goldens, wasm, the action matrix and full integration CI remain
separate acceptance gates; this record does not yet claim their completion.
