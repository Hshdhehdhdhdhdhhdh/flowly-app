# Flowly — AI-assisted workflow workspace

Responsive SaaS landing page with sign up / sign in, a protected workspace (kanban board), an AI workflow builder demo,
templates gallery, product tour, savings calculator and a demo request form.

This is the flat deploy version: every file sits in the top level, so it uploads to GitHub in one drag.

- `index.html` – the whole front end (HTML, CSS, JavaScript and SVG images in one file)
- `server.js` – Node.js + Express backend (auth, tasks, demo requests)
- `db.js` – small JSON-file database · `env.js` – .env loader
- `render.yaml` – Render setup

## Run locally
```
npm install
npm start      # http://localhost:3000
```

## Deploy on Render
New + → Web Service → pick this repository → Build `npm install`, Start `npm start`,
environment variables `NODE_ENV=production` and `JWT_SECRET=<long random text>`.

If the backend isn't reachable, the page falls back to saving data in the browser, so every form still works.
