// Phúc's chibi SVG avatar (office3d/avatars.ts), cropped to head and shoulders. Markup comes only from preset data
// (colours pass the reference's hex check), never from user text.
import { memo } from 'react';
import { PRESETS as RAW, drawAvatar } from '../office3d/avatars';
export interface Preset { id: string; gender: 'male' | 'female'; name: string; appearance: Record<string, unknown> }
export const PRESETS = RAW as Preset[];
const cache = new Map<string, string>();
export function chibiSvg(id: string): string | undefined {
  if (cache.has(id)) return cache.get(id);
  const p = PRESETS.find((x) => x.id === id); if (!p) return undefined;
  const svg = (drawAvatar({ appearance: p.appearance }) as string).replace('viewBox="0 0 160 170"', 'viewBox="30 8 100 100"').replace(/<g class="desk">[\s\S]*<\/g>\s*<\/svg>\s*$/, '</svg>');
  cache.set(id, svg); return svg;
}
export const Chibi = memo(function Chibi({ id, size = 40 }: { id: string; size?: number }) {
  const svg = chibiSvg(id);
  return svg ? <span className="chibi" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} /> : null;
});
