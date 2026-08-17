import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: false })

/**
 * Render markdown to HTML for the plan viewer.
 *
 * Sanitised even though the source is the user's own Claude session: plans
 * routinely quote code and web content, and this HTML is injected into the app's
 * own document, where a stray <script> or javascript: href would run with the
 * app's privileges rather than a page's.
 */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'strong', 'em', 'del',
      'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'table', 'thead',
      'tbody', 'tr', 'th', 'td', 'span', 'div', 'input',
    ],
    ALLOWED_ATTR: ['href', 'title', 'class', 'type', 'checked', 'disabled'],
    ALLOW_DATA_ATTR: false,
  })
}
