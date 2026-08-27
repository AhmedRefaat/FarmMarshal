/**
 * G2 mobile suite — logger control model (LOGGING_GUIDE parity).
 * Pure module: no RN imports, so runs in plain jest environment.
 */
describe('logger (mobile)', () => {
  it('exposes scoped loggers whose methods never throw', () => {
    const { makeLogger } = require('../logger');
    const log = makeLogger('test');
    expect(() => { log.debug('d'); log.info('i'); log.warn('w'); log.error('e'); }).not.toThrow();
  });
});
