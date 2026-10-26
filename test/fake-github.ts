// In-memory fake of the parts of the GitHub API that Yuzu sync uses (shared by unit and e2e tests).
export function fakeGitHub(opts: { flaky?: number } = {}) {
  const blobs = new Map<string, Buffer>();
  const trees = new Map<string, Record<string, string>>(); // tree sha -> path -> blob sha
  const commits = new Map<string, { tree: string; parents: string[] }>();
  let head: string | null = null; const refs = new Map<string, string>();
  let n = 0; const sha = () => `sha${++n}`;
  let flaky = opts.flaky ?? 0; let calls = 0;
  const dec = (b64: string) => Buffer.from(b64, "base64");
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    calls++;
    if (flaky > 0) { flaky--; return new Response("boom", { status: 502 }); }
    const u = new URL(url); const p = u.pathname.replace(/^\/repos\/o\/r/, ""); const m = init.method ?? "GET";
    const json = (x: any, status = 200) => new Response(JSON.stringify(x), { status });
    const body = init.body ? JSON.parse(init.body as string) : null;
    if (p === "" && m === "GET") return json({ full_name: "o/r", private: true, default_branch: "main", permissions: { push: true }, size: blobs.size * 10 });
    if (p.startsWith("/contents/") && m === "GET") {
      if (!head) return json({ message: "This repository is empty." }, 404);
      const path = decodeURIComponent(p.slice(10));
      const tree = trees.get(commits.get(head)!.tree)!;
      if (path === "lock.json") { const b = tree[path]; return b ? json({ sha: b, content: blobs.get(b)!.toString("base64") }) : json({ message: "Not Found" }, 404); }
      if (path === "inbox") { const files = Object.keys(tree).filter((k) => k.startsWith("inbox/")); return files.length ? json(files.map((k) => ({ type: "file", name: k.slice(6), sha: tree[k], size: blobs.get(tree[k])!.length }))) : new Response("", { status: 404 }); }
      const b = tree[path]; if (!b) return new Response("", { status: 404 });
      return new Response(new Uint8Array(blobs.get(b)!), { status: 200 });
    }
    if (p.startsWith("/contents/inbox/") && m === "DELETE") {
      const path = decodeURIComponent(p.slice(10)); const tree = { ...trees.get(commits.get(head!)!.tree)! }; if (!tree[path]) return json({ message: "Not Found" }, 404);
      delete tree[path]; const t = sha(); trees.set(t, tree); const c = sha(); commits.set(c, { tree: t, parents: [head!] }); head = c; return json({ commit: { sha: c } });
    }
    if (p.startsWith("/contents/") && (m === "PUT" || m === "DELETE")) {
      const path = decodeURIComponent(p.slice(10)); const tree = { ...(head ? trees.get(commits.get(head)!.tree)! : {}) };
      if (m === "PUT") { const b = sha(); blobs.set(b, dec(body.content)); tree[path] = b; } else delete tree[path];
      const t = sha(); trees.set(t, tree); const c = sha(); commits.set(c, { tree: t, parents: head ? [head] : [] }); head = c; return json({ commit: { sha: c }, content: { sha: tree[path] } });
    }
    if (!head && p.startsWith("/git/")) return json({ message: "Git Repository is empty." }, 409);
    if (p === "/git/ref/heads/main") return json({ object: { sha: head } });
    if (p.startsWith("/git/ref/") && m === "GET") { const r = refs.get(p.slice(9)); return r ? json({ object: { sha: r } }) : json({ message: "Not Found" }, 404); }
    if (p.startsWith("/git/refs/") && m === "DELETE") { refs.delete(p.slice(10)); return new Response(null, { status: 204 }); }
    if (p.startsWith("/git/refs/") && p !== "/git/refs/heads/main" && m === "PATCH") { refs.set(p.slice(10), body.sha); return json({}); }
    if (p.startsWith("/git/commits/") && m === "GET" && !commits.get(p.slice(13))) return json({ message: "Not Found" }, 404);
    if (p.startsWith("/git/commits/") && m === "GET") { const c = commits.get(p.slice(13))!; return json({ tree: { sha: c.tree }, message: (c as any).message ?? "" }); }
    if (p === "/git/blobs" && m === "POST") { const s = sha(); blobs.set(s, dec(body.content)); return json({ sha: s }); }
    if (p === "/git/trees" && m === "POST") {
      const base = body.base_tree ? { ...trees.get(body.base_tree)! } : {};
      for (const t of body.tree) { if (t.sha === null) delete base[t.path]; else if (t.content !== undefined) { const b = sha(); blobs.set(b, Buffer.from(t.content)); base[t.path] = b; } else base[t.path] = t.sha; }
      const s = sha(); trees.set(s, base); return json({ sha: s });
    }
    if (p === "/git/commits" && m === "POST") { const s = sha(); commits.set(s, { tree: body.tree, parents: body.parents, message: body.message } as any); return json({ sha: s }); }
    if (p === "/git/refs/heads/main" && m === "PATCH") {
      const c = commits.get(body.sha)!;
      if (!body.force && c.parents[0] !== head) return json({ message: "Update is not a fast forward" }, 422);
      head = body.sha; return json({});
    }
    if (p === "/git/refs" && m === "POST") { if (body.ref === "refs/heads/main") { head = body.sha; return json({}); } const k = body.ref.replace(/^refs\//, ""); if (refs.has(k)) return json({ message: "Reference already exists" }, 422); refs.set(k, body.sha); return json({}); }
    return new Response("nope " + m + " " + p, { status: 500 });
  };
  const drop = (name: string, content: string) => { const b = sha(); blobs.set(b, Buffer.from(content)); const tree = { ...(head ? trees.get(commits.get(head)!.tree)! : {}) }; tree["inbox/" + name] = b; const t = sha(); trees.set(t, tree); const c = sha(); commits.set(c, { tree: t, parents: head ? [head] : [] }); head = c; };
  const parentsOfHead = () => (head ? commits.get(head)!.parents : []);
  return { parentsOfHead, fetchImpl, files: () => (head ? trees.get(commits.get(head)!.tree)! : {}), commits: () => commits.size, calls: () => calls, setFlaky: (k: number) => { flaky = k; }, drop };
}
