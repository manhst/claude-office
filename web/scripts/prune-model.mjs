// One-off asset prep (not run in CI): node prune-model.mjs <UAL1_Standard.glb> <out.glb>
// Needs: npm i --no-save @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions
// Keeps the 5 clips the office uses, drops orphaned animation data, then resamples, dedups and quantizes.
import { NodeIO } from '@gltf-transform/core';
import { prune, resample, dedup, quantize } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const keep = new Set(['Idle_Loop','Walk_Loop','Sitting_Idle_Loop','Sitting_Talking_Loop','Idle_Talking_Loop']);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
for (const a of doc.getRoot().listAnimations()) if (!keep.has(a.getName())) { const ss=a.listSamplers(); a.listChannels().forEach(c=>c.dispose()); ss.forEach(s=>{const i=s.getInput(),o=s.getOutput(); s.dispose(); [i,o].forEach(x=>x&&x.listParents().length<=1&&x.dispose());}); a.dispose(); }
for (const a of doc.getRoot().listAccessors()) if (a.listParents().length===1) a.dispose();
await doc.transform(resample(), dedup(), prune(), quantize(), prune());
await io.write(process.argv[3], doc);
console.log(doc.getRoot().listAnimations().map(a=>a.getName()), doc.getRoot().listMeshes().length);
