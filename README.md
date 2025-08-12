CSV → text2qti Converter (Canvas) — README
What this is

A single-file website (canvas-csv-to-text2qti.html) that converts a CSV of quiz items into the plain-text format accepted by text2qti, so you can generate a QTI .zip and import into Canvas. Works offline in any modern browser. No Python required.
What you need

    A modern browser (Chrome, Edge, Firefox, Safari)

    The HTML file: canvas-csv-to-text2qti.html

    A CSV built from the template this site provides

    Access to a text2qti converter (e.g., your URL: http://ec2-34-207-154-191.compute-1.amazonaws.com)

    Your Canvas course to import the QTI .zip

Quick start

    Open canvas-csv-to-text2qti.html.

    Click Download Template CSV and open it in your spreadsheet tool.

    Fill in rows (one item per row). Images are optional.

    Save as CSV.

    Back on the website, upload your CSV and click Convert.

    Click Download .txt.

    Click Continue to Converter, upload the .txt, generate the QTI .zip.

    In Canvas: Settings → Import Course Content → QTI .zip.

CSV column schema
Column(s)	Purpose
Type	MC, MR, TF, NUM, SA, ESSAY, FILE, TEXT, QUIZ_META
Title	Question title (optional)
Points	Point value (ignored for TEXT, QUIZ_META)
Body	Question prompt or TEXT content
Answer1..Answer5	Choices (MC/MR/TF), acceptable answers (SA), rule (NUM in Answer1)
Correct	MC/TF: one index 1–5; MR: comma list (e.g., 1,3)
GeneralFeedback	General feedback
CorrectFeedback	Feedback on correct
IncorrectFeedback	Feedback on incorrect
Choice1Feedback..Choice5Feedback	Per-choice feedback F..J (optional)
TextTitle, TextContent	Only for Type=TEXT
QuizTitle, QuizDescription	Only for Type=QUIZ_META
BodyImageURL, BodyImageAlt	Prompt image URL and alt (optional)
BodyImageWidth, BodyImageHeight	Prompt image size: px or % (e.g., 300, 60%)
Answer1ImageURL..Answer5ImageURL	Choice image URL(s) (optional)
Answer1ImageAlt..Answer5ImageAlt	Choice image alt text (optional)
Answer1ImageWidth..Answer5ImageWidth	Choice image width (optional)
Answer1ImageHeight..Answer5ImageHeight	Choice image height (optional)

Notes:

    The header row is never included in the generated TXT.

    Width/Height can be left blank; you may supply only width.

Question types (minimal examples)
Multiple Choice (MC)

    CSV: Type=MC, choices in Answer1..Answer5, correct index in Correct.

    TXT generated (shape):

Title: Optional
Points: 2
1.  What is 2 + 3?
a)  6
b)  1
*c)  5
d)  10

Multiple Response (MR)

    CSV: Type=MR, correct like 1,3.

    TXT generated (shape):

Title: Optional
Points: 3
1.  Select all dinosaurs.
[*] Tyrannosaurus rex
[*] Triceratops
[ ] Smilodon

True/False (TF)

    CSV: labels in Answer1 and Answer2 (or leave default True/False); Correct=1 or 2.

Numerical (NUM)

    CSV: put the rule in Answer1.

        Exact: 5

        Range: [1.2598, 1.2600]

        Margin: 1.4142 +- 0.0001 or 100 +- 5%

Short Answer (SA)

    CSV: acceptable answers in Answer1..Answer5.

Essay (ESSAY)

    CSV: Type=ESSAY. No answers; optional prompt and prompt image.

File Upload (FILE)

    CSV: Type=FILE. No answers; optional prompt and prompt image.

Text Block (TEXT)

    CSV: Type=TEXT, use TextTitle and TextContent. No points.

Quiz metadata (QUIZ_META)

    CSV: Type=QUIZ_META, use QuizTitle and QuizDescription. Put this as the first data row.

Images (prompt and choices)

    Supported anywhere you provide:

        BodyImageURL, BodyImageAlt, BodyImageWidth, BodyImageHeight

        AnswerXImageURL, AnswerXImageAlt, AnswerXImageWidth, AnswerXImageHeight

    Width/Height examples:

        Pixels: 320

        Percent: 60%

    Tips:

        Upload images to Canvas → Files, copy the image URL, and paste it into the CSV.

        You can also use any publicly reachable https:// image URL.

        Alt text is recommended for accessibility.

On-page Image Size Helper

    In Image size helper, upload a local image to see natural dimensions.

    Set Width and Height values (px or %).

    Copy the Markdown line preview to guide values for your CSV fields.

    Replace URL with your Canvas Files URL (or public URL) in the CSV.

Workflow details

    Create CSV

        Use the template to ensure all columns are present.

        One item per row.

    Generate TXT

        Upload CSV → Convert → Download .txt.

        The header row is excluded automatically.

    Create QTI

        Click Continue to Converter, upload the .txt, export QTI .zip.

    Import to Canvas

        Canvas → Settings → Import Course Content → QTI .zip.

Validation checklist

    Types are valid: MC, MR, TF, NUM, SA, ESSAY, FILE, TEXT, QUIZ_META

    MC/TF: Correct has exactly one index 1–5

    MR: Correct uses comma-separated indices

    NUM: rule lives in Answer1

    SA: list acceptable answers in Answer1..Answer5

    TEXT: use TextTitle, TextContent

    QUIZ_META: use QuizTitle, QuizDescription (first data row)

    Image URLs load in a browser

    Points are numbers (optional for TEXT/QUIZ_META)

Troubleshooting

    No output produced
    Check that the header names match the template exactly and that at least one data row has a valid Type.

    Choices missing
    Ensure Answer1..Answer5 cells have values or leave them blank only if using images. If a choice has only an image, leave the text empty and set the corresponding AnswerXImageURL.

    Image size looks off in Canvas
    Try using only width (leave height blank) or switch from px to % (or vice versa). Large images may be styled by Canvas; test a few sizes.

    Import fails in Canvas
    Re-generate TXT, re-convert to QTI, and retry the import. Validate that your converter accepted the TXT without errors.

Known limitations

    Matching questions are not supported by this TXT format.

    Up to 5 choices per item are provided in the template.

Versioning

    HTML generator: current revision with vertical Image Size Helper and single bottom “Continue to Converter” button.

    Template CSV: canvas_csv_template_all_types_with_images.csv generated by the page.
