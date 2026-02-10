import { Hono } from 'hono';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SectionMeta {
  slug: string;
  title: string;
  group: string | null;
}

interface Section {
  slug: string;
  title: string;
  markdown: string;
  html: string;
  endpoints: EndpointHeading[];
}

interface EndpointHeading {
  id: string;
  title: string;
  method: string | null;
}

/**
 * Load and parse all API documentation sections at startup.
 */
function loadSections(): { sections: Section[]; meta: SectionMeta[] } {
  const docsDir = resolve(__dirname, '../../docs/api');

  let meta: { sections: SectionMeta[] };
  try {
    meta = JSON.parse(readFileSync(resolve(docsDir, '_meta.json'), 'utf-8'));
  } catch {
    return { sections: [], meta: [] };
  }

  const sections: Section[] = [];

  for (const entry of meta.sections) {
    try {
      const markdown = readFileSync(resolve(docsDir, `${entry.slug}.md`), 'utf-8');
      const html = marked.parse(markdown) as string;
      const endpoints = extractEndpoints(markdown);
      sections.push({
        slug: entry.slug,
        title: entry.title,
        markdown,
        html,
        endpoints,
      });
    } catch {
      // Skip missing files
    }
  }

  return { sections, meta: meta.sections };
}

/**
 * Extract ### headings that look like endpoint definitions.
 */
function extractEndpoints(markdown: string): EndpointHeading[] {
  const endpoints: EndpointHeading[] = [];
  const headingRegex = /^###\s+(.+)$/gm;
  let match;

  while ((match = headingRegex.exec(markdown)) !== null) {
    const title = match[1].trim();
    const id = slugify(title);
    const methodMatch = title.match(/^(GET|POST|PUT|DELETE|PATCH)\s+/);
    endpoints.push({
      id,
      title,
      method: methodMatch ? methodMatch[1] : null,
    });
  }

  return endpoints;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Serves the API reference documentation as rendered HTML.
 * GET /docs — redirects to /docs/getting-started
 * GET /docs/:section — renders section with sidebar
 * GET /docs/raw — combined markdown
 * GET /docs/raw/:section — single section markdown
 */
export function createDocsRoutes() {
  const app = new Hono();
  const { sections, meta } = loadSections();

  // Redirect root to getting-started
  app.get('/', (c) => {
    return c.redirect('/docs/getting-started');
  });

  // Raw combined markdown
  app.get('/raw', (c) => {
    const combined = sections.map((s) => s.markdown).join('\n\n---\n\n');
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    return c.text(combined);
  });

  // Raw single section markdown
  app.get('/raw/:section', (c) => {
    const slug = c.req.param('section');
    const section = sections.find((s) => s.slug === slug);
    if (!section) {
      return c.text('Section not found', 404);
    }
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    return c.text(section.markdown);
  });

  // Render section with sidebar
  app.get('/:section', (c) => {
    const slug = c.req.param('section');
    const section = sections.find((s) => s.slug === slug);
    if (!section) {
      return c.redirect('/docs/getting-started');
    }
    const html = renderPage(section, sections, meta);
    return c.html(html);
  });

  return app;
}

function methodBadge(method: string): string {
  const colors: Record<string, string> = {
    GET: '#16a34a',
    POST: '#2563eb',
    PUT: '#ea580c',
    DELETE: '#dc2626',
    PATCH: '#7c3aed',
  };
  const color = colors[method] || '#6b7280';
  return `<span style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.5px;padding:2px 6px;border-radius:3px;color:#fff;background:${color};font-family:monospace;margin-right:6px;vertical-align:middle;">${method}</span>`;
}

/**
 * Transform the HTML to split code blocks into the right column.
 * Endpoint sections (starting with <h3>) get a two-column layout.
 */
function splitColumns(html: string): string {
  // Split into sections on <h3> boundaries
  const parts = html.split(/(?=<h3[^>]*>)/);

  return parts
    .map((part) => {
      // Check if this part starts with an h3 (endpoint section)
      if (!part.match(/^<h3[^>]*>/)) {
        return `<div class="doc-section">${part}</div>`;
      }

      // Split code blocks from prose
      const codeBlocks: string[] = [];
      const prose = part.replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (match) => {
        codeBlocks.push(match);
        return '';
      });

      if (codeBlocks.length === 0) {
        return `<div class="doc-section">${part}</div>`;
      }

      const codeHtml = codeBlocks
        .map(
          (block) => `<div class="code-block-wrapper">${block}</div>`,
        )
        .join('');

      return `<div class="endpoint-section">
        <div class="endpoint-docs">${prose}</div>
        <div class="endpoint-code">${codeHtml}</div>
      </div>`;
    })
    .join('');
}

function renderPage(current: Section, all: Section[], meta: SectionMeta[]): string {
  const sidebarHtml = meta
    .map((entry) => {
      const section = all.find((s) => s.slug === entry.slug);
      if (!section) return '';
      const isActive = section.slug === current.slug;
      const activeClass = isActive ? ' active' : '';

      let subNav = '';
      if (isActive && section.endpoints.length > 0) {
        subNav =
          '<ul class="sub-nav">' +
          section.endpoints
            .map((ep) => {
              const label = ep.method
                ? `${methodBadge(ep.method)}<span class="ep-path">${ep.title.replace(/^(GET|POST|PUT|DELETE|PATCH)\s+/, '')}</span>`
                : ep.title;
              return `<li><a href="#${ep.id}">${label}</a></li>`;
            })
            .join('') +
          '</ul>';
      }

      return `<li class="nav-item${activeClass}">
        <a href="/docs/${section.slug}" class="nav-link${activeClass}">${entry.title}</a>
        ${subNav}
      </li>`;
    })
    .join('');

  // Add method badges to h3 headings in the content
  let contentHtml = current.html.replace(
    /<h3([^>]*)>((?:GET|POST|PUT|DELETE|PATCH)\s+[\s\S]*?)<\/h3>/g,
    (match, attrs, text) => {
      const methodMatch = text.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.*)$/);
      if (methodMatch) {
        const badge = methodBadge(methodMatch[1]);
        const id = slugify(text.trim());
        return `<h3 id="${id}"${attrs}>${badge}<code>${methodMatch[2].trim()}</code></h3>`;
      }
      return match;
    },
  );

  // Add IDs to all h3 headings that don't have one
  contentHtml = contentHtml.replace(/<h3(?![^>]*\bid=)([^>]*)>([\s\S]*?)<\/h3>/g, (match, attrs, text) => {
    const id = slugify(text.replace(/<[^>]+>/g, '').trim());
    return `<h3 id="${id}"${attrs}>${text}</h3>`;
  });

  // Split into two columns
  const twoColumnContent = splitColumns(contentHtml);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${current.title} — RevBack API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: #f8f9fa;
      color: #1a1a2e;
      line-height: 1.6;
    }

    /* ─── Header ──────────────────────────────────── */
    .header {
      background: #0f172a;
      color: white;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 200;
      border-bottom: 1px solid #1e293b;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }
    .header .version {
      font-size: 12px;
      color: #94a3b8;
      background: #1e293b;
      padding: 2px 8px;
      border-radius: 4px;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header a {
      color: #93c5fd;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
    }
    .header a:hover { color: #bfdbfe; }
    .hamburger {
      display: none;
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      padding: 4px;
    }

    /* ─── Layout ──────────────────────────────────── */
    .layout {
      display: flex;
      min-height: calc(100vh - 52px);
    }

    /* ─── Sidebar ─────────────────────────────────── */
    .sidebar {
      width: 260px;
      min-width: 260px;
      background: #ffffff;
      border-right: 1px solid #e2e8f0;
      padding: 20px 0;
      position: sticky;
      top: 52px;
      height: calc(100vh - 52px);
      overflow-y: auto;
      scrollbar-width: thin;
    }
    .sidebar::-webkit-scrollbar { width: 4px; }
    .sidebar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }

    .sidebar ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .nav-item { margin: 0; }
    .nav-link {
      display: block;
      padding: 8px 20px;
      color: #475569;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.15s;
      border-left: 3px solid transparent;
    }
    .nav-link:hover {
      color: #1e293b;
      background: #f1f5f9;
    }
    .nav-link.active {
      color: #2563eb;
      background: #eff6ff;
      border-left-color: #2563eb;
      font-weight: 600;
    }
    .sub-nav {
      margin: 0;
      padding: 0 0 8px 0;
    }
    .sub-nav li a {
      display: flex;
      align-items: center;
      padding: 4px 20px 4px 28px;
      color: #64748b;
      text-decoration: none;
      font-size: 12px;
      line-height: 1.5;
      transition: all 0.15s;
    }
    .sub-nav li a:hover {
      color: #2563eb;
      background: #f8fafc;
    }
    .sub-nav .ep-path {
      font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 11px;
    }

    /* ─── Content ─────────────────────────────────── */
    .content {
      flex: 1;
      min-width: 0;
      padding: 32px 40px 64px;
      max-width: 1200px;
    }

    /* ─── Endpoint sections (two-column) ──────────── */
    .doc-section {
      margin-bottom: 8px;
    }
    .endpoint-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e2e8f0;
    }
    .endpoint-docs {
      min-width: 0;
    }
    .endpoint-code {
      min-width: 0;
    }
    .endpoint-code pre {
      background: #1e293b !important;
      color: #e2e8f0 !important;
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      margin: 0 0 12px 0;
      font-size: 13px;
      line-height: 1.5;
      position: relative;
    }
    .endpoint-code pre code {
      background: none !important;
      color: inherit !important;
      padding: 0;
      font-size: inherit;
    }
    .code-block-wrapper {
      position: relative;
    }
    .code-block-wrapper .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: #334155;
      color: #94a3b8;
      border: none;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .code-block-wrapper:hover .copy-btn {
      opacity: 1;
    }
    .copy-btn:hover { color: #e2e8f0; background: #475569; }
    .copy-btn.copied { color: #4ade80; }

    /* ─── Typography ──────────────────────────────── */
    .content h1 {
      font-size: 28px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 8px;
      letter-spacing: -0.5px;
    }
    .content h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 40px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    .content h3 {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 32px;
      margin-bottom: 12px;
      padding-top: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .content h3 code {
      font-size: 14px;
      font-weight: 600;
      background: none;
      padding: 0;
      color: #334155;
    }
    .content p {
      margin-bottom: 12px;
      color: #334155;
      font-size: 14px;
    }
    .content strong {
      font-weight: 600;
      color: #1e293b;
    }
    .content a {
      color: #2563eb;
      text-decoration: none;
    }
    .content a:hover { text-decoration: underline; }

    /* ─── Code ────────────────────────────────────── */
    .content code {
      font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 13px;
      color: #be185d;
    }
    .content pre {
      background: #1e293b;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      overflow-x: auto;
      margin: 12px 0;
      font-size: 13px;
      line-height: 1.5;
    }
    .content pre code {
      background: none;
      color: inherit;
      padding: 0;
      font-size: inherit;
    }

    /* ─── Tables ──────────────────────────────────── */
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 13px;
    }
    .content th {
      text-align: left;
      padding: 8px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      font-weight: 600;
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .content td {
      padding: 8px 12px;
      border: 1px solid #e2e8f0;
      color: #334155;
    }
    .content td code {
      font-size: 12px;
    }
    .content tr:hover td {
      background: #f8fafc;
    }

    /* ─── Lists ───────────────────────────────────── */
    .content ul, .content ol {
      padding-left: 20px;
      margin-bottom: 12px;
    }
    .content li {
      font-size: 14px;
      color: #334155;
      margin-bottom: 4px;
    }

    /* ─── HR ──────────────────────────────────────── */
    .content hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 32px 0;
    }

    /* ─── Responsive ──────────────────────────────── */
    @media (max-width: 1024px) {
      .endpoint-section {
        grid-template-columns: 1fr;
      }
      .endpoint-code {
        margin-top: 0;
      }
    }
    @media (max-width: 768px) {
      .sidebar {
        position: fixed;
        left: -280px;
        top: 52px;
        height: calc(100vh - 52px);
        z-index: 150;
        transition: left 0.2s ease;
        box-shadow: none;
      }
      .sidebar.open {
        left: 0;
        box-shadow: 4px 0 24px rgba(0,0,0,0.15);
      }
      .hamburger { display: block; }
      .content { padding: 20px 16px 48px; }
      .overlay {
        display: none;
        position: fixed;
        inset: 52px 0 0 0;
        background: rgba(0,0,0,0.3);
        z-index: 140;
      }
      .overlay.visible { display: block; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <button class="hamburger" onclick="toggleSidebar()" aria-label="Toggle menu">&#9776;</button>
      <h1>RevBack API</h1>
      <span class="version">v0.1.0</span>
    </div>
    <div class="header-right">
      <a href="/docs/raw">Raw Markdown</a>
    </div>
  </div>
  <div class="overlay" id="overlay" onclick="toggleSidebar()"></div>
  <div class="layout">
    <nav class="sidebar" id="sidebar">
      <ul>${sidebarHtml}</ul>
    </nav>
    <main class="content">
      ${twoColumnContent}
    </main>
  </div>
  <script>
    // Sidebar toggle (mobile)
    function toggleSidebar() {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('overlay').classList.toggle('visible');
    }

    // Copy buttons on code blocks
    document.querySelectorAll('.code-block-wrapper').forEach(wrapper => {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        const code = wrapper.querySelector('code');
        if (code) {
          navigator.clipboard.writeText(code.textContent || '').then(() => {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
          });
        }
      });
      wrapper.appendChild(btn);
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const target = document.getElementById(link.getAttribute('href').slice(1));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.pushState(null, '', link.getAttribute('href'));
        }
      });
    });

    // Close sidebar when clicking a nav link on mobile
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          document.getElementById('sidebar').classList.remove('open');
          document.getElementById('overlay').classList.remove('visible');
        }
      });
    });
  </script>
</body>
</html>`;
}
