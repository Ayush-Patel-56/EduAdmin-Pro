import { describe, expect, it } from 'vitest'
import { newPasswordProblem } from './passwordRules'

describe('newPasswordProblem', () => {
  it('wants 8 to 128 characters, typed the same twice', () => {
    expect(newPasswordProblem('short', 'short')).toBe('Password must be at least 8 characters')
    expect(newPasswordProblem('x'.repeat(129), 'x'.repeat(129))).toBe('Password must be at most 128 characters')
    expect(newPasswordProblem('long-enough', 'long-enougH')).toBe("The two passwords don't match")
    expect(newPasswordProblem('long-enough', 'long-enough')).toBeNull()
  })
})
