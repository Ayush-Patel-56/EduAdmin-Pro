import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UploadsLinks } from './UploadsLinks'

describe('Faculty Uploads links on the Teacher Portal', () => {
  it('always offer Assignments and View all, so assignments are reachable even before any study material is uploaded', () => {
    const html = renderToStaticMarkup(<UploadsLinks onOpen={() => {}} />)
    expect(html).toContain('>Assignments</button>')
    expect(html).toContain('>View all</button>')
  })
})
