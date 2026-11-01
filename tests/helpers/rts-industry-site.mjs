// A copy of RTS's Industry window, built from the code RTS really runs (tests/helpers/rts-industry-control.js is RTS's own
// script, unchanged) plus a server that answers like RTS does: the window opens, then fetches its tree (loadJson), Save first
// asks validateOnSave and then posts save.html, and RTS closes the window itself 500 ms after the save succeeded.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(here, name), "utf8");

const MODEL = [
  { id: 16, n: "Business Products and Services (B2B)", segs: [
    { id: 170, n: "Commercial Products", codes: ["Aerospace and Defense", "Chemicals", "Metals, Minerals and Mining", "Other"] },
    { id: 171, n: "Commercial Services", codes: ["Accounting, Audit and Tax Services", "Environmental Services", "Legal Services", "Consulting Services", "Other"] }
  ] },
  { id: 17, n: "Consumer Products and Services (B2C)", segs: [
    { id: 180, n: "Apparel and Accessories", codes: ["Accessories", "Clothing", "Footwear", "Other"] }
  ] },
  { id: 18, n: "Information Technology", segs: [
    { id: 190, n: "Software", codes: ["Application Software", "Network Management Software", "Other"] }
  ] }
];
let codeId = 400;
for (const g of MODEL) for (const s of g.segs) s.codes = s.codes.map((n) => ({ id: codeId++, n }));

const template = () => ({
  items: MODEL.map((g) => ({ id: g.id, code: "", description: g.n, items: g.segs.map((s) => ({ id: s.id, code: "", description: s.n, items: s.codes.map((c) => ({ id: c.id, code: "", description: c.n })) })) }))
});

const templateHtml = () => `<div id="industryControltmp_id" class="controls_body">` + MODEL.map((g, gi) => `
<div id="industryControlGroup${g.id}tmp_id">
  <div id="industryControlGroup${g.id}tmp_idExpander" class="mt_5 sub-section__icon-collapse section__icon" onclick="IndustryControlTemplate.expand(this, 'industryControlGroup${g.id}tmp_idChild');"></div>
  <div><div><div class="controls_checkBox_border"><div id="industryControlGroup${g.id}tmp_idCheckBox" class="controls_emptyCheckBox"></div></div></div></div>
  <div id="industryControlGroup${g.id}tmp_idDescription">${g.n}</div>
  <div id="industryControlGroup${g.id}tmp_idChild" style="display:none">` + g.segs.map((s, si) => `
    <div id="industryControlSegment${s.id}tmp_id">
      <div id="industryControlSegment${s.id}tmp_idExpander" class="mt_5 sub-section__icon-collapse section__icon" onclick="IndustryControlTemplate.expand(this, 'industryControlSegment${s.id}tmp_idChild');"></div>
      <div><div><div id="industryControlSegment${s.id}tmp_idCheckBox" class="controls_emptyCheckBox"></div></div></div>
      <div id="industryControlSegment${s.id}tmp_idDescription">${s.n}</div>
      <div id="industryControlSegment${s.id}tmp_idChild" style="display:none">` + s.codes.map((c, ci) => `
        <div id="industryControlCode${c.id}tmp_id">
          <div><div id="industryControlCode${c.id}tmp_idCheckBox" class="controls_checkBox" onclick="IndustryControl.checkCode(this, ${gi}, ${si}, ${ci});"></div></div>
          <div id="industryControlCode${c.id}tmp_idDescription">${c.n}</div>
        </div>`).join("") + `
      </div>
    </div>`).join("") + `
  </div>
</div>`).join("") + `</div>`;

const CONSULTING_ID = () => MODEL.flatMap((g) => g.segs.flatMap((x) => x.codes)).find((c) => c.n === "Consulting Services").id;

export function mainPage() {
  return `<!doctype html><body style="font:14px sans-serif"><span class="flat-button__caption-x1">PBID: PB-1</span>
<div id="containerIndustryGroup"><div>
  <div class="mb_10"><span class="text text_bold">Industry Group</span></div>
  <div class="mb_20 oldIndustryItemsHolder"><div class="row"><span>Group</span></div></div>
  <div class="d_flex align-items-center mb_5"><input type="button" value="Add/Edit Industry" class="btn btn_secondary" onclick="openIndustries('company', {})"></div>
</div></div>
<script>
  window.opens = 0;
  window.openIndustries = function () { window.opens++; window.open("/industryGroup/create.html?id=15524918&fundId=0&type=company&pg=0&ps=0&pc=0&popUp=true", window.fixedName || "", "width=900,height=700"); };
</script></body>`;
}

function popupPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Industry</title>
<script src="/jquery.min.js"></script>
<script>
  var IndustryControlTemplate = {
    html: ${JSON.stringify(templateHtml())},
    jSon: ${JSON.stringify(template())},
    load: function () {},
    expand: function (el, childId) {
      var child = document.getElementById(childId);
      var open = child.style.display !== "none";
      child.style.display = open ? "none" : "block";
      el.className = open ? "mt_5 sub-section__icon-collapse section__icon" : "mt_5 sub-section__icon-expand section__icon";
    }
  };
  function disableButton($b, cls) { $b.prop("disabled", true).addClass(cls + "_disabled"); }
  function enableButton($b, cls) { $b.prop("disabled", false).removeClass(cls + "_disabled"); }
  function registerOnSaveTrigger() {}
  function isEmptyIndustryGroupForCompanyAllowed() { return false; }
</script>
<script src="/rts-industry-control.js"></script>
</head><body onload="onLoad('company', '/industryGroup/loadJson')">
<form action="/industryGroup/save.html" method="post">
  <input type="hidden" id="id" value="15524918"><input type="hidden" id="type" value="company"><input type="hidden" id="fundId" value="0">
  <input type="hidden" id="15524918Hidden" name="industryJson">
  <div id="processingSpinner" style="display:none">Loading...</div>
  <div id="mainSection">
    <div class="control_form_inner"><div id="industryControlPlace"></div>
      <div class="d_flex flex_column m_10">
        <div class="d_flex align_items_center justify_content_between"><h5 class="section__block-title mb_0 mr_10">Select Industries</h5>
          <div class="d_flex"><input type="button" value="Save Changes" class="btn buttonSave" id="saveIndustryButton" onclick="submitIndustryControl(this.form)"></div></div>
        <div id="15524918Content" class="section__block mt_10 p_10 pl_0"></div>
      </div>
    </div>
  </div>
  <div id="errorLabel" style="display:none">Something went wrong</div>
</form></body></html>`;
}

// state: what the server holds. options: how slowly it answers and whether validateOnSave asks for a confirmation.
export function createHandler({ loadMs = 400, validateMs = 300, saveMs = 500, confirmMessage = "", saveError = "", silentNoSave = false, alreadySaved = false } = {}) {
  const state = { saved: alreadySaved ? [CONSULTING_ID()] : [], saveRequests: 0, validateRequests: 0, loadRequests: 0, saveFinished: 0 };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const handler = async (req, res) => {
    const url = req.url.split("?")[0];
    const send = (body, type = "text/html") => { res.setHeader("content-type", type); res.end(body); };
    if (url === "/main.html") return send(mainPage());
    if (url === "/industryGroup/create.html") return send(popupPage());
    if (url === "/jquery.min.js") return send(read("jquery.min.js"), "text/javascript");
    if (url === "/rts-industry-control.js") return send(read("rts-industry-control.js"), "text/javascript");
    if (url === "/state") return send(JSON.stringify(state), "application/json");
    if (url === "/industryGroup/loadJson") {
      state.loadRequests++;
      await pause(loadMs);
      const model = template();
      for (const g of model.items) { g.checked = 0; for (const s of g.items) { s.checked = 0; for (const c of s.items) c.checked = state.saved.includes(c.id) ? 1 : 0; } }
      return send(JSON.stringify(model), "application/json");
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    if (url === "/industryGroup/validateOnSave") {
      state.validateRequests++;
      await pause(validateMs);
      return send(JSON.stringify(confirmMessage ? { status: "error", message: confirmMessage } : { status: "ok" }), "text/plain");
    }
    if (url === "/industryGroup/save.html") {
      state.saveRequests++;
      await pause(saveMs);
      if (saveError) return send(JSON.stringify({ status: "error", message: saveError }), "text/plain");
      if (silentNoSave) return send(JSON.stringify({ status: "ok" }), "text/plain"); // says ok, stores nothing
      const json = JSON.parse(decodeURIComponent((body.match(/industryJson=([^&]*)/) || [, "{}"])[1].replace(/\+/g, " ")));
      state.saved = (json.items || []).flatMap((g) => g.items.flatMap((s) => s.items.filter((c) => c.checked == 1).map((c) => c.id)));
      state.saveFinished++;
      return send(JSON.stringify({ status: "ok" }), "text/plain");
    }
    res.statusCode = 404; res.end("not found");
  };
  return { handler, state, MODEL };
}
