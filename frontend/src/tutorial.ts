import { marked } from 'marked'
import readme from '../../README.md?raw'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

interface Section {
  text: string
  id: string
  level: 1 | 2
}

function extractHeadings(md: string): Section[] {
  const sections: Section[] = []
  let inFence = false
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = /^(#{1,2})\s+(.+?)\s*$/.exec(line)
    if (m) {
      const level = m[1].length as 1 | 2
      const text = m[2].trim()
      sections.push({ text, id: slugify(text), level })
    }
  }
  return sections
}

marked.use({
  renderer: {
    heading({ text, depth }) {
      const id = slugify(text)
      return `<h${depth} id="${id}">${text}</h${depth}>\n`
    },
  },
})

const sections = extractHeadings(readme)
const html = String(marked.parse(readme))

const app = document.getElementById('tutorial-app')!
app.innerHTML = `
  <header>
    <div class="header-left">
      <div class="header-logo">⛅</div>
      <div class="header-text">
        <h1>Weather CRE</h1>
        <p class="subtitle">Tutorial</p>
      </div>
    </div>
    <div class="header-right">
      <a class="github-btn" href="/" title="Back to app">← App</a>
    </div>
  </header>
  <div class="tutorial-layout">
    <aside class="tutorial-sidebar">
      <nav aria-label="Tutorial contents">
        <p class="tutorial-sidebar-title">Contents</p>
        <ul class="tutorial-toc">
          ${sections
            .map(
              (s) =>
                `<li class="toc-h${s.level}"><a href="#${s.id}">${s.text}</a></li>`,
            )
            .join('\n          ')}
        </ul>
      </nav>
    </aside>
    <article class="tutorial-content">
      ${html}
    </article>
  </div>
`
