import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Serves the API reference documentation as rendered HTML.
 * GET /docs — public, no auth required.
 */
export function createDocsRoutes() {
  const app = new Hono();

  // Load markdown once at startup
  let markdown: string;
  try {
    markdown = readFileSync(resolve(__dirname, '../../docs/api-reference.md'), 'utf-8');
  } catch {
    markdown = '# API Reference\n\nDocumentation file not found.';
  }

  app.get('/', (c) => {
    const html = renderMarkdownPage(markdown);
    return c.html(html);
  });

  // Also serve raw markdown for programmatic consumption
  app.get('/raw', (c) => {
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    return c.text(markdown);
  });

  return app;
}

/**
 * Renders markdown as a styled HTML page using GitHub-flavored markdown CSS
 * and a client-side markdown parser (marked) loaded from CDN.
 */
function renderMarkdownPage(markdown: string): string {
  // Escape backticks and backslashes for safe embedding in JS template literal
  const escaped = markdown
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RevBack API Reference</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown-light.min.css">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #f6f8fa;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    }
    .header {
      background: #24292e;
      color: white;
      padding: 16px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }
    .header a {
      color: #79b8ff;
      text-decoration: none;
      font-size: 14px;
    }
    .header a:hover { text-decoration: underline; }
    .container {
      max-width: 980px;
      margin: 32px auto;
      padding: 32px 48px;
      background: white;
      border: 1px solid #d0d7de;
      border-radius: 6px;
    }
    .markdown-body { font-size: 16px; }
    .markdown-body h1 { border-bottom: 1px solid #d0d7de; padding-bottom: 8px; }
    .markdown-body h2 { border-bottom: 1px solid #d0d7de; padding-bottom: 6px; margin-top: 32px; }
    .markdown-body h3 { margin-top: 24px; }
    .markdown-body table { display: table; width: 100%; }
    .markdown-body pre { background: #f6f8fa; border-radius: 6px; padding: 16px; overflow-x: auto; }
    .markdown-body code { background: #f0f2f4; padding: 2px 6px; border-radius: 3px; font-size: 85%; }
    .markdown-body pre code { background: none; padding: 0; }
    @media (max-width: 768px) {
      .container { margin: 16px; padding: 16px 24px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>RevBack API Reference</h1>
    <a href="/docs/raw">Raw Markdown</a>
  </div>
  <div class="container">
    <article class="markdown-body" id="content">Loading...</article>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.1/marked.min.js"></script>
  <script>
    const md = \`${escaped}\`;
    document.getElementById('content').innerHTML = marked.parse(md);
  </script>
</body>
</html>`;
}
