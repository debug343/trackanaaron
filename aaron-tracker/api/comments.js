import { readFile, writeFile } from "./_github-store.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { data } = await readFile("data/comments.json");
    const all = data || [];
    // ?all=1 with admin password returns unapproved too
    const wantAll = req.query.all === "1" && req.query.password === process.env.ADMIN_PASSWORD;
    const comments = wantAll ? all : all.filter((c) => c.approved);
    return res.status(200).json({ comments });
  }

  if (req.method === "POST") {
    const { name, text, verifyWord, formLoadedAt, website } = req.body || {};

    // Honeypot — silently accept so bots don't know they were caught
    if (website) return res.status(201).json({ ok: true });

    // Time check: reject if submitted in < 3s or > 30min after form load
    const now = Date.now();
    const loaded = parseInt(formLoadedAt, 10);
    if (!loaded || now - loaded < 3000 || now - loaded > 1800000) {
      return res.status(400).json({ error: "Submission invalid. Please try again." });
    }

    // Verify word
    if (verifyWord?.trim().toLowerCase() !== "arctic") {
      return res.status(400).json({ error: "Please type 'arctic' to verify you're human." });
    }

    if (!name?.trim() || !text?.trim()) {
      return res.status(400).json({ error: "Name and message are required." });
    }

    const { data: comments, sha } = await readFile("data/comments.json");
    const comment = {
      id: Date.now().toString(),
      name: name.trim().slice(0, 80),
      text: text.trim().slice(0, 1000),
      createdAt: new Date().toISOString(),
      approved: false,
    };
    const updated = [comment, ...(comments || [])].slice(0, 500);
    await writeFile("data/comments.json", updated, sha);
    return res.status(201).json({ ok: true });
  }

  if (req.method === "PATCH") {
    // Admin approve
    const { id, password } = req.body || {};
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { data: comments, sha } = await readFile("data/comments.json");
    const updated = (comments || []).map((c) => c.id === id ? { ...c, approved: true } : c);
    await writeFile("data/comments.json", updated, sha);
    return res.status(200).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { id, password } = req.body || {};
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { data: comments, sha } = await readFile("data/comments.json");
    await writeFile("data/comments.json", (comments || []).filter((c) => c.id !== id), sha);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
