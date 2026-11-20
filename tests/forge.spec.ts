/** Contract of a Source kind's code-host capability on SourceRegistry. */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { SettingsSchema } from '../src/policy.ts'
import type { ChangeSnapshot, ForgePort } from '../src/sources/forge.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { SourceRegistry } from '../src/sources/registry.ts'

const snapshot = (number: number): ChangeSnapshot => ({ ref: { kind: 'change', number }, state: 'open', url: `https://forge.example/change/${number}`,
  authorId: 'alice', sameProject: true })

const forge: ForgePort = {
  kind: 'demo',
  changeWord: { zh: '变更', en: 'change' },
  pageUrl: (project, ref) => `https://forge.example/${project}/change/${ref.number}`,
  change: {
    parse: thread => thread.startsWith('demo:change:') ? { kind: 'change', number: Number(thread.slice('demo:change:'.length)) } : undefined,
    read: async (_ctx, ref) => snapshot(ref.number),
    claim: () => undefined,
    observe: async () => false,
    numbersOf: () => [1],
    terminalNotices: () => [],
  },
}
const kind = (id: string, capabilities?: SourceKind['capabilities']): SourceKind => ({
  kind: id, title: { zh: id, en: id }, description: { zh: '', en: '' }, schema: z.object({}).strict(), fields: [], health: [],
  ...capabilities ? { capabilities } : {},
})

describe('Source code-host capability', () => {
  it('publishes one ForgePort per registered kind and leaves kinds without one undefined', () => {
    const sources = new SourceRegistry(() => SettingsSchema.parse({}))
    sources.register(kind('demo', { forge }))
    sources.register(kind('plain'))
    expect(sources.forgeOf('demo')).toBe(forge)
    expect(sources.capabilities('demo')).toEqual({ forge })
    expect(sources.forgeOf('plain')).toBeUndefined()
    expect(sources.forgeOf('missing')).toBeUndefined()
    expect(sources.forges()).toEqual([{ source: 'demo', forge }])
  })

  it('projects a followed change into the card shape through the lookup', async () => {
    const { ticketChange } = await import('../src/app/cards.ts')
    expect(ticketChange({ follows: [{ thread: 'demo:change:7', own: true }] }, { forges: () => [{ source: 'demo', forge }] }))
      .toEqual({ source: 'demo', number: 7, word: { zh: '变更', en: 'change' } })
    expect(ticketChange({ follows: [{ thread: 'demo:change:7', own: true, closed: { at: 'x', outcome: 'merged' } }] },
      { forges: () => [{ source: 'demo', forge }] })).toMatchObject({ number: 7 })
    expect(ticketChange({ follows: [] }, { forges: () => [{ source: 'demo', forge }] })).toBeUndefined()
  })

  it('lets the capability parse its own Thread keys and derive a page URL', () => {
    expect(forge.change.parse('demo:change:7')).toEqual({ kind: 'change', number: 7 })
    expect(forge.change.parse('demo:issue:7')).toBeUndefined()
    expect(forge.pageUrl('group/app', { kind: 'change', number: 7 })).toBe('https://forge.example/group/app/change/7')
  })
})
