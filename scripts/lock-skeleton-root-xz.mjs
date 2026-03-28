#!/usr/bin/env node
/**
 * Lock ALL skeleton animation clips' Hips X and Z translation to Idle_11's
 * first-frame values at EVERY keyframe. Y is kept as-is for natural height
 * changes (crouch, fall, stand-up).
 *
 * This eliminates any horizontal drift/shift between or during clips so the
 * skeleton stays perfectly centred in the combat viewport.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GLB_PATH = path.join(__dirname, "..", "public", "models", "monsters", "skeleton.glb");

function readGlb(filepath) {
  const buf = fs.readFileSync(filepath);
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

function readVec3(json, bin, accIdx, i) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * 12;
  return [bin.readFloatLE(base), bin.readFloatLE(base + 4), bin.readFloatLE(base + 8)];
}

function writeVec3(json, bin, accIdx, i, xyz) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * 12;
  bin.writeFloatLE(xyz[0], base);
  bin.writeFloatLE(xyz[1], base + 4);
  bin.writeFloatLE(xyz[2], base + 8);
}

function main() {
  const { json, bin } = readGlb(GLB_PATH);

  const hipsIdx = json.nodes.findIndex((n) => n.name === "Hips");
  if (hipsIdx < 0) throw new Error("No Hips node");

  const idleAnim = json.animations.find((a) => a.name.includes("Idle_11"));
  if (!idleAnim) throw new Error("No Idle_11");

  // Get reference X/Z from Idle_11 frame 0
  let refX, refZ;
  for (const ch of idleAnim.channels) {
    if (ch.target.node === hipsIdx && ch.target.path === "translation") {
      const s = idleAnim.samplers[ch.sampler];
      const v = readVec3(json, bin, s.output, 0);
      refX = v[0];
      refZ = v[2];
      break;
    }
  }
  console.log(`Reference Hips X=${refX.toFixed(2)}, Z=${refZ.toFixed(2)}`);

  for (const anim of json.animations) {
    let transChannel = null;
    for (const ch of anim.channels) {
      if (ch.target.node === hipsIdx && ch.target.path === "translation") {
        transChannel = ch;
        break;
      }
    }
    if (!transChannel) continue;

    const sampler = anim.samplers[transChannel.sampler];
    const outAccIdx = sampler.output;
    const count = json.accessors[outAccIdx].count;

    const f0 = readVec3(json, bin, outAccIdx, 0);
    const fN = readVec3(json, bin, outAccIdx, count - 1);

    let xChanged = 0, zChanged = 0;
    for (let i = 0; i < count; i++) {
      const v = readVec3(json, bin, outAccIdx, i);
      const newX = refX;
      const newZ = refZ;
      if (Math.abs(v[0] - newX) > 0.001) xChanged++;
      if (Math.abs(v[2] - newZ) > 0.001) zChanged++;
      writeVec3(json, bin, outAccIdx, i, [newX, v[1], newZ]);
    }

    // Update accessor min/max
    const acc = json.accessors[outAccIdx];
    if (acc.min && acc.max) {
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < count; i++) {
        const v = readVec3(json, bin, outAccIdx, i);
        minY = Math.min(minY, v[1]);
        maxY = Math.max(maxY, v[1]);
      }
      acc.min = [refX, minY, refZ];
      acc.max = [refX, maxY, refZ];
    }

    const shortName = anim.name.replace("Armature|", "").replace("|baselayer", "");
    const newF0 = readVec3(json, bin, outAccIdx, 0);
    const newFN = readVec3(json, bin, outAccIdx, count - 1);
    console.log(
      `  ${shortName.padEnd(28)} ` +
      `X: ${f0[0].toFixed(1)}→${refX.toFixed(1)} (${xChanged} kf), ` +
      `Z: ${f0[2].toFixed(1)}→${refZ.toFixed(1)} (${zChanged} kf), ` +
      `Y: ${newF0[1].toFixed(1)}→${newFN[1].toFixed(1)}`
    );
  }

  // Final check
  console.log("\n=== VERIFICATION: all clips Hips X,Z ===");
  for (const anim of json.animations) {
    for (const ch of anim.channels) {
      if (ch.target.node === hipsIdx && ch.target.path === "translation") {
        const s = anim.samplers[ch.sampler];
        const count = json.accessors[s.output].count;
        let allMatch = true;
        for (let i = 0; i < count; i++) {
          const v = readVec3(json, bin, s.output, i);
          if (Math.abs(v[0] - refX) > 0.001 || Math.abs(v[2] - refZ) > 0.001) {
            allMatch = false;
            break;
          }
        }
        const short = anim.name.replace("Armature|", "").replace("|baselayer", "");
        console.log(`  ${short.padEnd(28)} ${allMatch ? "✓ locked" : "✗ DRIFT"}`);
      }
    }
  }

  fs.writeFileSync(GLB_PATH, writeGlb(json, bin));
  console.log("\nWrote", GLB_PATH);
}

main();
