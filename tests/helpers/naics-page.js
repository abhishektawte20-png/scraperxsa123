// Browser-side replica of RTS's "Select NAICS" dialog, shared by the jsdom
// tests and the real-Chromium test. Plain browser JavaScript on purpose.
//
//   installNaicsPage(options) -> state
//
// Two sections (GECS and NAICS) each have an Add button and their own Save
// Changes button inside a row; the list of codes sits above that row. The
// NAICS dialog is a tree (sector > sub-sector > group > industry) whose last
// level is a radio button labelled "541511 – Custom Computer Programming
// Services"; the dialog's Save wakes up once one is chosen.
(function () {
  var SECTOR_NAMES = [
    "Agriculture, Forestry, Fishing and Hunting", "Mining, Quarrying, and Oil and Gas Extraction", "Utilities", "Construction", "Manufacturing",
    "Wholesale Trade", "Retail Trade", "Transportation and Warehousing", "Information", "Finance and Insurance", "Real Estate and Rental and Leasing",
    "Professional, Scientific, and Technical Services", "Management of Companies and Enterprises",
    "Administrative and Support and Waste Management and Remediation Services", "Educational Services", "Health Care and Social Assistance",
    "Arts, Entertainment, and Recreation", "Accommodation and Food Services", "Other Services (except Public Administration)", "Public Administration"
  ];
  var SECTOR_CODES = ["11", "21", "22", "23", "31", "42", "44", "48", "51", "52", "53", "54", "55", "56", "61", "62", "71", "72", "81", "92"];

  var HTML = [
    '<div class="sec" id="gecs"><span>GECS</span><ul id="gecsList"></ul><div class="group group_m">',
    '<button aria-disabled="false" data-test-id="gecs-add-button" type="button" class="button button-RzszBy button_secondary" id="addGecs"><div class="button__hole"><span class="button__caption">Add GECS</span></div></button>',
    '<div class="group__i"></div>',
    '<button aria-disabled="true" disabled data-test-id="gecs-save-button" type="button" class="button button-RzszBy button_primary" id="gecsSave"><div class="button__hole"><span class="button__caption">Save Changes</span></div></button></div></div>',
    '<div class="sec" id="naics"><span>NAICS</span><ul id="list"></ul><div class="group group_m">',
    '<button aria-disabled="false" data-test-id="naics-add-button" type="button" class="button button-RzszBy button_secondary" id="addNaics"><div class="button__hole"><span class="button__caption">Add NAICS</span></div></button>',
    '<div class="group__i"></div>',
    '<button aria-disabled="true" disabled data-test-id="naics-save-button" type="button" class="button button-RzszBy button_primary" id="naicsSave"><div class="button__hole"><span class="button__caption">Save Changes</span></div></button></div></div>',
    '<div id="dlg" style="display:none;position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:1000">',
    '<div style="background:#fff;width:700px;margin:20px auto;padding:14px;height:560px;overflow:auto;font:13px sans-serif"><h2>Select NAICS</h2>',
    '<div id="cols" style="display:flex;gap:20px"><div id="left" style="flex:1"></div><div id="right" style="flex:1"></div></div>',
    '<div style="margin-top:12px"><button aria-disabled="true" data-test-id="naics-modal-save-button" type="button" id="dlgSave" class="button button_primary"><div class="button__hole"><span class="button__caption">Save</span></div></button> ',
    '<button type="button" id="dlgCancel">Cancel</button></div></div></div>'
  ].join("");

  function leaf(code, name) { return { code: code, name: name }; }

  function buildData(renameSector) {
    var data = SECTOR_NAMES.map(function (name, i) {
      return { name: name, children: [{ name: name + " (all)", children: [{ name: "Group", children: [{ name: "Industry", children: [leaf(SECTOR_CODES[i] + "9999", "Placeholder industry")] }] }] }] };
    });
    data[0] = { name: SECTOR_NAMES[0], children: [
      { name: "Crop Production", children: [{ name: "Oilseed and Grain Farming", children: [{ name: "Soybean Farming", children: [leaf("111110", "Soybean Farming")] }, { name: "Wheat Farming", children: [leaf("111140", "Wheat Farming")] }] }] },
      { name: "Animal Production and Aquaculture", children: [{ name: "Cattle Ranching and Farming", children: [{ name: "Beef Cattle Ranching and Farming", children: [leaf("112111", "Beef Cattle Ranching and Farming")] }] }] }
    ] };
    data[6] = { name: SECTOR_NAMES[6], children: [
      { name: "Furniture and Home Furnishings Retailers", children: [{ name: "Furniture Retailers", children: [leaf("449110", "Furniture Retailers")] }] },
      { name: "Clothing, Clothing Accessories, Shoe, and Jewelry Retailers", children: [{ name: "Clothing and Clothing Accessories Retailers", children: [leaf("458110", "Clothing and Clothing Accessories Retailers"), leaf("448140", "Family Clothing Stores")] }] }
    ] };
    data[11] = { name: SECTOR_NAMES[11], children: [{ name: "Professional, Scientific, and Technical Services", children: [
      { name: "Legal Services", children: [{ name: "Offices of Lawyers", children: [leaf("541110", "Offices of Lawyers")] }] },
      { name: "Computer Systems Design and Related Services", children: [{ name: "Computer Systems Design and Related Services", children: [
        leaf("541511", "Custom Computer Programming Services"), leaf("541512", "Computer Systems Design Services"), leaf("541519", "Other Computer Related Services")] }] },
      { name: "Advertising, Public Relations, and Related Services", children: [{ name: "Advertising Agencies", children: [leaf("541810", "Advertising Agencies")] }] }
    ] }] };
    var subs = [311, 312, 313, 314, 315, 316, 321, 322, 323, 324, 325, 326, 327, 331, 332, 333, 334, 335, 336, 337, 339];
    data[4] = { name: SECTOR_NAMES[4], children: subs.map(function (sub) {
      return { name: "Subsector " + sub, children: [1, 2, 3].map(function (g) {
        return { name: "Group " + sub + g, children: [1, 2, 4].map(function (j) {
          return { name: "Industry " + sub + g + j, children: [leaf("" + sub + g + j + "0", "Leaf " + sub + g + j + "0")] };
        }) };
      }) };
    }) };
    if (renameSector) data[11].name = "Professional, Scientific and Technical Services";
    return data;
  }

  window.installNaicsPage = function (options) {
    var o = Object.assign({ preserve: true, hiddenInputs: false, saveEnabledByRadio: true, dialogClosesOnSave: true, sectionSaveEnables: true, sectionSaveSettles: true, listShowsCode: true, preList: [], renameSector: false, startExpanded: false, delay: 10 }, options || {});
    document.body.insertAdjacentHTML("afterbegin", HTML);
    var $ = function (id) { return document.getElementById(id); };
    var state = { expanderClicks: 0, opens: 0, saves: 0, sectionSaves: 0, gecsSaves: 0, listed: o.preList.slice() };
    var data = buildData(o.renameSector);
    var expanded = {};

    function renderNode(node, depth, path) {
      var li = document.createElement("li");
      if (node.code) {
        li.innerHTML = '<label class="radio-button"><input type="radio" name="naics" class="radio-button__handler" style="position:absolute;opacity:0' + (o.hiddenInputs ? ";display:none" : "") + '">' +
          '<span class="radio-button__caption"><span class="radio-button__pointer"><svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="7" fill="none" stroke="#333"/></svg></span><span>' + node.code + " – " + node.name + "</span></span></label>";
        li.querySelector("input").addEventListener("change", function () { if (o.saveEnabledByRadio) $("dlgSave").setAttribute("aria-disabled", "false"); });
        return li;
      }
      var key = path + "/" + node.name;
      var row = document.createElement("div");
      row.style.margin = "3px 0";
      row.innerHTML = '<label class="checkbox-button" style="position:relative;display:inline-block;width:18px;height:18px;border:1px solid #888;text-align:center;line-height:16px;margin-right:6px;cursor:pointer">' +
        '<input type="checkbox" name="tree-expander" class="checkbox-button__handler" style="position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;cursor:pointer" aria-label="Expand ' + node.name + '"><span class="plus">+</span></label><span>' + node.name + "</span>";
      var box = row.querySelector("input");
      var kids = document.createElement("ul");
      kids.style.listStyle = "none";
      li.appendChild(row);
      li.appendChild(kids);
      function draw() {
        var open = !!expanded[key];
        box.checked = open;
        box.setAttribute("aria-label", (open ? "Collapse " : "Expand ") + node.name);
        row.querySelector(".plus").textContent = open ? "−" : "+";
        if (open && !kids.firstChild) node.children.forEach(function (c) { kids.appendChild(renderNode(c, depth + 1, key)); });
        if (!open) kids.textContent = "";
      }
      box.addEventListener("click", function () {
        state.expanderClicks++;
        if (expanded[key]) delete expanded[key]; else expanded[key] = true;
        setTimeout(function () { if (o.preserve) draw(); else mount(); }, o.delay);
      });
      draw();
      return li;
    }

    function mount() {
      var left = $("left"), right = $("right");
      left.textContent = "";
      right.textContent = "";
      function make(list, host) { var ul = document.createElement("ul"); ul.style.listStyle = "none"; list.forEach(function (n) { ul.appendChild(renderNode(n, 0, "")); }); host.appendChild(ul); }
      make(data.slice(0, 11), left);
      make(data.slice(11), right);
    }
    mount();
    if (o.startExpanded) document.querySelector("input[name=tree-expander]").click();

    var dlg = $("dlg");
    function refreshList() { $("list").innerHTML = state.listed.map(function (c) { return "<li>" + (o.listShowsCode ? c : "(entry)") + "</li>"; }).join(""); }
    refreshList();
    $("addNaics").addEventListener("click", function () { state.opens++; dlg.style.display = "block"; });
    $("dlgCancel").addEventListener("click", function () { dlg.style.display = "none"; });
    $("dlgSave").addEventListener("click", function (e) {
      var radio = document.querySelector("input[type=radio]:checked");
      if (e.currentTarget.getAttribute("aria-disabled") === "true" || !radio) return;
      state.saves++;
      var code = /^(\d{6})/.exec(radio.closest("label").textContent.trim())[1];
      if (o.dialogClosesOnSave) dlg.style.display = "none";
      state.listed.push(code);
      refreshList();
      if (o.sectionSaveEnables) { var s = $("naicsSave"); s.disabled = false; s.setAttribute("aria-disabled", "false"); }
    });
    $("naicsSave").addEventListener("click", function () {
      state.sectionSaves++;
      if (o.sectionSaveSettles) setTimeout(function () { var s = $("naicsSave"); s.disabled = true; s.setAttribute("aria-disabled", "true"); }, 30);
    });
    $("gecsSave").addEventListener("click", function () { state.gecsSaves++; });
    window.__naics = state;
    return state;
  };
})();
