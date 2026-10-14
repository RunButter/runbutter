// National public holidays, computed — pure, ZERO imports, browser and server.
//
// Free-data rule: no holiday API. Every country here is a handful of fixed
// dates plus a few that hang off Easter or "the last Monday of May", and that
// is arithmetic, not a service. The Time off screen computes a year, shows the
// list, and the admin saves it (set_public_holidays, 0136) — so a company that
// also closes on its own founding day, or works on a holiday, edits the list
// rather than fighting this file.
//
// NATIONAL days only. Germany, Spain, Switzerland and the US add regional
// ones (Bavaria's Epiphany, Catalonia's Sant Joan…); `note` says so on screen.
// Days that fall on a weekend are kept: they still show on the calendar, and
// they cost no working day anyway. Weekend SUBSTITUTE days are added where the
// law moves them (UK, US, Ireland's St Brigid's rule).

export interface Holiday { day: string; name: string }
export interface HolidayCountry { code: string; name: string; note?: string }

export const HOLIDAY_COUNTRIES: HolidayCountry[] = [
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland', note: 'Days most cantons observe; check your canton.' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'DE', name: 'Germany', note: 'Nationwide days only — add your state’s.' },
  { code: 'DK', name: 'Denmark' },
  { code: 'ES', name: 'Spain', note: 'National days only — add your region’s.' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom (England & Wales)' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IT', name: 'Italy' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'SE', name: 'Sweden' },
  { code: 'US', name: 'United States (federal)', note: 'Federal holidays; many companies work some of them.' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday

/** Easter Sunday (Gregorian), as [month, day]. Anonymous Gregorian algorithm. */
export function easter(y: number): [number, number] {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

/** The nth weekday of a month (n = -1: the last). weekday 0 = Sunday. */
function nth(y: number, m: number, weekday: number, n: number): [number, number, number] {
  if (n > 0) {
    const first = dow(y, m, 1);
    return [y, m, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7];
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [y, m, last - ((dow(y, m, last) - weekday + 7) % 7)];
}

export function holidaysFor(country: string, y: number): Holiday[] {
  const [em, ed] = easter(y);
  const E = (off: number, name: string): Holiday => ({ day: iso(y, em, ed + off), name });
  const F = (m: number, d: number, name: string): Holiday => ({ day: iso(y, m, d), name });
  const N = (m: number, weekday: number, n: number, name: string): Holiday => { const [a, b, c] = nth(y, m, weekday, n); return { day: iso(a, b, c), name }; };
  // UK/US style: a holiday on a weekend is observed on a weekday.
  const observedMon = (m: number, d: number, name: string): Holiday[] => {
    const w = dow(y, m, d);
    return w === 6 ? [F(m, d, name), { day: iso(y, m, d + 2), name: `${name} (substitute day)` }]
      : w === 0 ? [F(m, d, name), { day: iso(y, m, d + 1), name: `${name} (substitute day)` }] : [F(m, d, name)];
  };
  const observedUS = (m: number, d: number, name: string): Holiday[] => {
    const w = dow(y, m, d);
    return w === 6 ? [F(m, d, name), { day: iso(y, m, d - 1), name: `${name} (observed)` }]
      : w === 0 ? [F(m, d, name), { day: iso(y, m, d + 1), name: `${name} (observed)` }] : [F(m, d, name)];
  };
  // Midsummer Eve: the Friday between 19 and 25 June.
  const midsummerEve = (name: string): Holiday => { for (let d = 19; d <= 25; d++) if (dow(y, 6, d) === 5) return F(6, d, name); return F(6, 19, name); };

  let list: Holiday[] = [];
  switch (String(country).toUpperCase()) {
    case 'PL':
      list = [F(1, 1, 'New Year’s Day'), F(1, 6, 'Epiphany'), E(0, 'Easter Sunday'), E(1, 'Easter Monday'), F(5, 1, 'Labour Day'),
        F(5, 3, 'Constitution Day'), E(49, 'Pentecost'), E(60, 'Corpus Christi'), F(8, 15, 'Assumption Day'), F(11, 1, 'All Saints’ Day'),
        F(11, 11, 'Independence Day'), F(12, 25, 'Christmas Day'), F(12, 26, 'Second Day of Christmas')];
      // Christmas Eve became a public holiday from 2025.
      if (y >= 2025) list.push(F(12, 24, 'Christmas Eve'));
      break;
    case 'DE':
      list = [F(1, 1, 'New Year’s Day'), E(-2, 'Good Friday'), E(1, 'Easter Monday'), F(5, 1, 'Labour Day'), E(39, 'Ascension Day'),
        E(50, 'Whit Monday'), F(10, 3, 'German Unity Day'), F(12, 25, 'Christmas Day'), F(12, 26, 'Second Day of Christmas')];
      break;
    case 'AT':
      list = [F(1, 1, 'New Year’s Day'), F(1, 6, 'Epiphany'), E(1, 'Easter Monday'), F(5, 1, 'Labour Day'), E(39, 'Ascension Day'),
        E(50, 'Whit Monday'), E(60, 'Corpus Christi'), F(8, 15, 'Assumption Day'), F(10, 26, 'National Day'), F(11, 1, 'All Saints’ Day'),
        F(12, 8, 'Immaculate Conception'), F(12, 25, 'Christmas Day'), F(12, 26, 'St Stephen’s Day')];
      break;
    case 'CH':
      list = [F(1, 1, 'New Year’s Day'), E(-2, 'Good Friday'), E(1, 'Easter Monday'), E(39, 'Ascension Day'), E(50, 'Whit Monday'),
        F(8, 1, 'Swiss National Day'), F(12, 25, 'Christmas Day'), F(12, 26, 'St Stephen’s Day')];
      break;
    case 'CZ':
      list = [F(1, 1, 'New Year’s Day'), E(-2, 'Good Friday'), E(1, 'Easter Monday'), F(5, 1, 'Labour Day'), F(5, 8, 'Liberation Day'),
        F(7, 5, 'Saints Cyril and Methodius'), F(7, 6, 'Jan Hus Day'), F(9, 28, 'Statehood Day'), F(10, 28, 'Independence Day'),
        F(11, 17, 'Freedom and Democracy Day'), F(12, 24, 'Christmas Eve'), F(12, 25, 'Christmas Day'), F(12, 26, 'St Stephen’s Day')];
      break;
    case 'GB':
      list = [...observedMon(1, 1, 'New Year’s Day'), E(-2, 'Good Friday'), E(1, 'Easter Monday'), N(5, 1, 1, 'Early May bank holiday'),
        N(5, 1, -1, 'Spring bank holiday'), N(8, 1, -1, 'Summer bank holiday')];
      {
        // Christmas and Boxing Day move together: the two weekdays after.
        const w = dow(y, 12, 25);
        if (w === 6) list.push(F(12, 25, 'Christmas Day'), F(12, 26, 'Boxing Day'), { day: iso(y, 12, 27), name: 'Christmas Day (substitute day)' }, { day: iso(y, 12, 28), name: 'Boxing Day (substitute day)' });
        else if (w === 0) list.push(F(12, 25, 'Christmas Day'), F(12, 26, 'Boxing Day'), { day: iso(y, 12, 27), name: 'Christmas Day (substitute day)' });
        else if (w === 5) list.push(F(12, 25, 'Christmas Day'), F(12, 26, 'Boxing Day'), { day: iso(y, 12, 28), name: 'Boxing Day (substitute day)' });
        else list.push(F(12, 25, 'Christmas Day'), F(12, 26, 'Boxing Day'));
      }
      break;
    case 'IE': {
      // St Brigid's Day (from 2023): 1 February when it is a Friday, else the first Monday of February.
      const brigid = y >= 2023 ? [dow(y, 2, 1) === 5 ? F(2, 1, 'St Brigid’s Day') : N(2, 1, 1, 'St Brigid’s Day')] : [];
      list = [F(1, 1, 'New Year’s Day'), ...brigid, F(3, 17, 'St Patrick’s Day'), E(1, 'Easter Monday'), N(5, 1, 1, 'May bank holiday'),
        N(6, 1, 1, 'June bank holiday'), N(8, 1, 1, 'August bank holiday'), N(10, 1, -1, 'October bank holiday'),
        F(12, 25, 'Christmas Day'), F(12, 26, 'St Stephen’s Day')];
      break;
    }
    case 'US':
      list = [...observedUS(1, 1, 'New Year’s Day'), N(1, 1, 3, 'Martin Luther King Jr. Day'), N(2, 1, 3, 'Washington’s Birthday'),
        N(5, 1, -1, 'Memorial Day'), ...observedUS(6, 19, 'Juneteenth'), ...observedUS(7, 4, 'Independence Day'), N(9, 1, 1, 'Labor Day'),
        N(10, 1, 2, 'Columbus Day'), ...observedUS(11, 11, 'Veterans Day'), N(11, 4, 4, 'Thanksgiving Day'), ...observedUS(12, 25, 'Christmas Day')];
      break;
    case 'FR':
      list = [F(1, 1, 'New Year’s Day'), E(1, 'Easter Monday'), F(5, 1, 'Labour Day'), F(5, 8, 'Victory in Europe Day'), E(39, 'Ascension Day'),
        E(50, 'Whit Monday'), F(7, 14, 'Bastille Day'), F(8, 15, 'Assumption Day'), F(11, 1, 'All Saints’ Day'), F(11, 11, 'Armistice Day'),
        F(12, 25, 'Christmas Day')];
      break;
    case 'BE':
      list = [F(1, 1, 'New Year’s Day'), E(1, 'Easter Monday'), F(5, 1, 'Labour Day'), E(39, 'Ascension Day'), E(50, 'Whit Monday'),
        F(7, 21, 'National Day'), F(8, 15, 'Assumption Day'), F(11, 1, 'All Saints’ Day'), F(11, 11, 'Armistice Day'), F(12, 25, 'Christmas Day')];
      break;
    case 'NL': {
      // King's Day moves to the 26th when the 27th is a Sunday; Liberation Day is a day off every fifth year.
      list = [F(1, 1, 'New Year’s Day'), E(0, 'Easter Sunday'), E(1, 'Easter Monday'), dow(y, 4, 27) === 0 ? F(4, 26, 'King’s Day') : F(4, 27, 'King’s Day'),
        E(39, 'Ascension Day'), E(49, 'Whit Sunday'), E(50, 'Whit Monday'), F(12, 25, 'Christmas Day'), F(12, 26, 'Second Day of Christmas')];
      if (y % 5 === 0) list.push(F(5, 5, 'Liberation Day'));
      break;
    }
    case 'LU':
      list = [F(1, 1, 'New Year’s Day'), E(1, 'Easter Monday'), F(5, 1, 'Labour Day'), ...(y >= 2019 ? [F(5, 9, 'Europe Day')] : []), E(39, 'Ascension Day'),
        E(50, 'Whit Monday'), F(6, 23, 'National Day'), F(8, 15, 'Assumption Day'), F(11, 1, 'All Saints’ Day'), F(12, 25, 'Christmas Day'),
        F(12, 26, 'St Stephen’s Day')];
      break;
    case 'ES':
      list = [F(1, 1, 'New Year’s Day'), F(1, 6, 'Epiphany'), E(-2, 'Good Friday'), F(5, 1, 'Labour Day'), F(8, 15, 'Assumption Day'),
        F(10, 12, 'National Day of Spain'), F(11, 1, 'All Saints’ Day'), F(12, 6, 'Constitution Day'), F(12, 8, 'Immaculate Conception'),
        F(12, 25, 'Christmas Day')];
      break;
    case 'PT':
      list = [F(1, 1, 'New Year’s Day'), E(-2, 'Good Friday'), E(0, 'Easter Sunday'), F(4, 25, 'Freedom Day'), F(5, 1, 'Labour Day'),
        E(60, 'Corpus Christi'), F(6, 10, 'Portugal Day'), F(8, 15, 'Assumption Day'), F(10, 5, 'Republic Day'), F(11, 1, 'All Saints’ Day'),
        F(12, 1, 'Restoration of Independence'), F(12, 8, 'Immaculate Conception'), F(12, 25, 'Christmas Day')];
      break;
    case 'IT':
      list = [F(1, 1, 'New Year’s Day'), F(1, 6, 'Epiphany'), E(0, 'Easter Sunday'), E(1, 'Easter Monday'), F(4, 25, 'Liberation Day'),
        F(5, 1, 'Labour Day'), F(6, 2, 'Republic Day'), F(8, 15, 'Ferragosto'), F(11, 1, 'All Saints’ Day'), F(12, 8, 'Immaculate Conception'),
        F(12, 25, 'Christmas Day'), F(12, 26, 'St Stephen’s Day')];
      break;
    case 'SE':
      list = [F(1, 1, 'New Year’s Day'), F(1, 6, 'Epiphany'), E(-2, 'Good Friday'), E(1, 'Easter Monday'), F(5, 1, 'May Day'),
        E(39, 'Ascension Day'), F(6, 6, 'National Day'), midsummerEve('Midsummer Eve'), F(12, 24, 'Christmas Eve'), F(12, 25, 'Christmas Day'),
        F(12, 26, 'Boxing Day'), F(12, 31, 'New Year’s Eve')];
      break;
    case 'NO':
      list = [F(1, 1, 'New Year’s Day'), E(-3, 'Maundy Thursday'), E(-2, 'Good Friday'), E(1, 'Easter Monday'), F(5, 1, 'Labour Day'),
        F(5, 17, 'Constitution Day'), E(39, 'Ascension Day'), E(50, 'Whit Monday'), F(12, 25, 'Christmas Day'), F(12, 26, 'Boxing Day')];
      break;
    case 'DK':
      list = [F(1, 1, 'New Year’s Day'), E(-3, 'Maundy Thursday'), E(-2, 'Good Friday'), E(1, 'Easter Monday'),
        ...(y < 2024 ? [E(26, 'Great Prayer Day')] : []), E(39, 'Ascension Day'), E(50, 'Whit Monday'),
        F(12, 25, 'Christmas Day'), F(12, 26, 'Second Day of Christmas')];
      break;
    case 'FI':
      list = [F(1, 1, 'New Year’s Day'), F(1, 6, 'Epiphany'), E(-2, 'Good Friday'), E(1, 'Easter Monday'), F(5, 1, 'May Day'),
        E(39, 'Ascension Day'), midsummerEve('Midsummer Eve'), F(12, 6, 'Independence Day'), F(12, 24, 'Christmas Eve'),
        F(12, 25, 'Christmas Day'), F(12, 26, 'St Stephen’s Day')];
      break;
    default:
      return [];
  }
  // One entry per day (a substitute can land on another holiday), in order.
  const seen = new Map<string, Holiday>();
  for (const h of list) if (!seen.has(h.day)) seen.set(h.day, h);
  return [...seen.values()].sort((a, b) => a.day.localeCompare(b.day));
}
