import { readFile, writeFile } from "./_github-store.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const [{ data: emails }, { data: pushSubs }, { data: state }] = await Promise.all([
        readFile("data/subscribers.json"),
        readFile("data/push-subscriptions.json"),
        readFile("data/notify-state.json"),
      ]);
      const emailCount = (emails || []).length;
      const pushCount  = (pushSubs || []).length;
      return res.status(200).json({
        emailSubscribers: emailCount,
        pushSubscribers:  pushCount,
        total:            emailCount + pushCount,
        restMode:         state?.restMode    ?? false,
        restNote:         state?.restNote    ?? "",
        restSince:        state?.restSince   ?? null,
        raceUpdate:       state?.raceUpdate  ?? "",
        raceUpdateAt:     state?.raceUpdateAt ?? null,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const { password, restMode, restNote, raceUpdate } = req.body || {};
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { data: state, sha } = await readFile("data/notify-state.json");
      const updated = { ...(state || {}) };

      // Rest mode fields (only update if key present in body)
      if ("restMode" in (req.body || {})) {
        updated.restMode  = !!restMode;
        updated.restNote  = restNote || "";
        updated.restSince = restMode ? new Date().toISOString() : null;
      }

      // Race update field
      if ("raceUpdate" in (req.body || {})) {
        updated.raceUpdate   = raceUpdate || "";
        updated.raceUpdateAt = raceUpdate ? new Date().toISOString() : null;
      }

      await writeFile("data/notify-state.json", updated, sha);
      return res.status(200).json({ ok: true, restMode: updated.restMode, raceUpdate: updated.raceUpdate });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
