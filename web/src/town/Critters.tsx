// Flat SVG drawings for the town: crocodile, dog, cat. Same flat style as the UI icons.
export const CrocSvg = ({ open }: { open?: boolean }) => (
  <svg viewBox="0 0 120 44" width="96" height="35" aria-hidden="true">
    <path d="M6 26c10-10 30-12 52-10l26-4 30 4-6 5 6 4-30 3-26-2c-22 4-40 4-52 0z" fill="#3f7d3a" />
    {[24, 38, 52, 66].map((x) => <path key={x} d={`M${x} 17l4-6 4 6z`} fill="#2f6a2c" />)}
    <circle cx="82" cy="13" r="3.2" fill="#e8f5c8" /><circle cx="82.8" cy="13" r="1.4" fill="#1b2a18" />
    {open ? <path d="M84 21l32-14-4 9 4 12-32-3z" fill="#b33b3b" stroke="#2f6a2c" strokeWidth="2" /> : <path d="M86 22h28" stroke="#24521f" strokeWidth="1.6" />}
  </svg>
);
export const DogSvg = () => (
  <svg viewBox="0 0 48 36" width="44" height="33" aria-hidden="true">
    <path d="M8 18h24a6 6 0 0 1 6 6v4H6v-4a6 6 0 0 1 2-6z" fill="#c98a4b" /><rect x="8" y="27" width="4" height="8" rx="2" fill="#a86f38" /><rect x="28" y="27" width="4" height="8" rx="2" fill="#a86f38" />
    <path d="M6 20c-4-2-5-6-3-9" stroke="#a86f38" strokeWidth="3" strokeLinecap="round" fill="none" className="tail" />
    <circle cx="36" cy="14" r="8" fill="#d9a066" /><path d="M30 8l-3 9 5-3zM40 7l5 8-6-2z" fill="#8a5a2b" /><path d="M41 16h6a2 2 0 0 1-2 3h-4z" fill="#d9a066" />
    <circle cx="46.5" cy="16" r="1.4" fill="#222" /><circle cx="38" cy="12" r="1.3" fill="#222" />
  </svg>
);
export const CatSvg = () => (
  <svg viewBox="0 0 44 34" width="38" height="30" aria-hidden="true">
    <path d="M30 26c6 0 10-6 8-12" stroke="#5b6473" strokeWidth="3" strokeLinecap="round" fill="none" className="tail" />
    <ellipse cx="22" cy="24" rx="11" ry="8" fill="#7b8494" /><circle cx="12" cy="13" r="7.5" fill="#8c95a5" />
    <path d="M6 9l1-7 5 5zM13 6l5-4 0 7z" fill="#7b8494" /><circle cx="9.5" cy="12.5" r="1.3" fill="#d7f56b" /><circle cx="14.5" cy="12.5" r="1.3" fill="#d7f56b" />
    <path d="M12 15.5l-1 1h2z" fill="#f08aa0" /><path d="M3 15h5M3 17.5h5M16 15h5M16 17.5h5" stroke="#d8dce4" strokeWidth=".7" />
  </svg>
);
