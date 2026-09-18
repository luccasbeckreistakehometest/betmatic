/**
 * Runs the e2e suite as if it were another moment, without touching the machine clock.
 *
 *   E2E_CLOCK_SHIFT_MS=5400000 NODE_OPTIONS="--require ./tests/e2e/fake-clock.cjs" npx playwright test
 *
 * Preloaded into every Node process of a run (the Playwright runner, its workers, the seed and the
 * dev server all inherit NODE_OPTIONS), so the fake ESPN world, the database and the app agree on
 * what "now" is. That is what makes the seed's day arithmetic testable: shift by a few hours and the
 * run lands the other side of Eastern midnight, where the slate used to age out.
 *
 * The browser keeps the real clock — page-side countdowns drift by the shift, which no spec asserts.
 */
const shift = Number(process.env.E2E_CLOCK_SHIFT_MS ?? 0);

if (Number.isFinite(shift) && shift !== 0) {
  const RealDate = Date;
  const shiftedNow = () => RealDate.now() + shift;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [shiftedNow()] : args));
    }
    static now() {
      return shiftedNow();
    }
  }
  // parse and UTC are inherited statics, and the bundled server modules read Date's statics as own
  // properties: without these copies, application code calling Date.parse() throws "not a function".
  for (const key of Object.getOwnPropertyNames(RealDate)) {
    if (typeof RealDate[key] === "function" && !Object.prototype.hasOwnProperty.call(ShiftedDate, key)) {
      ShiftedDate[key] = RealDate[key].bind(RealDate);
    }
  }
  globalThis.Date = ShiftedDate;
}
