jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({}) })
}))
const { sendBekreftelse } = require('../src/services/varsling')

describe('varsling', () => {
  it('sender bekreftelse uten å kaste', async () => {
    await expect(sendBekreftelse('kari@firma.intern', { tittel: 'Demo', fra: '2026-10-29T16:00' })).resolves.toBeUndefined()
  })
})
