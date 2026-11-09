// The fixed-status controls of the RTS Business Entity section, for tests that publish a whole plan: the three drop-downs
// (already showing the wanted values unless told otherwise) and the Ownership / Business Status History tables.
export const FIN = ["", "Private Equity-Backed", "Corporation", "Angel-Backed"];
export const RES = ["", "Actively Tracked Company", "Does Not Qualify for Meth./Not Act. Tracked", "ProxyCurl Automated"];
export const PUB = ["", "Research in Progress", "Publish", "Do Not Publish"];

export function statusControlsHtml({ financing = "Corporation", research = "Does Not Qualify for Meth./Not Act. Tracked", publish = "Publish" } = {}) {
  const opts = (list, selected) => list.map((o) => `<option${o === selected ? " selected" : ""}>${o}</option>`).join("");
  const table = (id, title, add, save) => `<div id="${id}"><b>${title}</b><div class="rows"></div><input type="button" value="${add}"><input type="button" value="Save" id="${save}" disabled></div>`;
  return `<select name="company.financingStatus.id" id="company.financingStatus.id">${opts(FIN, financing)}</select>
    <select name="company.researchStatus.id" id="companyResearchStatus">${opts(RES, research)}</select>
    <select name="companyPublishStatusSelect" class="profile-publish-status">${opts(PUB, publish)}</select>
    ${table("osh", "Ownership Status History", "Add New Ownership Status", "saveOwnershipStatusHistory")}
    ${table("bsh", "Business Status History", "Add New Business Status", "saveTargetStageHistory")}`;
}

// Makes the tables behave like RTS: Add New adds a row, any edit wakes Save, Save greys out again.
export function wireStatusControls(doc, generalSaveId = "saveBusinessEntityButton") {
  // (self-contained: tests also send this function into a real browser page)
  const OSH = ["", "Privately Held", "Publicly Held"];
  const BSH = ["", "Profitable", "Generating Revenue", "Startup"];
  const row = (list) => `<div class="row"><span class="emptyMark"></span><input type="text" class="input shDate" value=""><select class="input input_select shStatus">${list.map((o) => `<option>${o}</option>`).join("")}</select></div>`;
  for (const [id, list] of [["osh", OSH], ["bsh", BSH]]) {
    const box = doc.getElementById(id);
    const save = box.querySelector('input[id^="save"]');
    box.addEventListener("input", () => { save.disabled = false; });
    box.addEventListener("change", () => { save.disabled = false; });
    box.querySelector('input[value^="Add New"]').addEventListener("click", () => { box.querySelector(".rows").insertAdjacentHTML("beforeend", row(list)); });
    save.addEventListener("click", () => { setTimeout(() => { save.disabled = true; }, 10); });
  }
  const general = doc.getElementById(generalSaveId);
  if (general) for (const sel of ["company.financingStatus.id", "companyResearchStatus"]) { const el = doc.getElementById(sel); el?.addEventListener("change", () => { general.disabled = false; }); }
  doc.querySelector("select.profile-publish-status")?.addEventListener("change", () => { if (general) general.disabled = false; });
}
