/**
 * Password and passphrase generation.
 *
 * Zero imports and no Node APIs, so this runs in the browser, in a route
 * handler and in a test with the same code — same rule as lib/finance/runway.ts
 * and lib/workspace/blueprint.ts.
 *
 * ── TWO THINGS HERE ARE EASY TO GET WRONG AND SILENT WHEN YOU DO ────────────
 *
 * 1. `Math.random()` is not a CSPRNG. It is seeded, predictable and in some
 *    engines recoverable from a handful of outputs. A password generator built
 *    on it produces strings that LOOK random and are guessable, and nothing
 *    about the output ever reveals it. This uses `crypto.getRandomValues` and
 *    throws if it is missing rather than falling back — a silent downgrade to a
 *    weak generator is worse than an error, because the user keeps the password.
 *
 * 2. `random % alphabet.length` is BIASED unless the length divides 256. With
 *    a 26-letter alphabet the first four letters come up ~11% more often than
 *    the rest, which quietly removes bits from every password. Rejection
 *    sampling below discards the tail of the byte range instead.
 *
 * ── STRENGTH IS COMPUTED, NOT SCORED ────────────────────────────────────────
 * `entropyBits` is exactly log2(alphabet^length) — the real figure for a string
 * drawn uniformly from a known alphabet, which is what these are. No zxcvbn, no
 * five-colour "strength meter" guessing at a number it cannot know. A meter
 * that says "Strong" for `Password1!` is worse than no meter, and one that
 * cannot tell 60 bits from 120 is not measuring the thing that matters.
 */

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** Drop 0/O/1/l/I — for anything a human will read aloud or retype. */
  avoidAmbiguous: boolean;
}

export const DEFAULT_OPTIONS: PasswordOptions = {
  length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false,
};

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
// No quotes, backslash or backtick: these end up in shell commands, YAML files
// and connection strings, and the one that breaks is never the one you test.
const SYMBOLS = '!#$%&()*+,-./:;<=>?@[]^_{|}~';
const AMBIGUOUS = /[0O1lI|]/g;

function randomBytes(n: number): Uint8Array {
  const c = (globalThis as any).crypto;
  if (!c?.getRandomValues) {
    throw new Error('No secure random source. Password generation is refused rather than falling back to Math.random.');
  }
  return c.getRandomValues(new Uint8Array(n));
}

/**
 * A uniform index into `n` options, by rejection sampling.
 *
 * Values at or above the largest multiple of `n` inside the range are thrown
 * away, so every remaining value maps to exactly one index. Refilling in blocks
 * keeps it to roughly one syscall per password rather than one per character.
 *
 * THE RANGE IS SIZED TO `n`, and the first version of this was not: it always
 * drew ONE byte, so for the 695-word list `256 % 695` is 256, the acceptance
 * limit came out zero, and the loop never terminated — the passphrase generator
 * hung the tab rather than producing a biased result. Enough bytes are drawn to
 * cover `n`, which is also what keeps the sampling uniform for any list size a
 * future word file might have.
 */
function uniform(n: number, take: () => number): number {
  if (n <= 0) throw new Error('empty alphabet');
  let bytes = 1, range = 256;
  while (range < n) { bytes++; range *= 256; }
  const limit = range - (range % n);
  for (;;) {
    let v = 0;
    for (let i = 0; i < bytes; i++) v = v * 256 + take();
    if (v < limit) return v % n;
  }
}

function byteSource() {
  let buf = randomBytes(256);
  let i = 0;
  return () => {
    if (i >= buf.length) { buf = randomBytes(256); i = 0; }
    return buf[i++];
  };
}

export function buildAlphabet(o: PasswordOptions): string {
  let a = '';
  if (o.lower) a += LOWER;
  if (o.upper) a += UPPER;
  if (o.digits) a += DIGITS;
  if (o.symbols) a += SYMBOLS;
  if (o.avoidAmbiguous) a = a.replace(AMBIGUOUS, '');
  return a;
}

/**
 * At least one character from every selected class.
 *
 * Not for strength — it very slightly REDUCES entropy by constraining the
 * output — but because sites reject a password with no digit, and a generator
 * whose result is rejected on submit is a generator people stop using. The
 * guaranteed characters are placed at random positions, never at the end, or
 * the shape itself leaks which classes were forced.
 */
export function generatePassword(opts: Partial<PasswordOptions> = {}): string {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const len = Math.max(4, Math.min(Math.floor(o.length) || 20, 128));
  const alphabet = buildAlphabet(o);
  if (!alphabet) throw new Error('Pick at least one character type.');

  const take = byteSource();
  const classes = [
    o.lower && LOWER, o.upper && UPPER, o.digits && DIGITS, o.symbols && SYMBOLS,
  ].filter(Boolean).map((s) => (o.avoidAmbiguous ? (s as string).replace(AMBIGUOUS, '') : s as string))
    .filter((s) => s.length > 0);

  const out: string[] = [];
  for (let i = 0; i < len; i++) out.push(alphabet[uniform(alphabet.length, take)]);

  // Place one of each class at distinct random positions.
  const slots = new Set<number>();
  for (const cls of classes.slice(0, len)) {
    let p = uniform(len, take);
    while (slots.has(p)) p = (p + 1) % len;
    slots.add(p);
    out[p] = cls[uniform(cls.length, take)];
  }
  return out.join('');
}

/**
 * A short, memorable word list. Deliberately not the full 7776-word EFF list:
 * shipping 60 kB of words to every visitor to generate a passphrase is a poor
 * trade, and the entropy is REPORTED honestly from whatever list is here rather
 * than claimed from a list we do not have.
 */
const WORDS = ('able acid aged also arch area army atom aunt away axis baby back bald band bank barn base bath bead beam bean bear beat beef bell belt bend best bike bill bird bite blue boat body boil bold bolt bond bone book boot born boss both bowl bulk bull burn bush busy cafe cage cake calm camp cane card care cart case cash cast cave cell chef chin chip city clam clap claw clay clip club coal coat code coin cold cook cool copy cord cork corn cost crew crop cube cusp dark dart dash data date dawn deal dean dear debt deck deep deer desk dial dice diet disk dive dock does dome done door dose dove down draw drew drip drop drum dual duck dust duty each earn ease east easy echo edge exit face fact fade fair fall fame farm fast fate fear feat feed feel fell felt file fill film find fine fire firm fish fist five flag flat flew flip flow foam foil fold folk food foot ford fork form fort four fuel full fund gain game gate gave gear gene gift girl give glad glass goal goat gold golf gone good gown grab gray grew grid grin grip grow gulf hair half hall hand hang hard harm hawk haze head heal heap hear heat heel held hell helm help herb herd hero hide high hill hint hire hive hold hole home hood hoof hook hope horn hose host hour huge hunt hurt icon idea inch iron item jade jail jazz jeep join joke jump junk keen keep kept kick kind king kiss kite knee knew knot lace lack lake lamb lamp land lane late lava lawn layer lead leaf leak lean leap left lend lens levy life lift like limb lime line link lion list live load loaf loan lock loft logo lone long look loop lord lose loss loud love luck lung made mail main make male mall many maple march mark mask mast mate math meal mean meat meet melt menu mesh mice mild mile milk mill mind mine mint miss mist mode mold mole monk mood moon more moss most moth move much mule muse must nail name navy near neat neck need nest news next nice node none noon norm nose note noun oath obey odds oily omit once only onto open oral oven over pace pack page paid pain pair palm park part pass past path peak pear peat peer pile pine pink pipe pity plan play plot plug plum poem poet pole poll pond pool poor pope pore port pose post pour pray prey prop pull pulp pump pure push quit quiz race rack raft rage raid rail rain rake ramp rank rare rate read real reef reel rent rest ribs rice rich ride ring riot ripe rise risk road roar robe rock rode role roll roof room root rope rose ruby rude ruin rule rush rust sage said sail salt same sand save scan seal seat seed seek self sell send sent shed ship shoe shop shot show shut side sigh sign silk sing sink site size skin skip slab sled slim slip slot slow snap snow soak soap sock soft soil sold sole solo song soon sort soul soup sour span spin spot spun spur stab star stay stem step stir stop such suit sung sunk sure surf swam swan swim tail take tale talk tall tank tape task teal team tear tell tend tent term test text than that thaw them then they thin this thus tide tidy tile till tilt time tiny toad toll tone took tool tore torn tour town trap tray tree trim trip true tube tuna tune turn twin type unit upon urge used user vain vale vane vary vase vast veil vein verb vest veto view vine visa void volt vote wade wage wait wake walk wall wand want ward warm wash wave weak wear weed week well went were west what when whip whom wide wife wild will wind wine wing wipe wire wise wish wolf wood wool word wore work worm worn wrap yard yarn year yell yoga zeal zero zinc zone zoom').split(' ');

export interface PassphraseOptions { words: number; separator: string; capitalize: boolean; number: boolean }
export const DEFAULT_PASSPHRASE: PassphraseOptions = { words: 5, separator: '-', capitalize: false, number: false };

export function generatePassphrase(opts: Partial<PassphraseOptions> = {}): string {
  const o = { ...DEFAULT_PASSPHRASE, ...opts };
  const n = Math.max(3, Math.min(Math.floor(o.words) || 5, 12));
  const take = byteSource();
  const picked: string[] = [];
  for (let i = 0; i < n; i++) {
    // WITH replacement. Removing a used word would make each pick depend on the
    // last and make the entropy claim below wrong.
    let w = WORDS[uniform(WORDS.length, take)];
    if (o.capitalize) w = w[0].toUpperCase() + w.slice(1);
    picked.push(w);
  }
  if (o.number) {
    picked[uniform(picked.length, take)] += String(uniform(10, take));
  }
  return picked.join(o.separator || '-');
}

/** Exact for a uniform draw from a known alphabet, which is what these are. */
export function entropyBits(alphabetSize: number, length: number): number {
  if (alphabetSize <= 1 || length <= 0) return 0;
  return Math.log2(alphabetSize) * length;
}

export const passphraseBits = (words: number) => entropyBits(WORDS.length, words);
export const wordListSize = () => WORDS.length;

/**
 * Plain words for a number, and the thresholds are about OFFLINE cracking of a
 * leaked hash — the case a password has to survive. Under ~60 bits is reachable
 * by a rented GPU cluster; ~80 is comfortable; ~128 is the point past which the
 * number stops being the weak part of anything.
 */
export function strengthLabel(bits: number): { label: string; tone: 'danger' | 'warning' | 'success' } {
  if (bits < 45) return { label: 'Weak', tone: 'danger' };
  if (bits < 60) return { label: 'Fair', tone: 'warning' };
  if (bits < 80) return { label: 'Strong', tone: 'success' };
  return { label: 'Very strong', tone: 'success' };
}
