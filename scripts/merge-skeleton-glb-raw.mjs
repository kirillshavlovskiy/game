#!/usr/bin/env node
/**
 * Merge Meshy per-animation skeleton GLBs into one file at the raw glTF JSON + binary level.
 *
 * All source files share the SAME 26-node bone hierarchy (Hips → LeftUpLeg → … → Head).
 * Strategy: use Idle as the base (mesh + skin + skeleton), then for every other file
 * copy its animation data (samplers/accessors/bufferViews) into the base, remapping
 * channel target.node by bone name so every clip drives the SAME skeleton.
 *
 * Usage:
 *   node scripts/merge-skeleton-glb-raw.mjs <input-dir> [output.glb]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "public", "models", "monsters", "skeleton.glb");

function readGlb(filepath) {
  const buf = fs.readFileSync(filepath);
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error("Not a GLB: " + filepath);
  let o = 12;
  let json = null;
  let bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o);
    const type = buf.subarray(o + 4, o + 8).toString("ascii");
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "JSON") json = JSON.parse(data.toString("utf8").replace(/\0/g, ""));
    else if (type === "BIN\x00") bin = Buffer.from(data);
    o += 8 + len;
  }
  if (!json) throw new Error("No JSON chunk: " + filepath);
  return { json, bin: bin ?? Buffer.alloc(0) };
}

function writeGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonPadded = jsonPad ? Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]) : jsonBuf;
  const binPad = (4 - (bin.length % 4)) % 4;
  const binPadded = binPad ? Buffer.concat([bin, Buffer.alloc(binPad, 0)]) : bin;
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); // "glTF"
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

function buildNameToNode(json) {
  const map = new Map();
  for (let i = 0; i < json.nodes.length; i++) {
    const name = json.nodes[i].name;
    if (name && !map.has(name)) map.set(name, i);
  }
  return map;
}

function readAccessorBuffer(json, bin, accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const compSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType] ?? 4;
  const compCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[acc.type] ?? 1;
  const byteLen = acc.count * compCount * compSize;
  return bin.subarray(start, start + byteLen);
}

function listGlbs(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".glb"))
    .map((f) => path.join(dir, f))
    .sort();
}

function sortIdleFirst(paths) {
  const idle = paths.find((p) => /Animation_Idle_\d+_withSkin\.glb$/i.test(p));
  if (!idle) return paths;
  return [idle, ...paths.filter((p) => p !== idle)];
}

function main() {
  const inDir = process.argv[2];
  const outPath = process.argv[3] ? path.resolve(process.cwd(), process.argv[3]) : DEFAULT_OUT;
  if (!inDir || !fs.existsSync(inDir)) {
    console.error("Usage: node scripts/merge-skeleton-glb-raw.mjs <input-dir> [output.glb]");
    process.exit(1);
  }

  let paths = listGlbs(inDir);
  if (!paths.length) { console.error("No .glb files in", inDir); process.exit(1); }
  paths = sortIdleFirst(paths);

  console.log("Base:", path.basename(paths[0]));
  const base = readGlb(paths[0]);
  const baseJson = base.json;
  let baseBin = base.bin;
  const baseNameToNode = buildNameToNode(baseJson);

  console.log("Base nodes:", baseJson.nodes.length, "joints:", baseJson.skins?.[0]?.joints?.length);
  console.log("Base bones:", [...baseNameToNode.keys()].join(", "));

  const seenAnimNames = new Set(
    (baseJson.animations ?? []).map((a) => a.name)
  );

  for (let fi = 1; fi < paths.length; fi++) {
    const fp = paths[fi];
    const fname = path.basename(fp);
    const src = readGlb(fp);
    const srcJson = src.json;
    const srcBin = src.bin;

    if (!srcJson.animations?.length) {
      console.warn("Skip (no animations):", fname);
      continue;
    }

    const srcNameToNode = buildNameToNode(srcJson);

    for (const srcAnim of srcJson.animations) {
      if (seenAnimNames.has(srcAnim.name)) {
        console.warn("Skip duplicate:", srcAnim.name, "<-", fname);
        continue;
      }

      const newSamplers = [];
      const newChannels = [];
      let skipped = 0;

      for (const srcSampler of srcAnim.samplers) {
        const inputData = readAccessorBuffer(srcJson, srcBin, srcSampler.input);
        const outputData = readAccessorBuffer(srcJson, srcBin, srcSampler.output);

        const inputAcc = srcJson.accessors[srcSampler.input];
        const outputAcc = srcJson.accessors[srcSampler.output];

        const binOffset = baseBin.length;

        const inputBvIdx = baseJson.bufferViews.length;
        baseJson.bufferViews.push({
          buffer: 0,
          byteOffset: binOffset,
          byteLength: inputData.length,
        });
        const inputAccIdx = baseJson.accessors.length;
        baseJson.accessors.push({
          bufferView: inputBvIdx,
          byteOffset: 0,
          componentType: inputAcc.componentType,
          count: inputAcc.count,
          type: inputAcc.type,
          max: inputAcc.max,
          min: inputAcc.min,
        });

        const outputBvIdx = baseJson.bufferViews.length;
        baseJson.bufferViews.push({
          buffer: 0,
          byteOffset: binOffset + inputData.length,
          byteLength: outputData.length,
        });
        const outputAccIdx = baseJson.accessors.length;
        const outAccObj = {
          bufferView: outputBvIdx,
          byteOffset: 0,
          componentType: outputAcc.componentType,
          count: outputAcc.count,
          type: outputAcc.type,
        };
        if (outputAcc.max) outAccObj.max = outputAcc.max;
        if (outputAcc.min) outAccObj.min = outputAcc.min;
        baseJson.accessors.push(outAccObj);

        baseBin = Buffer.concat([baseBin, inputData, outputData]);

        const samplerIdx = newSamplers.length;
        newSamplers.push({
          input: inputAccIdx,
          output: outputAccIdx,
          interpolation: srcSampler.interpolation ?? "LINEAR",
        });

        // Find which channels use this sampler index in the source
        for (const ch of srcAnim.channels) {
          if (ch.sampler !== (srcAnim.samplers.indexOf(srcSampler))) continue;

          const srcNodeIdx = ch.target?.node;
          if (srcNodeIdx == null) { skipped++; continue; }
          const boneName = srcJson.nodes[srcNodeIdx]?.name;
          if (!boneName) { skipped++; continue; }
          const baseNodeIdx = baseNameToNode.get(boneName);
          if (baseNodeIdx == null) { skipped++; continue; }

          newChannels.push({
            sampler: samplerIdx,
            target: {
              node: baseNodeIdx,
              path: ch.target.path,
            },
          });
        }
      }

      if (newChannels.length === 0) {
        console.warn("Skip (no matched channels):", srcAnim.name, "<-", fname, "skipped:", skipped);
        continue;
      }

      if (!baseJson.animations) baseJson.animations = [];
      baseJson.animations.push({
        name: srcAnim.name,
        samplers: newSamplers,
        channels: newChannels,
      });
      seenAnimNames.add(srcAnim.name);
      console.log("+", srcAnim.name, `(${newChannels.length} ch, ${skipped} skipped)`);
    }
  }

  // Update buffer size
  if (baseJson.buffers?.length) {
    baseJson.buffers[0].byteLength = baseBin.length;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, writeGlb(baseJson, baseBin));

  const finalAnims = baseJson.animations?.map((a) => a.name) ?? [];
  console.log("\nWrote", outPath);
  console.log(finalAnims.length, "animations:", finalAnims.join(", "));
  console.log("Nodes:", baseJson.nodes.length, "| Joints:", baseJson.skins?.[0]?.joints?.length);
}

main();
