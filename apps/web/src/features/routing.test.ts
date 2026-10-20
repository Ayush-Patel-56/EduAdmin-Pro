import { describe, expect, it } from 'vitest'
import { adminNav, legacyAdminTarget } from './admin/nav'
import { DEFAULT_PREFERENCES, preferencesOf } from './auth/types'
import { legacyTeacherPaths, teacherNav } from './teacher/nav'

describe('legacy admin redirects', () => {
  it('sends the old dashboard root to /management', () => {
    expect(legacyAdminTarget('')).toBe('/management')
  })

  it('renames the paths that changed', () => {
    expect(legacyAdminTarget('fees')).toBe('/management/fee-management')
    expect(legacyAdminTarget('tests')).toBe('/management/tests-bank')
  })

  it('keeps unchanged sections and any deeper path', () => {
    expect(legacyAdminTarget('academic-planning')).toBe('/management/academic-planning')
    expect(legacyAdminTarget('fees/receipts/7')).toBe('/management/fee-management/receipts/7')
  })

  it('never redirects to a section that does not exist', () => {
    for (const old of ['fees', 'tests']) {
      const target = legacyAdminTarget(old).replace('/management/', '')
      expect(adminNav.some((n) => n.path === target)).toBe(true)
    }
  })
})

describe('legacy faculty redirects', () => {
  it('every old path points at a real faculty page', () => {
    for (const to of Object.values(legacyTeacherPaths)) {
      expect(teacherNav.some((n) => n.path === to)).toBe(true)
    }
  })

  it('maps the renamed pages', () => {
    expect(legacyTeacherPaths['daily-class-report']).toBe('daily-report')
    expect(legacyTeacherPaths['student-ratings']).toBe('daily-ratings')
    expect(legacyTeacherPaths['study-material']).toBe('courses')
  })
})

describe('preferencesOf (older API without preferences)', () => {
  it('falls back to defaults when /auth/me has no preferences', () => {
    expect(preferencesOf({})).toEqual(DEFAULT_PREFERENCES)
    expect(preferencesOf({ preferences: undefined }).accentTheme).toBeNull()
  })

  it('uses the stored preferences when present', () => {
    expect(
      preferencesOf({ preferences: { emailNotifications: false, syllabusUpdates: true, accentTheme: 'EMERALD' } }),
    ).toEqual({ emailNotifications: false, syllabusUpdates: true, accentTheme: 'EMERALD' })
  })

  it('fills any missing field from the defaults', () => {
    const partial = { preferences: { accentTheme: 'BLUE' } } as Parameters<typeof preferencesOf>[0]
    expect(preferencesOf(partial)).toEqual({ emailNotifications: false, syllabusUpdates: true, accentTheme: 'BLUE' })
  })
})
