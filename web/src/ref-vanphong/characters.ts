// Blocky characters, ported from VanphongAI (Phuc) van_phong_3d.js "dungNguoi" + nhan_vat.js "chuanHoa". See ./NOTICE.
// Recipes (sizes, offsets, colours) are kept verbatim; only the module shape and types are ours.
import * as THREE from 'three';

export const DA = '#ffe4d4';
export const HOP = new THREE.BoxGeometry(1, 1, 1);
const kho = new Map<string, THREE.Material>();
export const tron = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
const hopLe = (hex: string | undefined, macDinh: string) => (/^#[0-9a-f]{6}$/i.test(hex || '') ? hex! : macDinh);

export function vatLieu(mau: string, them?: THREE.MeshLambertMaterialParameters) {
  const k = mau + (them ? JSON.stringify(them) : '');
  if (!kho.has(k)) kho.set(k, new THREE.MeshLambertMaterial({ color: mau, ...them }));
  return kho.get(k)!;
}
export function vatLieuSang(mau: string) {
  const k = `sang${mau}`;
  if (!kho.has(k)) kho.set(k, new THREE.MeshBasicMaterial({ color: mau }));
  return kho.get(k)!;
}
export let BONG = true; // cast shadows (turned off on software GL)
export const setShadows = (on: boolean) => { BONG = on; };
export function khoi(cha: THREE.Object3D, w: number, h: number, d: number, mau: string | THREE.Material, x: number, y: number, z: number, bong = true) {
  const m = new THREE.Mesh(HOP, typeof mau === 'string' ? vatLieu(mau) : mau);
  m.scale.set(w, h, d); m.position.set(x, y, z);
  m.castShadow = bong && BONG; m.receiveShadow = BONG;
  cha.add(m);
  return m;
}

export interface NgoaiHinh { gioi?: 'nam' | 'nu'; kieu_toc?: string; toc?: string; toc2?: string; mat?: string; ao?: string; phu?: string; phu_kien?: string[] }
const TOC_NAM = ['nhon', 'nam_gon', 'nam_roi', 'vuot'];
const KIEU = ['ngan', 'dai', 'buoc', 'duoi_ngua', 'bui', 'xoan', 'mai_bang', ...TOC_NAM];
export function chuanHoa(g?: NgoaiHinh): Required<NgoaiHinh> {
  const nh: any = { ...(g || {}) };
  nh.kieu_toc = KIEU.includes(nh.kieu_toc) ? nh.kieu_toc : 'ngan';
  nh.gioi = nh.gioi === 'nam' || nh.gioi === 'nu' ? nh.gioi : (TOC_NAM.includes(nh.kieu_toc) ? 'nam' : 'nu');
  nh.toc = hopLe(nh.toc, '#6b5b95');
  nh.toc2 = hopLe(nh.toc2, tron(nh.toc, '#ffffff', 0.25));
  nh.mat = hopLe(nh.mat, '#5b6cff');
  nh.ao = hopLe(nh.ao, '#f0ebe4');
  nh.phu = hopLe(nh.phu, nh.mat);
  nh.phu_kien = Array.isArray(nh.phu_kien) ? nh.phu_kien : [];
  return nh;
}
// A few of the reference's 20 presets (nhan_vat.js MAU_SAN), verbatim.
const m = (gioi: 'nam' | 'nu', kieu_toc: string, toc: string, toc2: string, mat: string, ao: string, phu: string, phu_kien: string[]): NgoaiHinh => ({ gioi, kieu_toc, toc, toc2, mat, ao, phu, phu_kien });
export const MAU_SAN: Record<string, NgoaiHinh> = {
  nam_01: m('nam', 'nam_gon', '#2b2b33', '#4a4a58', '#5a4632', '#e9eef5', '#3b6fd1', ['kinh']),
  nam_02: m('nam', 'nhon', '#4f6bff', '#a07bff', '#3d5afe', '#ebe8ff', '#4f6bff', ['tai_nghe']),
  nam_04: m('nam', 'nam_roi', '#c8643f', '#e9925f', '#b4532a', '#fff4e6', '#e67e22', []),
  nam_07: m('nam', 'nam_gon', '#6b4423', '#9a6a3f', '#6b4423', '#f5efe6', '#8e5a2b', ['kinh']),
  nu_01: m('nu', 'dai', '#86a8ff', '#c39bff', '#5b6cff', '#33406f', '#c39bff', ['sao']),
  nu_03: m('nu', 'buoc', '#2d2d34', '#169c7c', '#10a37f', '#e6f6f0', '#10a37f', ['hoa']),
  nu_04: m('nu', 'duoi_ngua', '#ff8fb1', '#ffc2d4', '#e0558a', '#fff0f5', '#e0558a', ['no']),
  nu_05: m('nu', 'bui', '#23232b', '#45455a', '#5a3e2b', '#f2efe9', '#b23a48', ['khuyen']),
};

function toc(dau: THREE.Group, nh: Required<NgoaiHinh>) {
  const t1 = nh.toc, t2 = nh.toc2, phu = nh.phu;
  const k = (w: number, h: number, d: number, x: number, y: number, z: number, mau = t1, xoay?: number[]) => {
    const mm = khoi(dau, w, h, d, mau, x, y, z);
    if (xoay) mm.rotation.set(xoay[0] || 0, xoay[1] || 0, xoay[2] || 0);
    return mm;
  };
  k(0.62, 0.14, 0.56, 0, 0.59, -0.01);
  k(0.62, 0.42, 0.08, 0, 0.37, -0.285);
  for (const b of [-1, 1]) k(0.06, 0.26, 0.48, b * 0.31, 0.44, -0.03);
  k(0.2, 0.02, 0.1, -0.1, 0.665, 0.12, tron(t1, '#ffffff', 0.16));
  const mai = () => { k(0.2, 0.13, 0.06, -0.19, 0.47, 0.27); k(0.24, 0.17, 0.06, 0.02, 0.45, 0.27); k(0.16, 0.11, 0.06, 0.21, 0.48, 0.27); };
  const tocMai = () => { for (const b of [-1, 1]) k(0.07, 0.3, 0.08, b * 0.3, 0.3, 0.17, t2); };
  const dai = () => { k(0.64, 0.75, 0.1, 0, -0.2, -0.3, t2); };
  switch (nh.kieu_toc) {
    case 'nhon':
      [[-0.18, 0.7, 0.08, 0.35], [0, 0.74, 0.02, 0], [0.18, 0.7, 0.06, -0.35], [-0.1, 0.71, -0.17, 0.2], [0.12, 0.7, -0.16, -0.2]]
        .forEach(([x, y, z, r]) => k(0.16, 0.16, 0.16, x, y, z, t1, [0, 0, r]));
      [-0.17, 0, 0.17].forEach((x) => k(0.15, 0.15, 0.06, x, 0.49, 0.27, x ? t1 : t2, [0, 0, 0.78]));
      break;
    case 'nam_gon': k(0.42, 0.11, 0.06, -0.09, 0.49, 0.27); k(0.14, 0.07, 0.06, 0.21, 0.52, 0.27); break;
    case 'nam_roi':
      mai();
      [[0.31, 0.55, 0.14, 0.4], [-0.32, 0.5, 0.08, -0.3], [0.1, 0.69, -0.06, 0.5], [-0.16, 0.68, 0.12, -0.4], [0.22, 0.66, -0.2, 0.2]]
        .forEach(([x, y, z, r], i) => k(0.14, 0.14, 0.14, x, y, z, i % 2 ? t2 : t1, [r, 0, r]));
      break;
    case 'vuot': k(0.62, 0.16, 0.22, 0, 0.6, -0.21); k(0.36, 0.1, 0.12, 0.02, 0.61, 0.22, t1, [-0.35, 0, 0]); break;
    case 'dai':
      mai(); tocMai(); dai();
      for (const b of [-1, 1]) { k(0.08, 0.4, 0.4, b * 0.32, 0.35, -0.05); k(0.08, 0.45, 0.36, b * 0.32, -0.05, -0.08, t2); }
      break;
    case 'buoc':
      mai();
      for (const b of [-1, 1]) {
        k(0.1, 0.1, 0.1, b * 0.35, 0.3, -0.06, phu);
        [0.17, 0.03, -0.11, -0.25].forEach((y, i) => k(0.13, 0.15, 0.13, b * (0.37 + (i % 2) * 0.02), y, -0.06, i < 2 ? t1 : t2));
        k(0.08, 0.06, 0.08, b * 0.37, -0.35, -0.06, phu);
      }
      break;
    case 'duoi_ngua': mai(); tocMai(); k(0.12, 0.12, 0.1, 0, 0.5, -0.34, phu); k(0.17, 0.36, 0.15, 0, 0.3, -0.39); k(0.14, 0.24, 0.13, 0, 0.02, -0.41, t2); break;
    case 'bui': mai(); tocMai(); k(0.28, 0.26, 0.28, 0, 0.75, -0.18); k(0.3, 0.05, 0.3, 0, 0.64, -0.18, phu); break;
    case 'xoan':
      mai();
      for (const b of [-1, 1]) [0.42, 0.26, 0.1].forEach((y, i) => [0.1, -0.1, -0.25].forEach((z, j) => k(0.13, 0.13, 0.13, b * 0.34, y, z, (i + j) % 2 ? t2 : t1)));
      [-0.2, 0, 0.2].forEach((x, i) => { k(0.14, 0.14, 0.14, x, 0.3, -0.33, i % 2 ? t1 : t2); k(0.14, 0.14, 0.14, x, 0.12, -0.33, i % 2 ? t2 : t1); k(0.15, 0.12, 0.15, x, 0.68, -0.02 - i * 0.05); });
      break;
    case 'mai_bang':
      k(0.6, 0.13, 0.06, 0, 0.47, 0.27); dai();
      for (const b of [-1, 1]) { k(0.1, 0.4, 0.1, b * 0.3, 0.2, 0.18); k(0.08, 0.5, 0.36, b * 0.32, 0.25, -0.1); }
      break;
    default:
      mai(); tocMai();
      for (const b of [-1, 1]) { k(0.08, 0.24, 0.42, b * 0.32, 0.4, -0.04); k(0.08, 0.24, 0.42, b * 0.32, 0.16, -0.04, t2); }
      k(0.62, 0.3, 0.09, 0, 0.15, -0.29, t2);
      break;
  }
}

function phuKien(dau: THREE.Group, nh: Required<NgoaiHinh>) {
  const k = (w: number, h: number, d: number, mau: string, x: number, y: number, z: number, rz?: number) => { const mm = khoi(dau, w, h, d, mau, x, y, z, false); if (rz) mm.rotation.z = rz; return mm; };
  for (const pk of nh.phu_kien) {
    switch (pk) {
      case 'kinh':
        for (const b of [-1, 1]) {
          const x = b * 0.12;
          k(0.17, 0.024, 0.02, '#2b2b36', x, 0.29, 0.268); k(0.17, 0.024, 0.02, '#2b2b36', x, 0.14, 0.268);
          k(0.024, 0.15, 0.02, '#2b2b36', x - 0.073, 0.215, 0.268); k(0.024, 0.15, 0.02, '#2b2b36', x + 0.073, 0.215, 0.268);
        }
        k(0.07, 0.02, 0.02, '#2b2b36', 0, 0.26, 0.268);
        break;
      case 'tai_nghe':
        k(0.7, 0.06, 0.1, '#2d2f3a', 0, 0.7, 0);
        for (const b of [-1, 1]) { k(0.06, 0.4, 0.1, '#2d2f3a', b * 0.35, 0.5, 0); k(0.1, 0.2, 0.2, nh.phu, b * 0.36, 0.25, 0); }
        break;
      case 'sao': k(0.11, 0.11, 0.04, '#ffd45c', 0.22, 0.52, 0.29, 0.785); k(0.06, 0.06, 0.05, '#fff1b8', 0.22, 0.52, 0.29, 0.785); break;
      case 'hoa':
        for (const [x, y] of [[0, 0.06], [0, -0.06], [0.06, 0], [-0.06, 0]]) k(0.07, 0.07, 0.05, '#ff9ec4', -0.27 + x, 0.52 + y, 0.2);
        k(0.05, 0.05, 0.06, '#ffd45c', -0.27, 0.52, 0.21);
        break;
      case 'no':
        k(0.13, 0.11, 0.05, nh.phu, 0.1, 0.67, 0.08, 0.3); k(0.13, 0.11, 0.05, nh.phu, 0.24, 0.67, 0.08, -0.3);
        k(0.05, 0.06, 0.06, tron(nh.phu, '#000000', 0.25), 0.17, 0.67, 0.09);
        break;
      case 'kep': k(0.14, 0.035, 0.03, nh.phu, 0.2, 0.5, 0.3, -0.3); break;
      case 'khuyen': for (const b of [-1, 1]) k(0.04, 0.06, 0.04, '#ffd45c', b * 0.31, 0.1, 0.02); break;
      default: break;
    }
  }
}

export interface Hinh { goc: THREE.Group; than: THREE.Group; dau: THREE.Group; tay: THREE.Group[]; chan: THREE.Group[]; mat: THREE.Group[]; mieng: THREE.Group; moHoi: THREE.Mesh }
/** Character faces +z, origin on the floor. ngoi: seated on a chair, otherwise standing (legs on hip joints for walking). */
export function dungNguoi(ngoaiHinh: NgoaiHinh | undefined, ngoi: boolean): Hinh {
  const nh = chuanHoa(ngoaiHinh);
  const nam = nh.gioi === 'nam';
  const goc = new THREE.Group();
  const quan = nam ? '#3b4052' : tron(nh.phu, '#1d1b26', 0.55);
  const chan: THREE.Group[] = [];
  for (const x of [-0.11, 0.11]) {
    if (ngoi) {
      khoi(goc, 0.17, 0.16, 0.44, quan, x, 0.5, 0.2);
      khoi(goc, 0.16, 0.44, 0.16, quan, x, 0.27, 0.38);
      khoi(goc, 0.17, 0.08, 0.24, '#4a3a33', x, 0.04, 0.42);
    } else {
      const p = new THREE.Group(); p.position.set(x, 0.62, 0); goc.add(p);
      khoi(p, 0.17, 0.58, 0.17, quan, 0, -0.29, 0);
      khoi(p, 0.18, 0.08, 0.26, '#4a3a33', 0, -0.58, 0.04);
      chan.push(p);
    }
  }
  if (!nam) { if (ngoi) khoi(goc, 0.5, 0.1, 0.46, quan, 0, 0.58, 0.16); else khoi(goc, 0.52, 0.24, 0.36, quan, 0, 0.6, 0); }
  const hong = new THREE.Group(); hong.position.y = ngoi ? 0.52 : 0.64; goc.add(hong);
  const than = new THREE.Group(); hong.add(than);
  khoi(than, 0.46, 0.5, 0.3, nh.ao, 0, 0.25, 0);
  khoi(than, 0.47, 0.05, 0.31, tron(nh.ao, '#000000', 0.18), 0, 0.03, 0, false);
  khoi(than, 0.22, 0.05, 0.02, tron(nh.ao, '#ffffff', 0.5), 0, 0.475, 0.155, false);
  if (nam) khoi(than, 0.07, 0.3, 0.02, nh.phu, 0, 0.3, 0.158, false);
  else {
    for (const b of [-1, 1]) khoi(than, 0.08, 0.07, 0.03, nh.phu, b * 0.055, 0.43, 0.16, false);
    khoi(than, 0.04, 0.05, 0.035, tron(nh.phu, '#000000', 0.25), 0, 0.43, 0.165, false);
  }
  const tay = [-1, 1].map((b) => {
    const p = new THREE.Group(); p.position.set(b * 0.3, 0.45, 0); than.add(p);
    khoi(p, 0.13, 0.36, 0.14, nh.ao, 0, -0.16, 0);
    khoi(p, 0.12, 0.1, 0.12, DA, 0, -0.38, 0);
    return p;
  });
  const dau = new THREE.Group(); dau.position.y = 0.5; than.add(dau);
  khoi(dau, 0.56, 0.52, 0.5, DA, 0, 0.27, 0);
  const mat = [-1, 1].map((b) => {
    const g = new THREE.Group(); g.position.set(b * 0.12, 0.21, 0.252); dau.add(g);
    khoi(g, 0.1, 0.14, 0.01, nh.mat, 0, 0, 0, false);
    khoi(g, 0.1, 0.05, 0.016, tron(nh.mat, '#140f2a', 0.55), 0, 0.045, 0, false);
    khoi(g, 0.035, 0.035, 0.022, '#ffffff', -0.022, 0.025, 0, false);
    return g;
  });
  const may = tron(nh.toc, '#1a1018', 0.5);
  for (const b of [-1, 1]) {
    khoi(dau, nam ? 0.11 : 0.1, 0.022, 0.012, may, b * 0.12, 0.33, 0.252, false);
    khoi(dau, 0.08, 0.035, 0.01, '#ffb3c0', b * 0.19, 0.12, 0.252, false);
    khoi(dau, 0.04, 0.1, 0.08, '#ffd9c6', b * 0.29, 0.22, 0, false);
  }
  const mieng = new THREE.Group(); mieng.position.set(0, 0.085, 0.252); dau.add(mieng);
  khoi(mieng, 0.07, 0.022, 0.012, '#9c3d44', 0, 0, 0, false);
  toc(dau, nh);
  phuKien(dau, nh);
  const moHoi = khoi(dau, 0.06, 0.1, 0.06, '#9ad8ff', 0.34, 0.5, 0.16, false);
  moHoi.visible = false;
  return { goc, than, dau, tay, chan, mat, mieng, moHoi };
}
