# Kenna's rules, for the owner to confirm

Kenna was asked for as a private calorie and weight tracker for a phone:
log your weight and one calorie total per meal, see history and trend
graphs, compare today with yesterday and with your all-time averages, and
keep progress photos, with everything staying on the phone.

Every number below is a choice made while building Kenna to meet that
request, not one the owner has stated. This file lists each with the value
the app uses now and the reason it was chosen, so that when a rule is
questioned ("why did it ask me about 3,200 calories?") there is one place
that says whether it's a decision or a mistake.

**For the owner:** go through the table. For each rule you agree with,
write the date in its **Owner agreed** column (for example 2026-09-30).
For one you want changed, say what you want instead: the value is changed
in the code and here in the same pull request, and you then write the date
beside the new value. Until a date is written there, the rule has not been
agreed.

**For anyone changing a rule:** change its row here in the same pull
request. `test/unit/requirements.test.js` checks that every value in the
**Value** column matches the code, and fails when they differ.

| Id | Rule | Value | Why | Owner agreed |
|---|---|---|---|---|
| calories-min | Fewest calories one meal can have | 0 | A meal can be logged as nothing (a skipped snack) | not yet |
| calories-max | Most calories one meal can have | 10,000 | Anything above is certainly a typo; calories are whole numbers | not yet |
| weight-min | Lowest weight that can be logged, in lbs | 50 | Below this is a typo or a unit mix-up | not yet |
| weight-max | Highest weight that can be logged, in lbs | 1,000 | Above this is a typo | not yet |
| weight-decimals | Decimal places a weight can have | 2 | Scales show one or two decimals | not yet |
| units | Units and language | lbs, US English | The one user weighs in pounds | not yet |
| future-days | Days that can be logged | today and earlier | A day that hasn't happened can't have a weight or meals | not yet |
| far-back-years | A day asked about before logging when it is more than this many days ago... | 365 | Most likely a mistyped year (2002 for 2026) | not yet |
| far-back-before-first | ...and more than this many days before the first day logged | 30 | Filling in the weeks before starting Kenna isn't asked about | not yet |
| meal-times | A meal is asked about when it is more than this many times its usual size... | 3 | Most likely an extra digit (4500 for 450) | not yet |
| meal-margin | ...and more than this many calories above its usual size | 1,000 | A 350 cal snack isn't asked about beside a usual 100 | not yet |
| meal-recent | A meal's usual size is the median of its most recent logs, at most this many | 30 | Follows what you eat now, not months ago | not yet |
| meal-history | A usual size is used once a meal has been logged this many times | 3 | Fewer logs say too little about what's usual | not yet |
| meal-no-history | Until then, a meal is asked about above this many calories | 3,000 | Few single meals are larger | not yet |
| weight-base | A weight is asked about when it differs from the nearest other day's weight by more than this many lbs... | 5 | Day-to-day weight rarely moves more; most likely a typo (108.4 for 180.4) | not yet |
| weight-per-day | ...plus this many lbs for each further day between them... | 0.5 | Weight can change more over a longer gap | not yet |
| weight-share | ...but never more than this share of that weight | 25% | Keeps the allowance sensible after a long gap | not yet |
| averages-today | Averages (Compare, History's months) | leave out today | Today isn't over; it's compared with a typical finished day | not yet |
| averages-calories | Calorie averages count | only days with a meal | A day with only a weight isn't a 0 cal day | not yet |
| recent-days | Compare's recent average covers this many days before today, beside the all-time one | 30 | Over a long loss the all-time average lags far behind | not yet |
| backup-remind-from | Kenna asks for a backup once this many days have something logged | 3 | A first meal is too little to ask about | not yet |
| backup-every-default | ...and then every this many days, unless changed in Settings | 3 | At most a few days of logs are ever only on the phone | not yet |
| backup-every-choices | The intervals Settings offers, in days | 1, 3, 7 | Daily, every 3 days, weekly | not yet |
| backup-photo | A photo not in a saved backup is asked about | straight away | A photo can't be taken again | not yet |
| backup-snooze | "Not now" on the backup question puts it off | until the next day | A skipped backup is asked about again soon | not yet |
| install-note-snooze | "Not now" on the Add to Home Screen note hides it for this many days | 7 | Safari may clear a tab's data after about a week unused | not yet |
| photo-size | Longest side of the copy Kenna keeps of a photo, in pixels | 1,600 | Sharp on a phone while a year of photos fits on it | not yet |
