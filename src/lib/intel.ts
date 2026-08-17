export interface DirStat {
  name: string
  files: number
}

export interface Intel {
  root: string
  name: string
  languages: string[]
  frameworks: string[]
  package_manager: string
  test_framework: string
  database: string
  scripts: Record<string, string>
  build_cmd: string
  test_cmd: string
  dev_cmd: string
  typecheck_cmd: string
  entry_points: string[]
  config_files: string[]
  instruction_files: string[]
  top_dirs: DirStat[]
  file_count: number
  line_count: number
  skipped: number
}

/**
 * The compact brief handed to Claude once per task.
 *
 * Kept deliberately small — a few hundred tokens. Its job is to stop Claude
 * spending a turn running `ls` and `cat package.json` before it can start, not
 * to replace its own exploration. Anything Claude can cheaply discover itself
 * is left out; anything that is a *convention decision* (which package manager,
 * which test command) is included, because guessing those wrong is expensive.
 */
export function projectCard(intel: Intel | null): string {
  if (!intel) return ''
  const line = (label: string, value: string) => (value ? `${label}: ${value}\n` : '')

  const stack = [intel.languages.join(', '), intel.frameworks.join(', ')]
    .filter(Boolean)
    .join(' · ')

  const commands = [
    intel.build_cmd && `build \`${intel.build_cmd}\``,
    intel.test_cmd && `test \`${intel.test_cmd}\``,
    intel.dev_cmd && `dev \`${intel.dev_cmd}\``,
    intel.typecheck_cmd && `typecheck \`${intel.typecheck_cmd}\``,
  ]
    .filter(Boolean)
    .join(', ')

  const layout = intel.top_dirs
    .slice(0, 6)
    .map((d) => `${d.name} (${d.files})`)
    .join(', ')

  return (
    `<project-brief>\n` +
    line('Project', intel.name) +
    line('Stack', stack) +
    line('Package manager', intel.package_manager) +
    line('Tests', intel.test_framework) +
    line('Database', intel.database) +
    line('Commands', commands) +
    line('Entry points', intel.entry_points.slice(0, 4).join(', ')) +
    line('Layout', layout) +
    line('Size', `${intel.file_count} files, ${intel.line_count.toLocaleString()} lines`) +
    line('Project instructions', intel.instruction_files.join(', ')) +
    `</project-brief>\n` +
    `Use the commands above rather than guessing equivalents.` +
    (intel.instruction_files.length
      ? ` Follow ${intel.instruction_files.join(' and ')}.`
      : '')
  )
}

export function summarise(intel: Intel | null): string {
  if (!intel) return ''
  const bits = [intel.languages[0], intel.frameworks[0], intel.package_manager].filter(Boolean)
  return bits.join(' · ')
}
