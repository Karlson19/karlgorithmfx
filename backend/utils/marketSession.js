const SESSIONS = {
  SYDNEY:   { open: 21, close: 6 },
  TOKYO:    { open: 0,  close: 9 },
  LONDON:   { open: 7,  close: 16 },
  NEW_YORK: { open: 12, close: 21 },
};

function isSessionActive(session, hourUTC) {
  const { open, close } = session;
  if (open > close) {
    // Wraps midnight (e.g. SYDNEY 21-6)
    return hourUTC >= open || hourUTC < close;
  }
  return hourUTC >= open && hourUTC < close;
}

function getActiveSessions() {
  const now = new Date();
  const hourUTC = now.getUTCHours();
  return Object.entries(SESSIONS)
    .filter(([, s]) => isSessionActive(s, hourUTC))
    .map(([name]) => name);
}

function getPrimarySession() {
  const active = getActiveSessions();
  if (active.includes('NEW_YORK') && active.includes('LONDON')) return 'LONDON_NY_OVERLAP';
  if (active.includes('NEW_YORK')) return 'NEW_YORK';
  if (active.includes('LONDON')) return 'LONDON';
  if (active.includes('TOKYO')) return 'TOKYO';
  if (active.includes('SYDNEY')) return 'SYDNEY';
  return 'CLOSED';
}

function isGoodTimeToTrade() {
  const session = getPrimarySession();
  return ['LONDON', 'NEW_YORK', 'LONDON_NY_OVERLAP'].includes(session);
}

function getNextSession() {
  const now = new Date();
  const hourUTC = now.getUTCHours();
  const minuteUTC = now.getUTCMinutes();

  const sessionOrder = ['SYDNEY', 'TOKYO', 'LONDON', 'NEW_YORK'];
  const opens = [21, 0, 7, 12];

  for (let i = 0; i < opens.length; i++) {
    const openHour = opens[i];
    if (openHour > hourUTC || (openHour === hourUTC && minuteUTC === 0)) {
      const hoursUntil = openHour - hourUTC;
      const minutesUntil = 60 - minuteUTC;
      return {
        name: sessionOrder[i],
        in: minuteUTC === 0
          ? `${hoursUntil} hour${hoursUntil !== 1 ? 's' : ''}`
          : `${hoursUntil > 0 ? hoursUntil - 1 + ' hour' + (hoursUntil - 1 !== 1 ? 's ' : ' ') : ''}${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}`
      };
    }
  }

  // Tomorrow's SYDNEY
  const hoursUntil = 24 - hourUTC + opens[0];
  return { name: 'SYDNEY', in: `${hoursUntil} hours` };
}

function getSessionInfo() {
  const primary = getPrimarySession();
  const active = getActiveSessions();
  const next = getNextSession();
  const isPeak = primary === 'LONDON_NY_OVERLAP';

  return {
    active_session: primary,
    all_active: active,
    good_time_to_trade: isGoodTimeToTrade(),
    is_peak_hours: isPeak,
    next_session: next.name,
    next_session_in: next.in,
    sessions: Object.keys(SESSIONS).reduce((acc, name) => {
      acc[name] = isSessionActive(SESSIONS[name], new Date().getUTCHours());
      return acc;
    }, {})
  };
}

module.exports = { getSessionInfo, getPrimarySession, isGoodTimeToTrade, getActiveSessions };
