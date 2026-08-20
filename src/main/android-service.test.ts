import { describe, expect, it } from 'vitest'
import { parseAdbDevices, parsePackages } from './android-service'

describe('Android service parsers', () => {
  it('returns only connected ADB devices', () => {
    const output = [
      'List of devices attached',
      'emulator-5554\tdevice',
      'emulator-5556\toffline',
      '192.168.0.2:5555\tunauthorized',
      ''
    ].join('\n')

    expect(parseAdbDevices(output)).toEqual(['emulator-5554'])
  })

  it('normalizes Android package output', () => {
    const output = 'package:com.example.game\r\npackage:com.example.chat\r\n'
    expect(parsePackages(output)).toEqual(['com.example.game', 'com.example.chat'])
  })
})
