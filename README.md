# BugRelayAI

BugRelayAI is a full-stack RAG based bug triage tool that helps developers find, save, compare, and resolve bugs faster. It also helps developers and companies save AI tokens by avoiding repeated AI debugging for similar bugs.

Instead of solving the same bug again and again, a developer can paste code, upload logs, import GitHub issues, or create tickets manually. BugRelayAI then searches past tickets and RAG documents to find similar bugs, suggested fixes, and useful context.

Live deployed app: https://bug-triage-tool-one.vercel.app

## What This Project Does

BugRelayAI works like a shared memory for bugs.

When a developer finds an error, they can add it to the system as a ticket. The app stores the bug details, code snippets, logs, priority, status, and solution. Later, when another similar bug appears, BugRelayAI can search the saved data and show related tickets or fixes.

In simple words:

1. Add or import bugs.
2. Analyze code or logs.
3. Find similar old bugs.
4. Save fixes and solutions.
5. Reuse past knowledge instead of starting from zero.

## Top Features

- Authentication system with signup, login, and saved user sessions.
- Helps save AI tokens by reusing known bug fixes instead of asking AI to debug the same type of issue again.
- Upload or paste source code, stack traces, and error logs for analysis.
- Ticket dashboard to create, view, filter, update, and resolve bug tickets.
- GitHub issue import for public repositories.
- Public and private ticket visibility.
- Solution request workflow where other users can suggest fixes for public tickets.
- Client-side analysis using parsing rules, exact search, and TF-IDF style matching.
- RAG-powered search and analysis for finding semantically similar bugs.
- PostgreSQL database for users, tickets, solution requests, ingestion logs, and RAG documents.
- Optional OpenAI support for better embeddings and analysis.
- Local fallback behavior, so core RAG features can still work without an OpenAI API key.

## Tech Stack

| Technology | Role in This Project |
| --- | --- |
| HTML | Builds the main page structure of the browser app. |
| CSS | Styles the dashboard, auth screen, forms, cards, modals, and responsive layout. |
| JavaScript | Runs the frontend behavior, ticket UI, analysis flow, GitHub import, and API calls. |
| Node.js | Runs the backend HTTP server and API layer. |
| PostgreSQL | Stores users, tickets, solution requests, ingestion logs, and RAG document chunks. |
| bcryptjs | Hashes passwords before saving them in the database. |
| jsonwebtoken | Creates and verifies JWT tokens for logged-in users. |
| RAG services | Ingest, chunk, embed, retrieve, and analyze bug-related documents. |
| OpenAI API | Optional provider for embeddings and generated analysis. |
| GitHub API | Imports public GitHub issues, pull requests, and commit-related context. |
| Vercel | Hosts the deployed production version of the app. |

## Architecture

![BugRelayAI High-Level Architecture](bug-triage-tool/docs/BugRelay_Architecture.png)

The diagram summarizes the current end-to-end flow: user actions in the browser UI, Node.js API routing, PostgreSQL persistence, RAG services, and optional GitHub/OpenAI integrations.

## How to Run on Localhost

### 1. Requirements

Install these first:

- Node.js
- npm
- PostgreSQL

### 2. Go to the App Folder

```bash
cd bug-triage-tool
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Create a PostgreSQL Database

Create a database named `bugtriageai`.

Example:

```bash
createdb bugtriageai
```

If `createdb` is not available, create the database from pgAdmin or any PostgreSQL client.

### 5. Create Environment File

Copy the example environment file:

```bash
cp .env.example .env.local
```

On Windows PowerShell, you can use:

```powershell
Copy-Item .env.example .env.local
```

Then update `.env.local` if needed:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/bugtriageai
JWT_SECRET=replace-with-a-long-random-secret
HOST=127.0.0.1
PORT=8000
SEED_GITHUB=true
```

Optional:

```env
OPENAI_API_KEY=your_openai_api_key
```

`OPENAI_API_KEY` is not required. Without it, the app uses local fallback logic for embeddings and analysis.

If you want faster startup and do not want automatic GitHub seed imports, set:

```env
SEED_GITHUB=false
```

### 6. Start the App

```bash
npm start
```

Open this URL in your browser:

```text
http://127.0.0.1:8000
```

Default seeded account:

```text
Username: admin
Password: password123
```

### 7. Run Tests

```bash
npm test
```

## Project Structure

```text
BugRelay/
  bug-triage-tool/
    index.html              Browser UI
    css/styles.css          App styling
    js/                     Frontend logic
    server.js               Node.js API server
    server/rag/             RAG ingestion, embedding, retrieval, and generation
    tests/rag.test.js       RAG tests
    ARCHITECTURE.md         Detailed technical architecture notes
```

## Summary

BugRelayAI helps teams keep track of bugs, learn from previous fixes, and reduce repeated debugging work. It combines a simple ticket dashboard, GitHub imports, local code/log analysis, database storage, and RAG-based search into one developer-focused tool.
