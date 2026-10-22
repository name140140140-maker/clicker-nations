// Щоденна страховка: закриває теми підтримки без активності 4+ години,
// навіть якщо ніхто не писав боту (основне закриття відбувається при кожному повідомленні).
import { sweepInactive } from "./support-webhook.js";

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).send("unauthorized");
    return;
  }
  try {
    const closed = await sweepInactive();
    res.status(200).json({ ok: true, closed });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
