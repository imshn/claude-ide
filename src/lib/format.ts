import * as prettier from 'prettier/standalone'
import babel from 'prettier/plugins/babel'
import estree from 'prettier/plugins/estree'
import typescript from 'prettier/plugins/typescript'
import postcss from 'prettier/plugins/postcss'
import html from 'prettier/plugins/html'
import markdown from 'prettier/plugins/markdown'
import yaml from 'prettier/plugins/yaml'

/**
 * Prettier in the browser build. Loaded eagerly rather than lazily: the plugins
 * are the bulk of it either way and a format keystroke should not wait on a
 * network-less dynamic import resolving.
 */
const PARSERS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'babel', jsx: 'babel', mjs: 'babel', cjs: 'babel',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', vue: 'vue',
  md: 'markdown', mdx: 'mdx',
  yml: 'yaml', yaml: 'yaml',
}

export function parserFor(path: string): string | null {
  return PARSERS[path.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

export const canFormat = (path: string) => parserFor(path) !== null

/**
 * Format source, honouring the project's own .prettierrc when the app can read
 * one — a formatter that quietly imposes different settings than the repo's is
 * worse than none, because it rewrites files the team has agreed on.
 */
export async function format(
  path: string,
  source: string,
  config: Record<string, unknown> | null,
): Promise<string> {
  const parser = parserFor(path)
  if (!parser) throw new Error(`no formatter for ${path.split('/').pop()}`)

  return prettier.format(source, {
    ...(config ?? {}),
    parser,
    plugins: [babel, estree, typescript, postcss, html, markdown, yaml],
  })
}

/** Parse a .prettierrc / .prettierrc.json / package.json "prettier" block. */
export function readConfig(raw: string, fromPackageJson: boolean): Record<string, unknown> | null {
  try {
    const doc = JSON.parse(raw)
    const cfg = fromPackageJson ? doc?.prettier : doc
    return cfg && typeof cfg === 'object' ? cfg : null
  } catch {
    return null
  }
}
