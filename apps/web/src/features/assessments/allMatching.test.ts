import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn()
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => api(...args) }))

const { allMatchingQuestions, SELECT_ALL_LIMIT } = await import('./api')

const page = (total: number, n: number, from = 0) => ({ total, page: 1, pageSize: 200, items: Array.from({ length: n }, (_, i) => ({ id: `q${from + i}` })) })

describe('allMatchingQuestions', () => {
  beforeEach(() => api.mockReset())

  it('pages through at 200 a request until it has them all, with the filters as given', async () => {
    api.mockResolvedValueOnce(page(450, 200)).mockResolvedValueOnce(page(450, 200, 200)).mockResolvedValueOnce(page(450, 50, 400))
    const qs = await allMatchingQuestions('/schools/s1/assessments', { subject: 'Physics', q: 'motion', bank: 'school' })
    expect(qs).toHaveLength(450)
    expect(api).toHaveBeenCalledTimes(3)
    const urls = api.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain('subject=Physics')
    expect(urls[0]).toContain('q=motion')
    expect(urls.map((u) => new URLSearchParams(u.split('?')[1]).get('page'))).toEqual(['1', '2', '3'])
    expect(urls.every((u) => u.includes('pageSize=200'))).toBe(true)
  })

  it(`refuses more than ${SELECT_ALL_LIMIT} after the first request, asking to narrow the filters`, async () => {
    api.mockResolvedValue(page(SELECT_ALL_LIMIT + 1, 200))
    await expect(allMatchingQuestions('/b', {})).rejects.toThrow(/1,001 questions match.*up to 1,000.*narrow the filters/)
    expect(api).toHaveBeenCalledTimes(1)
  })

  it(`allows exactly ${SELECT_ALL_LIMIT}`, async () => {
    for (let i = 0; i < 5; i++) api.mockResolvedValueOnce(page(SELECT_ALL_LIMIT, 200, i * 200))
    expect(await allMatchingQuestions('/b', {})).toHaveLength(SELECT_ALL_LIMIT)
  })
})
