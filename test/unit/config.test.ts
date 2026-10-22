/**
 * The tests of the configuration of the studio.
 */

import { describe, expect, test } from 'bun:test'
import { ConfigError, readConfig } from '../../src/platform/config'

/** A workspace of the tests. */
const WORKSPACE = '22222222-2222-4222-8222-222222222222'

describe('the configuration of the studio', () => {
  test('it reads the defaults of a development environment', () => {
    const config = readConfig({})
    expect(config.port).toBe(8081)
    expect(config.gatewayUrl).toBe('http://localhost:8080')
    expect(config.hubUrl).toBe('http://localhost:8082')
    expect(config.workspaces).toEqual([])
    expect(config.production).toBe(false)
  })

  test('it reads the workspaces of the deployment', () => {
    const config = readConfig({
      BRIDGE_WORKSPACES: ` ${WORKSPACE} , 11111111-1111-4111-8111-111111111111 `,
    })
    expect(config.workspaces).toEqual([WORKSPACE, '11111111-1111-4111-8111-111111111111'])
  })

  test('it refuses a workspace that is not an identifier', () => {
    expect(() => readConfig({ BRIDGE_WORKSPACES: 'acme' })).toThrow(ConfigError)
  })

  test('it refuses a workspace that is named twice', () => {
    expect(() => readConfig({ BRIDGE_WORKSPACES: `${WORKSPACE},${WORKSPACE}` })).toThrow(
      ConfigError
    )
  })

  test('a production environment needs the workspaces and the key of the gateway', () => {
    expect(() => readConfig({ NODE_ENV: 'production' })).toThrow(ConfigError)
    expect(() => readConfig({ NODE_ENV: 'production', BRIDGE_WORKSPACES: WORKSPACE })).toThrow(
      ConfigError
    )
    const config = readConfig({
      NODE_ENV: 'production',
      BRIDGE_WORKSPACES: WORKSPACE,
      BRIDGE_GATEWAY_IDENTITY_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----',
    })
    expect(config.production).toBe(true)
    expect(config.requireGatewayIdentity).toBe(true)
    expect(config.gatewayIdentityKey?.version).toBe('v5')
  })

  test('it cannot require the identity of the gateway without a key', () => {
    expect(() =>
      readConfig({ BRIDGE_REQUIRE_GATEWAY_IDENTITY: 'true', BRIDGE_WORKSPACES: WORKSPACE })
    ).toThrow(ConfigError)
  })

  test('the redirect uri is the url of the studio', () => {
    const config = readConfig({ BRIDGE_PUBLIC_URL: 'https://studio.example.com/' })
    expect(config.hub.redirectUri).toBe('https://studio.example.com/auth/callback')
  })
})
