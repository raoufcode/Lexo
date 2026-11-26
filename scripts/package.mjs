// Construit dist/lexo-chrome.zip et dist/lexo-firefox.zip (aucune dépendance).
// Chaque archive reçoit un manifeste nettoyé pour son navigateur.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INCLUDE = ["_locales", "icons", "src", "vendor"];
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

function files(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

// --- écriture ZIP minimale (deflate) ---------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(0x00210000, 10); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(0x00210000, 12);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cenBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cenBuf, end]);
}

function build(target) {
  const m = structuredClone(manifest);
  if (target === "chrome") {
    delete m.background.scripts;
    delete m.browser_specific_settings;
  } else {
    delete m.background.service_worker;
  }
  const entries = [{ name: "manifest.json", data: Buffer.from(JSON.stringify(m, null, 2)) }];
  for (const dir of INCLUDE) {
    for (const f of files(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      if (target === "firefox" && rel === "src/background/sw.js") continue;
      entries.push({ name: rel, data: fs.readFileSync(f) });
    }
  }
  fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
  const out = path.join(ROOT, "dist", `lexo-${target}-${m.version}.zip`);
  fs.writeFileSync(out, zip(entries));
  // Dossier décompressé (pratique pour « Charger l'extension non empaquetée »).
  const dir = path.join(ROOT, "dist", target);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const { name, data } of entries) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  console.log(`${out} (${entries.length} fichiers)`);
}

build("chrome");
build("firefox");
