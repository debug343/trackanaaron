import { readFile, writeFile } from "./_github-store.js";

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { email } = req.body || {};
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }
    const { data: subscribers, sha } = await readFile("data/subscribers.json");
    const list = subscribers || [];
    const normalized = email.toLowerCase().trim();
    if (!list.includes(normalized)) {
      await writeFile("data/subscribers.json", [...list, normalized], sha);
    }
    return res.status(200).json({ ok: true });
  }

  // Unsubscribe via email link: GET /api/subscribe?email=x&token=y
  if (req.method === "GET") {
    const { email, token } = req.query;
    if (!email || !token) return res.status(400).send("Invalid link");
    const expected = Buffer.from(email).toString("base64url");
    if (token !== expected) return res.status(400).send("Invalid unsubscribe link");
    const { data: subscribers, sha } = await readFile("data/subscribers.json");
    await writeFile("data/subscribers.json", (subscribers || []).filter((e) => e !== email.toLowerCase()), sha);
    return res.status(200).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0e1a;color:#e8eaf6"><h2>Unsubscribed</h2><p style="color:#4a7aaa">You've been removed from Aaron's race updates.</p></body></html>`);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
