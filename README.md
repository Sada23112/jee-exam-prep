# JEE CBT — AI-Powered Examination Simulator

A production-grade, offline-first computer-based examination simulator designed to recreate the authentic **NTA JEE Main** examination experience for competitive engineering entrance preparation.

Built with local-first data persistence, client-side PDF document ingestion, mathematical typography, deterministic scoring, and Google Gemini AI tutoring.

---

## 🌟 Key Features

### 1. Realistic JEE Main CBT Examination Interface
- **Authentic NTA Layout:** Candidate profile indicator, live countdown timer with urgency alerts, and section/subject switching (Physics, Chemistry, Mathematics).
- **Official 5-State Question Palette:**
  - ⚪ **Not Visited:** Questions yet to be viewed.
  - 🔴 **Not Answered:** Visited questions left unanswered.
  - 🟢 **Answered:** Saved responses counted for evaluation.
  - 🟣 **Marked for Review:** Flagged for reconsideration.
  - 🟣🟢 **Answered & Marked for Review:** Answered and flagged (counted in final evaluation).
- **Reliable Deadline Timer:** Monotonic UTC deadline tracking (`deadlineAt = startedAt + durationMs`) resilient to page reloads, tab throttling, and system sleep.
- **Single-Writer Safety:** Cross-tab locking using `BroadcastChannel` to prevent concurrent exam corruption.
- **Answer Inputs:** Radio/checkbox options and dedicated on-screen numerical virtual keypad.

### 2. Question Paper Importer & Document Processing
- **Format Ingestion:** Digital PDFs, scanned papers, and images (`PNG`, `JPEG`, `WebP`) processed 100% in-browser using `pdfjs-dist`.
- **Interactive Document Viewer & Crop Tool:** Page-by-page navigator with zoom controls and interactive box-drag diagram cropper that creates SHA-256 verified assets in IndexedDB.
- **Rule-Based Segmentation:** Regex and layout heuristic engine that extracts subjects, question numbering, and options into structured drafts.
- **Answer Key Mapper:** Parser supporting standard key formats (`1. B`, `Q2: (C)`, `15: 42.5`, `4: A, C`), preview table, ambiguity warning flags, and direct question mapping.
- **Split-Screen Verification Interface:** Side-by-side original source document viewer and editable question verification workspace.
- **Authoritative Key Gate:** Unverified question keys cannot silently become authoritative answers.

### 3. Examination Results & Performance Analytics
- **Deterministic Scoring Engine:** Supports signed marking rules (+4, -1, 0) for single-choice, multiple-choice (exact-set), and numerical with tolerance ($\pm \Delta$).
- **Integrity Safeguard:** Questions with unverified keys are marked *ungraded* and excluded from official totals.
- **Diagnostic Insights:** Negative marking loss counter (`-X marks lost to penalties`), pacing note, and Time Traps detection (questions where $>150\text{s}$ were spent resulting in zero or negative marks).
- **Chapter-Wise Performance Breakdown:** Granular aggregation of attempts, accuracy percentage, score, and time spent per syllabus topic.
- **Question-Wise Review:** Filterable by status (All, Correct, Incorrect, Unattempted, Ungraded) comparing candidate responses against authoritative answers with step-by-step KaTeX solutions.

### 4. AI Performance Tutor (Google Gemini)
- **Model Integration:** Powered by Google's high-speed, cost-efficient `gemini-3.5-flash-lite` (with `gemini-3.8-flash` option).
- **Strategic Post-Exam Analysis:** Evaluates conceptual gaps, negative marking patterns, and pacing to produce a targeted revision plan and PYQ recommendations.
- **Sovereign & Offline Fallback:** Complete local diagnostic report generated offline; "Copy AI Prompt" button allows candidates to copy structured test summaries into any LLM.

### 5. Application Settings & Sovereign Storage
- **Privacy First:** Gemini API keys are stored locally in the browser (`localStorage`), never committed or transmitted to any third-party backend.
- **Connectivity Testing:** Live testing button validating API key response and model connectivity.
- **Workspace Health:** IndexedDB storage usage metrics and JSON Backup & Restore.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend Framework** | React 19, TypeScript 5.9, Vite 7.3 |
| **Routing** | React Router v7 |
| **Local Database** | Dexie.js 4.4 (IndexedDB) with revision concurrency & storage budget |
| **Validation** | Zod 4.6 (Runtime schema validation on all records and backups) |
| **Math Typography** | KaTeX 0.19 with bundled WOFF2/WOFF fonts |
| **Document Engine** | PDF.js (`pdfjs-dist`) with client-side Web Worker |
| **AI Integration** | Google Gemini API (`gemini-3.5-flash-lite`, `gemini-3.8-flash`) |
| **Testing** | Vitest (187 unit/integration tests) + Playwright (18 E2E browser tests) |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js `^22.14.0` or `>=24.0.0`
- pnpm `11.24.0` or newer

### Installation
```bash
# Clone the repository
git clone https://github.com/Sada23112/jee-exam-prep.git
cd jee-exam-prep

# Install dependencies
pnpm install

# (Optional) Set up your Gemini API key in a local .env file
cp .env.example .env
# Edit .env and enter your VITE_GEMINI_API_KEY
```

### Running the App
```bash
# Start local development server
pnpm dev
```
Open **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)** in your browser.

### Quality Verification
```bash
pnpm lint        # ESLint check (0 errors, 0 warnings)
pnpm typecheck   # TypeScript check
pnpm test        # Vitest unit & integration tests
pnpm build       # Production bundle build
pnpm test:e2e    # Playwright browser end-to-end tests
pnpm verify      # Run all gates in succession
```

---

## ☁️ Deployment Guide (Vercel)

This application is ready to deploy to **Vercel** with zero extra backend configuration.

### Deploy Steps:
1. Go to [Vercel](https://vercel.com) and log in with your GitHub account.
2. Click **"Add New Project"** and select `jee-exam-prep`.
3. In the project settings:
   - **Framework Preset:** Vite
   - **Build Command:** `pnpm build`
   - **Output Directory:** `dist`
   - **Install Command:** `pnpm install`
4. Under **Environment Variables**, add:
   - `VITE_GEMINI_API_KEY`: `Your_Gemini_API_Key`
   - `VITE_GEMINI_MODEL`: `gemini-3.5-flash-lite`
5. Click **"Deploy"**.

> [!NOTE]
> `vercel.json` is included in the root directory to handle Single-Page Application (SPA) routing rewrites so all routes (`/importer`, `/exam/new`, `/settings`, etc.) work seamlessly on refresh.

---

## 🔒 Security & Privacy Notice
- API credentials are **never** committed into this repository. `.env` is explicitly ignored by `.gitignore`.
- Exam questions, page images, and test responses are saved in the user's browser IndexedDB.
