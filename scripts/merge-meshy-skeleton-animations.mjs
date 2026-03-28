#!/usr/bin/env node
/**
 * Merges Meshy per-animation GLBs into one file via gltf-transform, then **retargets** animation channels
 * so every clip drives the **same** armature as the base file.
 *
 * Without retarget, copied clips keep node indices pointing at **discarded duplicate rigs** — the mesh stays
 * in T-pose for most animations (only the base clip worked). Same issue as Dracula; see
 * `scripts/retarget-glb-animation-nodes.mjs`.
 *
 * **Still prefer** Blender NLA merge when you can: `scripts/blender_merge_skeleton_animation_glbs.py` then retarget.
 *
 * Usage (repo root):
 *   node scripts/merge-meshy-skeleton-animations.mjs <input-dir> [output.glb] [--ref "ClipName"]
 *
 * Default output: public/models/monsters/skeleton.glb
 * Default `--ref`: first animation on the base (Idle) GLB — usually `Armature|Idle_11|baselayer`.
 *
 * Expects filenames like Meshy_AI_Blue_Eyed_Skeleton_biped_Animation_*_withSkin.glb
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { NodeIO } from "@gltf-transform/core";
import { copyToDocument, createDefaultPropertyResolver, unpartition } from "@gltf-transform/functions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "public", "models", "monsters", "skeleton.glb");
const RETARGET_SCRIPT = path.join(__dirname, "retarget-glb-animation-nodes.mjs");

const io = new NodeIO();

function parseArgs() {
  const rest = process.argv.slice(2).filter(Boolean);
  const refIdx = rest.indexOf("--ref");
  let refOverride = null;
  if (refIdx >= 0 && rest[refIdx + 1]) {
    refOverride = rest[refIdx + 1];
    rest.splice(refIdx, 2);
  }
  return { inDir: rest[0], outPath: rest[1], refOverride };
}

function listGlbFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".glb"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function sortBaseFirst(paths) {
  const idle = paths.find((p) => /Animation_Idle_\d+_withSkin\.glb$/i.test(p));
  if (!idle) return paths;
  return [idle, ...paths.filter((p) => p !== idle)];
}

async function main() {
  const { inDir, outPath: outArg, refOverride } = parseArgs();
  const outPath = outArg ? path.resolve(process.cwd(), outArg) : DEFAULT_OUT;
  if (!inDir || !fs.existsSync(inDir)) {
    console.error(
      "Usage: node scripts/merge-meshy-skeleton-animations.mjs <input-dir> [output.glb] [--ref clipName]",
    );
    process.exit(1);
  }

  let paths = listGlbFiles(inDir);
  if (paths.length === 0) {
    console.error("No .glb files in", inDir);
    process.exit(1);
  }
  paths = sortBaseFirst(paths);

  console.log("Base:", path.basename(paths[0]));
  let target = await io.read(paths[0]);
  const seenNames = new Set(target.getRoot().listAnimations().map((a) => a.getName()));

  for (let i = 1; i < paths.length; i++) {
    const p = paths[i];
    const source = await io.read(p);
    const anims = source.getRoot().listAnimations();
    if (anims.length === 0) {
      console.warn("Skip (no animations):", path.basename(p));
      continue;
    }
    for (const a of anims) {
      const nm = a.getName();
      if (seenNames.has(nm)) {
        console.warn("Skip duplicate clip name:", nm, "<-", path.basename(p));
        continue;
      }
      const resolve = createDefaultPropertyResolver(target, source);
      copyToDocument(target, source, [a], resolve);
      seenNames.add(nm);
    }
  }

  /** Single BIN chunk; avoid `prune` here — it can drop nodes still referenced after a buggy merge. */
  await target.transform(unpartition());

  const refAnim =
    refOverride ??
    target.getRoot().listAnimations()[0]?.getName() ??
    "Armature|Idle_11|baselayer";

  const tmpRaw = path.join(
    path.dirname(outPath),
    `.skeleton-merge-raw-${process.pid}-${Date.now()}.glb`,
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await io.write(tmpRaw, target);

  try {
    console.log("Retargeting channels to bones from reference clip:", refAnim);
    execFileSync(process.execPath, [RETARGET_SCRIPT, tmpRaw, outPath, "--ref", refAnim], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } finally {
    try {
      fs.unlinkSync(tmpRaw);
    } catch {
      /* ignore */
    }
  }

  const names = (() => {
    const b = fs.readFileSync(outPath);
    let o = 12;
    while (o < b.length) {
      const len = b.readUInt32LE(o);
      const type = b.subarray(o + 4, o + 8).toString("ascii");
      const data = b.subarray(o + 8, o + 8 + len);
      if (type === "JSON") {
        const j = JSON.parse(data.toString("utf8").replace(/\0/g, ""));
        return (j.animations ?? []).map((a) => a.name);
      }
      o += 8 + len;
    }
    return [];
  })();
  console.log("Wrote", outPath, `(${names.length} animations, retargeted)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
