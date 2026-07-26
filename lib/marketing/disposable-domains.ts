// Throwaway-inbox domains, vendored rather than fetched.
//
// Every "disposable email API" charges per lookup for what is, in the end, a
// list of strings. Bundling it costs nothing at runtime, works offline, adds no
// latency to a form POST and leaks no lead's address to a third party. The
// trade-off is freshness — new burner domains appear constantly — which is why
// a disposable hit only FLAGS a submission here, never blocks it.
//
// Covers the high-volume providers and their common aliases. Extend freely;
// order doesn't matter, lookups go through a Set.
const DOMAINS = [
  '0-mail.com', '10mail.org', '10minutemail.com', '10minutemail.net', '20minutemail.com',
  '33mail.com', 'anonbox.net', 'anonymbox.com', 'armyspy.com', 'blondmail.com',
  'burnermail.io', 'byom.de', 'cuvox.de', 'dayrep.com', 'discard.email', 'discardmail.com',
  'dispostable.com', 'dropmail.me', 'einrot.com', 'emailondeck.com', 'emailtemporanea.net',
  'emailtemporario.com.br', 'emltmp.com', 'fakeinbox.com', 'fakemail.net', 'fakemailgenerator.com',
  'fleckens.hu', 'getairmail.com', 'getnada.com', 'gmial.com', 'guerrillamail.biz',
  'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.net',
  'guerrillamail.org', 'guerrillamailblock.com', 'harakirimail.com', 'inboxalias.com',
  'inboxbear.com', 'inboxkitten.com', 'jetable.org', 'mail-temporaire.fr', 'mail7.io',
  'mailbox52.ga', 'maildrop.cc', 'mailduck.io', 'mailemail.ru', 'mailforspam.com',
  'mailinator.com', 'mailinator.net', 'mailnesia.com', 'mailsac.com', 'mailtemp.info',
  'mailtothis.com', 'meltmail.com', 'minuteinbox.com', 'moakt.com', 'mohmal.com',
  'msgsafe.io', 'mt2015.com', 'mytemp.email', 'mytrashmail.com', 'nada.email',
  'no-spam.ws', 'notmailinator.com', 'nowmymail.com', 'onetimeuseemail.com', 'opayq.com',
  'pokemail.net', 'rhyta.com', 'sharklasers.com', 'shieldemail.com', 'smashmail.de',
  'spam4.me', 'spambog.com', 'spambox.us', 'spamgourmet.com', 'spamherelots.com',
  'sute.jp', 'tafmail.com', 'teleworm.us', 'temp-mail.io', 'temp-mail.org', 'tempail.com',
  'tempemail.net', 'tempinbox.com', 'tempm.com', 'tempmail.altmails.com', 'tempmail.ninja',
  'tempmail.plus', 'tempmailo.com', 'tempr.email', 'throwawaymail.com', 'tmail.ws',
  'tmpmail.net', 'trashmail.com', 'trashmail.de', 'trashmail.me', 'trashmail.net',
  'trbvm.com', 'vomoto.com', 'wegwerfmail.de', 'wegwerfmail.net', 'yopmail.com',
  'yopmail.fr', 'yopmail.net', 'zetmail.com',
];

export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set(DOMAINS);
