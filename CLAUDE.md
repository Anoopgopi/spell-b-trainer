# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # Install dependencies
npm run dev       # Start dev server at http://localhost:5173 (strictPort)
npm run build     # Production build → dist/
npm run preview   # Preview production build
```

There are no tests or linting configured in this project.

## Architecture

This is **Spell-B Trainer**, a single-page React 18 app built with Vite. The entire application logic lives in two files:

- **`src/App.jsx`** — All state, logic, and UI in one component (~1000 lines). No routing, no external state library.
- **`src/styles.css`** — All CSS (BEM-style class names like `app-shell`, `flashcard`, `quiz-panel`, etc.)

### Key concepts in App.jsx

**Word list management**
- Words are loaded via file upload (`.txt`, `.csv`, `.json`) and parsed by `parseWordFileText()`, which handles all three formats. For CSV, only the first column is used.
- The full word list (`fullWords`) is split into 50-word chunks (`CHUNK_SIZE = 50`). The active chunk is `activeWords`.
- Both `fullWords` and `mistakes` persist to `localStorage` (`STORAGE_KEY`, `MISTAKES_KEY`).

**Practice session state**
- `chunkIndex` — which 50-word set is active
- `currentIndex` — position within the active chunk
- `completedKeys` — tracks correctly answered words per chunk (`{ [chunkIndex]: { [word]: true } }`), used to drive the progress bar and skip already-completed words in random mode
- `mistakes` — words answered incorrectly (deduped, persisted)

**Quiz mode**
- When `quizMode` is true, the word is hidden until the user speaks it (triggering a 60-second countdown), then types and checks spelling
- `answerStatus` can be `'Correct'`, `'Try again'`, or `"Time's up"`
- A mistake is recorded on the first wrong attempt or timer expiry (not on subsequent retries)

**Browser APIs used**
- **Web Speech API (synthesis)** — `window.speechSynthesis` for TTS; `getPreferredVoice()` selects en-US local voice first
- **Web Speech API (recognition)** — `window.SpeechRecognition` for dictation; `tokensToLetters()` maps spoken letter names (e.g. "bee", "see", "dee") to characters
- **Dictionary API** — `lookupDictionary()` fetches from `https://api.dictionaryapi.dev/api/v2/entries/en/{word}` (free, no key). Uses `AbortController` to cancel in-flight requests on word change.

**Two UI tabs**
- **Practice** — flashcard with word display, quiz input, audio controls, and definition panel
- **Mistakes** — list of incorrectly spelled words with per-word speak button

### Word list data files

Sample word lists live in `data/` (gitignored, not committed):
- `spellingbee-2026-450.json` — JSON format (`{ "words": [...] }`)
- `*.csv` files (e.g. `2B-A-spelling-list.csv`) — CSV with `Word,Definition` header; only the first column (Word) is imported by the app

These can be uploaded directly via the app's file picker.
