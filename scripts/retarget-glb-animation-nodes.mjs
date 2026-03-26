#!/usr/bin/env node
/**
 * After merging per-animation GLBs, clips often still target duplicate armature node indices.
 * Only the first skeleton drives the visible skin — other clips animate invisible copies → model looks static.
 *
 * Usage:
 *   node scripts/retarget-glb-animation-nodes.mjs <input.glb> <output.glb> [--ref "Armature|walking_man|baselayer"]
 *
 * Rewrites every animation channel's target.node to match the reference clip's node index for the same bone name.
 */
import fs from "fs";

function readGlb(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error("Not a GLB");
  let o = 12;
  let json = null;
  let bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o);
    const type = buf.subarray(o + 4, o + 8).toString("ascii");
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "JSON") json = JSON.parse(data.toString("utf8").replace(/\0/g, ""));
    else if (type === "BIN\u0000") bin = Buffer.from(data);
    o += 8 + len;
  }
  if (!json) throw new Error("No JSON chunk");
  return { json, bin: bin ?? Buffer.alloc(0) };
}

function padJson(jsonBuf) {
  const pad = (4 - (jsonBuf.length % 4)) % 4;
  return pad ? Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]) : jsonBuf;
}

function padBin(binBuf) {
  const pad = (4 - (binBuf.length % 4)) % 4;
  return pad ? Buffer.concat([binBuf, Buffer.alloc(pad, 0)]) : binBuf;
}

function writeGlb(json, bin) {
  const jsonBuf = padJson(Buffer.from(JSON.stringify(json), "utf8"));
  const binBuf = padBin(bin);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); // glTF
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let o = 12;
  out.writeUInt32LE(jsonBuf.length, o);
  out.write("JSON", o + 4);
  jsonBuf.copy(out, o + 8);
  o += 8 + jsonBuf.length;
  out.writeUInt32LE(binBuf.length, o);
  out.write("BIN\u0000", o + 4);
  binBuf.copy(out, o + 8);
  return out;
}

function buildRefNameToNode(json, refAnimName) {
  const anim = json.animations?.find((a) => a.name === refAnimName);
  if (!anim) throw new Error(`Reference animation not found: ${refAnimName}`);
  const nodes = json.nodes;
  const map = new Map();
  for (const ch of anim.channels ?? []) {
    const idx = ch.target?.node;
    if (idx == null) continue;
    const name = nodes[idx]?.name;
    if (name == null) continue;
    if (!map.has(name)) map.set(name, idx);
  }
  return map;
}

function retarget(json, refNameToNode) {
  const nodes = json.nodes;
  let nFixed = 0;
  let nMissing = 0;
  for (const anim of json.animations ?? []) {
    for (const ch of anim.channels ?? []) {
      const old = ch.target?.node;
      if (old == null) continue;
      const name = nodes[old]?.name;
      if (name == null) continue;
      const nu = refNameToNode.get(name);
      if (nu === undefined) {
        nMissing++;
        continue;
      }
      if (nu !== old) nFixed++;
      ch.target.node = nu;
    }
  }
  return { nFixed, nMissing };
}

const argv = process.argv.slice(2);
let refName = "Armature|walking_man|baselayer";
const refIdx = argv.indexOf("--ref");
if (refIdx >= 0 && argv[refIdx + 1]) {
  refName = argv[refIdx + 1];
  argv.splice(refIdx, 2);
}
const [inputPath, outputPath] = argv;
if (!inputPath || !outputPath) {
  console.error(
    "Usage: node scripts/retarget-glb-animation-nodes.mjs <in.glb> <out.glb> [--ref clipName]",
  );
  process.exit(1);
}

const { json, bin } = readGlb(inputPath);
const refMap = buildRefNameToNode(json, refName);
const { nFixed, nMissing } = retarget(json, refMap);
fs.writeFileSync(outputPath, writeGlb(json, bin));
console.log(`Wrote ${outputPath} — retargeted ${nFixed} channel node indices; ${nMissing} unresolved bone names.`);
