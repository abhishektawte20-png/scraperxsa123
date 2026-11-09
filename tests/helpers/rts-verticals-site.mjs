// A copy of the RTS Verticals section and its window: Published / Recommended lists, Add New Vertical (opens a window listing
// every vertical with True / False), True stores the choice with a short delay, and the section's Save changes publishes it.
export const VERTICALS = ["3D Printing", "AdTech", "E-Commerce", "LOHAS & Wellness", "Artificial Intelligence & Machine Learning"];

export function createHandler({ chooseMs = 300, saveMs = 400, published = ["LOHAS & Wellness"], saveRefuses = false } = {}) {
  const state = { published: [...published], pending: [], chooseRequests: 0, saveRequests: 0 };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const main = () => `<!doctype html><body style="font:14px sans-serif"><span class="flat-button__caption-x1">PBID: PB-1</span>
<div class="card"><b>Verticals</b>
  <div id="pub"><div class="h">Published Verticals (${state.published.length})</div>${state.published.map((p) => `<div class="r"><a href="#">Edit</a> ${p}</div>`).join("")}</div>
  <div class="h">Recommended Verticals (0)</div>
  <button type="button" class="button_main button_secondary-color" id="addV">Add New Vertical</button>
</div>
<div><span>Input By: someone</span> <input type="button" id="saveV" value="Save changes" ${state.pending.length ? "" : "disabled"}></div>
<script>
  document.getElementById("addV").onclick = () => window.open("/verticals.html", "", "width=900,height=700");
  document.getElementById("saveV").onclick = async () => { document.getElementById("saveV").disabled = true; await fetch("/save", { method: "POST" }); };
  // the page follows the server (no reload: a reload would drop the extension's panel)
  const render = async () => {
    const s = await (await fetch("/state")).json();
    document.getElementById("pub").innerHTML = '<div class="h">Published Verticals (' + s.published.length + ')</div>' + s.published.map((p) => '<div class="r"><a href="#">Edit</a> ' + p + '</div>').join("");
    document.getElementById("saveV").disabled = s.pending.length === 0;
  };
  setInterval(render, 150); render();
</script></body>`;
  const win = () => `<!doctype html><body style="font:13px sans-serif"><div><b>Recommended Verticals</b></div><div><b>Other Verticals</b></div><table>
  ${VERTICALS.map((n) => `<tr><td class="v">${n}</td><td>Description of ${n} with the words True and False.</td><td><button class="b t">True</button> <button class="b f">False</button></td></tr>`).join("")}
  </table><script>
    for (const b of document.querySelectorAll("button.t")) b.onclick = async () => { await fetch("/choose?name=" + encodeURIComponent(b.closest("tr").querySelector(".v").textContent), { method: "POST" }); b.className = "b t on"; };
  </script></body>`;
  const handler = async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (body, type = "text/html") => { res.setHeader("content-type", type); res.end(body); };
    if (url.pathname === "/main.html") return send(main());
    if (url.pathname === "/verticals.html") return send(win());
    if (url.pathname === "/state") return send(JSON.stringify(state), "application/json");
    if (url.pathname === "/choose") { await pause(chooseMs); state.chooseRequests++; state.pending.push(url.searchParams.get("name")); return send("ok", "text/plain"); }
    if (url.pathname === "/save") { await pause(saveMs); state.saveRequests++; if (!saveRefuses) { state.published.push(...state.pending); state.pending = []; } return send("ok", "text/plain"); }
    res.statusCode = 404; res.end("not found");
  };
  return { handler, state };
}
