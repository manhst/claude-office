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
export const IconState = (p: P) => <Svg {...p}><path d="M3 8h4l1.5-3 2 6L12 8h1" /></Svg>;
export const IconDot = (p: P) => <Svg {...p}><circle cx="8" cy="8" r="4" fill="currentColor" stroke="none" /></Svg>;
export const IconGrid = (p: P) => <Svg {...p}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></Svg>;
export const IconCube = (p: P) => <Svg {...p}><path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z" /><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6" /></Svg>;
