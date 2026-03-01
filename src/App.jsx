import React, { useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'spellingBee.words.v1'
const MISTAKES_KEY = 'spellingBee.mistakes.v1'
const CHUNK_SIZE = 50

function normalizeWord(w) {
  return String(w || '').trim()
}

function parseWordFileText(text) {
  const raw = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  const trimmed = raw.trim()
  const words = []

  const tryJson = () => {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
    if (parsed && Array.isArray(parsed.words)) return parsed.words
    return null
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const fromJson = tryJson()
      if (fromJson) {
        for (const w of fromJson) {
          const n = normalizeWord(w)
          if (n) words.push(n)
        }
        return Array.from(new Set(words))
      }
    } catch {
      void 0
    }
  }

  const lines = raw.split('\n').map((l) => l.trim())
  for (const line of lines) {
    if (!line) continue
    const parts = line.split(',').map((p) => p.trim())
    if (!parts[0]) continue
    words.push(parts[0])
  }

  return Array.from(new Set(words.map(normalizeWord).filter(Boolean)))
}

function pickRandomIndex(len, notIndex) {
  if (len <= 0) return -1
  if (len === 1) return 0
  let idx = Math.floor(Math.random() * len)
  if (idx === notIndex) idx = (idx + 1) % len
  return idx
}

function getPreferredVoice(voices) {
  const v = voices || []
  const pick = (pred) => v.find(pred)
  return (
    pick((x) => x.lang?.toLowerCase?.().startsWith('en-us') && x.localService) ||
    pick((x) => x.lang?.toLowerCase?.().startsWith('en-us')) ||
    pick((x) => x.lang?.toLowerCase?.().startsWith('en') && x.localService) ||
    pick((x) => x.lang?.toLowerCase?.().startsWith('en')) ||
    v[0] ||
    null
  )
}

async function lookupDictionary(word, signal) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const err = new Error(`Dictionary lookup failed (${res.status})`)
    err.status = res.status
    throw err
  }
  const data = await res.json()

  const entry = Array.isArray(data) ? data[0] : null
  const phonetic = entry?.phonetic || entry?.phonetics?.find((p) => p?.text)?.text || ''

  const meanings = Array.isArray(entry?.meanings) ? entry.meanings : []
  const defs = meanings
    .flatMap((m) => {
      const pos = m?.partOfSpeech ? String(m.partOfSpeech) : ''
      const d0 = Array.isArray(m?.definitions) ? m.definitions[0] : null
      const definition = d0?.definition ? String(d0.definition) : ''
      const example = d0?.example ? String(d0.example) : ''
      return [{ partOfSpeech: pos, definition, example }]
    })
    .filter((x) => x.definition)

  return { phonetic, definitions: defs }
}

// ── Small presentational helpers ──────────────────────────────────────────────


function Badge({ children, variant = 'default', dot = false }) {
  const cls = {
    default: 'badge',
    accent:  'badge badge-accent',
    success: 'badge badge-success',
    danger:  'badge badge-danger',
    info:    'badge badge-info',
  }[variant] || 'badge'
  return (
    <span className={cls}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

function ProgressBar({ value, total }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="progress-section">
      <div className="progress-header">
        <span className="progress-label">Session progress</span>
        <span className="progress-fraction">{value} / {total} words</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={total}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [fullWords, setFullWords] = useState([])
  const [chunkIndex, setChunkIndex] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [activeTab, setActiveTab] = useState('practice')
  const [quizMode, setQuizMode] = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [answer, setAnswer] = useState('')
  const [answerStatus, setAnswerStatus] = useState('') // 'Correct' | 'Try again' | "Time's up" | ''
  const [timeLeftSec, setTimeLeftSec] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const [hasCheckedOnce, setHasCheckedOnce] = useState(false)
  const [mistakes, setMistakes] = useState([])
  const [completedKeys, setCompletedKeys] = useState({})
  const [speechSupported, setSpeechSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [listenError, setListenError] = useState('')
  const [lastHeard, setLastHeard] = useState('')
  const [lastAppended, setLastAppended] = useState('')

  const [dictLoading, setDictLoading] = useState(false)
  const [dictError, setDictError] = useState('')
  const [dictResult, setDictResult] = useState(null)

  const [voiceReady, setVoiceReady] = useState(false)
  const [rate, setRate] = useState(0.9)
  const [repeat, setRepeat] = useState(1)

  const abortRef = useRef(null)
  const answerInputRef = useRef(null)
  const recognitionRef = useRef(null)


  // ── Persistence ──
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) setFullWords(parsed.map(normalizeWord).filter(Boolean))
      }
    } catch { setFullWords([]) }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fullWords)) } catch { void 0 }
  }, [fullWords])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MISTAKES_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) setMistakes(parsed.map(normalizeWord).filter(Boolean))
      }
    } catch { setMistakes([]) }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(MISTAKES_KEY, JSON.stringify(mistakes)) } catch { void 0 }
  }, [mistakes])

  // ── Voice setup ──
  useEffect(() => {
    const ensureVoices = () => {
      const voices = window.speechSynthesis?.getVoices?.() || []
      setVoiceReady(voices.length > 0)
    }
    ensureVoices()
    window.speechSynthesis?.addEventListener?.('voiceschanged', ensureVoices)
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', ensureVoices)
  }, [])

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setSpeechSupported(Boolean(SpeechRecognition))
  }, [])

  // ── Helpers ──
  const normalizeForCompare = (w) => normalizeWord(w).toLocaleLowerCase('en-US')
  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // ── Derived state ──
  const chunkCount = useMemo(() => Math.max(1, Math.ceil((fullWords?.length || 0) / CHUNK_SIZE)), [fullWords?.length])

  const activeWords = useMemo(() => {
    const start = chunkIndex * CHUNK_SIZE
    return (fullWords || []).slice(start, start + CHUNK_SIZE)
  }, [fullWords, chunkIndex])

  const currentWord = useMemo(() => {
    if (currentIndex < 0 || currentIndex >= activeWords.length) return ''
    return activeWords[currentIndex]
  }, [activeWords, currentIndex])

  const stats = useMemo(() => ({
    count:   activeWords.length,
    current: currentIndex >= 0 ? currentIndex + 1 : 0,
  }), [activeWords.length, currentIndex])

  const chunkProgress = useMemo(() => {
    const inChunk = completedKeys[String(chunkIndex)] || {}
    return { completed: Object.keys(inChunk).length, total: activeWords.length }
  }, [completedKeys, chunkIndex, activeWords.length])

  const chunkMistakes = useMemo(() => {
    const inChunkSet = new Set(activeWords.map((w) => normalizeForCompare(w)))
    return mistakes.filter((w) => inChunkSet.has(normalizeForCompare(w)))
  }, [mistakes, activeWords])

  const maybeMaskExample = (example) => {
    if (!quizMode || revealed) return example
    const w = normalizeWord(currentWord)
    const ex = normalizeWord(example)
    if (!w || !ex) return example
    try {
      const re = new RegExp(`\\b${escapeRegExp(w)}\\b`, 'gi')
      return ex.replace(re, '______')
    } catch { return example }
  }

  const tokensToLetters = (spoken) => {
    const raw = normalizeWord(spoken)
    if (!raw) return ''
    const cleaned = raw.toLocaleLowerCase('en-US').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!cleaned) return ''
    const map = {
      a:'a', b:'b', bee:'b', be:'b', c:'c', see:'c', sea:'c', d:'d', dee:'d',
      e:'e', ee:'e', f:'f', ef:'f', g:'g', gee:'g', h:'h', aitch:'h', i:'i',
      eye:'i', j:'j', jay:'j', k:'k', kay:'k', l:'l', el:'l', ell:'l', elle:'l',
      m:'m', em:'m', n:'n', en:'n', o:'o', oh:'o', p:'p', pee:'p', pea:'p',
      q:'q', cue:'q', queue:'q', r:'r', are:'r', s:'s', ess:'s', t:'t', tee:'t',
      u:'u', you:'u', v:'v', vee:'v', w:'w', doubleu:'w', x:'x', ex:'x',
      y:'y', why:'y', z:'z', zee:'z', zed:'z',
    }
    const tokens = cleaned.split(' ').filter(Boolean)
    return tokens.map((tok) => map[tok] || (tok.length === 1 && tok >= 'a' && tok <= 'z' ? tok : tok)).join('')
  }

  // ── Navigation ──
  const setWordIndex = (idx) => {
    setCurrentIndex(idx)
    setDictResult(null)
    setDictError('')
    setRevealed(false)
    setAnswer('')
    setAnswerStatus('')
    setTimerRunning(false)
    setTimeLeftSec(0)
    setHasCheckedOnce(false)
  }

  const loadRandom = () => {
    const inChunk = completedKeys[String(chunkIndex)] || {}
    const remainingIdx = []
    for (let i = 0; i < activeWords.length; i++) {
      const key = normalizeForCompare(activeWords[i])
      if (!inChunk[key]) remainingIdx.push(i)
    }
    const idx = remainingIdx.length
      ? remainingIdx[Math.floor(Math.random() * remainingIdx.length)]
      : pickRandomIndex(activeWords.length, currentIndex)
    setWordIndex(idx)
  }

  const loadNext = () => {
    if (!activeWords.length) return
    const idx = currentIndex < 0 ? 0 : (currentIndex + 1) % activeWords.length
    setWordIndex(idx)
  }

  const loadPrevious = () => {
    if (!activeWords.length) return
    const idx = currentIndex < 0 ? 0 : (currentIndex - 1 + activeWords.length) % activeWords.length
    setWordIndex(idx)
  }

  useEffect(() => {
    if (!activeWords.length) {
      if (currentIndex !== -1) setCurrentIndex(-1)
      return
    }
    if (currentIndex < 0 || currentIndex >= activeWords.length) setWordIndex(0)
  }, [activeWords.length, chunkIndex])

  // ── File upload ──
  const onUpload = async (file) => {
    if (!file) return
    const text = await file.text()
    const parsed = parseWordFileText(text)
    setFullWords(parsed)
    setChunkIndex(0)
    setCurrentIndex(parsed.length ? 0 : -1)
    setDictResult(null); setDictError(''); setRevealed(false)
    setAnswer(''); setAnswerStatus(''); setTimerRunning(false); setTimeLeftSec(0)
    setHasCheckedOnce(false); setCompletedKeys({}); 
    setActiveTab('practice')
  }

  const clearWords = () => {
    setFullWords([]); setChunkIndex(0); setCurrentIndex(-1)
    setDictResult(null); setDictError(''); setRevealed(false)
    setAnswer(''); setAnswerStatus(''); setTimerRunning(false); setTimeLeftSec(0)
    setHasCheckedOnce(false); setCompletedKeys({}); 
    try { localStorage.removeItem(STORAGE_KEY) } catch { void 0 }
  }

  const clearProgressForChunk = () => {
    setCompletedKeys((prev) => { const next = { ...prev }; delete next[String(chunkIndex)]; return next })
    setHasCheckedOnce(false)
    setAnswer(''); setAnswerStatus(''); setRevealed(false); setTimerRunning(false); setTimeLeftSec(0)
  }

  const clearMistakes = () => {
    setMistakes([])
    try { localStorage.removeItem(MISTAKES_KEY) } catch { void 0 }
  }

  // ── Quiz logic ──
  const checkAnswer = () => {
    const expected = normalizeForCompare(currentWord)
    const got = normalizeForCompare(answer)
    if (!expected) return

    if (got && got === expected) {
      setRevealed(true)
      setAnswerStatus('Correct')
      setTimerRunning(false)
      setTimeLeftSec(0)
      setHasCheckedOnce(true)
      setCompletedKeys((prev) => {
        const key = String(chunkIndex)
        const existing = prev[key] || {}
        return { ...prev, [key]: { ...existing, [expected]: true } }
      })
      return
    }

    if (!got) { setAnswerStatus(''); return }

    if (!hasCheckedOnce) {
      setMistakes((prev) => {
        const have = new Set(prev.map((x) => normalizeForCompare(x)))
        if (have.has(expected)) return prev
        return [...prev, currentWord]
      })
    }

    setHasCheckedOnce(true)
    setAnswerStatus('Try again')
  }

  // ── Timer ──
  useEffect(() => {
    if (!timerRunning) return
    if (timeLeftSec <= 0) {
      setTimerRunning(false)
      if (quizMode && !revealed) {
        setAnswerStatus("Time's up")
        if (!hasCheckedOnce) {
          const expected = normalizeForCompare(currentWord)
          if (expected) {
            setMistakes((prev) => {
              const have = new Set(prev.map((x) => normalizeForCompare(x)))
              if (have.has(expected)) return prev
              return [...prev, currentWord]
            })
          }
          setHasCheckedOnce(true)
        }
      }
      return
    }
    const id = setInterval(() => { setTimeLeftSec((t) => (t <= 1 ? 0 : t - 1)) }, 1000)
    return () => clearInterval(id)
  }, [timerRunning, timeLeftSec])

  // ── Speech synthesis ──
  const speak = () => {
    const w = normalizeWord(currentWord)
    if (!w || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const voices = window.speechSynthesis.getVoices()
    const voice = getPreferredVoice(voices)
    for (let i = 0; i < Math.max(1, Number(repeat) || 1); i++) {
      const u = new SpeechSynthesisUtterance(w)
      if (voice) u.voice = voice
      u.rate  = Math.min(1.3, Math.max(0.6, Number(rate) || 0.9))
      u.pitch = 1
      u.volume = 1
      window.speechSynthesis.speak(u)
    }
    if (quizMode) {
      setRevealed(false); setAnswerStatus(''); setTimerRunning(true); setTimeLeftSec(60)
      setTimeout(() => answerInputRef.current?.focus?.(), 0)
    }
  }

  // ── Speech recognition ──
  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) { setListenError('Speech recognition not supported in this browser.'); return }
    setListenError(''); setLastHeard(''); setLastAppended(''); setListening(true)

    const rec = new SpeechRecognition()
    recognitionRef.current = rec
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 3

    rec.onresult = (event) => {
      const startIdx = event?.resultIndex ?? 0
      const results = event?.results
      if (!results) return
      let append = '', heard = ''
      for (let i = startIdx; i < results.length; i++) {
        const r = results[i]
        if (!r || !r.isFinal) continue
        const alt = r?.[0]?.transcript || ''
        heard = alt
        const letters = tokensToLetters(alt)
        if (letters) append += letters
      }
      if (append) {
        setLastHeard(heard); setLastAppended(append)
        setAnswer((prev) => `${normalizeWord(prev)}${append}`)
      }
    }
    rec.onerror = (event) => setListenError(normalizeWord(event?.error || 'Speech recognition error'))
    rec.onend = () => setListening(false)
    try { rec.start() } catch (e) {
      setListening(false)
      setListenError(normalizeWord(e?.message || 'Unable to start listening'))
    }
  }

  const stopListening = () => {
    try { recognitionRef.current?.stop?.() } catch { void 0 }
  }

  // ── Dictionary ──
  const fetchMeaning = async () => {
    const w = normalizeWord(currentWord)
    if (!w) return
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setDictLoading(true); setDictError(''); setDictResult(null)
    try {
      const result = await lookupDictionary(w, controller.signal)
      setDictResult(result)
    } catch (e) {
      if (e?.name === 'AbortError') return
      setDictError(e?.message || 'Failed to fetch dictionary entry')
    } finally { setDictLoading(false) }
  }

  // ── Reset on word change ──
  useEffect(() => {
    if (!currentWord) return
    setDictResult(null); setDictError(''); setDictLoading(false)
    if (abortRef.current) abortRef.current.abort()
    setRevealed(false); setAnswer(''); setAnswerStatus('')
    setTimerRunning(false); setTimeLeftSec(0); setHasCheckedOnce(false)
    setListenError(''); setListening(false); stopListening()
  }, [currentWord])

  useEffect(() => {
    if (!activeWords.length) { setCurrentIndex(-1); return }
    setCurrentIndex(0); 
    setAnswer(''); setAnswerStatus(''); setRevealed(false)
    setTimerRunning(false); setTimeLeftSec(0)
    setListenError(''); setListening(false); stopListening()
  }, [chunkIndex])

  const timerIsUrgent  = timerRunning && timeLeftSec <= 15
  const timerMinutes   = String(Math.floor(timeLeftSec / 60)).padStart(2, '0')
  const timerSeconds   = String(timeLeftSec % 60).padStart(2, '0')

  const answerStatusVariant =
    answerStatus === 'Correct'   ? 'correct'  :
    answerStatus === 'Try again' ? 'wrong'    :
    answerStatus === "Time's up" ? 'timeout'  : ''

  const answerStatusIcon =
    answerStatus === 'Correct'   ? '✓'   :
    answerStatus === 'Try again' ? '✗'   :
    answerStatus === "Time's up" ? '⏱'  : ''

  const answerInputClass = [
    'answer-input',
    answerStatus === 'Correct'   ? 'is-correct' : '',
    answerStatus === 'Try again' || answerStatus === "Time's up" ? 'is-wrong' : '',
  ].filter(Boolean).join(' ')

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="app-shell">
      {/* ── Header / Navigation ── */}
      <header className="app-header" role="banner">
        <div className="app-header-inner">
          <div className="app-logo">
            <div className="app-logo-icon" aria-hidden="true">🐝</div>
            <div className="app-logo-text">
              <span className="app-logo-title">Spell-B Trainer</span>
              <span className="app-logo-sub">Practice · Pronunciation · Progress</span>
            </div>
          </div>

          <div className="app-header-actions">
            {/* Word counter */}
            {fullWords.length > 0 && (
              <>
                <Badge>
                  {stats.current} / {stats.count}
                </Badge>
                <Badge variant="accent">
                  List {chunkIndex + 1} / {chunkCount}
                </Badge>
              </>
            )}

          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="app-main" id="main-content">

        {/* ── Control Bar ── */}
        <section className="control-bar" aria-label="Word list controls">
          <div className="control-bar-row">
            {/* Left: upload + clear + tab */}
            <div className="row">
              <label className="btn btn-upload" role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click() }}
              >
                <input
                  type="file"
                  accept=".txt,.csv,.json,application/json,text/plain"
                  style={{ display: 'none' }}
                  onChange={(e) => onUpload(e.target.files?.[0])}
                  aria-label="Upload word list file"
                />
                <span aria-hidden="true">↑</span>
                Upload word list
              </label>

              {fullWords.length > 0 && (
                <button className="btn btn-danger" onClick={clearWords} aria-label="Clear word list">
                  Clear list
                </button>
              )}

              <div className="tab-bar" role="tablist" aria-label="View tabs">
                <button
                  role="tab"
                  aria-selected={activeTab === 'practice'}
                  className={`tab-btn ${activeTab === 'practice' ? 'active' : ''}`}
                  onClick={() => setActiveTab('practice')}
                >
                  Practice
                </button>
                <button
                  role="tab"
                  aria-selected={activeTab === 'mistakes'}
                  className={`tab-btn ${activeTab === 'mistakes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('mistakes')}
                >
                  Mistakes
                  <span className="tab-count" aria-label={`${mistakes.length} mistakes`}>{mistakes.length}</span>
                </button>
              </div>
            </div>

            {/* Right: chunk selector + quiz toggle */}
            <div className="row">
              {fullWords.length > 0 && (
                <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <span className="text-xs text-muted font-medium">50-word set</span>
                  <select
                    className="select"
                    value={chunkIndex}
                    onChange={(e) => setChunkIndex(Number(e.target.value))}
                    disabled={!fullWords.length}
                    aria-label="Select word set"
                  >
                    {Array.from({ length: chunkCount }).map((_, idx) => {
                      const start = idx * CHUNK_SIZE + 1
                      const end   = Math.min((idx + 1) * CHUNK_SIZE, fullWords.length)
                      return <option key={idx} value={idx}>Words {start}–{end}</option>
                    })}
                  </select>
                </div>
              )}

              <div className="toggle-group" title="In quiz mode the word is hidden until you answer or click Reveal">
                <span className="toggle-label">Quiz mode</span>
                <label className="toggle" aria-label="Toggle quiz mode">
                  <input
                    type="checkbox"
                    checked={quizMode}
                    onChange={(e) => setQuizMode(e.target.checked)}
                  />
                  <span className="toggle-track" aria-hidden="true" />
                </label>
              </div>
            </div>
          </div>

          <div className="control-bar-hint">
            Accepted formats: one word per line <code>.txt</code>, first column of <code>.csv</code>, or JSON array / <code>{"{ words: [] }"}</code>.
            Duplicates are removed automatically.
          </div>
        </section>

        {/* ── Flashcard ── */}
        <div className="flashcard" role="region" aria-label="Flashcard">

          {/* ── MISTAKES TAB ── */}
          {activeTab === 'mistakes' ? (
            <div className="mistakes-panel">
              <div className="mistakes-header">
                <h2 className="mistakes-title">Words to review</h2>
                <button
                  className="btn btn-danger"
                  onClick={clearMistakes}
                  disabled={!mistakes.length}
                  aria-label="Clear all mistakes"
                >
                  Clear all
                </button>
              </div>

              {!mistakes.length ? (
                <div className="mistakes-empty">
                  <div className="mistakes-empty-icon" aria-hidden="true">🏆</div>
                  <p className="mistakes-empty-text">
                    No mistakes recorded yet.<br />Keep practicing and your mistakes will appear here.
                  </p>
                </div>
              ) : (
                <div className="mistake-list" role="list">
                  {mistakes.map((w, i) => (
                    <div key={`${w}-${i}`} className="mistake-item" role="listitem">
                      <span className="mistake-word">{w}</span>
                      <button
                        className="btn"
                        aria-label={`Speak ${w}`}
                        onClick={() => {
                          if (!window.speechSynthesis) return
                          window.speechSynthesis.cancel()
                          const voices = window.speechSynthesis.getVoices()
                          const voice  = getPreferredVoice(voices)
                          const u = new SpeechSynthesisUtterance(w)
                          if (voice) u.voice = voice
                          u.rate = Math.min(1.3, Math.max(0.6, Number(rate) || 0.9))
                          u.pitch = 1; u.volume = 1
                          window.speechSynthesis.speak(u)
                        }}
                      >
                        <span aria-hidden="true">🔊</span> Speak
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          /* ── EMPTY STATE ── */
          ) : !currentWord ? (
            <div className="empty-state" role="status">
              <div className="empty-icon" aria-hidden="true">📄</div>
              <h2 className="empty-title">Upload a word list to begin</h2>
              <p className="empty-sub">
                Import a plain text file, CSV, or JSON array. Once loaded, you can practice pronunciation, test your spelling, and track your progress.
              </p>
              <div className="empty-actions">
                <label className="btn btn-upload btn-lg" role="button" tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click() }}
                >
                  <input
                    type="file"
                    accept=".txt,.csv,.json,application/json,text/plain"
                    style={{ display: 'none' }}
                    onChange={(e) => onUpload(e.target.files?.[0])}
                    aria-label="Upload word list file"
                  />
                  <span aria-hidden="true">↑</span>
                  Choose a file
                </label>
                <span className="upload-drop-hint text-xs text-muted">Supports .txt, .csv, .json</span>
              </div>
            </div>

          /* ── PRACTICE TAB ── */
          ) : (
            <>
              {/* Hero: word display + nav */}
              <div className="flashcard-hero">
                <div className="flashcard-meta-row">
                  <div className="row">
                    <button
                      className="btn btn-primary btn-lg"
                      onClick={loadRandom}
                      aria-label="Pick a random word"
                    >
                      <span aria-hidden="true">⇄</span> Random
                    </button>
                    <button
                      className="btn btn-lg"
                      onClick={loadPrevious}
                      aria-label="Previous word"
                    >
                      <span aria-hidden="true">←</span> Previous
                    </button>
                    <button
                      className="btn btn-lg"
                      onClick={loadNext}
                      aria-label="Next word"
                    >
                      Next <span aria-hidden="true">→</span>
                    </button>
                  </div>

                  <div className="flashcard-actions-top">
                    <button
                      className="btn"
                      onClick={clearProgressForChunk}
                      disabled={!chunkProgress.completed}
                      aria-label="Reset progress for this set of 50 words"
                      title="Reset progress for this set"
                    >
                      Reset set
                    </button>

                  </div>
                </div>

                {/* Word */}
                <div className="word-display">
                  <div
                    className={`word-text ${quizMode && !revealed ? 'masked' : ''}`}
                    aria-label={quizMode && !revealed ? 'Word hidden — click Speak to hear it' : currentWord}
                  >
                    {quizMode && !revealed ? '• • • • • •' : currentWord}
                  </div>
                  <div className="word-sub-row">
                    <span className="word-sub">
                      {quizMode && !revealed
                        ? 'Word hidden — click Speak to hear it, then type the spelling'
                        : 'Click Speak to hear the pronunciation'}
                    </span>
                    {quizMode && !revealed && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => setRevealed(true)}
                        aria-label="Reveal the word"
                      >
                        Reveal
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <ProgressBar value={chunkProgress.completed} total={chunkProgress.total} />

              {/* Quiz panel */}
              {quizMode && (
                <div className="quiz-panel" aria-label="Answer input">
                  <div className="quiz-input-row">
                    <input
                      ref={answerInputRef}
                      className={answerInputClass}
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      placeholder="Type the spelling here…"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') checkAnswer() }}
                      aria-label="Type your spelling answer"
                      aria-describedby="answer-hint"
                    />
                    <button
                      className="btn btn-primary btn-lg"
                      onClick={checkAnswer}
                      aria-label="Check spelling answer"
                    >
                      Check
                    </button>
                    {speechSupported && (
                      <button
                        className={`btn btn-lg ${listening ? 'btn-success' : ''}`}
                        onClick={() => (listening ? stopListening() : startListening())}
                        aria-label={listening ? 'Stop speech-to-text' : 'Start speech-to-text'}
                        title="Dictate letter names (e.g. 'aye', 'bee', 'see')"
                      >
                        {listening ? (
                          <><span className="badge-dot" aria-hidden="true" style={{ background: 'var(--success)', marginRight: 4 }} />Stop</>
                        ) : (
                          <><span aria-hidden="true">🎙</span> Dictate</>
                        )}
                      </button>
                    )}
                  </div>

                  <div className="quiz-hint-row">
                    {/* Timer */}
                    {(timerRunning || timeLeftSec > 0) && (
                      <div className={`timer-display ${timerIsUrgent ? 'urgent' : ''}`} aria-live="polite" aria-atomic="true">
                        <span className="timer-icon" aria-hidden="true">⏱</span>
                        {timerMinutes}:{timerSeconds}
                      </div>
                    )}

                    {/* Answer status */}
                    {answerStatus && (
                      <div
                        className={`answer-status ${answerStatusVariant}`}
                        role="status"
                        aria-live="polite"
                      >
                        <span aria-hidden="true">{answerStatusIcon}</span>
                        {answerStatus}
                        {answerStatus === 'Correct' && ' — well done!'}
                      </div>
                    )}

                    {/* Speech errors */}
                    {listenError && (
                      <span className="quiz-hint-text" style={{ color: 'var(--danger)' }}>
                        <span aria-hidden="true">⚠</span> {listenError}
                      </span>
                    )}

                    {/* Speech feedback */}
                    {speechSupported && listening && (lastHeard || lastAppended) && (
                      <span className="speech-feedback">
                        <span aria-hidden="true">🎙</span>
                        Heard: <span className="speech-feedback-heard">"{lastHeard || '…'}"</span>
                        → added "{lastAppended}"
                      </span>
                    )}

                    {!speechSupported && (
                      <span id="answer-hint" className="quiz-hint-text">
                        Speech recognition unavailable in this browser — type your answer
                      </span>
                    )}

                    {speechSupported && !listening && !answerStatus && (
                      <span id="answer-hint" className="quiz-hint-text">
                        Press Enter or click Check · Click Speak first to start 60-second timer
                      </span>
                    )}
                  </div>
                </div>
              )}

              <hr className="divider" />

              {/* Audio controls */}
              <div className="audio-panel" aria-label="Audio controls">
                <div className="audio-primary-actions">
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={speak}
                    disabled={!window.speechSynthesis}
                    aria-label="Speak the word"
                  >
                    <span aria-hidden="true">🔊</span> Speak
                  </button>

                  <button
                    className="btn btn-lg"
                    onClick={fetchMeaning}
                    disabled={dictLoading}
                    aria-label={dictLoading ? 'Looking up definition…' : 'Look up definition'}
                  >
                    {dictLoading ? (
                      <>Looking up…</>
                    ) : (
                      <><span aria-hidden="true">📖</span> Define</>
                    )}
                  </button>

                  <Badge variant={voiceReady ? 'success' : 'default'} dot={!voiceReady}>
                    {voiceReady ? 'Voice ready' : 'Loading voices…'}
                  </Badge>
                </div>

                <div className="audio-controls-divider" aria-hidden="true" />

                <div className="audio-controls-right">
                  <div className="range-group">
                    <span className="range-label">Speed</span>
                    <input
                      type="range"
                      min="0.6"
                      max="1.3"
                      step="0.05"
                      value={rate}
                      onChange={(e) => setRate(Number(e.target.value))}
                      aria-label={`Speech rate: ${rate.toFixed(2)}`}
                      style={{ width: 100 }}
                    />
                    <span className="range-value">{rate.toFixed(2)}×</span>
                  </div>

                  <div className="range-group">
                    <span className="range-label">Repeat</span>
                    <input
                      className="input"
                      style={{ width: 60 }}
                      type="number"
                      min="1"
                      max="5"
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                      aria-label="Number of times to repeat"
                    />
                  </div>
                </div>
              </div>

              {/* Dictionary error */}
              {dictError && (
                <div className="error-panel">
                  <div className="error-inner">
                    <span className="error-icon" aria-hidden="true">⚠</span>
                    <div className="error-content">
                      <div className="error-title">Definition not found</div>
                      <div className="error-message">{dictError}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Dictionary result */}
              {dictResult && (
                <div className="definition-panel">
                  <div className="definition-header">
                    <span className="definition-title">Definition</span>
                    {dictResult.phonetic && (
                      <Badge variant="accent">{dictResult.phonetic}</Badge>
                    )}
                  </div>

                  <div className="definition-entry">
                    {dictResult.definitions?.length ? (
                      dictResult.definitions.slice(0, 3).map((d, idx) => (
                        <div key={idx} className="definition-item">
                          {d.partOfSpeech && (
                            <span className="definition-pos">{d.partOfSpeech}</span>
                          )}
                          <p className="definition-text">{d.definition}</p>
                          {d.example && (
                            <p className="definition-example">
                              "{maybeMaskExample(d.example)}"
                            </p>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-secondary">No definitions found.</p>
                    )}
                    <p className="definition-source">
                      <span aria-hidden="true">🔗</span> Source: dictionaryapi.dev
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
