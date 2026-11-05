// Town map around the office. Pure data in plan pixels (x right, y = depth toward the camera), converted to Vanphong world
// units by toWorld(): 37.5 px per unit, the building box is exactly the Vanphong office floor (adapter.ts BIEN).
export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
export const PX = 37.5;
/** Town plan bounds: y0 < 0 makes room for Xuka, the flower garden, and Xém Nướng north of the back street. */
export const TOWN = { y0: -280, w: 1600, h: 970 };
export const BUILDING: Box = { x: 290, y: 120, w: 960, h: 600 }; // = BIEN x -12.8..12.8, z -8.4..7.6
export const ROADS: Box[] = [
  { x: 0, y: 30, w: TOWN.w, h: 70 }, // back street
  { x: 0, y: 760, w: TOWN.w, h: 70 }, // front street
  { x: 200, y: 30, w: 70, h: 800 }, // left avenue
  { x: 1270, y: 30, w: 70, h: 800 }, // right avenue
];
export const CAFE: Box = { x: 1365, y: 140, w: 215, h: 250 };
/** Xuka Mát xa: across the back street from Crossian Cafe (same x span), door facing the street. */
export const MASSAGE: Box = { x: 1365, y: -215, w: 215, h: 215 };
export const MASSAGE_BEDS: Pt[] = [{ x: 1405, y: -95 }, { x: 1472, y: -95 }, { x: 1540, y: -95 }];
/** Xém Nướng: BBQ + crocodile-meat hotpot, northwest opposite the crocodile pond. */
export const BBQ: Box = { x: 40, y: -240, w: 260, h: 230 };
export const BBQ_SEATS: Pt[] = [{ x: 90, y: -110 }, { x: 155, y: -95 }, { x: 220, y: -110 }, { x: 120, y: -165 }, { x: 200, y: -165 }];
/** Flower garden between Xuka (east) and Xém Nướng (west), north of the back street. */
export const GARDEN: Box = { x: 360, y: -220, w: 960, h: 180 };
/** Couple meet points in the garden (plan px); partners stand either side. */
export const ROMANCE_SPOTS: Pt[] = [{ x: 620, y: -130 }, { x: 850, y: -145 }, { x: 1080, y: -125 }];
/** Main road lanes (front street): eastbound top lane, westbound bottom lane. */
export const LANES = [{ y: 778, dir: 1 }, { y: 812, dir: -1 }] as const;
export const TRADA: Box = { x: 1370, y: 470, w: 190, h: 120 };
export const POND = { cx: 105, cy: 420, rx: 85, ry: 170 };
/** IT Ops desk corner inside the office (left / pantry side), not out on the street. */
export const ITOPS_SPOT: Pt = { x: 340, y: 480 };
export const CAFE_SEATS: Pt[] = [{ x: 1410, y: 300 }, { x: 1470, y: 330 }, { x: 1530, y: 300 }, { x: 1440, y: 240 }];
export const TRADA_STOOLS: Pt[] = [{ x: 1395, y: 560 }, { x: 1445, y: 575 }, { x: 1500, y: 575 }, { x: 1545, y: 560 }];
export const POND_EDGE: Pt[] = [{ x: 215, y: 320 }, { x: 215, y: 500 }, { x: 120, y: 230 }, { x: 110, y: 610 }];
export const STREET: Pt[] = [{ x: 60, y: 65 }, { x: 700, y: 65 }, { x: 1550, y: 65 }, { x: 60, y: 795 }, { x: 1000, y: 795 }, { x: 1550, y: 795 }, { x: 235, y: 250 }, { x: 1305, y: 640 }, { x: 1305, y: 420 }, { x: 235, y: 700 }];
export const YARD: Pt[] = [{ x: 400, y: 880 }, { x: 900, y: 890 }, { x: 1300, y: 880 }, { x: 1450, y: 700 }, { x: 1500, y: 650 }, { x: 60, y: 880 }, { x: 1440, y: 420 }];
/** Smoking / water-cooler corner west of the pond (gossip + deadline vent). */
export const SMOKE: Box = { x: 40, y: 620, w: 150, h: 90 };
export const SMOKE_SPOTS: Pt[] = [{ x: 70, y: 655 }, { x: 115, y: 670 }, { x: 155, y: 650 }];
/** Outdoor gym / table tennis in the south yard. */
export const GYM: Box = { x: 480, y: 860, w: 340, h: 110 };
export const GYM_SPOTS: Pt[] = [{ x: 520, y: 910 }, { x: 600, y: 900 }, { x: 680, y: 910 }, { x: 760, y: 900 }];
/** ATM + snack machine east of the office, south of trà đá. */
export const ATM: Box = { x: 1400, y: 690, w: 150, h: 100 };
export const ATM_SPOTS: Pt[] = [{ x: 1430, y: 740 }, { x: 1480, y: 755 }, { x: 1520, y: 740 }];
/** Parking / security gate at the SW approach (left avenue → front street). */
export const GATE: Box = { x: 40, y: 690, w: 150, h: 70 };
export const GATE_SPOTS: Pt[] = [{ x: 70, y: 720 }, { x: 120, y: 735 }, { x: 165, y: 720 }];
/** Bia Hải Xồm — beer stall opposite cổng/trạm gửi xe, across the front street (south). */
export const BIA: Box = { x: 40, y: 850, w: 200, h: 110 };
export const BIA_SEATS: Pt[] = [{ x: 70, y: 900 }, { x: 120, y: 915 }, { x: 170, y: 900 }, { x: 95, y: 940 }, { x: 155, y: 940 }];
/** Shipper drop-off spots by the security gate / parking. */
export const SHIPPER_SPOTS: Pt[] = [{ x: 90, y: 710 }, { x: 140, y: 725 }, { x: 180, y: 710 }];
/** Glass outdoor meeting pod in the south yard (east of gym) — fake meetings / naps. */
export const POD: Box = { x: 900, y: 860, w: 170, h: 110 };
export const POD_SPOTS: Pt[] = [{ x: 940, y: 910 }, { x: 990, y: 920 }, { x: 1040, y: 910 }];
/** Printer + photocopier inside the office, against the back/north wall by the window right of the back door (= adapter FURNITURE.printer). */
export const PRINT: Box = { x: 901, y: 123, w: 82, h: 27 };
export const PRINT_SPOTS: Pt[] = [{ x: 890, y: 171 }, { x: 976, y: 171 }, { x: 1018, y: 169 }];
export const pondCenter = (): Pt => ({ x: POND.cx, y: POND.cy });
export const inPond = (p: Pt) => ((p.x - POND.cx) / POND.rx) ** 2 + ((p.y - POND.cy) / POND.ry) ** 2 <= 1;
/** Plan px → world [x, z]. */
export const toWorld = (p: Pt): [number, number] => [(p.x - 770) / PX, (p.y - 120) / PX - 8.4];
export const fromWorld = (x: number, z: number): Pt => ({ x: x * PX + 770, y: (z + 8.4) * PX + 120 });
/** Side characters walk around the building, not through it: next waypoint from `a` toward `b` (a building corner, or b). */
const M = 24;
const R = { x0: BUILDING.x - M, x1: BUILDING.x + BUILDING.w + M, y0: BUILDING.y - M, y1: BUILDING.y + BUILDING.h + M };
const CORNERS: Pt[] = [{ x: R.x0 - 2, y: R.y0 - 2 }, { x: R.x1 + 2, y: R.y0 - 2 }, { x: R.x1 + 2, y: R.y1 + 2 }, { x: R.x0 - 2, y: R.y1 + 2 }];
export function crossesBuilding(a: Pt, b: Pt): boolean {
  let t0 = 0, t1 = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - R.x0], [dx, R.x1 - a.x], [-dy, a.y - R.y0], [dy, R.y1 - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p; if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return t1 - t0 > 1e-6;
}
const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export function waypoint(a: Pt, b: Pt): Pt {
  if (!crossesBuilding(a, b)) return b;
  let best = b, cost = Infinity;
  for (const c of CORNERS) {
    if (d(a, c) < 1 || crossesBuilding(a, c)) continue;
    const via = crossesBuilding(c, b) ? Math.min(...CORNERS.filter((k) => k !== c && !crossesBuilding(c, k) && !crossesBuilding(k, b)).map((k) => d(c, k) + d(k, b)), Infinity) : d(c, b);
    if (d(a, c) + via < cost) { cost = d(a, c) + via; best = c; }
  }
  return best;
}
