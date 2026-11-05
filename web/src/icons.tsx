// Flat inline SVG icons (no emoji in the UI). 16px grid, currentColor stroke.
import type { ReactNode, SVGProps } from 'react';
type P = SVGProps<SVGSVGElement> & { size?: number };
const Svg = ({ size = 14, children, ...p }: P & { children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon" {...p}>{children}</svg>
);
export const IconTool = (p: P) => <Svg {...p}><path d="M10.5 2.5a3 3 0 0 0-3.7 3.9L2.5 10.7a1.4 1.4 0 0 0 2 2l4.3-4.3a3 3 0 0 0 3.9-3.7l-1.9 1.9-1.6-.4-.4-1.6z" /></Svg>;
export const IconMail = (p: P) => <Svg {...p}><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.5 4.5 5.5 4 5.5-4" /></Svg>;
export const IconReply = (p: P) => <Svg {...p}><path d="M6 4 2.5 7.5 6 11" /><path d="M3 7.5h6.5a4 4 0 0 1 4 4V13" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m3 8.5 3.2 3L13 4.5" /></Svg>;
export const IconCross = (p: P) => <Svg {...p}><path d="m4 4 8 8M12 4l-8 8" /></Svg>;
export const IconCall = (p: P) => <Svg {...p}><path d="M5 3.5v9l7-4.5z" /></Svg>;
export const IconResult = (p: P) => <Svg {...p}><path d="M13 8H3.5M7 4.5 3.5 8 7 11.5" /></Svg>;
export const IconWarn = (p: P) => <Svg {...p}><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3M8 11.3v.2" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M8 3v10M3 8h10" /></Svg>;
export const IconDot = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="4" fill="currentColor" stroke="none" /></Svg>;
export const IconTerminal = (p: P) => <Svg {...p}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="m4.5 6.5 2 1.5-2 1.5M8 10h3" /></Svg>;
export const IconUser = (p: P) => <Svg {...p}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5a5 5 0 0 1 10 0" /></Svg>;
export const IconFile = (p: P) => <Svg {...p}><path d="M4 2h5.5L12 4.5V14H4z" /><path d="M9.5 2v2.5H12" /></Svg>;
export const IconBranch = (p: P) => <Svg {...p}><circle cx="5" cy="3.5" r="1.5" /><circle cx="5" cy="12.5" r="1.5" /><circle cx="11" cy="6.5" r="1.5" /><path d="M5 5v6M11 8c0 2-3 2-6 3" /></Svg>;
export const IconEdit = (p: P) => <Svg {...p}><path d="M10.5 2.5 13.5 5.5 6 13H3v-3z" /><path d="m9 4 3 3" /></Svg>;
export const IconCroc = (p: P) => <Svg {...p}><path d="M1.5 9.5c2-2 5-2.5 8-2l4.5-1.5-1 2.5 1 1.5-4.5-.5c-3 1.5-6 1.5-8 0z" /><circle cx="8.5" cy="7" r=".6" fill="currentColor" stroke="none" /></Svg>;
