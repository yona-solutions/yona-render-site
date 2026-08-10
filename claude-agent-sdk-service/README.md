# Claude Agent SDK Service

Minimal Express backend for hosting a Claude Agent SDK chat endpoint on Render.

## Local development

1. Copy `.env.example` to `.env`
2. Add `ANTHROPIC_API_KEY`
3. Install dependencies with `npm install`
4. Start the dev server with `npm run dev`

## Endpoints

- `GET /health`
- `POST /chat`

Example request:

```json
{
  "message": "Summarize this quarter's revenue trend."
}
```
