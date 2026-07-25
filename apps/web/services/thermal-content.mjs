import sharp from "sharp";

export const THERMAL_CONTENT_WIDTH = 384;
export const THERMAL_CONTENT_MAX_HEIGHT = 800;
const LEFT = 25;
const RIGHT = 359;
const LINES_PER_PAGE = 16;
const LINE_HEIGHT = 31;

const templateLabels = Object.freeze({
  chat: "MIMO CONVERSATION",
  todo: "TODAY · TODO LIST",
  word: "STUDY · WORD CARDS",
  story: "PLAY · STORY CARD",
  note: "AI HUB · NOTE"
});

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function units(character) {
  if (/\s/u.test(character)) return 0.4;
  if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(character)) return 1;
  if (/[.,:;!?|'"ilI1]/u.test(character)) return 0.35;
  if (/[A-Z0-9]/u.test(character)) return 0.68;
  return 0.57;
}

export function wrapThermalContent(value, maxUnits = 17) {
  const lines = [];
  for (const paragraph of String(value ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    let used = 0;
    for (const character of paragraph) {
      const next = units(character);
      if (line && used + next > maxUnits) {
        lines.push(line.trimEnd());
        line = character.trimStart();
        used = units(line);
      } else {
        line += character;
        used += next;
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  return lines;
}

function pageSvg({ kind, title, lines, pageIndex, pageCount, date }) {
  const bodyStart = 150;
  const footerY = bodyStart + lines.length * LINE_HEIGHT + 24;
  const height = Math.max(410, footerY + 76);
  const rows = lines.map((line, index) => `<text x="${LEFT}" y="${bodyStart + index * LINE_HEIGHT}" class="body">${escapeXml(line || " ")}</text>`).join("");
  const label = templateLabels[kind] ?? templateLabels.note;
  return {
    width: THERMAL_CONTENT_WIDTH,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${THERMAL_CONTENT_WIDTH}" height="${height}" viewBox="0 0 ${THERMAL_CONTENT_WIDTH} ${height}">
      <rect width="100%" height="100%" fill="#fff"/>
      <style>
        text{fill:#000;font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Arial",sans-serif}
        .micro{font-size:10px;font-weight:800;letter-spacing:1.6px}.brand{font-size:13px;font-weight:900;letter-spacing:1px}
        .title{font-size:24px;font-weight:900}.body{font-size:18px;font-weight:500}.page{font-size:12px;font-weight:900}
      </style>
      <rect x="10" y="10" width="364" height="${height - 20}" rx="16" fill="none" stroke="#000" stroke-width="2"/>
      <rect x="18" y="18" width="348" height="${height - 36}" rx="11" fill="none" stroke="#000" stroke-width="1" stroke-dasharray="4 5"/>
      <circle cx="43" cy="48" r="17" fill="#000"/><text x="43" y="54" text-anchor="middle" fill="#fff" style="fill:#fff;font-size:15px;font-weight:900">AI</text>
      <text x="70" y="44" class="brand">AI HUB OS</text><text x="70" y="61" class="micro">${escapeXml(label)}</text>
      <text x="359" y="50" text-anchor="end" class="page">${pageIndex + 1}/${pageCount}</text>
      <path d="M25 79 H359" stroke="#000" stroke-width="4"/>
      <text x="25" y="119" class="title">${escapeXml(String(title || "MIMO NOTE").slice(0, 30))}</text>
      <path d="M25 133 H359" stroke="#000" stroke-width="1" stroke-dasharray="3 4"/>
      ${rows}
      <path d="M25 ${footerY} H359" stroke="#000" stroke-width="1"/>
      <text x="25" y="${footerY + 29}" class="micro">${escapeXml(date)}</text>
      <text x="359" y="${footerY + 29}" text-anchor="end" class="micro">PRINTED WITH CARE</text>
    </svg>`
  };
}

export function paginateThermalContent(input = {}) {
  const kind = Object.hasOwn(templateLabels, input.kind) ? input.kind : "note";
  const title = String(input.title ?? "MIMO Note").trim().slice(0, 80) || "MIMO Note";
  const raw = String(input.content ?? "").trim().slice(0, 3_000);
  const lines = wrapThermalContent(raw || "这是一张来自 AI Hub OS 的小纸条。", kind === "word" ? 16 : 17);
  const groups = [];
  for (let offset = 0; offset < lines.length; offset += LINES_PER_PAGE) groups.push(lines.slice(offset, offset + LINES_PER_PAGE));
  if (!groups.length) groups.push([""]);
  const date = String(input.date ?? new Date().toISOString().slice(0, 10)).slice(0, 24);
  const pages = groups.map((group, pageIndex) => ({
    ...pageSvg({ kind, title, lines: group, pageIndex, pageCount: groups.length, date }),
    pageIndex,
    bodyLines: group
  }));
  return { kind, title, pages, pageCount: pages.length, totalHeight: pages.reduce((sum, page) => sum + page.height, 0) };
}

async function packSvg(svg, width, height, rotate180) {
  let pipeline = sharp(Buffer.from(svg, "utf8"), { density: 72 })
    .flatten({ background: "#fff" })
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .threshold(176);
  if (rotate180) pipeline = pipeline.rotate(180);
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const widthBytes = Math.ceil(info.width / 8);
  const bitmap = Buffer.alloc(widthBytes * info.height);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] < 128) bitmap[y * widthBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
    }
  }
  return { width: info.width, height: info.height, bitmap };
}

export async function renderThermalContentBatches(input, { rotate180 = true } = {}) {
  const pagination = paginateThermalContent(input);
  const batches = [];
  for (const page of pagination.pages) {
    if (page.height > THERMAL_CONTENT_MAX_HEIGHT) throw new RangeError(`Thermal content page is too high: ${page.height}`);
    batches.push({ index: page.pageIndex, ...await packSvg(page.svg, page.width, page.height, rotate180) });
  }
  return { ...pagination, width: THERMAL_CONTENT_WIDTH, height: pagination.totalHeight, rotate180, batches };
}

export function thermalContentPreviewDataUrl(input) {
  const pagination = paginateThermalContent(input);
  const first = pagination.pages[0];
  return {
    width: first.width,
    height: first.height,
    pageCount: pagination.pageCount,
    totalHeight: pagination.totalHeight,
    previewDataUrl: `data:image/svg+xml;base64,${Buffer.from(first.svg, "utf8").toString("base64")}`
  };
}

