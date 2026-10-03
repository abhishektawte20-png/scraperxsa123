# ScraperX RTS Profile Assistant: sharing it with the team

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
