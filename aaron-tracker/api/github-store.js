const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const TOKEN = process.env.GITHUB_TOKEN;

async function githubRequest(path, options = {}) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

export async function readFile(path) {
  const res = await githubRequest(`contents/${path}`);
  if (res.status === 404) return { data: null, sha: null };
  const json = await res.json();
  const data = JSON.parse(Buffer.from(json.content, "base64").toString("utf8"));
  return { data, sha: json.sha };
}

export async function writeFile(path, data, sha) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");
  const body = { message: `update ${path}`, content };
  if (sha) body.sha = sha;
  const res = await githubRequest(`contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return res.ok;
}
