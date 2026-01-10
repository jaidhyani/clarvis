import { test, describe } from 'node:test'
import assert from 'node:assert'
import { loadConfig, DEFAULTS } from './config.js'
import { homedir } from 'os'
import { join } from 'path'

describe('config', () => {
  test('returns defaults when no config provided', () => {
    const config = loadConfig([])
    assert.strictEqual(config.port, DEFAULTS.port)
    assert.strictEqual(config.projectsRoot, DEFAULTS.projectsRoot)
  })

  test('CLI args override defaults', () => {
    const config = loadConfig(['--port', '8080', '--projects-root', '/tmp/projects'])
    assert.strictEqual(config.port, 8080)
    assert.strictEqual(config.projectsRoot, '/tmp/projects')
  })

  test('expands ~ in projectsRoot', () => {
    const config = loadConfig(['--projects-root', '~/my-projects'])
    assert.strictEqual(config.projectsRoot, join(homedir(), 'my-projects'))
  })

  test('ignores invalid port', () => {
    const config = loadConfig(['--port', 'invalid'])
    assert.strictEqual(Number.isNaN(config.port), true)
  })
})
