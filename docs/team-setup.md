# ScraperX UI Automation Tool: sharing it with the team

## For the person who sets up the mappings (the team lead)

1. Load the extension (see "Installing" below) and map every field you need
   ("Map this field" in the preview, or "Teach new field"), plus any output
   rules. Check that each one works on a profile where a test entry is safe.
2. Open **Teach new field** (the "Mapped & taught fields" window) and press
   **Export team defaults**. Chrome downloads a file called `teamDefaults.js`.
   If nothing downloads, press **Copy instead** and paste into the file.
3. In the extension folder, replace `core/teamDefaults.js` with the downloaded
   file.
4. Open `chrome://extensions` and press the reload arrow on the extension.
   Check that the mapped fields are listed as "team default".
5. Zip the whole extension folder and send it to the researchers.

When RTS changes a field, or you map a new one, repeat the steps and send a
new zip. Researchers reload it; their own changes are kept.

## For researchers

### Installing
1. Unzip the folder you were sent. Keep it somewhere permanent.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Press **Load unpacked** and choose the unzipped folder.
   To update later: unzip the new version over the same folder (or choose the
   new folder), then press the reload arrow on the extension.
4. Chrome will ask to allow access to `rts.pitchbook.com`. Accept it.
5. **Allow pop-ups for `rts.pitchbook.com`** (Chrome settings > Privacy and
   security > Site settings > Pop-ups and redirects > Allowed). Some RTS forms,
   such as Social Media Identifier, open in their own window and the extension
   opens them for you.

### Using it
Mappings the team lead made are already in place: just paste the agent's
output, validate, preview and publish. You do not need to map anything.

If one field does not work for you, open **Teach new field**, press **Re-map**
on it and pick the field again. Your change is saved in your browser only and
replaces the team version for that field. **Reset to team defaults** (same
window) removes your changes.

## Feedback channel (for the person who maintains the tool)

The **Feedback** button (and **Send to developer** under the issue report) posts
the report to a channel in one click.

1. In Microsoft Teams open the channel, press the three dots, choose
   **Workflows**, and pick **Post to a channel when a webhook request is
   received**. Finish the wizard and copy the web address it gives you.
2. Open `core/feedbackConfig.js` in the extension folder, paste the address
   between the quotes of `webhookUrl`, save, and reload the extension on
   `chrome://extensions`. Send the folder to the researchers.
   (Or, for yourself only: Feedback window, **Set up the channel**, paste, **Save
   channel address**.)
3. Slack, Google Chat and Discord webhook addresses work the same way. Any other
   address is refused, and the extension is only allowed to contact those hosts.

Anyone who has the address can post to the channel, so share the extension
only inside the team. Without an address the Feedback window offers **Copy
instead**.

## Run history

Every report you validate is kept in your browser for 15 days and erased
automatically after that (**History** button). Open a run to see what the agent
returned that day, tick two runs of the same company and press **Compare** to see
which values changed, or **Export all** to save them to a file. **Erase all
history** removes everything at once. Nothing leaves the browser unless you
export or send it.

## Take a break (Super Over)

The **Take a break** button in the panel opens a small cricket batting game for the moments when RTS is slow. It runs entirely inside the extension: no network, and nothing is read from or written to RTS. Only the chosen timing level and the best score are kept on the user's own browser (`chrome.storage.local`, key `sxrts_game`). **Esc** or **Back to work** closes it. The three timing levels (Relaxed, Normal, Pro) change how forgiving the swing window is.

## When something cannot be done

- **JSON problems.** If the pasted JSON has a simple slip (a comma before a closing bracket, curly quotes, a raw line break inside a text value, comments, `True`/`False`), the extension fixes it, says what it changed, and validates the result. Anything that would need a guess is not touched: the panel shows the line, column and the text nearby in plain words, and **Generate Correct JSON Prompt** copies a message for the agent that asks for the same data again as valid JSON (nothing added or removed).
- **Valid JSON is not the same as "can be written".** The banner turns amber and counts the fields that have no RTS mapping yet.
- **Automatic page capture.** For every field that could not be written (not mapped yet, or a control not found) the report ends with the structure of the page area around that field, found by the field's own label. Typed values are never read, and text is kept only for labels and buttons, so company data on the page is not copied. **Copy report** includes it, and **Send to developer** sends it to the channel (a tick box in the Feedback window turns this off). Open the section where the field is entered before copying the report, otherwise the field is listed as "Not on screen".

## Industry tagging (a tree of checkboxes in a separate window)

On the Industry code row of the preview press **Map this field**, choose **Separate window**, pick the button that opens the window (it must be an enabled button), then **Open the window and pick its fields**. In the window choose **A tree of checkboxes**, click one **+** button, one **checkbox** and the **Save** button, then **Done**.

When publishing, the extension opens the window, opens the branches until the industry named in the report is on screen, ticks only that one (never unticks anything), saves, and then **reads the tick back** (it reopens the window if the page closes it) before reporting success. A choice that is already ticked is skipped. A generic name such as "Other" exists in many groups, so it is chosen by its code (for example 2.2.2 is the 2nd branch, its 2nd group, that group's 2nd choice) and refused if that place holds a different name.

For the window mapping, the quickest way is **Detect automatically (one click)** in the tree mode: the extension finds the checkboxes, the + buttons and the Save button by itself, tests the + buttons by opening and closing one branch, and fills in the steps. Check what it found and press Done. If something is missing it says which part to pick by hand, and **Copy this window's structure (for the developer)** copies the window's layout (no typed values, no free text) so the mapping can be fixed quickly. A mapping is made once; export it from **Mapped & taught fields** as team defaults and everyone else gets it from day one.

## Sections, keywords and reports (v0.20.3)

- **Sections are opened for you.** Before publishing, and after switching between the Business Entity and Company tabs, the extension presses RTS's own **Expand** control once, so a field is not missed only because its section was collapsed.
- **Keywords (a tag box).** Map the box once (**Map this field**, pick the "Enter or paste keywords" box as both the box and the Add button). When publishing, each keyword is typed, Enter is pressed (RTS offers the exact existing keyword if there is one, otherwise "(new)"), Save Changes is pressed only if it is waiting, and success is claimed only when the tag is really on the page. Keywords that are already tags are skipped.
- **Reports.** The page capture now ignores a mapped button that is hidden (a look-alike inside a pop-up) and knows the names RTS uses for Name Variations, Website Address, Email Default Structure and SIC.
- **Industry tagging detection** now also works when the tree draws its choices only after a branch is opened.

## What the results mean (v0.21.0)

After **Publish and save** each field ends in one of four states:
- **Saved** (green): written, saved with RTS's own Save button, and read back from the page.
- **Already in RTS** (green, muted, folded away): RTS already holds the value, so nothing was changed. This is never a failure.
- **Needs attention** (red): something really went wrong; the line says what.
- **Not mapped** (grey): the extension does not know where this goes in RTS yet. These rows are folded under "Waiting for RTS mapping".

Social media values are written as the bare handle on every network (`facebook.com/RelianceIndustriesLimited/` becomes `RelianceIndustriesLimited`; no address, no @, no trailing slash). The preview shows the handle and it stays editable. Page captures never copy attribute values that look like links or ids.

**A fixed extension ID.** From this version the extension carries a fixed key, so Chrome gives it the same ID (`dojojjlelcjpebaekkgmpagfcolnfhig`) wherever the folder is loaded, and mappings made in the browser survive moving or re-loading the folder. Upgrading to this version from an older one starts with empty browser storage once (mappings that were only in the browser are lost; those shipped as team defaults are not). Export your mappings as team defaults first.

## Industry tagging on RTS's real markup (v0.21.2)

RTS draws the industry tick boxes itself (`div.controls_checkBox`) and the + buttons are `div.sub-section__icon-expand`. **Detect automatically** recognises both, remembers what an *unticked* box looks like, and tests the + buttons. A choice counts as ticked when its look differs from that usual look (a real checkbox is read directly). If a window for the form is already open (RTS opens the industry window under a fixed name), publishing now reuses it instead of failing with "No popup window opened".

## Industry window: Detect reads the whole list (v0.21.3)

RTS gives every branch its own box (`controls_emptyCheckBox`, inside a `controls_checkBox_border` frame) and the choices a box of their own (`controls_checkBox`). **Detect automatically** now picks the *choices* only: it ignores the frame and the branches' own boxes, and finds the choices by the letters of their id around the record number (`industryControlCode…CheckBox`). It then opens every branch and reports what it read, for example "Found: 227 choices in 49 branches; + buttons tested; Save button "Save Changes"". The picker window is laid out so **Done** is always in view, the manual picking is folded away once detection succeeded, and "press before Save" is under Advanced (the industry window has no such step).

## Fixes after the first real industry run (v0.21.4)

- **Detect never ticks anything.** Tick boxes are small and clickable, so earlier versions mistook them for + buttons and clicked them while reading the list. They are now excluded, and Detect checks that no box changed (and warns to close the window without Save if one did).
- **Both levels of + buttons.** RTS's sector buttons and group buttons have different ids (`industryControlGroup…Expander`, `industryControlSegment…Expander`); Detect keeps both, top level first.
- **A choice is found by the place RTS gives it.** Every choice's click handler carries `checkCode(this, sector, group, choice)` counted from 0, which is the code minus 1: 2.5.6 is (1, 4, 5). The extension opens the sector and group by that place, ticks the choice there, and refuses if the name RTS lists at that place is not the reported name, or if the reported name sits at a different code.
- **A window that goes away on Save** (RTS submits the form) is no longer a crash: the extension reopens the window and reads the tick back.
- **Keywords:** Enter is pressed again (up to three times, waiting longer each time) if the suggestion list was not ready.
- **Mapped fields on the other tab:** if a mapped control is not found, the extension switches between Business Entity and Company (which also expands the sections) and tries once more.
- **Page captures** count rows that differ only in numbers as the same row ("N more similar").

## 0.21.5

- Industry tagging: if RTS closes or reloads the industry window while the extension is working in it (Chrome says "Frame with ID 0 was removed"), the extension now opens the window again and repeats the job, up to 3 tries. A choice that is already ticked is only reported, so repeating is safe. Everything else about the industry window works exactly as in 0.21.4. If all tries fail, the error is shown, never a success.

## 0.22.0

- **Undo** (button next to Publish). Every publish is written to a ledger kept 15 days: what was saved and what was there before. "Undo N changes" reverts, then reads RTS again to confirm: the Industry tick (unticked and saved), a replaced Website address or Email default structure (previous value put back; an empty website is emptied), and replaced single-value mapped fields. Rows that were *added* (name variations, keywords, SIC/NAICS, sites, social media, management, research notes) are listed exactly, with where to delete them; the extension has not been taught how RTS deletes those rows and does not guess. Undo is blocked on a different profile than the run was made on.
- **Field health** (button next to History). Per field: success rate, saved / already in RTS / failed / not mapped, the most common error, and the failure log, for the last 7 or 30 days. Success rate means "RTS showed it saved (or already there)", i.e. whether the automation works; whether the agent's value was right is still a QA call. Numbers stay in the browser for 35 days.
- **Weekly digest.** Once a week, each browser posts its field-health numbers and failure log to the team channel (the Feedback webhook). No channel set: nothing is sent and nothing is lost; open Field health to copy it, or press "Send digest now". To start it, set the webhook in `core/feedbackConfig.js` or in the Feedback window.
- **Fix:** the "Save clicked" note to the background is now acknowledged before Save is pressed. A page that closes its window the instant Save is accepted could previously win the race and a successful save was shown as "the window closed before it reported back".

## 0.22.1

- **"No popup window opened" fixed at the root.** That message came up when a window for the form was already open: RTS then only brings it to the front, which opens nothing new for the extension to find. The extension now (1) also watches for any pop-up that was not there before, even if Chrome gave no event; (2) after 2.5 seconds without a new window, uses the window that is already open and brings it to the front; (3) if that window holds an old page (not the form), closes it and presses the button once more for a clean one. The message only appears now if there really is no window and the button opens none (disabled button, or pop-ups blocked).

## 0.22.2

- **NAICS one-click mapping.** In "Map NAICS codes", the new **Detect everything** button finds the Add NAICS button (if it is not picked), opens the dialog by itself, finds a + button, a code's radio button, the dialog's Save and the section's own Save Changes (never the look-alike GECS one), closes the dialog and fills Steps A to E. Nothing is chosen or saved while detecting. Picking each part by hand still works.
- Industry tagging was not changed in this version.

## 0.23.0

- **Site, built in (no mapping needed).** The report's address fields (address, city, state, country, postcode, phone, fax, site email), or a `company.sites` record, are published as ONE site: the Site section is opened (and the Company tab if needed), **Add New Site** is pressed once, the whole form is filled, **SAVE** is pressed once, and the new site is read back from the section.
  - Site type is always **Primary HQ**, status always **Current**, and the site name is the **city** (the report's own values for these are ignored).
  - A site that is already listed (same address line; same city when the report has no address) is not added again: it shows as **Already in RTS**. Tick **Add the site even if one already exists** (shown under Publish when the report has a site) to add it anyway.
  - If a value is not one of RTS's choices (for example a country), nothing is saved and the form is cancelled, so no half-filled form is left open.
  - Updating an existing site is not included yet (it needs RTS's edit form).
  - The 8 separate site mappings in earlier team defaults are no longer needed (they would have saved one site per field); they are removed from the shipped defaults, and a built-in Site always wins over a taught one.
- **Output rules: "Applies to" is now built from the report's fields.** Employee count, address, city, state, country, postcode, phone, industry code, NAICS, verticals and every other field of the report (and any field you teach) can carry a rule, and a new field appears by itself. Existing rules keep working.

## 0.24.0

- **Check mappings** (button next to Field health). Looks on the open profile for every button, box, tick box and Save button the extension uses (your mappings, the team's, and the built-in ones including Site) and says for each part whether it is found, with a green / amber / red result per mapping and a "Copy report" for the developer. It **writes nothing**: no value is typed, nothing is ticked or saved. Windows and dialogs it needs (Industry, NAICS, Site, Social) are opened and closed again by themselves; a mapping whose section is not showing is looked for on the profile's other tabs, then the tab you were on is shown again. Run it before a batch of work to find a broken mapping early.
- **Team defaults: the Industry code mapping no longer has a "press first" Save.** It pressed Save Changes twice (once as a "press first" button, once as the real Save), which could close the window under the script ("Frame with ID 0 was removed"). No code of the Industry flow changed.

## 0.25.0

- **Site section now opens.** RTS keeps the Site bar's click handler on a small icon inside the bar, so pressing the bar itself did nothing. The extension now presses the icon / title inside the bar first (and the bar, and any "Site" text), tries the Company tab and the other tab, and if the section still cannot be opened it says so plainly and tells you to open it by hand and publish again.
- **Unmap, everywhere.** "Unmap" is now on every mapped field's card in the preview, on every mapping in "Mapped & taught fields" (your own are deleted; a **team** mapping is hidden on this browser only), and on any failing mapping in Check mappings. "Restore" (in Mapped & taught fields, under *Unmapped team mappings*) brings a hidden team mapping back; "Reset to team defaults" restores all of them.
- **Analyze page** (button next to Check mappings). For anything that cannot be mapped the usual way: it reads the page (or the open window) and lists every box and button with its words, required flag and dropdown choices, grouped by form, and guesses which report field each box fills. Choose the button that opens a form and "Press it and scan" to see the form it reveals (a separate window is read through the worker and closed again). Then **Create mapping** turns the whole form into ONE mapping: pick the report field (for example Management), which box takes which value, a fixed value for any box (for example Relationship = Executive), and the Save button. When published, the extension opens the form, fills every box and presses Save once, per record. "Copy analysis" gives a text account (no typed values) to send to the developer. Scanning only reads.
  - A form that closes itself on Save is reported as saved by state, not read back, and says so.
  - Multi-window flows (for example Management's person search, then "add new person", then the position) are scanned window by window; mapping a window is done with Teach new field > Separate window. A guided multi-step flow is the next step.

## 0.26.0

- **Lighter extension.** Removed: the **Field health** window, **Check mappings** and **Analyze page** (and the whole-form mapping they made). Industry tagging, NAICS, Site, Undo, Unmap, output rules and the automatic **weekly digest** (posted to the team channel once a week; it needs no window) stay.
- **Site can be unmapped.** "Unmap Site" is on the Site cards in the preview and "Site · built in" is listed first in Mapped & taught fields. Unmapped, the Site fields wait for a mapping like any other field (an old taught Site mapping of your own, if you have one, becomes active again and can be unmapped from the same list). "Restore" turns the built-in Site back on.
- **Site is more reliable.** It now (1) treats Save as done when RTS closes the form *or* leaves it open with Save greyed out again, and puts the form away; (2) waits for the state list to load after the country is chosen; (3) reads every box back before Save and fills again any that the page wiped when the country changed; (4) when the report has only a full address, takes the missing city, state, country and zip from it (what the report does give is never replaced).

## 0.27.0

- **Set up Site** (Mapped & taught fields > *Site · built in* > Set up; also on every Site card). Adding a site is ONE go: the extension presses the button that opens the form once, fills every box, and presses SAVE once. You never map the site's boxes one by one. In this window:
  - **Find the Site form** opens the Site section and the form (left open) and lists, with a tick or a cross, what it found: the section, the Add New Site button, every box, the State list or box, the Primary HQ / Current choices, SAVE and Cancel. Nothing is typed or saved.
  - A cross has **Point at it**: click the real box (or button, or the bar that opens the section) on the page and it is remembered; what you pointed at is the only thing used for that box, never a look-alike.
  - **Try it (nothing is saved)** fills the form with sample values up to SAVE, reads everything back, empties the form and closes it. The steps done are shown.
  - **Copy log** gives the ticks, crosses and steps to send to the developer. **Forget what I pointed at** goes back to the extension's own guesses.
  - What was pointed at is saved in this browser and travels with **Export team defaults** (`siteSetup`), so everyone gets it from day one.
- A failed Site now says where it stopped ("Done before this: Site section open; Add New Site pressed, form open; site name, site type").
- Values typed by a try-run or by a run that failed are emptied when the form is put away, and text boxes the report does not fill are emptied before the next site, so nothing leaks into the next site.

## 0.27.1

- **Site: the State box.** A real run stopped at "State: neither a dropdown nor a box was found in the form" (after site name, site type, address and country were filled). The State box is now found by its name, by the words printed beside it ("State", "Province", "Region"), by the choice it offers (a dropdown that lists the state), or as a plain box; and its choices are waited for up to 9 seconds after the country is chosen (RTS loads them late). If no State box exists at all, the site is still tried (outside the US it is not needed); if RTS then refuses Save, the message says the State box was not found and lists the boxes that are on screen.
- All other Site boxes are also found by their printed words when RTS gives them other names.
- A site listed with only its street is recognised when the report gives the whole address (same street and same city).

## 0.27.2

- **Site: a clear result, and no false "saved".** The results screen showed "Saved Texas City; RTS now shows it as linked" once per Site field. It now shows ONE Site line. When the Site list cannot confirm the new site, it says "Saved Texas City, but the Site list does not show it yet. Check the Site list in RTS." and the card's detail shows what the list does contain. If RTS answers a Save with a message (Save greyed out, form still open), the extension reports RTS's own words and does not call it saved.
- **No second copy.** A site the extension added to a profile (even one the Site list could not confirm) is not added again for that profile for 30 days; "Add the site even if one already exists" still adds it.

## 0.27.3

- **Site: the form is no longer emptied or cancelled right after SAVE.** The extension used to empty the form and press Cancel as soon as Save greyed out. On a slow RTS that is still sending the values, this could cancel the save or send an empty site. Now, after SAVE, the form is left alone until there is evidence: the form closes, or the new site appears in the list. A message from RTS is reported in RTS's own words. If neither happens within 20 seconds, the form is left as it is and the card says so (nothing is cancelled).
- **Add New Site is found whatever it is.** Any control whose words are "Add New Site" now counts (an input of any type, a link, a button or a div with a span), including the button path from your earlier mapping, with the Site block checked first.

## 0.27.4

- **Phone (and fax) in RTS's format.** New output-rule step **"Format as a US phone number (281-941-6001)"**. The team defaults now ship four rules that use it (phone and fax, for the report's address fields and for a `company.sites` record), so a phone such as "(281) 941-6001" or "+1 281 941 6001" reaches the preview, and RTS, as 281-941-6001. Numbers of other countries, and incomplete numbers, are never changed. Turn a rule off in Output rules if another format is needed.
- **Site: if RTS refuses an optional box** (phone, fax, zip, email, address line 2), that box is emptied, SAVE is pressed once more, and the site is still added; the result says what was left out ("Saved Texas City without Phone (…): RTS refused it").
- **Site: RTS's own complaint is read.** Besides messages by class name, any red text in the form and any box marked invalid are read and shown, with the box named, in the card's message.

## 0.27.5

- **Site: typed the way a person types.** RTS's Site form builds its *Address Preview* and wakes **SAVE** from key presses, not only from "input"/"change" events. The extension now sends key down, key press, the value, key up, then leaves the box, for every Site text box, and presses SAVE with a full mouse press. If the Address Preview stays empty it nudges the address boxes once more and notes it in the steps ("address preview …" or "address preview stayed empty").
- **Site: Address Line 1 is the street only.** The report's full address ("12600 Crystal View Blvd., Texas City, TX 77568") is cut back to its street ("12600 Crystal View Blvd.") because city, state, zip and country have their own boxes.
- **Site: the new row is recognised** when the site's name appears once more in the Site list, even if the list shows the address cut short.

## 0.27.6

- **Site: the "(Format)" links.** Before SAVE, the extension presses the **(Format)** link beside Zip, Phone and Fax (only for boxes that hold a value). If RTS reformats the value, the reformatted value is kept; if RTS marks it as wrong, that box is emptied so the site can still be saved. The steps say what happened ("Format pressed for Phone: …").
- **Site: SAVE that does nothing.** If SAVE is pressed and neither the form closes, nor the list shows the site, nor RTS says anything, zip, phone and fax are emptied and SAVE is pressed once more, so the site is still added. The result lists what was left out ("Saved Texas City without Zip (77568), Phone (…)") so it can be added by hand.

## 0.27.7

- **Phone by country.** New step "Format the phone for the country": the number is written for the country of the same record (the site's own country, else the report's country). US and Canada are built in (`281-941-6001`). For any other country, add `Country=pattern` pairs in the step, e.g. `Germany=+49 ## ########; India=+91 ##### #####` (`#` = one digit). A country with no pattern is left exactly as it is; an incomplete number is never guessed.
- **Your own steps.** In Output rules > Add rule, pick any field and add conditions: *if the number is between … and …* (e.g. employee count 2–10 → `2-10`), *if equals / contains / starts with / ends with*, and *replace values from a list* (`a=b; c=d`). Steps run in order.

## 0.28.0

- **No waiting for OK.** While a publish runs, RTS's own message boxes ("Data is not saved.", "Another site is already set as Current Primary HQ.", …) are answered at once and listed under the results ("RTS showed … answered automatically"). A confirm is answered OK, except one that mentions deleting/removing/discarding, which is answered Cancel. Outside a publish, nothing changes. These boxes used to freeze the page until someone pressed OK, which made saves that had worked look like failures.
- **Save looked unfinished → look again.** If a save reports "not observed in time / did not complete" the field is re-checked once; a value that is already in RTS is reported as "already in RTS" (never added twice).
- **Primary HQ.** If another site already holds Current Primary HQ, the site is not added and the message says so plainly. (Moving HQ from the old site to the new one needs the existing site's edit form; not built yet.)
- **ANC mark.** Every profile gets `AIGEN_SRX_V1_Y - Used ScraperX UI Automation Tool for research` appended to Research Notes. The row is always there, marked "required", and cannot be unticked or edited. Existing notes are never removed.
- **Native names.** A name is "Native Other Name" only if it really contains non-Latin letters; a Latin-letter name stays "Other Name" even when the agent writes a script.
- **Quieter validation.** Notes about outside pages (registries, magazines) are no longer listed. Data aggregators (e.g. ZoomInfo, RevenueBase, Prospeo) and staging/hosting addresses (netlify.app, vercel.app, …) are still warnings.

## 0.28.1

- **Industry window.** (a) RTS windows opened by the extension are no longer given the dialog guard (they run exactly as in 0.27.x; the guard stays on the main RTS page). (b) After a window job the worker waits until that window is really gone before the next job can start, so a window that is closing is never mistaken for a new one. (c) A window that closes the moment the choice is ticked is read back by reopening it, instead of being reported as an error. (d) After three windows go away without reporting, one more window is opened only to READ the tick: ticked means "saved (read back from RTS)", otherwise it stays an error. (e) The error now names the last step the window reached. (f) Window-based fields are never re-run by the "look again" check, and wait 0.8 s for the previous save to finish.

## 0.29.0

- **Progress bar.** While Publish runs, a bar shows "N of M fields done", the step in progress, time so far and a rough time left. It turns green ("Done · all N fields processed") when everything went through and amber ("Finished · … need attention") when something needs a look, with the time taken and the counts.
- **Two Primary HQs.** A new tick box on the Site card, on by default: "If another site is already Primary HQ, add this one as Regional HQ". When RTS refuses because another site is already Current Primary HQ, the new site is saved with Site Type "Regional HQ" (the existing one is not touched) and the result says so. Unticked: the site is not added and the message says why.
- **Industry window.** Each retry now waits longer than the one before (1.2 s, 2.4 s, 3.6 s), there are four tries instead of three, the dying window is waited for before the next try, and the final error lists every step the window reached with its timing ("choiceFound +1.2s → tickClicking +1.4s …"). Send that line if Industry ever fails again.

## 0.29.1

- **Found: the Industry mapping could press the window's own Close button.** A mapping made by "detect everything" listed `#msa-close-btn` among the + buttons. While looking for the choice the extension pressed every + button in page order, so it could press Close first and the window shut before anything was ticked ("The window closed before it reported back"). Now (a) the extension never presses a control whose id, class, title or words say close / cancel / dismiss / exit, whatever a mapping lists; (b) the detector never offers one as a + button; (c) the shipped team defaults no longer list it.
- **Both tabs expanded.** Before a publish, every section of the Business Entity tab and of the Company tab is expanded (the Expand link is only pressed where it says Expand, so nothing already open is collapsed), and the page is scrolled back.

## 0.29.2

- **"No popup window opened" on Industry.** (a) Fields that open a window (Industry, NAICS) now run FIRST in a publish, right after the click on Publish. Chrome only lets a page open a window shortly after a person's click (about 5 seconds), and before this the Industry window waited behind the name, SIC and Site saves. (b) When a later try fails for a different reason than the first, both reasons are shown ("The first try had failed with: …"), and the RTS message boxes seen during the run are listed. (c) If this error still appears: Chrome > Settings > Privacy and security > Site settings > Pop-ups and redirects > allow https://rts.pitchbook.com.
