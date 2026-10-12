# Certificate Studio

Make personalised certificates in bulk, entirely in your browser. You upload a template, add a list of names, place the name where it belongs, and download one certificate per person.

- **Private by design.** There's no server, account, or tracking. Files are read locally and never uploaded. The page's Content Security Policy blocks network requests (`connect-src 'none'`), so it can't send data anywhere even by accident.
- **Works offline.** All libraries and fonts are bundled in this folder.
- **Arabic and English.** Text direction is detected per name (or can be forced to LTR/RTL), and the bundled Arabic typefaces are Amiri, Cairo, and Tajawal.

## Getting started (Windows)

Double-click **Certificate Studio** on your Desktop, or open **`Start Certificate Studio.bat`** in this folder. The app opens in your default browser. Nothing is installed.

You can also open `index.html` directly in a browser. A current version of Chrome, Edge, or Firefox is recommended.

## Desktop app (Windows)

Certificate Studio is also available as a standalone Windows app. It's the same app in its own window, and it doesn't need a browser or an internet connection.

- **Installer:** `Certificate-Studio-Setup-<version>-x64.exe` installs the app for the current user (no admin rights needed) and adds Desktop and Start Menu shortcuts. You can remove it later from *Settings → Apps*.
- **Portable:** `Certificate-Studio-<version>-x64-Portable.exe` runs without installing anything.

In the desktop app, exports open the standard Windows *Save* dialog, starting in your Downloads folder. On top of the web version's protections, the app blocks every non-local request, so certificate data stays on your computer.

The executables aren't code-signed, so Windows SmartScreen may show "Windows protected your PC" the first time. Click **More info → Run anyway**.

**Building it yourself** requires [Node.js](https://nodejs.org/) (internet access is needed only for the build):

```
npm install
npm start        # run the desktop app from source
npm run dist     # build the installer and portable .exe into dist/
```

## How to use it

1. **Template.** Upload a PNG, JPG, WEBP, SVG, or PDF, or drop the file onto the canvas. For a multi-page PDF, pick the page you want. You can also start from the built-in sample design.
2. **Recipients.** Type or paste names, one per line, or click **Import Excel / CSV** (`.xlsx`, `.xls`, `.csv`, `.ods`). The importer guesses which column holds the names (it recognises headers such as *Name*, *Full Name*, *الاسم*). You can change the column, then replace your list or add to it. `samples/sample-names.xlsx` is included for trying it out.
3. **Name style.**
   - **Moving and sizing.** Drag the dashed box to move the name. The side handles change the box width and the round corner handle changes the text size. Arrow keys nudge the box (hold Shift for bigger steps), and a guide appears when the box is centred.
   - **Styling.** Choose the typeface, bold or italic, alignment, direction, size, colour, letter case, and tracking.
   - **Your own font.** The **+** button loads a `.ttf`, `.otf`, or `.woff` file.
   - **Long names.** *Shrink long names to fit the box* scales down names that would otherwise overflow.
4. **Preview.** Use the arrows above the canvas, or click a name in the list.
5. **Export.** Choose PDF, PNG, or JPG, then:
   - **This certificate** downloads the one you're previewing. The download icon on each row in the list does the same for that name.
   - **Download all (ZIP)** gives you one file per name. File names follow the recipient, duplicates get a `(2)` suffix, and *Number file names* adds `001 - ` prefixes.
   - **All in one PDF** puts every certificate in a single multi-page PDF.

Your layout, style, and name list are saved in the browser for next time. Templates are not stored, so you'll need to upload yours again after closing the app.

## Output quality

| Template | Output resolution | PDF page size |
| --- | --- | --- |
| Image | The image's own pixel size (capped at 7000 px on the long edge) | A4-equivalent long edge, matching the image's proportions |
| PDF | Rendered at ≈300 DPI for A4 | Same as the original page |

PDF exports contain a high-quality image of each certificate, so the text isn't selectable. For the sharpest result, use a high-resolution template, ideally at least 3000 px wide.

## Tips

- If a name looks too high or low on the line, set the box's vertical centre to where the middle of the letters should sit.
- For very large batches (hundreds of names), ZIP export uses less memory than a single combined PDF.
- If your browser asks whether to allow multiple downloads, allow it for this page.

## Project structure

```
index.html                 App markup
css/styles.css             Styles
js/app.js                  All application logic
vendor/                    pdf.js, jsPDF, JSZip, SheetJS (with licences)
fonts/                     Bundled typefaces (SIL Open Font License)
assets/icon.ico            Launcher icon
samples/sample-names.xlsx  Example name list
Start Certificate Studio.bat
electron/main.js           Desktop app (Electron) wrapper
package.json               Desktop build configuration
```

## Third-party components

- [pdf.js](https://mozilla.github.io/pdf.js/) 3.11 (Apache-2.0) renders PDF templates.
- [jsPDF](https://github.com/parallax/jsPDF) 2.5 (MIT) writes the PDFs.
- [JSZip](https://stuk.github.io/jszip/) 3.10 (MIT/GPLv3) builds the ZIP archives.
- [SheetJS Community Edition](https://sheetjs.com/) 0.18 (Apache-2.0) reads spreadsheets.
- The typefaces are Amiri, Cairo, Tajawal, Playfair Display, Cormorant Garamond, Great Vibes, and Montserrat, all under the SIL Open Font License and bundled through Fontsource.
