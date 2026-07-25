import sharp from "sharp";

export const THERMAL_PRINTER_WIDTH = 384;
export const THERMAL_BATCH_MAX_HEIGHT = 800;
const CONTENT_LEFT = 26;
const CONTENT_RIGHT = THERMAL_PRINTER_WIDTH - 26;
const BODY_FONT_SIZE = 20;
const BODY_LINE_HEIGHT = 31;
const MAX_BODY_LINES = 120;

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function glyphUnits(character) {
  if (/\s/u.test(character)) return 0.38;
  if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(character)) return 1;
  if (/[A-Z0-9]/u.test(character)) return 0.66;
  if (/[.,:;!?'"|ilI1]/u.test(character)) return 0.34;
  return 0.56;
}

function wrapText(value, maxUnits, maxLines = Number.POSITIVE_INFINITY) {
  const output = [];
  const paragraphs = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      output.push("");
      if (output.length >= maxLines) break;
      continue;
    }
    let line = "";
    let units = 0;
    for (const character of paragraph) {
      const nextUnits = glyphUnits(character);
      if (line && units + nextUnits > maxUnits) {
        output.push(line.trimEnd());
        if (output.length >= maxLines) break;
        line = character.trimStart();
        units = glyphUnits(line);
      } else {
        line += character;
        units += nextUnits;
      }
    }
    if (output.length >= maxLines) break;
    if (line) output.push(line.trimEnd());
    if (output.length >= maxLines) break;
  }
  return output;
}

function textRows(lines, startY, lineHeight, attributes = "") {
  return lines.map((line, index) => (
    `<text x="${CONTENT_LEFT}" y="${startY + index * lineHeight}" ${attributes}>${escapeXml(line || " ")}</text>`
  )).join("");
}

function letterAttachment(input = {}) {
  const dataUrl = String(input.attachmentImageDataUrl ?? input.attachment?.previewDataUrl ?? "").trim();
  if (!dataUrl.startsWith("data:image/")) return null;
  const width = Math.max(80, Math.min(300, Number(input.attachmentWidth ?? input.attachment?.width ?? 300) || 300));
  const height = Math.max(60, Math.min(150, Number(input.attachmentHeight ?? input.attachment?.height ?? 150) || 150));
  const x = Math.round((THERMAL_PRINTER_WIDTH - width) / 2);
  return {
    dataUrl,
    width,
    height,
    x,
    caption: String(input.attachmentCaption ?? input.attachment?.title ?? "MEMORY PHOTO").trim().slice(0, 42)
  };
}

export function buildThermalLetterSvg(input = {}) {
  const subject = String(input.subject ?? "一封来自 AI Hub 的信").trim().slice(0, 120);
  const body = String(input.body ?? "").trim().slice(0, 3_000);
  const sender = String(input.sender ?? "AI Hub Friend").trim().slice(0, 48);
  const recipient = String(input.recipient ?? "A Dear Friend").trim().slice(0, 48);
  const date = String(input.date ?? new Date().toISOString().slice(0, 10)).trim().slice(0, 24);
  const letterId = String(input.letterId ?? "PREVIEW").replace(/[^a-zA-Z0-9_-]/g, "").slice(-10) || "PREVIEW";
  const pageIndex = Math.max(0, Number(input.pageIndex ?? 0) || 0);
  const pageCount = Math.max(1, Number(input.pageCount ?? 1) || 1);
  const attachment = input.includeAttachment === false ? null : letterAttachment(input);

  const titleLines = wrapText(subject, 12.2, 2);
  const bodyLines = wrapText(body || "愿这张小小的纸，替我把此刻的心意送到你身边。", 16.2, MAX_BODY_LINES);
  const bodyWasClipped = wrapText(body, 16.2, MAX_BODY_LINES + 1).length > MAX_BODY_LINES;
  if (bodyWasClipped && bodyLines.length) bodyLines[bodyLines.length - 1] = `${bodyLines.at(-1).slice(0, -1)}…`;

  const titleStartY = 195;
  const titleLineHeight = 37;
  const metaY = titleStartY + titleLines.length * titleLineHeight + 7;
  const bodyStartY = metaY + 96;
  const attachmentBlockHeight = attachment ? attachment.height + 52 : 0;
  const attachmentY = bodyStartY + bodyLines.length * BODY_LINE_HEIGHT + 20;
  const footerY = bodyStartY + bodyLines.length * BODY_LINE_HEIGHT + attachmentBlockHeight + 38;
  const height = Math.max(620, footerY + 118);

  const titleSvg = textRows(titleLines, titleStartY, titleLineHeight, 'class="title"');
  const bodySvg = textRows(bodyLines, bodyStartY, BODY_LINE_HEIGHT, 'class="body"');
  const attachmentSvg = attachment ? `
    <g class="attachment">
      <rect x="${attachment.x - 7}" y="${attachmentY - 7}" width="${attachment.width + 14}" height="${attachment.height + 14}" rx="6" fill="#fff" stroke="#000" stroke-width="1.5"/>
      <image x="${attachment.x}" y="${attachmentY}" width="${attachment.width}" height="${attachment.height}" href="${escapeXml(attachment.dataUrl)}" preserveAspectRatio="xMidYMid meet"/>
      <text x="192" y="${attachmentY + attachment.height + 27}" text-anchor="middle" class="caption">${escapeXml(attachment.caption)}</text>
    </g>` : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THERMAL_PRINTER_WIDTH}" height="${height}" viewBox="0 0 ${THERMAL_PRINTER_WIDTH} ${height}">
    <rect width="100%" height="100%" fill="#fff"/>
    <style>
      text{fill:#000;font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Arial",sans-serif}
      .micro{font-size:10px;font-weight:700;letter-spacing:2px}.brand{font-size:27px;font-weight:900;letter-spacing:1px}
      .title{font-size:28px;font-weight:900}.body{font-size:${BODY_FONT_SIZE}px;font-weight:500}
      .meta{font-size:13px;font-weight:700}.serial{font-size:15px;font-weight:900;letter-spacing:.7px}.footer{font-size:11px;font-weight:700;letter-spacing:1px}.caption{font-size:10px;font-weight:800;letter-spacing:1.3px}
    </style>
    <rect x="10" y="10" width="364" height="${height - 20}" rx="18" fill="none" stroke="#000" stroke-width="2"/>
    <rect x="18" y="18" width="348" height="${height - 36}" rx="13" fill="none" stroke="#000" stroke-width="1" stroke-dasharray="4 5"/>
    <circle cx="52" cy="66" r="24" fill="#000"/><text x="52" y="74" text-anchor="middle" fill="#fff" style="fill:#fff;font-size:22px;font-weight:900">AI</text>
    <text x="88" y="57" class="micro">AI HUB OS</text><text x="88" y="83" class="brand">PAPER LETTER</text>
    <path d="M26 112 H358" stroke="#000" stroke-width="5"/><path d="M26 122 H358" stroke="#000" stroke-width="1"/>
    <rect x="214" y="130" width="144" height="30" rx="4" fill="#fff" stroke="#000" stroke-width="2"/>
    <text x="286" y="151" text-anchor="middle" class="serial">NO. ${escapeXml(letterId)}</text>
    ${titleSvg}
    <path d="M26 ${metaY + 10} H358" stroke="#000" stroke-width="1" stroke-dasharray="3 4"/>
    <text x="26" y="${metaY + 35}" class="meta">TO  ${escapeXml(recipient)}</text>
    <text x="26" y="${metaY + 57}" class="meta">FROM  ${escapeXml(sender)}</text>
    <text x="358" y="${metaY + 57}" text-anchor="end" class="meta">${escapeXml(date)}</text>
    ${attachmentSvg}
    ${bodySvg}
    <path d="M26 ${footerY} H358" stroke="#000" stroke-width="1"/>
    <circle cx="38" cy="${footerY + 31}" r="5" fill="#000"/><circle cx="55" cy="${footerY + 31}" r="5" fill="none" stroke="#000" stroke-width="2"/><circle cx="72" cy="${footerY + 31}" r="5" fill="#000"/>
    <text x="358" y="${footerY + 35}" text-anchor="end" class="footer">PRINTED WITH CARE · ${pageIndex + 1}/${pageCount}</text>
    <text x="192" y="${footerY + 71}" text-anchor="middle" class="micro">DIGITAL HEART · PHYSICAL PAPER</text>
    <path d="M126 ${footerY + 87} h132" stroke="#000" stroke-width="3"/>
  </svg>`;

  return { svg, width: THERMAL_PRINTER_WIDTH, height, bodyWasClipped };
}

function buildContinuationPageSvg(input, bodyLines, pageIndex, pageCount) {
  const subject = String(input.subject ?? "一封来自 AI Hub 的信").trim().slice(0, 48);
  const sender = String(input.sender ?? "AI Hub Friend").trim().slice(0, 36);
  const recipient = String(input.recipient ?? "A Dear Friend").trim().slice(0, 36);
  const bodyStartY = 154;
  const attachment = input.includeAttachment ? letterAttachment(input) : null;
  const attachmentY = bodyStartY + bodyLines.length * BODY_LINE_HEIGHT + 18;
  const attachmentBlockHeight = attachment ? attachment.height + 48 : 0;
  const footerY = bodyStartY + bodyLines.length * BODY_LINE_HEIGHT + attachmentBlockHeight + 28;
  const height = Math.max(360, footerY + 82);
  const bodySvg = textRows(bodyLines, bodyStartY, BODY_LINE_HEIGHT, 'class="body"');
  const attachmentSvg = attachment ? `
    <g class="attachment">
      <rect x="${attachment.x - 7}" y="${attachmentY - 7}" width="${attachment.width + 14}" height="${attachment.height + 14}" rx="6" fill="#fff" stroke="#000" stroke-width="1.5"/>
      <image x="${attachment.x}" y="${attachmentY}" width="${attachment.width}" height="${attachment.height}" href="${escapeXml(attachment.dataUrl)}" preserveAspectRatio="xMidYMid meet"/>
      <text x="192" y="${attachmentY + attachment.height + 27}" text-anchor="middle" class="caption">${escapeXml(attachment.caption)}</text>
    </g>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${THERMAL_PRINTER_WIDTH}" height="${height}" viewBox="0 0 ${THERMAL_PRINTER_WIDTH} ${height}">
    <rect width="100%" height="100%" fill="#fff"/>
    <style>
      text{fill:#000;font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC","Arial",sans-serif}
      .micro{font-size:10px;font-weight:800;letter-spacing:1.5px}.title{font-size:19px;font-weight:900}
      .body{font-size:${BODY_FONT_SIZE}px;font-weight:500}.meta{font-size:11px;font-weight:700}.page{font-size:14px;font-weight:900}.caption{font-size:10px;font-weight:800;letter-spacing:1.3px}
    </style>
    <rect x="10" y="10" width="364" height="${height - 20}" rx="16" fill="none" stroke="#000" stroke-width="2"/>
    <rect x="18" y="18" width="348" height="${height - 36}" rx="11" fill="none" stroke="#000" stroke-width="1" stroke-dasharray="4 5"/>
    <text x="26" y="45" class="micro">AI HUB OS · PAPER LETTER · CONTINUED</text>
    <rect x="294" y="27" width="64" height="27" rx="4" fill="#fff" stroke="#000" stroke-width="2"/>
    <text x="326" y="46" text-anchor="middle" class="page">${pageIndex + 1}/${pageCount}</text>
    <path d="M26 66 H358" stroke="#000" stroke-width="4"/>
    <text x="26" y="96" class="title">${escapeXml(subject.length > 24 ? `${subject.slice(0, 23)}…` : subject)}</text>
    <text x="26" y="122" class="meta">TO ${escapeXml(recipient)} · FROM ${escapeXml(sender)}</text>
    <path d="M26 134 H358" stroke="#000" stroke-width="1" stroke-dasharray="3 4"/>
    ${bodySvg}
    ${attachmentSvg}
    <path d="M26 ${footerY} H358" stroke="#000" stroke-width="1"/>
    <text x="26" y="${footerY + 27}" class="micro">CONTINUED LETTER · ${pageIndex + 1}/${pageCount}</text>
  </svg>`;
  return { svg, width: THERMAL_PRINTER_WIDTH, height };
}

export function paginateThermalLetter(input = {}) {
  const rawBody = String(input.body ?? "").trim().slice(0, 3_000);
  const allLines = wrapText(rawBody || "愿这张小小的纸，替我把此刻的心意送到你身边。", 16.2, MAX_BODY_LINES);
  const bodyWasClipped = wrapText(rawBody, 16.2, MAX_BODY_LINES + 1).length > MAX_BODY_LINES;
  if (bodyWasClipped && allLines.length) allLines[allLines.length - 1] = `${allLines.at(-1).slice(0, -1)}…`;
  const attachment = letterAttachment(input);
  const firstPageLineCount = attachment ? 3 : 7;
  const continuationLineCount = attachment ? 8 : 14;
  const groups = [allLines.slice(0, firstPageLineCount)];
  for (let offset = firstPageLineCount; offset < allLines.length; offset += continuationLineCount) {
    groups.push(allLines.slice(offset, offset + continuationLineCount));
  }
  const pageCount = groups.length;
  const pages = groups.map((bodyLines, pageIndex) => {
    if (pageIndex === 0) {
      const page = buildThermalLetterSvg({
        ...input,
        body: bodyLines.join("\n"),
        pageIndex,
        pageCount,
        includeAttachment: pageIndex === pageCount - 1
      });
      return { ...page, pageIndex, bodyLines };
    }
    return {
      ...buildContinuationPageSvg({ ...input, includeAttachment: pageIndex === pageCount - 1 }, bodyLines, pageIndex, pageCount),
      pageIndex,
      bodyLines,
      bodyWasClipped: false
    };
  });
  return { pages, pageCount, bodyWasClipped, totalHeight: pages.reduce((sum, page) => sum + page.height, 0) };
}

export async function renderThermalLetterBitmap(input, { rotate180 = true } = {}) {
  const template = buildThermalLetterSvg(input);
  let pipeline = sharp(Buffer.from(template.svg, "utf8"), { density: 72 })
    .flatten({ background: "#ffffff" })
    .resize(template.width, template.height, { fit: "fill" })
    .greyscale()
    .threshold(176);
  if (rotate180) pipeline = pipeline.rotate(180);
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const widthBytes = Math.ceil(info.width / 8);
  const bitmap = Buffer.alloc(widthBytes * info.height);
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[y * info.width + x] < 128) {
        bitmap[y * widthBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
      }
    }
  }
  return { ...template, bitmap, rotate180 };
}

export async function renderThermalLetterBatches(
  input,
  { rotate180 = true, maxBatchHeight = THERMAL_BATCH_MAX_HEIGHT } = {}
) {
  const pagination = paginateThermalLetter(input);
  const safeBatchHeight = Math.max(360, Math.min(960, Number(maxBatchHeight) || THERMAL_BATCH_MAX_HEIGHT));
  const batches = [];

  for (const page of pagination.pages) {
    if (page.height > safeBatchHeight) {
      throw new RangeError(`logical Letter page exceeds safe height: ${page.height} > ${safeBatchHeight}`);
    }
    let pipeline = sharp(Buffer.from(page.svg, "utf8"), { density: 72 })
      .flatten({ background: "#ffffff" })
      .resize(page.width, page.height, { fit: "fill" })
      .greyscale()
      .threshold(176);
    if (rotate180) pipeline = pipeline.rotate(180);
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    const widthBytes = Math.ceil(info.width / 8);
    const bitmap = Buffer.alloc(widthBytes * info.height);
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[y * info.width + x] < 128) {
          bitmap[y * widthBytes + Math.floor(x / 8)] |= 1 << (7 - (x % 8));
        }
      }
    }
    batches.push({ index: page.pageIndex, width: info.width, height: info.height, bitmap });
  }

  return {
    width: THERMAL_PRINTER_WIDTH,
    height: pagination.totalHeight,
    rotate180,
    maxBatchHeight: safeBatchHeight,
    bodyWasClipped: pagination.bodyWasClipped,
    pageCount: pagination.pageCount,
    batches
  };
}

export function thermalLetterPreviewDataUrl(input) {
  const pagination = paginateThermalLetter(input);
  const template = pagination.pages[0];
  return {
    ...template,
    pageCount: pagination.pageCount,
    totalHeight: pagination.totalHeight,
    bodyWasClipped: pagination.bodyWasClipped,
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(template.svg, "utf8").toString("base64")}`
  };
}
