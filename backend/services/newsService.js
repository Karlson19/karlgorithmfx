const Parser = require('rss-parser');
const cache = require('../utils/cache');

const parser = new Parser({
  customFields: {
    item: ['description']
  }
});

const RSS_FEEDS = [
  'https://www.forexfactory.com/ff_calendar_thisweek.xml',
  'https://feeds.feedburner.com/forexlive/eurusd'
];

function parseImpact(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  if (text.includes('fomc') || text.includes('nfp') || text.includes('gdp') ||
      text.includes('cpi') || text.includes('ecb') || text.includes('interest rate') ||
      text.includes('fed') || text.includes('unemployment')) {
    return 'HIGH';
  }
  if (text.includes('pmi') || text.includes('retail') || text.includes('trade balance') ||
      text.includes('consumer') || text.includes('manufacturing')) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function detectCurrency(title) {
  const text = title.toLowerCase();
  if (text.includes('eur') || text.includes('ecb') || text.includes('euro') ||
      text.includes('german') || text.includes('france') || text.includes('eurozone')) {
    return 'EUR';
  }
  if (text.includes('usd') || text.includes('fed') || text.includes('us ') ||
      text.includes('nfp') || text.includes('fomc') || text.includes('dollar')) {
    return 'USD';
  }
  return 'OTHER';
}

function formatCountdown(dateStr) {
  const now = new Date();
  const target = new Date(dateStr);
  const diff = target - now;
  if (diff < 0) return 'Released';
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

// Fallback hardcoded upcoming events for when RSS fails
function getFallbackNews() {
  const now = new Date();
  const addHours = (h) => new Date(now.getTime() + h * 3600000).toISOString();

  return [
    {
      id: '1',
      title: 'ECB Interest Rate Decision',
      currency: 'EUR',
      date: addHours(14),
      impact: 'HIGH',
      forecast: '4.25%',
      previous: '4.00%',
      actual: null,
      countdown: formatCountdown(addHours(14))
    },
    {
      id: '2',
      title: 'US Non-Farm Payrolls (NFP)',
      currency: 'USD',
      date: addHours(38),
      impact: 'HIGH',
      forecast: '185K',
      previous: '175K',
      actual: null,
      countdown: formatCountdown(addHours(38))
    },
    {
      id: '3',
      title: 'US CPI (Month-over-Month)',
      currency: 'USD',
      date: addHours(62),
      impact: 'HIGH',
      forecast: '0.3%',
      previous: '0.4%',
      actual: null,
      countdown: formatCountdown(addHours(62))
    },
    {
      id: '4',
      title: 'Eurozone GDP (Quarter-over-Quarter)',
      currency: 'EUR',
      date: addHours(26),
      impact: 'MEDIUM',
      forecast: '0.3%',
      previous: '0.1%',
      actual: null,
      countdown: formatCountdown(addHours(26))
    },
    {
      id: '5',
      title: 'US Initial Jobless Claims',
      currency: 'USD',
      date: addHours(50),
      impact: 'MEDIUM',
      forecast: '220K',
      previous: '215K',
      actual: null,
      countdown: formatCountdown(addHours(50))
    },
    {
      id: '6',
      title: 'German Manufacturing PMI',
      currency: 'EUR',
      date: addHours(5),
      impact: 'MEDIUM',
      forecast: '48.5',
      previous: '47.8',
      actual: null,
      countdown: formatCountdown(addHours(5))
    }
  ];
}

async function fetchNews() {
  const cached = cache.get('news');
  if (cached) return cached;

  try {
    const feed = await Promise.race([
      parser.parseURL('https://www.forexlive.com/feed/news'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('RSS timeout')), 5000))
    ]);

    const items = (feed.items || []).slice(0, 20).map((item, i) => ({
      id: String(i + 1),
      title: item.title || 'Forex News',
      currency: detectCurrency(item.title || ''),
      date: item.pubDate || new Date().toISOString(),
      impact: parseImpact(item.title || '', item.contentSnippet || ''),
      forecast: null,
      previous: null,
      actual: null,
      link: item.link,
      countdown: formatCountdown(item.pubDate || new Date().toISOString()),
      snippet: item.contentSnippet ? item.contentSnippet.slice(0, 150) : ''
    })).filter(n => n.currency === 'EUR' || n.currency === 'USD');

    const news = items.length > 0 ? items : getFallbackNews();
    cache.set('news', news, 300); // 5 min
    return news;
  } catch (err) {
    console.error('News fetch error:', err.message);
    const fallback = getFallbackNews();
    cache.set('news', fallback, 300);
    return fallback;
  }
}

function hasHighImpactNewsNearby(news, minutesWindow = 60) {
  const now = new Date();
  return news.some(n => {
    if (n.impact !== 'HIGH') return false;
    const diff = Math.abs(new Date(n.date) - now) / 60000;
    return diff <= minutesWindow;
  });
}

module.exports = { fetchNews, hasHighImpactNewsNearby };
