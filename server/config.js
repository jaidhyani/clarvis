import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const CONFIG_PATH = join(homedir(), '.clarvis', 'config.json')

const DEFAULTS = {
  port: 3000,
  projectsRoot: join(homedir(), 'projects')
}

function parseArgs(args) {
  const result = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      result.port = parseInt(args[i + 1], 10)
      i++
    } else if (args[i] === '--projects-root' && args[i + 1]) {
      result.projectsRoot = args[i + 1]
      i++
    }
  }
  return result
}

function loadConfigFile() {
  if (!existsSync(CONFIG_PATH)) {
    return {}
  }
  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(content)
  } catch {
    return {}
  }
}

function loadEnvVars() {
  const result = {}
  if (process.env.CLARVIS_PORT) {
    result.port = parseInt(process.env.CLARVIS_PORT, 10)
  }
  if (process.env.CLARVIS_PROJECTS_ROOT) {
    result.projectsRoot = process.env.CLARVIS_PROJECTS_ROOT
  }
  return result
}

export function loadConfig(argv = process.argv.slice(2)) {
  const fileConfig = loadConfigFile()
  const envConfig = loadEnvVars()
  const cliConfig = parseArgs(argv)

  // Precedence: CLI > env > file > defaults
  const config = {
    ...DEFAULTS,
    ...fileConfig,
    ...envConfig,
    ...cliConfig
  }

  // Expand ~ in projectsRoot
  if (config.projectsRoot.startsWith('~')) {
    config.projectsRoot = join(homedir(), config.projectsRoot.slice(1))
  }

  return config
}

export { CONFIG_PATH, DEFAULTS }
