// Browser-side replica of RTS's Site section, shared by the jsdom tests and the real-Chromium test.
//   installSitePage(options) -> state
// A collapsed "Site" bar, a list of sites, the "Add New Site" button and the form with the boxes the real one
// has (names as in RTS). SAVE wakes up once the required boxes are filled; saving adds a row and closes the form.
(function () {
  var COUNTRIES = ["", "United States", "United Kingdom", "Canada", "India", "Germany", "Czech Republic"];
  var STATES = ["", "Alabama", "California", "New York", "Texas"];

  window.installSitePage = function (options) {
    var o = Object.assign({ collapsed: true, existing: [], labelsOnly: false, rejectSave: false, otherTab: false }, options || {});
    var state = { opens: 0, saves: 0, sites: o.existing.slice(), barClicks: 0, cancels: 0, tabClicks: 0, lastForm: null };
    var nm = function (n) { return o.labelsOnly ? "" : ' name="' + n + '"'; };
    var rows = function () { return state.sites.map(function (s) { return "<li>" + s.name + " — " + s.address1 + ", " + s.city + "</li>"; }).join(""); };
    var opt = function (list) { return list.map(function (c) { return "<option>" + c + "</option>"; }).join(""); };
    var html = [
      '<div id="tabs"><button class="navigation__button" id="tabCompany">Company</button><button class="navigation__button" id="tabEntity">Business Entity</button></div>',
      '<div id="companyTab"' + (o.otherTab ? ' style="display:none"' : "") + '>',
      '<div class="bar" id="siteBar" style="cursor:pointer;background:#47719a;color:#fff;padding:6px">Site</div>',
      '<div id="blockSite" style="' + (o.collapsed ? "display:none" : "") + '"><ul id="sites">' + rows() + '</ul>',
      '<input type="button" class="btn btn_secondary buttonView" id="addSite" value="Add New Site">',
      '<div id="siteForm" style="display:none"><table>',
      '<tr><td>Site name*</td><td><input type="text"' + nm("site.siteName") + '></td></tr>',
      '<tr><td>Site Type*</td><td><select' + nm("site.siteType.id") + '>' + opt(["", "Primary HQ", "Regional HQ", "Regional Office"]) + '</select></td></tr>',
      '<tr><td>Address Line 1</td><td><input type="text"' + nm("site.address1") + '></td></tr>',
      '<tr><td>Address Line 2</td><td><input type="text"' + nm("site.address2") + '></td></tr>',
      '<tr><td>City*</td><td><input type="text"' + nm("site.city") + '></td></tr>',
      '<tr><td>Country*</td><td><select' + nm("site.countryCode.id") + '>' + opt(COUNTRIES) + '</select></td></tr>',
      '<tr id="stateRow"><td>State*</td><td><select id="stateSel">' + opt(STATES) + '</select><input type="text" id="provinceInput"' + nm("site.province") + ' style="display:none"></td></tr>',
      '<tr><td>Zip <a>(Format)</a></td><td><input type="text"' + nm("site.zip") + '></td></tr>',
      '<tr><td>Phone <a>(Format)</a></td><td><input type="text"' + nm("site.phone") + '></td></tr>',
      '<tr><td>Fax <a>(Format)</a></td><td><input type="text"' + nm("site.fax") + '></td></tr>',
      '<tr><td>Email</td><td><input type="text"' + nm("site.coEmailAddr") + '></td></tr>',
      '<tr><td>Status*</td><td><select' + nm("site.siteStatus.id") + '>' + opt(["", "Current", "Former"]) + '</select></td></tr>',
      '</table><input type="button" class="btn mr_15 buttonSave" id="saveSiteInfoButton" value="SAVE" disabled><input type="button" id="cancelSite" value="Cancel"></div>',
      '</div></div>',
      '<div id="entityTab"' + (o.otherTab ? "" : ' style="display:none"') + '><p>Business Entity</p></div>'
    ].join("");
    document.body.insertAdjacentHTML("beforeend", html);
    var $ = function (id) { return document.getElementById(id); };
    var form = $("siteForm");
    var field = function (label) {
      var cell = Array.prototype.find.call(form.querySelectorAll("td"), function (td) { return td.textContent.indexOf(label) === 0; });
      return cell.nextElementSibling.querySelector("input:not([style*='none']), select:not([style*='none'])");
    };
    $("tabCompany").addEventListener("click", function () { state.tabClicks++; $("companyTab").style.display = ""; $("entityTab").style.display = "none"; });
    $("tabEntity").addEventListener("click", function () { $("companyTab").style.display = "none"; $("entityTab").style.display = ""; });
    $("siteBar").addEventListener("click", function () { state.barClicks++; var b = $("blockSite"); b.style.display = b.style.display === "none" ? "" : "none"; });
    $("addSite").addEventListener("click", function () { state.opens++; form.style.display = ""; });
    $("cancelSite").addEventListener("click", function () { state.cancels++; form.style.display = "none"; });
    function refresh() {
      var country = field("Country*").value;
      var us = country === "United States";
      $("stateSel").style.display = us ? "" : "none";
      $("provinceInput").style.display = us ? "none" : "";
      var ok = field("Site name*").value && field("Site Type*").value && field("City*").value && country && field("Status*").value && (us ? $("stateSel").value : true);
      $("saveSiteInfoButton").disabled = !ok;
    }
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    refresh();
    $("saveSiteInfoButton").addEventListener("click", function () {
      if (o.rejectSave) return;
      var us = field("Country*").value === "United States";
      state.lastForm = {
        name: field("Site name*").value, type: field("Site Type*").value, address1: field("Address Line 1").value, city: field("City*").value,
        country: field("Country*").value, state: us ? $("stateSel").value : $("provinceInput").value, zip: field("Zip").value, phone: field("Phone").value,
        fax: field("Fax").value, email: field("Email").value, status: field("Status*").value
      };
      state.saves++;
      state.sites.push({ name: state.lastForm.name, address1: state.lastForm.address1, city: state.lastForm.city });
      $("sites").innerHTML = rows();
      form.style.display = "none";
    });
    window.__site = state;
    return state;
  };
})();
