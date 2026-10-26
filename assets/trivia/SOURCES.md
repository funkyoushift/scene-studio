# Open Trivia Database source

The bundled sample was retrieved from the [Open Trivia Database](https://opentdb.com/) public API on 2026-10-26. The API declares the questions Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0); see the [license deed](https://creativecommons.org/licenses/by-sa/4.0/) and the bundled license text. The source API is free, requires no API key, and limits requests to 50 questions with a recommended minimum five-second interval. The importer requests no more than 25 per category and waits at least six seconds between API requests.

The imported question content and its adaptations remain available under CC BY-SA 4.0. This applies to the adapted database content, not unrelated application code. Please attribute the Open Trivia Database and link to the license when redistributing the adapted data.

## Import and transformations

Run `python scripts/import-trivia-bank.py` to retrieve the current category list and a bounded sample for each available category. The script decodes HTML entities into plain Unicode text, normalizes whitespace and Unicode, removes duplicate questions, and rejects malformed/oversized questions, invalid or oversized choices, and duplicate/missing choices. It stores the correct answer at index zero and records category, source, and difficulty. Questions are not independently fact-checked or guaranteed family-safe; review content before exposing it to an audience.
