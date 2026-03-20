import { readFile, writeFile } from "./github-store.js";

export default async function handler(req, res) {
  if (req.method === "POST") {
    const subscription = req.body;

    // Validate subscription shape
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: "Invalid subscription object" });
    }

    const { data: subs, sha } = await readFile("data/push-subscriptions.json");
    const list = subs || [];

    // Deduplicate by endpoint — each browser instance has a unique endpoint URL
    if (!list.some((s) => s.endpoint === subscription.endpoint)) {
      await writeFile("data/push-subscriptions.json", [...list, subscription], sha);
    }

    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { endpoint } = req.body || {};
    if (!endpoint) return res.status(400).json({ error: "Endpoint required" });

    const { data: subs, sha } = await readFile("data/push-subscriptions.json");
    const filtered = (subs || []).filter((s) => s.endpoint !== endpoint);
    await writeFile("data/push-subscriptions.json", filtered, sha);

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
