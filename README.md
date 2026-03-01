# Spell-B Trainer

A flashcard-style spelling practice app built with React and Vite.

## Features

- **Upload a word list** — `.txt` (one word per line), `.csv` (first column used), or `.json` (array or `{ "words": [] }`)
- **Quiz mode** — word is hidden until you click Speak; a 60-second countdown starts automatically
- **Spelling check** — type your answer and press Enter or click Check; mistakes are recorded on the first wrong attempt or timer expiry
- **Progress tracking** — session progress bar per 50-word chunk; completed words are skipped in random mode
- **Mistakes tab** — review all incorrectly spelled words with per-word audio playback
- **Pronunciation** — browser built-in Text-to-Speech (Web Speech API), adjustable speed and repeat count
- **Speech dictation** — spell out letter names ("aye", "bee", "see") via microphone using the Web Speech Recognition API
- **Definition lookup** — phonetic transcription, part of speech, definition, and example sentence via [dictionaryapi.dev](https://dictionaryapi.dev) (free, no key required)
- **Persistence** — word list and mistakes survive page refresh via `localStorage`

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (included with Node.js)

### Install and run

```bash
npm install
npm run dev
```

Open <http://localhost:5173> in your browser.

### Build for production

```bash
npm run build
npm run preview
```

The production build is output to `dist/`.

## Usage

1. Click **Upload word list** and choose a `.txt`, `.csv`, or `.json` file.
2. The app splits the list into 50-word sets — use the **50-word set** selector to navigate between them.
3. Toggle **Quiz mode** (on by default) to hide the word. Click **Speak** to hear it and start the 60-second timer, then type your spelling and click **Check**.
4. Turn Quiz mode off to see words as flashcards without the spelling test.
5. Click **Define** to fetch the definition and example sentence from the free Dictionary API.
6. The **Mistakes** tab shows every word you spelled incorrectly; click **Speak** next to any entry to hear it again.

## Tech Stack

- [React 18](https://react.dev/)
- [Vite](https://vitejs.dev/)
- Web Speech API — text-to-speech synthesis and speech recognition (no external library)
- [dictionaryapi.dev](https://dictionaryapi.dev) — free, open-source dictionary API, no account required

## License

[MIT](./LICENSE)
