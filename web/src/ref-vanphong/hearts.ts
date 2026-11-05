// Flat SVG heart pops for the garden affair (not emoji chrome). CSS2D particles that float up and fade.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

const SVG = '<svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M8 13.8C3.2 10.2 1.2 7.6 1.2 5.3 1.2 3.2 2.9 1.8 4.9 1.8c1.1 0 2.1.5 2.9 1.4C8.6 2.3 9.6 1.8 10.7 1.8c2 0 3.7 1.4 3.7 3.5 0 2.3-2 4.9-6.4 8.5z"/></svg>';

export class HeartFX {
  private last = 0;
  constructor(private parent: THREE.Object3D) {}
  /** Spawn a few hearts above (x,z). Rate-limited so screenshots stay readable. */
  burst(x: number, z: number, now: number, force = false) {
    if (!force && now - this.last < 700) return;
    this.last = now;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const div = document.createElement('div');
      div.className = 'vp-heart';
      div.style.color = ['#e11d48', '#f43f5e', '#fb7185', '#be123c'][i % 4];
      div.style.setProperty('--dx', `${(Math.random() - 0.5) * 28}px`);
      div.style.setProperty('--delay', `${i * 90}ms`);
      div.innerHTML = SVG;
      const o = new CSS2DObject(div);
      o.center.set(0.5, 0.5);
      o.position.set(x + (Math.random() - 0.5) * 0.35, 1.6 + Math.random() * 0.25, z + (Math.random() - 0.5) * 0.35);
      this.parent.add(o);
      setTimeout(() => { this.parent.remove(o); div.remove(); }, 1600);
    }
  }
}
