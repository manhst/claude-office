// @ts-nocheck
// Verbatim port of Phúc's VanphongAI nhan_vat.js (chibi SVG avatar + 20 presets MAU_SAN + chuanHoa). See ./NOTICE.
// Only change: the IIFE/window.NhanVat global became ES exports.

  let dem = 0;
  const DA = '#ffe4d4';

  function tronMau(hex, hex2, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(hex2.slice(1), 16);
    const kenh = (x, s) => (x >> s) & 255;
    const c = [16, 8, 0].map(s => Math.round(kenh(a, s) + (kenh(b, s) - kenh(a, s)) * t));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  const hopLe = (hex, macDinh) => (/^#[0-9a-f]{6}$/i.test(hex || '') ? hex : macDinh);

  const TOC_NAM = ['nhon', 'nam_gon', 'nam_roi', 'vuot'];
  const TOC_NU = ['ngan', 'dai', 'buoc', 'duoi_ngua', 'bui', 'xoan', 'mai_bang'];
  const TEN_KIEU_TOC = {
    ngan: 'Ngắn ngang vai', dai: 'Dài thẳng', buoc: 'Buộc hai bên', duoi_ngua: 'Đuôi ngựa', bui: 'Búi tó', xoan: 'Dài xoăn',
    mai_bang: 'Dài mái bằng', nhon: 'Tóc dựng', nam_gon: 'Ngắn gọn gàng', nam_roi: 'Tóc rối', vuot: 'Vuốt ngược',
  };
  const TEN_PHU_KIEN = { kinh: 'Kính', sao: 'Kẹp sao', tai_nghe: 'Tai nghe', hoa: 'Hoa cài', no: 'Nơ', kep: 'Kẹp tóc', khuyen: 'Khuyên tai' };

  const CAP = 'M42 64 Q38 18 80 16 Q122 18 118 64 Q113 46 101 41 Q80 35 59 41 Q47 46 42 64 Z ';
  const MAI = {
    thuong: CAP + 'M47 54 Q50 29 80 27 Q110 29 113 54 L107 46 L103 55 L96 44 L88 54 L82 42 L75 54 L68 44 L61 55 L56 46 Z',
    nhon: CAP + 'M45 56 Q47 27 80 23 Q113 27 115 56 L108 47 L105 57 L97 45 L91 56 L83 42 L77 56 L69 45 L63 57 L57 47 Z',
    gon: CAP + 'M45 57 Q44 26 80 23 Q115 25 116 52 Q107 38 90 38 Q70 40 61 50 Q54 56 45 57 Z',
    roi: CAP + 'M45 57 Q46 26 80 22 Q114 26 115 57 L109 45 L104 56 L99 41 L92 53 L86 38 L79 52 L72 39 L66 54 L58 42 L52 56 Z',
    vuot: 'M42 62 Q38 16 80 14 Q122 16 118 62 Q114 44 104 37 Q80 27 56 37 Q46 44 42 62 Z M49 46 Q53 24 80 21 Q107 24 111 46 Q99 33 80 32 Q61 33 49 46 Z',
    bang: CAP + 'M46 55 Q47 28 80 26 Q113 28 114 55 Z',
  };
  const SAU_DAI = 'M40 60 Q36 14 80 13 Q124 14 120 60 L125 132 Q104 126 98 106 L62 106 Q56 126 35 132 Z';
  const SAU_NGAN_GAY = 'M40 62 Q36 16 80 14 Q124 16 120 62 Q121 76 115 84 L45 84 Q39 76 40 62 Z';

  function kieuToc(kieu, f, nh) {
    const phu = nh.phu;
    switch (kieu) {
      case 'dai':
        return { sau: `<path d="${SAU_DAI}" fill="${f}"/>`, ben: `<path d="M44 58 Q40 82 46 108 L55 102 Q50 82 53 62 Z M116 58 Q120 82 114 108 L105 102 Q110 82 107 62 Z" fill="${f}"/>`, mai: MAI.thuong };
      case 'mai_bang':
        return { sau: `<path d="${SAU_DAI}" fill="${f}"/>`, ben: `<path d="M44 56 L44 104 L54 104 L54 60 Z M116 56 L116 104 L106 104 L106 60 Z" fill="${f}"/>`, mai: MAI.bang };
      case 'xoan':
        return {
          sau: `<path d="M40 60 Q34 14 80 13 Q126 14 120 60 Q129 74 121 88 Q131 102 122 116 Q129 128 118 134 L100 118 L60 118 L42 134 Q31 128 38 116 Q29 102 39 88 Q31 74 40 60 Z" fill="${f}"/>`,
          ben: `<path d="M44 58 Q37 72 45 84 Q38 96 47 108 L55 102 Q48 93 54 83 Q47 72 53 62 Z M116 58 Q123 72 115 84 Q122 96 113 108 L105 102 Q112 93 106 83 Q113 72 107 62 Z" fill="${f}"/>`,
          mai: MAI.thuong,
        };
      case 'buoc':
        return {
          sau: `<path d="M40 62 Q36 16 80 14 Q124 16 120 62 Q121 82 112 90 L48 90 Q39 82 40 62 Z" fill="${f}"/>`
            + `<ellipse cx="30" cy="84" rx="11" ry="27" transform="rotate(12 30 84)" fill="${f}"/><ellipse cx="130" cy="84" rx="11" ry="27" transform="rotate(-12 130 84)" fill="${f}"/>`,
          ben: '', mai: MAI.thuong,
          tren: `<circle cx="38" cy="58" r="4.5" fill="${phu}"/><circle cx="122" cy="58" r="4.5" fill="${phu}"/>`,
        };
      case 'duoi_ngua':
        return {
          sau: `<path d="${SAU_NGAN_GAY}" fill="${f}"/><path d="M108 30 Q140 34 138 72 Q137 104 118 128 Q127 96 119 68 Q115 50 104 42 Z" fill="${f}"/>`,
          ben: `<path d="M45 60 Q42 74 47 88 L54 85 Q50 72 52 62 Z M115 60 Q118 74 113 88 L106 85 Q110 72 108 62 Z" fill="${f}"/>`,
          mai: MAI.thuong, tren: `<circle cx="111" cy="34" r="4.5" fill="${phu}"/>`,
        };
      case 'bui':
        return {
          sau: `<circle cx="80" cy="15" r="15" fill="${f}"/><path d="${SAU_NGAN_GAY}" fill="${f}"/>`,
          ben: `<path d="M45 60 Q42 72 47 84 L54 81 Q50 70 52 62 Z M115 60 Q118 72 113 84 L106 81 Q110 70 108 62 Z" fill="${f}"/>`,
          mai: MAI.thuong, tren: `<ellipse cx="80" cy="27.5" rx="9.5" ry="3" fill="${phu}"/>`,
        };
      case 'nhon':
        return { sau: `<path d="M42 66 L33 52 L43 47 L37 31 L52 33 L54 17 L68 25 L80 10 L92 25 L106 17 L108 33 L123 31 L117 47 L127 52 L118 66 Z" fill="${f}"/>`, ben: '', mai: MAI.nhon };
      case 'nam_gon':
        return { sau: `<path d="M42 66 Q38 16 80 14 Q122 16 118 66 Q118 56 114 50 L46 50 Q42 56 42 66 Z" fill="${f}"/>`, ben: '', mai: MAI.gon };
      case 'nam_roi':
        return { sau: `<path d="M41 66 L35 54 L42 50 L37 36 L50 37 L51 22 L64 27 L71 12 L82 23 L94 12 L99 27 L112 22 L111 37 L124 37 L118 50 L125 55 L119 66 Z" fill="${f}"/>`, ben: '', mai: MAI.roi };
      case 'vuot':
        return { sau: `<path d="M42 66 Q38 13 80 11 Q122 13 118 66 Q118 52 113 45 L47 45 Q42 52 42 66 Z" fill="${f}"/>`, ben: '', mai: MAI.vuot };
      default: // ngan
        return {
          sau: `<path d="M40 62 Q36 16 80 14 Q124 16 120 62 Q122 86 113 95 L47 95 Q38 86 40 62 Z" fill="${f}"/>`,
          ben: `<path d="M44 58 Q41 78 47 94 L55 90 Q51 76 53 62 Z M116 58 Q119 78 113 94 L105 90 Q109 76 107 62 Z" fill="${f}"/>`,
          mai: MAI.thuong,
        };
    }
  }

  // Mắt có "mí" để nhân viên lờ đờ khi mệt: mí trượt xuống, bị cắt gọn trong tròng mắt.
  function mat(cx, uid, gioi) {
    const ry = gioi === 'nam' ? 8.6 : 9.6;
    const cid = `${uid}-cm${cx}`;
    const trai = cx < 80;
    const mi = `<g class="mi"><rect x="-10" y="${(-ry - 14).toFixed(1)}" width="20" height="14" fill="${DA}"/>`
      + `<path d="M-9.5 ${(-ry).toFixed(1)} Q0 ${(-ry + 1.6).toFixed(1)} 9.5 ${(-ry).toFixed(1)}" stroke="#2a1d1d" stroke-width="2" fill="none" stroke-linecap="round"/></g>`;
    const mi_mat = gioi === 'nam'
      ? `<path d="M-8.6 ${(-ry + 1).toFixed(1)} Q0 ${(-ry - 3.4).toFixed(1)} 8.6 ${(-ry + 1).toFixed(1)}" stroke="#2a1d1d" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
      : `<path d="M-9 ${(-ry + 2).toFixed(1)} Q0 ${(-ry - 3).toFixed(1)} 9 ${(-ry + 2).toFixed(1)}" stroke="#2a1d1d" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
        + `<path d="M${trai ? -9 : 9} ${(-ry + 2).toFixed(1)} l${trai ? -3.2 : 3.2} -2.6" stroke="#2a1d1d" stroke-width="2" stroke-linecap="round"/>`;
    // Vị trí đặt ở nhóm ngoài: animation chớp mắt (CSS transform) sẽ ghi đè transform của chính nhóm .mat.
    return `<g transform="translate(${cx} 68)"><g class="mat">
      <clipPath id="${cid}"><ellipse rx="8.2" ry="${ry}"/></clipPath>
      <g clip-path="url(#${cid})">
        <ellipse rx="8.2" ry="${ry}" fill="#fff"/>
        <ellipse rx="6.6" ry="${ry - 1}" cy="0.6" fill="url(#${uid}-mat)"/>
        <ellipse rx="3.1" ry="${(ry * 0.44).toFixed(1)}" cy="1.4" fill="#1d1630"/>
        <circle cx="-2.6" cy="-3.4" r="2.5" fill="#fff"/>
        <circle cx="2.6" cy="3.6" r="1.2" fill="#fff" opacity=".9"/>
        ${mi}
      </g>
      ${mi_mat}
    </g></g>`;
  }

  function chanMay(gioi, mauMay) {
    const d = gioi === 'nam' ? 'M57 54.5 Q65 51.5 73 53.5 M87 53.5 Q95 51.5 103 54.5' : 'M58 54 Q65 50.5 72 52.5 M88 52.5 Q95 50.5 102 54';
    return `<path d="${d}" stroke="${mauMay}" stroke-width="${gioi === 'nam' ? 2.8 : 1.7}" fill="none" stroke-linecap="round"/>`;
  }

  function trangPhuc(nh) {
    const phuToi = tronMau(nh.phu, '#000000', 0.25);
    const phuKien = nh.gioi === 'nam'
      ? `<path d="M78 106 L82 106 L83.6 113 L80 128 L76.4 113 Z" fill="${nh.phu}"/><path d="M77.5 104.5 L82.5 104.5 L81.5 108 L78.5 108 Z" fill="${phuToi}"/>`
      : `<path d="M80 109 L71.5 104.5 L72 113.5 Z M80 109 L88.5 104.5 L88 113.5 Z" fill="${nh.phu}"/><circle cx="80" cy="109" r="2.4" fill="${phuToi}"/>`;
    return `<rect x="73" y="90" width="14" height="13" rx="4" fill="#f4c7b1"/>
      <path d="M50 138 Q50 106 80 102 Q110 106 110 138 Z" fill="${nh.ao}"/>
      <path d="M68 104 L80 117 L92 104 L86 102 L80 110 L74 102 Z" fill="#fff"/>${phuKien}`;
  }

  function phuKien(ds, nh) {
    const sang = tronMau(nh.phu, '#ffffff', 0.45), toi = tronMau(nh.phu, '#000000', 0.25);
    return (ds || []).map((pk) => {
      switch (pk) {
        case 'kinh':
          return `<g fill="rgba(255,255,255,.14)" stroke="#3a2f2a" stroke-width="2">
            <rect x="54" y="59" width="22" height="18" rx="7"/><rect x="84" y="59" width="22" height="18" rx="7"/>
            <path d="M76 66 Q80 63 84 66" fill="none"/></g>`;
        case 'sao':
          return `<path d="M107 27 Q109 36 118 38 Q109 40 107 49 Q105 40 96 38 Q105 36 107 27 Z" fill="#ffd45c" stroke="#f2a93b" stroke-width="1"/>
            <path d="M97 25 Q98 29 102 30 Q98 31 97 35 Q96 31 92 30 Q96 29 97 25 Z" fill="#fff3b8"/>`;
        case 'tai_nghe':
          return `<path d="M40 66 Q39 11 80 11 Q121 11 120 66" stroke="#2f3140" stroke-width="5" fill="none" stroke-linecap="round"/>
            <rect x="32" y="57" width="13" height="23" rx="6" fill="${nh.phu}"/><rect x="115" y="57" width="13" height="23" rx="6" fill="${nh.phu}"/>`;
        case 'hoa':
          return `<g transform="translate(53 35)">${[0, 72, 144, 216, 288].map(g => `<circle r="4.2" cx="0" cy="-5" transform="rotate(${g})" fill="#ffb3c7"/>`).join('')}
            <circle r="3" fill="#ffe27a"/></g>`;
        case 'no':
          return `<g transform="translate(105 31) rotate(15)"><path d="M0 0 L-10 -6.5 L-10 6.5 Z M0 0 L10 -6.5 L10 6.5 Z" fill="${nh.phu}"/><circle r="2.8" fill="${toi}"/></g>`;
        case 'kep':
          return `<g transform="translate(55 41) rotate(-25)"><rect x="-7" y="-1.6" width="14" height="3.2" rx="1.6" fill="${nh.phu}"/><rect x="-6" y="3" width="12" height="3" rx="1.5" fill="${sang}"/></g>`;
        case 'khuyen':
          return '<circle cx="46" cy="75.5" r="2.4" fill="#f5c542" stroke="#d9a520" stroke-width=".8"/><circle cx="114" cy="75.5" r="2.4" fill="#f5c542" stroke="#d9a520" stroke-width=".8"/>';
        default:
          return '';
      }
    }).join('');
  }

  function ban(loai) {
    if (loai === 'quay') {
      return `<rect x="6" y="118" width="148" height="50" rx="10" class="quay"/>
        <rect x="6" y="118" width="148" height="8" rx="4" class="quay-mat"/>
        <rect x="20" y="108" width="26" height="12" rx="2" fill="#fff" transform="rotate(-6 33 114)"/>
        <rect x="22" y="104" width="26" height="12" rx="2" fill="#f4f1ea" transform="rotate(4 35 110)"/>
        <path d="M118 117 a9 9 0 0 1 18 0 z" fill="#f5c542"/><rect x="115" y="116" width="24" height="3.5" rx="1.75" fill="#d9a520"/>
        <circle cx="127" cy="106.5" r="2" fill="#d9a520"/>
        <circle cx="62" cy="121" r="6" class="tay tay-trai"/><circle cx="98" cy="121" r="6" class="tay tay-phai"/>`;
    }
    return `<rect x="14" y="121" width="132" height="12" rx="5" class="ban-mat"/>
      <rect x="20" y="131" width="120" height="37" rx="3" class="ban-than"/>
      <rect x="61" y="96" width="38" height="27" rx="3.5" class="laptop"/>
      <circle cx="80" cy="109.5" r="3.6" class="laptop-logo"/>
      <path d="M55 125 L105 125 L101 121 L59 121 Z" class="laptop-de"/>
      <g class="coc"><rect x="116" y="108" width="12" height="14" rx="2.5" fill="#fff"/>
        <path d="M128 111 q5 0 5 4 q0 4 -5 4" fill="none" stroke="#fff" stroke-width="2"/>
        <path class="khoi" d="M120 104 q-2 -4 0 -7 M124 104 q2 -4 0 -7" stroke="#bdb6ad" stroke-width="1.5" fill="none" stroke-linecap="round"/></g>
      <circle cx="56" cy="122" r="6" class="tay tay-trai"/><circle cx="104" cy="122" r="6" class="tay tay-phai"/>`;
  }

  function chuanHoa(nhGoc) {
    const nh = Object.assign({}, nhGoc || {});
    nh.kieu_toc = TEN_KIEU_TOC[nh.kieu_toc] ? nh.kieu_toc : 'ngan';
    nh.gioi = nh.gioi === 'nam' || nh.gioi === 'nu' ? nh.gioi : (TOC_NAM.includes(nh.kieu_toc) ? 'nam' : 'nu');
    nh.toc = hopLe(nh.toc, '#6b5b95');
    nh.toc2 = hopLe(nh.toc2, tronMau(nh.toc, '#ffffff', 0.25));
    nh.mat = hopLe(nh.mat, '#5b6cff');
    nh.ao = hopLe(nh.ao, '#f0ebe4');
    nh.phu = hopLe(nh.phu, nh.mat);
    return nh;
  }

  function ve(nv) {
    const nh = chuanHoa(nv.ngoai_hinh);
    const uid = 'nv' + (++dem);
    const f = `url(#${uid}-toc)`;
    const toc = kieuToc(nh.kieu_toc, f, nh);
    const tre = (-Math.random() * 5).toFixed(2);

    return `<svg class="svg-nv" viewBox="0 0 160 170" style="--tre:${tre}s" aria-hidden="true">
  <defs>
    <linearGradient id="${uid}-toc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${nh.toc}"/><stop offset="1" stop-color="${nh.toc2}"/></linearGradient>
    <linearGradient id="${uid}-mat" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${tronMau(nh.mat, '#140f2a', 0.55)}"/><stop offset=".55" stop-color="${nh.mat}"/><stop offset="1" stop-color="${tronMau(nh.mat, '#ffffff', 0.55)}"/>
    </linearGradient>
  </defs>
  <g class="nguoi">
    ${toc.sau}
    ${trangPhuc(nh)}
    <ellipse cx="46" cy="66" rx="5" ry="7" fill="#ffd9c6"/><ellipse cx="114" cy="66" rx="5" ry="7" fill="#ffd9c6"/>
    <path d="M46 62 Q46 28 80 28 Q114 28 114 62 Q114 86 97 94 Q80 101 63 94 Q46 86 46 62 Z" fill="${DA}"/>
    <ellipse cx="56" cy="81" rx="6.2" ry="3.4" fill="#ff9eae" opacity=".5"/><ellipse cx="104" cy="81" rx="6.2" ry="3.4" fill="#ff9eae" opacity=".5"/>
    <g class="quang-tham"><ellipse cx="65" cy="79.5" rx="6" ry="1.6" fill="#8a6bb5"/><ellipse cx="95" cy="79.5" rx="6" ry="1.6" fill="#8a6bb5"/></g>
    ${chanMay(nh.gioi, tronMau(nh.toc, '#1a1018', 0.5))}
    ${mat(65, uid, nh.gioi)}${mat(95, uid, nh.gioi)}
    <path d="M79 78.5 L80.5 79.5" stroke="#e7a58f" stroke-width="1.6" stroke-linecap="round"/>
    <g class="mieng">
      <path class="mieng-dong" d="M75.5 86 Q80 89.5 84.5 86" stroke="#9c3d44" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path class="mieng-met" d="M74.5 87.5 q2.75 -2.2 5.5 0 t5.5 0" stroke="#9c3d44" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <path class="mieng-mo" d="M75 85 Q80 85 85 85 Q84 92 80 92 Q76 92 75 85 Z" fill="#b8444f"/>
    </g>
    ${toc.ben}
    <path d="${toc.mai}" fill="${f}"/>
    <path d="M58 33 Q80 24 102 33" stroke="#fff" stroke-opacity=".38" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${toc.tren || ''}
    ${phuKien(nh.phu_kien, nh)}
    <path class="mo-hoi" d="M112 42 q5 7 0 10.5 q-5 -3.5 0 -10.5 Z" fill="#9ad8ff" stroke="#5bb8f0" stroke-width=".8"/>
    <g class="hon" fill="#fff" stroke="#cfd6e6" stroke-width=".8"><ellipse cx="91" cy="93" rx="3.4" ry="2.6"/><ellipse cx="98" cy="86" rx="4.4" ry="3.3"/><ellipse cx="106" cy="77" rx="5.6" ry="4.2"/></g>
    <g class="zzz" font-family="sans-serif" font-weight="800" fill="#8f9bff"><text x="114" y="40" font-size="14">Z</text><text x="125" y="27" font-size="11">z</text><text x="134" y="17" font-size="8">z</text></g>
    <g class="lap-lanh">
      <path d="M24 34 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 Z" fill="#ffd45c"/>
      <path d="M138 22 l1.5 4.5 4.5 1.5 -4.5 1.5 -1.5 4.5 -1.5 -4.5 -4.5 -1.5 4.5 -1.5 Z" fill="#ffd45c"/>
      <path d="M134 60 l1.2 3.6 3.6 1.2 -3.6 1.2 -1.2 3.6 -1.2 -3.6 -3.6 -1.2 3.6 -1.2 Z" fill="#9fe8ff"/>
    </g>
    <g class="choang"><path d="M80 4 a7 7 0 1 1 -7 7 a4.5 4.5 0 1 1 4.5 -4.5" stroke="#7a7f99" stroke-width="2.2" fill="none" stroke-linecap="round"/></g>
  </g>
  <g class="ban">${ban(nh.ban)}</g>
</svg>`;
  }

  // 20 mẫu có sẵn: chọn là xong, không cần vẽ thêm.
  const m = (id, gioi, ten, kieu_toc, toc, toc2, mat, ao, phu, phu_kien) => ({ id, gioi, ten, ngoai_hinh: { gioi, kieu_toc, toc, toc2, mat, ao, phu, phu_kien } });
  const MAU_SAN = [
    m('nam_01', 'nam', 'Coder kính cận', 'nam_gon', '#2b2b33', '#4a4a58', '#5a4632', '#e9eef5', '#3b6fd1', ['kinh']),
    m('nam_02', 'nam', 'Tóc dựng năng động', 'nhon', '#4f6bff', '#a07bff', '#3d5afe', '#ebe8ff', '#4f6bff', ['tai_nghe']),
    m('nam_03', 'nam', 'Vest lịch lãm', 'vuot', '#1d1d24', '#3a3a48', '#6b4a2e', '#2f3550', '#c0392b', []),
    m('nam_04', 'nam', 'Tóc rối tinh nghịch', 'nam_roi', '#c8643f', '#e9925f', '#b4532a', '#fff4e6', '#e67e22', []),
    m('nam_05', 'nam', 'Bạch kim lạnh lùng', 'nhon', '#e8e9f2', '#b9bdd6', '#4aa3df', '#1f2a44', '#4aa3df', ['khuyen']),
    m('nam_06', 'nam', 'Xanh lá thư thái', 'nam_roi', '#2e8b57', '#7ccf9a', '#2e7d4f', '#effaf3', '#2e8b57', ['tai_nghe']),
    m('nam_07', 'nam', 'Học giả tóc nâu', 'nam_gon', '#6b4423', '#9a6a3f', '#6b4423', '#f5efe6', '#8e5a2b', ['kinh']),
    m('nam_08', 'nam', 'Tóc đỏ nhiệt huyết', 'nhon', '#d63a3a', '#ff8a65', '#c62828', '#ffffff', '#d63a3a', []),
    m('nam_09', 'nam', 'Tím bí ẩn', 'vuot', '#5b3c88', '#9b6fd6', '#7e57c2', '#2b2440', '#9b6fd6', ['khuyen']),
    m('nam_10', 'nam', 'Vàng nắng vui vẻ', 'nam_roi', '#f2c14e', '#ffe08a', '#e09f1f', '#eaf4ff', '#3b82f6', ['kep']),
    m('nu_01', 'nu', 'Tím mộng mơ', 'dai', '#86a8ff', '#c39bff', '#5b6cff', '#33406f', '#c39bff', ['sao']),
    m('nu_02', 'nu', 'Tóc cam kính tròn', 'ngan', '#c8643f', '#e9925f', '#b4532a', '#f4e7da', '#d97757', ['kinh']),
    m('nu_03', 'nu', 'Hai bím xanh ngọc', 'buoc', '#2d2d34', '#169c7c', '#10a37f', '#e6f6f0', '#10a37f', ['hoa']),
    m('nu_04', 'nu', 'Đuôi ngựa hồng', 'duoi_ngua', '#ff8fb1', '#ffc2d4', '#e0558a', '#fff0f5', '#e0558a', ['no']),
    m('nu_05', 'nu', 'Búi tóc thanh lịch', 'bui', '#23232b', '#45455a', '#5a3e2b', '#f2efe9', '#b23a48', ['khuyen']),
    m('nu_06', 'nu', 'Xoăn nâu ấm áp', 'xoan', '#7a4a2a', '#b07a4f', '#7a4a2a', '#fdf3e7', '#c06c3e', ['hoa']),
    m('nu_07', 'nu', 'Bob bạc hà', 'ngan', '#7fd6c2', '#c3f0e6', '#1fa38a', '#eefaf7', '#1fa38a', ['kep']),
    m('nu_08', 'nu', 'Mái bằng truyền thống', 'mai_bang', '#18181f', '#3a3a4a', '#3b2f2f', '#fbe9ec', '#d6336c', ['no']),
    m('nu_09', 'nu', 'Đuôi ngựa thể thao', 'duoi_ngua', '#f5c84c', '#ffe9a3', '#d48806', '#eaf3ff', '#3b82f6', ['tai_nghe']),
    m('nu_10', 'nu', 'Hai bím đỏ dâu', 'buoc', '#d6455d', '#ff8da1', '#c2185b', '#ffffff', '#d6455d', ['no']),
  ];

export { ve, chuanHoa, MAU_SAN, TOC_NAM, TOC_NU, TEN_KIEU_TOC, TEN_PHU_KIEN };
