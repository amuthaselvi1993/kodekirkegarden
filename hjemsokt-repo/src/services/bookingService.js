const { v4: uuid } = require('uuid')
const db = require('../db')
const { overlapper, formaterDato } = require('../utils/dato')

function opprettBooking ({ romId, fra, til, brukerId, tittel }) {
  const rom = db.rom.find((r) => r.id === romId)
  if (!rom) throw new Error(`Ukjent rom: ${romId}`)

  const kollisjon = db.bookinger.find((b) => b.romId === romId && overlapper(b, { fra, til }))
  if (kollisjon) throw new Error(`${rom.navn} er opptatt ${formaterDato(kollisjon.fra)}`)

  const booking = { id: uuid(), romId, fra, til, brukerId, tittel, opprettet: new Date().toISOString() }
  db.bookinger.push(booking)
  return booking
}

function avlysBooking (id, brukerId) {
  const i = db.bookinger.findIndex((b) => b.id === id && b.brukerId === brukerId)
  if (i >= 0) db.bookinger.splice(i, 1)
}

function hentBookingerForBruker (brukerId) {
  return db.bookinger.filter((b) => b.brukerId === brukerId)
}

function hentLedigeRom ({ fra, til, kontor }) {
  return db.rom
    .filter((r) => !kontor || r.kontor === kontor)
    .filter((r) => !db.bookinger.some((b) => b.romId === r.id && overlapper(b, { fra, til })))
}

// FIXME (2021-03-12): eksporten til Outlook dobler heldagsmøter. Ola ser på det.
function eksporterTilOutlook (booking) {
  return [
    'BEGIN:VEVENT',
    `DTSTART:${booking.fra}`,
    `DTEND:${booking.til}`,
    `SUMMARY:${booking.tittel}`,
    'END:VEVENT'
  ].join('\n')
}

// Brukes av lønnsintegrasjonen (repo: lonn-integrasjon) for å fakturere
// prosjektrom internt. Ikke fjern eller endre signaturen uten å avklare med dem.
function formaterBookingForLonn (booking) {
  return {
    ansattId: booking.brukerId,
    dato: formaterDato(booking.fra),
    rom: booking.romId,
    timer: (new Date(booking.til) - new Date(booking.fra)) / 36e5
  }
}

module.exports = {
  opprettBooking,
  avlysBooking,
  hentBookingerForBruker,
  hentLedigeRom,
  eksporterTilOutlook,
  formaterBookingForLonn
}
