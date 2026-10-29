const db = require('../src/db')
const { opprettBooking, hentLedigeRom } = require('../src/services/bookingService')

beforeEach(() => { db.bookinger.length = 0 })

describe('opprettBooking', () => {
  it('lager en booking for et ledig rom', () => {
    const b = opprettBooking({ romId: 'osl-4-orakel', fra: '2026-10-29T16:00', til: '2026-10-29T17:00', brukerId: 'kari' })
    expect(b.id).toBeDefined()
  })

  it('avviser dobbeltbooking', () => {
    const tid = { romId: 'osl-4-orakel', fra: '2026-10-29T16:00', til: '2026-10-29T17:00' }
    opprettBooking({ ...tid, brukerId: 'kari' })
    expect(() => opprettBooking({ ...tid, brukerId: 'ola' })).toThrow('opptatt')
  })

  // FIXME (2021-04-08): feiler på sommertid. Skippet til vi har tid.
  it.skip('håndterer booking over sommertidsskiftet', () => {
    const b = opprettBooking({ romId: 'osl-4-orakel', fra: '2021-03-28T01:30', til: '2021-03-28T03:30', brukerId: 'kari' })
    expect(b.til).toBe('2021-03-28T03:30')
  })
})

describe('hentLedigeRom', () => {
  it('filtrerer på kontor', () => {
    const rom = hentLedigeRom({ fra: '2026-10-29T16:00', til: '2026-10-29T17:00', kontor: 'Bergen' })
    expect(rom.map((r) => r.id)).toEqual(['brg-2-taarnet'])
  })
})
