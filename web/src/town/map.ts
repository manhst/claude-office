// Town map around the office (2D px). Pure data: roads, Crossian Cafe, the sidewalk trà đá stall, the crocodile pond, points of interest.
export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }
export const TOWN = { w: 1600, h: 1080 };
export const OFFICE_AT: Pt = { x: 310, y: 150 }; // top-left of the office floor (Office2D) inside the town
export const BUILDING: Box = { x: 290, y: 120, w: 960, h: 740 };
export const ROADS: Box[] = [
  { x: 0, y: 30, w: TOWN.w, h: 70 }, // top street
  { x: 0, y: 900, w: TOWN.w, h: 70 }, // bottom street
  { x: 200, y: 30, w: 70, h: 940 }, // left avenue
  { x: 1270, y: 30, w: 70, h: 940 }, // right avenue
];
export const CAFE: Box = { x: 1365, y: 140, w: 215, h: 250 };
export const TRADA: Box = { x: 1370, y: 470, w: 190, h: 120 };
export const POND = { cx: 105, cy: 520, rx: 85, ry: 170 };
export const NOC: Pt = { x: 1180, y: 892 }; // IT Ops monitoring kiosk, just outside the building
export const ARCHITECT_SPOT: Pt = { x: 770, y: 890 }; // by the office front door (bottom wall)
export const DOOR: Pt = { x: 770, y: 870 };
export const CAFE_SEATS: Pt[] = [{ x: 1410, y: 300 }, { x: 1470, y: 330 }, { x: 1530, y: 300 }, { x: 1440, y: 240 }];
export const TRADA_STOOLS: Pt[] = [{ x: 1395, y: 560 }, { x: 1445, y: 575 }, { x: 1500, y: 575 }, { x: 1545, y: 560 }];
export const POND_EDGE: Pt[] = [{ x: 215, y: 420 }, { x: 215, y: 600 }, { x: 120, y: 330 }, { x: 110, y: 710 }];
export const STREET: Pt[] = [{ x: 60, y: 65 }, { x: 700, y: 65 }, { x: 1550, y: 65 }, { x: 60, y: 935 }, { x: 1000, y: 935 }, { x: 1550, y: 935 }, { x: 235, y: 250 }, { x: 1305, y: 700 }, { x: 1305, y: 420 }, { x: 235, y: 800 }];
export const YARD: Pt[] = [{ x: 400, y: 1010 }, { x: 900, y: 1020 }, { x: 1300, y: 1010 }, { x: 1450, y: 780 }, { x: 1500, y: 680 }, { x: 60, y: 1000 }, { x: 1440, y: 420 }];
export const pondCenter = (): Pt => ({ x: POND.cx, y: POND.cy });
export const inPond = (p: Pt) => ((p.x - POND.cx) / POND.rx) ** 2 + ((p.y - POND.cy) / POND.ry) ** 2 <= 1;
