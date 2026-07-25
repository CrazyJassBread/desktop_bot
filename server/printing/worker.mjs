import { config } from "../config.mjs";
import { db } from "../api/database.mjs";
import { renderThermalLetterBatches } from "../services/thermal-letter.mjs";
import { printerConfigured, sendBitmap, sendFeed } from "./printer-client.mjs";
import { beginOledActivity } from "../device/oled-client.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const generatedRoot = fileURLToPath(new URL("../../data/generated/", import.meta.url));

let running = false;

export function shouldAutoPrintLetter(senderId, recipientId, autoSend = config.printer.autoSend) {
  return Boolean(autoSend || (senderId && senderId === recipientId));
}

async function processOneJob() {
  if (running || !printerConfigured()) return;
  const job = db.prepare(`SELECT p.id,p.letter_id,l.sender_id,l.recipient_id,l.subject,l.body,l.created_at,s.display_name sender_name,r.display_name recipient_name,ph.file_name photo_file_name
    FROM print_jobs p JOIN letters l ON l.id=p.letter_id JOIN users s ON s.id=l.sender_id JOIN users r ON r.id=l.recipient_id LEFT JOIN photos ph ON ph.id=l.photo_id
    WHERE p.status='queued' AND (?=1 OR l.sender_id=l.recipient_id) ORDER BY p.created_at LIMIT 1`).get(config.printer.autoSend ? 1 : 0);
  if (!job) return;
  const claimed = db.prepare("UPDATE print_jobs SET status='printing',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'").run(job.id);
  if (!claimed.changes) return;
  running = true;
  const endOledActivity = beginOledActivity("laugh");
  try {
    const output = await renderThermalLetterBatches({
      letterId: job.letter_id,
      subject: job.subject,
      body: job.body,
      sender: job.sender_name,
      recipient: job.recipient_name,
      date: String(job.created_at).slice(0, 10),
      attachmentImageDataUrl: job.photo_file_name ? `data:image/png;base64,${(await readFile(join(generatedRoot, job.photo_file_name))).toString("base64")}` : null,
      attachmentCaption: "PIXEL MEMORY"
    }, { rotate180: config.printer.rotate180 });
    for (const batch of output.batches) await sendBitmap(batch);
    await sendFeed(3);
    db.prepare("UPDATE print_jobs SET status='printed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.id);
    db.prepare("UPDATE letters SET status='printed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.letter_id);
  } catch (error) {
    console.error(`Print job ${job.id} failed: ${error.message}`);
    db.prepare("UPDATE print_jobs SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.id);
    db.prepare("UPDATE letters SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(job.letter_id);
  } finally { endOledActivity(); running = false; }
}

export function startPrintWorker() {
  const timer = setInterval(processOneJob, 1_000);
  timer.unref();
  return { stop: () => clearInterval(timer), runOnce: processOneJob };
}
