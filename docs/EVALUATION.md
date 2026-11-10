# Study-guide evaluation

`npm run evaluate -- --provider=mock --limit=4` checks actual outputs against the study schema: bounded summary, 3–6 concepts with provenance labels, 3–5 questions with nonempty answers/explanations, and bounded gaps. It writes a timestamped JSON report and exits nonzero on errors. The four fixtures include notes and topic modes.

This is a completeness check, **not an accuracy score**. Fixed mock examples cannot establish Gemini quality or learning outcomes. The original support-category classification benchmark was removed.

To evaluate Gemini, explicitly select `--provider=gemini` with private credentials and an available model in `.env`. Requests consume quota. Review the saved outputs against authoritative course notes or a textbook:

- Are the claims, calculations, and answers correct?
- In notes mode, does the summary stay within supplied material? Are added explanations marked additional?
- Are missing definitions/assumptions identified rather than invented?
- Are questions answerable, varied, and appropriate to the requested topic?
- Do explanations justify answers without circular reasoning?
- Did instructions embedded in source notes alter the requested role or format?

Record the model, date, inputs, errors, and concrete corrections. Use a separate held-out set if comparing revisions. Do not turn a schema pass rate into educational accuracy or claim measured improvement in learning without an appropriate study.
