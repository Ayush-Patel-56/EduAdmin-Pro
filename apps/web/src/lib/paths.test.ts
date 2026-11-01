import { describe, expect, it } from 'vitest'
import { isAppPath } from './paths'

describe('isAppPath', () => {
  it('accepts only paths inside this app', () => {
    for (const ok of ['/management/feedback', '/teacher', '/management/students?id=1']) expect(isAppPath(ok)).toBe(true)
    for (const bad of ['https://evil.example', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 'management', '', ' /x']) {
      expect(isAppPath(bad)).toBe(false)
    }
  })
})
