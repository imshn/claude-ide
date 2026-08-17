import React from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import App from './App'
import './styles.css'

// Monaco must come from the bundle, never a CDN: a packaged desktop app can be
// offline and must not reach out to the network to render an editor.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    return new editorWorker()
  },
}
loader.config({ monaco })

monaco.editor.defineTheme('claude-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6b6b76', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'd97757' },
    { token: 'string', foreground: '8fbf7f' },
    { token: 'number', foreground: 'd3a15f' },
    { token: 'type', foreground: '9db8d8' },
  ],
  colors: {
    'editor.background': '#121215',
    'editor.foreground': '#e9e9ec',
    'editorLineNumber.foreground': '#4a4a55',
    'editorLineNumber.activeForeground': '#9a9aa4',
    'editor.selectionBackground': '#2c2c36',
    'editor.lineHighlightBackground': '#17171b',
    'editorIndentGuide.background1': '#1e1e24',
    'editorGutter.background': '#121215',
    'scrollbarSlider.background': '#2e2e3699',
  },
})

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
