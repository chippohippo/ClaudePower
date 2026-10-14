// Which way does an imported gun point? Packs disagree (Kenney blasters lie along ±Z, Quaternius
// guns along ±X, others anywhere), and nothing in a glTF says where the muzzle is. Two cues that
// hold for almost every firearm model:
//   1. the grip / magazine / trigger guard hang below the barrel, behind the middle of the gun
//   2. the muzzle end is slimmer (just a barrel) than the rear (stock, receiver, grip)
// Used by tools/assets/import.mjs (on raw glTF vertex data) and by client/assets.js at runtime
// for manifests that don't specify a rotation.
//
// positions: flat [x, y, z, …] in model space. Returns the long horizontal axis, the sign of the
// muzzle along it, the Y rotation that makes the barrel point along -Z (SKYFALL forward), and a
// 0..1 confidence (low = check it in the asset viewer).

export function gunFacing(positions) {
  const n = Math.floor(positions.length / 3);
  if (!n) return { axis: 'z', sign: -1, rotY: 0, confidence: 0 };
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = positions[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const ax = mx[0] - mn[0] >= mx[2] - mn[2] ? 0 : 2;
  const lo = mn[ax], len = mx[ax] - mn[ax] || 1, h = mx[1] - mn[1] || 1, mid = lo + len / 2;
  // cue 1: where along the gun is the stuff hanging low (grip, mag)?
  let lowSum = 0, lowN = 0;
  // cue 2: vertical thickness of each end (outer 18%)
  let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = positions[i * 3 + ax], y = positions[i * 3 + 1];
    if (y < mn[1] + h * 0.3) { lowSum += a; lowN++; }
    const t = (a - lo) / len;
    if (t < 0.18) { if (y < aMin) aMin = y; if (y > aMax) aMax = y; }
    else if (t > 0.82) { if (y < bMin) bMin = y; if (y > bMax) bMax = y; }
  }
  const lowC = lowN ? (lowSum / lowN - mid) / (len / 2) : 0;          // -1..1, + = low stuff toward +axis
  const thickA = aMax > aMin ? (aMax - aMin) / h : 0, thickB = bMax > bMin ? (bMax - bMin) / h : 0;
  const thin = thickA - thickB;                                        // + = the +axis end is slimmer
  // muzzle toward +axis when the low stuff sits toward -axis and the +axis end is slimmer
  const score = -lowC * 1.0 + thin * 0.8;
  const sign = score >= 0 ? 1 : -1;
  const rotY = ax === 2 ? (sign < 0 ? 0 : Math.PI) : (sign > 0 ? Math.PI / 2 : -Math.PI / 2);
  return { axis: ax === 0 ? 'x' : 'z', sign, rotY, confidence: Math.min(1, Math.abs(score)), lowC: +lowC.toFixed(3), thin: +thin.toFixed(3) };
}
