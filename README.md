# Batch Genie — Quiz Tools for Canvas (v7.2)

Two tools on one page, switched with the tabs at the top:

- **AI Quiz Extractor** — turn a document into a Canvas-ready QTI quiz.
- **Paper Test Builder** — pull from your Canvas question banks to generate scrambled paper test versions with answer keys.

---

## Paper Test Builder

Built for the ExamView workflow: load banks → pick questions → split the test into sections → generate versions.

**1. Question Banks.** Load one or many .zip files at once — Canvas question-bank exports or saved Batch Genie sessions. Each XML file inside a Canvas export becomes its own bank (Canvas puts each bank in a separate file), so a single zip can give you several banks to pull from. Check the banks you want active.

**2. Select Questions.** Browse everything in the active banks, filtered by type or a text search. Click **View** on any question to see it with its correct answer marked. Check the ones you want, or use **Select All Shown** or **🎲 Pick Random…** to grab N at random. A running counter shows how many are selected.

**3. Test Sections.** Each section holds a block of question numbers (shown as Q1–20, Q21–35, and so on) and draws that many questions at random from your selected pool. Narrow a section to certain question types or certain banks. Mark any question **Required** and it appears in that section on every version — useful for the questions everyone must answer.

**4. Versions & Scrambling.** Choose how many versions and name them whatever you like (A, B, C or Blue/Gold or 1st Period/3rd Period). Independently toggle: scramble question order within sections, scramble answer choices within each question, or scramble all questions across the whole test. Then decide whether every version uses the same questions in a different order, or draws a different random set each time.

**5. Generate.** Preview each version's answer key inline, print any version, or download the whole package as a zip:

- `*.docx` — a real Word file per version, editable before printing. Images and chemistry Unicode carry over.
- `*_print.html` — open and press Cmd+P to print or save as PDF.
- `*_answer_keys.csv` — every version, one row per question, with section, type, points, and source bank.
- `*_zipgrade_key.csv` — all versions in one file, ready to import into ZipGrade for bubble-sheet scanning.

True/False choices are never scrambled (a reversed "False / True" reads as a mistake). Written-response questions get blank answer lines sized to the type and are left off the ZipGrade key, since a scanner can't grade them — the plain CSV still lists their answers for hand grading.

---

# AI Quiz Extractor

Batch Genie turns any quiz document into a Canvas-ready QTI zip in minutes. Upload a PDF, Word doc, or text file; the AI extracts every question, suggests correct answers, and formats chemistry notation properly (H₂O, 6.02 × 10²³, SO₄²⁻). Review and edit in the browser, then export for Canvas or Blooket.

It is a single-file website — `index.html` — with no build step and no server beyond a small Google Apps Script key vault.

## What it does

Upload a **PDF, .docx, .txt, or .md** file and Batch Genie will extract every question with AI, including embedded images from PDFs and Word docs. You review and edit everything in the browser: answers, points, images, feedback, and quiz settings. Then export:

- **QTI .zip for Canvas** — import via Course Settings → Import Course Content → QTI .zip file. The quiz title, description, shuffle/show-correct settings, access code, and due/availability dates are included via `assessment_meta.xml`, the Canvas-native settings file.
- **Session .zip** — saves the full workbench (questions + images) so you can resume editing later, on any device.
- **Blooket CSV** — every supported question converted to Blooket's multiple-choice format, with AI-generated distractors for numeric and short-answer questions. Images are not supported by Blooket CSV import; add those inside Blooket.

You can also **import a Canvas QTI export** back into the workbench for editing, and **merge multiple saved sessions** into one combined question bank.

## Supported question types

MC (multiple choice), MR (multiple response), TF (true/false), NUM (numerical with sig-fig-aware bounds), SA (short answer), FIB (fill in multiple blanks), ESSAY, and FILE (file upload). Matching questions are not supported by this QTI profile.

For FIB questions, type `[blank_id]` markers directly into the question text (e.g. `The pH is [ph_blank] and the pOH is [poh_blank]`) — the blank answer fields appear as soon as you click out of the text box.

## Setup

1. Host `index.html` anywhere (GitHub Pages works) or open it locally in a modern browser.
2. Create the key vault: new Google Apps Script project → paste in `api-key-vault.gs` → set the two Script Properties (`anthropic_api_key`, `settings_password`) → deploy as a web app ("Execute as: Me", "Who has access: Anyone") → put the deployment URL in the `VAULT_URL` constant in `index.html`.
3. Open the site, click the ⚙ gear, and enter your settings password once. The AI unlocks and stays unlocked on that device.

The vault never reveals the API key without the password, and the password is only ever sent in POST bodies. The AI model (Claude Sonnet 5 by default; Opus 5 and Haiku 4.5 available) is selected in the same settings modal.

## Workflow

1. **Upload** a document, set extraction preferences, and click Extract.
2. **Review** every question — the AI flags its suggested answer, but you are responsible for verifying correctness before export.
3. **Configure** quiz settings: title, description, points, access code, availability/due dates, shuffle, one-at-a-time.
4. **Export** — Download QTI for Canvas, Save Session to resume later, or Export Blooket CSV.
5. **Import into Canvas**: Course Settings → Import Course Content → QTI .zip file. After import, open the quiz in Canvas to confirm settings and set anything QTI can't carry (time limits, multiple attempts).

Before every export, Batch Genie validates the quiz and blocks the download if any question has no correct answer selected, empty answer choices, an invalid numerical rule, or FIB blanks without answers — so a half-finished question can't silently become a mis-keyed quiz.

## Notes and limitations

Point values: if the source document states point values, the AI uses them; otherwise every question gets an automatic share of 100 points, which you can change globally with Update Point Values. Numerical answers accept `[min, max]` ranges, `value +- margin` (absolute or `%`), or exact values; the Exact Answer Updater computes sig-fig-appropriate bounds for you and understands `6.022e23`, `6.022 × 10²³`, and plain decimals. The chemistry sanitizer converts common plain-text notation to proper Unicode, but deliberately leaves letter-digit pairs at word ends alone (so electron configs like `1s2` in source text aren't wrongly subscripted) — the AI handles those during extraction. Large image sets may exceed browser storage for the auto-saved session; use Save Session (.zip) to preserve images reliably.

## Files

`index.html` — page shell, tabs, and the AI extractor. `test-banks.js` — question-bank loading. `test-compose.js` — version building and scrambling. `test-export.js` — Word/print/CSV output. `test-builder.js` — the Paper Test Builder interface. `api-key-vault.gs` — the Google Apps Script key vault (deployed separately; contains no secrets, which live in Script Properties).

**Deploying vault changes:** editing and saving the Apps Script does *not* update the live web app. You must go to Deploy → Manage deployments → edit the existing deployment (pencil icon) → Version: **New version** → Deploy. Editing the existing deployment keeps the same URL, so `VAULT_URL` in `index.html` stays valid; "New deployment" would create a different URL and break the link. Note also that the vault project may live under a different Google account than your default — check which account you're signed in as if changes appear to have no effect.

---

Created by Chris Leatherwood — Tyler, TX · v7.2 · © 2025–2026
