import { readFile, writeFile } from "./github-store.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { data } = await readFile("data/journal.json");
    return res.status(200).json({ entries: data || [] });
  }

  if (req.method === "POST") {
    const { title, text, password, raceData, embed } = req.body || {};
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!text?.trim()) return res.status(400).json({ error: "Text required" });

    const { data: entries, sha } = await readFile("data/journal.json");
    const entry = {
      id: Date.now().toString(),
      title: title?.trim() || new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
      text: text.trim(),
      embed: embed?.trim() || null,
      raceData: raceData || null,
      createdAt: new Date().toISOString(),
    };
    const updated = [entry, ...(entries || [])].slice(0, 100);
    await writeFile("data/journal.json", updated, sha);
    return res.status(201).json({ entry });
  }

  if (req.method === "PUT") {
    const { id, title, text, password, embed } = req.body || {};
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (!text?.trim()) return res.status(400).json({ error: "Text required" });
    const { data: entries, sha } = await readFile("data/journal.json");
    const updated = (entries || []).map((e) =>
      e.id === id ? { ...e, title: title?.trim() || e.title, text: text.trim(), embed: embed?.trim() || null } : e
    );
    await writeFile("data/journal.json", updated, sha);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id, password } = req.body || {};
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { data: entries, sha } = await readFile("data/journal.json");
    await writeFile("data/journal.json", (entries || []).filter((e) => e.id !== id), sha);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
