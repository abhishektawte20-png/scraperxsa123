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
