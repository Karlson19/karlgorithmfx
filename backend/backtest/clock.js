// Virtual clock for replays. The engine reads "now" in a few places (session
// hours, pivot points, news windows). During a replay we point `Date` at the
// moment the candle under test closed, so the engine sees exactly what it
// would have seen live and nothing from the future.
const RealDate = Date;
let virtualNow = null;

class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0 && virtualNow !== null) super(virtualNow);
    else super(...args);
  }
  static now() {
    return virtualNow !== null ? virtualNow : RealDate.now();
  }
}

function install() { global.Date = FakeDate; }
function uninstall() { global.Date = RealDate; virtualNow = null; }
function setNow(ms) { virtualNow = ms; }

module.exports = { install, uninstall, setNow };
