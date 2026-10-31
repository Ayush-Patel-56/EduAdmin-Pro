import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { forgetPreviousUser, meQueryKey } from './session'

describe('signing in on a shared browser', () => {
  it("drops everything cached for whoever was here before, and re-reads who's signed in", () => {
    const client = new QueryClient()
    client.setQueryData(['notifications'], [{ id: 'n1' }])
    client.setQueryData(['recruitment', 'candidates', {}], [{ id: 'c1' }])
    client.setQueryData(meQueryKey, { id: 'previous-user' })
    forgetPreviousUser(client)
    expect(client.getQueryData(['notifications'])).toBeUndefined()
    expect(client.getQueryData(['recruitment', 'candidates', {}])).toBeUndefined()
    expect(client.getQueryData(meQueryKey)).toBeUndefined()
  })
})
