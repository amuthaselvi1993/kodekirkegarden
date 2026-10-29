const dayjs = require('dayjs')

function overlapper (a, b) {
  return new Date(a.fra) < new Date(b.til) && new Date(b.fra) < new Date(a.til)
}

function formaterDato (iso) {
  return dayjs(iso).format('DD.MM.YYYY HH:mm')
}

module.exports = { overlapper, formaterDato }
