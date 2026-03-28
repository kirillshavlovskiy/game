#!/usr/bin/env node
/**
 * Normalize all skeleton.glb animation clips so every clip's Hips bone
 * starts at the same position as Idle_11's first frame.
 *
 * Problem: each Meshy animation was exported with the Hips at a different
 * origin, so switching clips causes the skeleton to visually jump.
 *
 * Strategy:
 *   1. Read Idle_11 first-frame Hips translation → reference position
 *   2. For every "upright-start" clip, shift ALL Hips translation keyframes
 *      by (reference − clip_frame0) so frame 0 aligns with Idle_11
 *   3. For falling_down: normalize start to reference (skeleton falls from standing)
 *   4. For Stand_Up1 / Arise: normalize start to where normalized falling_down ENDS
 *      (skeleton rises from the ground)
 *   5. Write patched skeleton.glb
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLB_PATH = path.join(__dirname, "..", "public", "models", "monsters", "skeleton.glb");

function readGlb(filepath) {
  const buf = fs.readFileSync(filepath);
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error("Not a GLB");
  let o = 12, json = null, bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o);
    const type = buf.subarray(o + 4, o + 8).toString("ascii");
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "JSON") json = JSON.parse(data.toString("utf8").replace(/\0/g, ""));
    else if (type === "BIN\x00") bin = Buffer.from(data);
    o += 8 + len;
  }
  return { json, bin };
}

function writeGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonPadded = jsonPad ? Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]) : jsonBuf;
  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = binPad ? Buffer.concat([bin, Buffer.alloc(binPad, 0)]) : bin;
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let off = 12;
  out.writeUInt32LE(jsonPadded.length, off);
  out.write("JSON", off + 4);
  jsonPadded.copy(out, off + 8);
  off += 8 + jsonPadded.length;
  out.writeUInt32LE(binPadded.length, off);
  out.write("BIN\x00", off + 4);
  binPadded.copy(out, off + 8);
  return out;
}

/** Read a VEC3 at keyframe index `i` from the output accessor of a sampler. */
function readVec3(json, bin, accIdx, i) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * 12;
  return [bin.readFloatLE(base), bin.readFloatLE(base + 4), bin.readFloatLE(base + 8)];
}

/** Write a VEC3 at keyframe index `i`. */
function writeVec3(json, bin, accIdx, i, xyz) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * 12;
  bin.writeFloatLE(xyz[0], base);
  bin.writeFloatLE(xyz[1], base + 4);
  bin.writeFloatLE(xyz[2], base + 8);
}

function getKeyframeCount(json, accIdx) {
  return json.accessors[accIdx].count;
}

/** Find the Hips translation channel in an animation, return { sampler, outputAccIdx, count }. */
function findHipsTransChannel(json, anim, hipsNodeIdx) {
  for (const ch of anim.channels) {
    if (ch.target.node === hipsNodeIdx && ch.target.path === "translation") {
      const sampler = anim.samplers[ch.sampler];
      return {
        sampler,
        outputAccIdx: sampler.output,
        count: getKeyframeCount(json, sampler.output),
      };
    }
  }
  return null;
}

function main() {
  const { json, bin } = readGlb(GLB_PATH);

  const hipsIdx = json.nodes.findIndex((n) => n.name === "Hips");
  if (hipsIdx < 0) throw new Error("No Hips node found");

  const idleAnim = json.animations.find((a) => a.name.includes("Idle_11"));
  if (!idleAnim) throw new Error("No Idle_11 animation");

  const idleCh = findHipsTransChannel(json, idleAnim, hipsIdx);
  if (!idleCh) throw new Error("Idle_11 has no Hips translation channel");

  const ref = readVec3(json, bin, idleCh.outputAccIdx, 0);
  console.log("Reference (Idle_11 frame 0):", ref.map((v) => v.toFixed(2)).join(", "));

  const GROUND_START_CLIPS = new Set(["Armature|Stand_Up1|baselayer", "Armature|Arise|baselayer"]);
  const FALLING_CLIP = "Armature|falling_down|baselayer";

  let fallingDownNewEnd = null;

  // Pass 1: normalize all upright clips + falling_down
  for (const anim of json.animations) {
    if (GROUND_START_CLIPS.has(anim.name)) continue; // handle in pass 2

    const ch = findHipsTransChannel(json, anim, hipsIdx);
    if (!ch) {
      console.log(`  ${anim.name}: no Hips translation — skip`);
      continue;
    }

    const frame0 = readVec3(json, bin, ch.outputAccIdx, 0);
    const offset = [ref[0] - frame0[0], ref[1] - frame0[1], ref[2] - frame0[2]];
    const dist = Math.sqrt(offset[0] ** 2 + offset[1] ** 2 + offset[2] ** 2);

    if (dist < 0.01) {
      console.log(`  ${anim.name}: already aligned (dist=${dist.toFixed(4)})`);
      if (anim.name === FALLING_CLIP) {
        const last = readVec3(json, bin, ch.outputAccIdx, ch.count - 1);
        fallingDownNewEnd = last;
        console.log(`    falling_down end: ${last.map((v) => v.toFixed(2)).join(", ")}`);
      }
      continue;
    }

    for (let i = 0; i < ch.count; i++) {
      const v = readVec3(json, bin, ch.outputAccIdx, i);
      writeVec3(json, bin, ch.outputAccIdx, i, [v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]]);
    }

    const newFrame0 = readVec3(json, bin, ch.outputAccIdx, 0);
    const newLast = readVec3(json, bin, ch.outputAccIdx, ch.count - 1);
    console.log(`  ${anim.name}: offset (${offset.map((v) => v.toFixed(2)).join(", ")}), dist=${dist.toFixed(2)}`);
    console.log(`    new frame0: ${newFrame0.map((v) => v.toFixed(2)).join(", ")}`);
    console.log(`    new last:   ${newLast.map((v) => v.toFixed(2)).join(", ")}`);

    if (anim.name === FALLING_CLIP) {
      fallingDownNewEnd = newLast;
    }

    // Update accessor min/max
    const acc = json.accessors[ch.outputAccIdx];
    if (acc.min && acc.max) {
      const mins = [Infinity, Infinity, Infinity];
      const maxs = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < ch.count; i++) {
        const v = readVec3(json, bin, ch.outputAccIdx, i);
        for (let c = 0; c < 3; c++) {
          mins[c] = Math.min(mins[c], v[c]);
          maxs[c] = Math.max(maxs[c], v[c]);
        }
      }
      acc.min = mins;
      acc.max = maxs;
    }
  }

  if (!fallingDownNewEnd) {
    console.warn("WARNING: falling_down clip not found or has no Hips translation!");
    fallingDownNewEnd = ref;
  }

  console.log("\nfalling_down normalized end:", fallingDownNewEnd.map((v) => v.toFixed(2)).join(", "));

  // Pass 2: normalize Stand_Up1 and Arise to start where falling_down ends
  for (const anim of json.animations) {
    if (!GROUND_START_CLIPS.has(anim.name)) continue;

    const ch = findHipsTransChannel(json, anim, hipsIdx);
    if (!ch) {
      console.log(`  ${anim.name}: no Hips translation — skip`);
      continue;
    }

    const frame0 = readVec3(json, bin, ch.outputAccIdx, 0);
    const offset = [
      fallingDownNewEnd[0] - frame0[0],
      fallingDownNewEnd[1] - frame0[1],
      fallingDownNewEnd[2] - frame0[2],
    ];
    const dist = Math.sqrt(offset[0] ** 2 + offset[1] ** 2 + offset[2] ** 2);

    for (let i = 0; i < ch.count; i++) {
      const v = readVec3(json, bin, ch.outputAccIdx, i);
      writeVec3(json, bin, ch.outputAccIdx, i, [v[0] + offset[0], v[1] + offset[1], v[2] + offset[2]]);
    }

    const newFrame0 = readVec3(json, bin, ch.outputAccIdx, 0);
    const newLast = readVec3(json, bin, ch.outputAccIdx, ch.count - 1);
    console.log(`  ${anim.name}: offset (${offset.map((v) => v.toFixed(2)).join(", ")}), dist=${dist.toFixed(2)}`);
    console.log(`    new frame0: ${newFrame0.map((v) => v.toFixed(2)).join(", ")} (should match falling_down end)`);
    console.log(`    new last:   ${newLast.map((v) => v.toFixed(2)).join(", ")} (should be near idle ref)`);

    // Update accessor min/max
    const acc = json.accessors[ch.outputAccIdx];
    if (acc.min && acc.max) {
      const mins = [Infinity, Infinity, Infinity];
      const maxs = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < ch.count; i++) {
        const v = readVec3(json, bin, ch.outputAccIdx, i);
        for (let c = 0; c < 3; c++) {
          mins[c] = Math.min(mins[c], v[c]);
          maxs[c] = Math.max(maxs[c], v[c]);
        }
      }
      acc.min = mins;
      acc.max = maxs;
    }
  }

  // Final verification: print all clips' frame0 and frameN positions
  console.log("\n=== VERIFICATION ===");
  for (const anim of json.animations) {
    const ch = findHipsTransChannel(json, anim, hipsIdx);
    if (!ch) continue;
    const f0 = readVec3(json, bin, ch.outputAccIdx, 0);
    const fN = readVec3(json, bin, ch.outputAccIdx, ch.count - 1);
    const shortName = anim.name.replace("Armature|", "").replace("|baselayer", "");
    const f0str = f0.map((v) => v.toFixed(1)).join(", ");
    const fNstr = fN.map((v) => v.toFixed(1)).join(", ");
    console.log(`  ${shortName.padEnd(28)} start(${f0str})  end(${fNstr})`);
  }

  // Write
  fs.writeFileSync(GLB_PATH, writeGlb(json, bin));
  console.log("\nWrote patched", GLB_PATH);
}

main();
