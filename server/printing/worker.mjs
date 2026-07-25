import { config } from "../config.mjs";
import { db } from "../api/database.mjs";
import { renderThermalLetterBatches } from "../services/thermal-letter.mjs";
import { printerConfigured, sendBitmap } from "./printer-client.mjs";
import { beginOledActivity } from "../device/oled-client.mjs";

let running = false;

async function processOneJob() {
  if (running || !config.printer.autoSend || !printerConfigured()) return;
  const job = db.prepare(`SELECT p.id,p.letter_id,l.subject,l.body,l.created_at,s.display_name sender_name,r.display_name recipient_name
    FROM print_jobs p JOIN letters l ON l.id=p.letter_id JOIN users s ON s.id=l.sender_id JOIN users r ON r.id=l.recipient_id
    WHERE p.status='queued' ORDER BY p.created_at LIMIT 1`).get();
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
      date: String(job.created_at).slice(0, 10)
    }, { rotate180: config.printer.rotate180 });
    for (const batch of output.batches) await sendBitmap(batch);
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
