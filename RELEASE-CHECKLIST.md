# iPhone release checklist

The automated tests run the app in Chromium and WebKit, but the share
sheet, Home Screen install and iPhone storage only exist on a real iPhone.
Go through this list on an iPhone before merging a change into the
published branch (`claude/phone-calorie-tracker-gbxsn6`), and again on the
live site once Pages has deployed it.

Use a copy of the app at its own address (the steps below do), never the
live Kenna you log with: each web address keeps its own data, so nothing
here touches your real days or photos.

## Before merging

1. `npm test` passes, and the GitHub checks **Tests / test** and
   **Tests / webkit** are green on the pull request.
2. On a computer on the same Wi-Fi as the iPhone, run `npm run serve:docs`
   and note the computer's network address (for example 192.168.1.23).
3. On the iPhone, open `http://<that address>:8080` in Safari.
4. Tap Share → **Add to Home Screen** → **Add**, and open Kenna from the new
   icon. The "Add Kenna to your Home Screen" card is not shown there.
5. Log a meal: **Log Meal**, type a number, **Save and close**. Today shows
   "Saved for Today" and the new total.
6. Log a weight and check it in History and on Compare. In History, tap
   **Show earlier months**, open a day further down and swipe back: History
   shows the same months, with that day where it was.
7. Add a progress photo from the photo library (a HEIC one if you have it),
   confirm its day and tap **Save photo**.
   It appears on the Photos screen and opens in the viewer.
8. Settings → **Export Backup** → **Save or share…** → **Save to Files**.
   Settings then says "Backup shared" and when.
9. Delete the photo and change the meal, then Settings → **Import Backup**
   and pick the file just saved. The question says 1 day will be replaced;
   after **Restore**, the meal and the photo come back. **Undo restore**
   brings back the changed meal and removes the photo again. Importing the
   file twice adds nothing the second time.
10. Open Photos with two photos added, step between them with a swipe,
    and compare them side by side (**Compare photos**).
11. Delete the test copy from the Home Screen (touch and hold → Remove App).

## After Pages deploys

1. Open the live app from its Home Screen icon while online, then close it.
2. Turn on Airplane Mode and open it again: it opens and shows your data.
3. If anything fails, roll back as the README describes.

## Record

Add a row here, in the same pull request as the change, each time the
list is gone through: the date, the iPhone model and iOS version, the
commit tested, which part (before merging or after deploy) and the
result of each step: "all passed", or the number of each step that
failed and what was done about it.

| Date | iPhone, iOS | Commit | Part | Result |
|---|---|---|---|---|
| 2026-09-24 | iPhone 14, iOS 18.7.2 | 64d7124 | Before merging | Steps 1–11 passed. In step 6, Show earlier months wasn't tried: the test copy held one day, so the button is rightly not shown. The pull request was merged while steps 9–11 were under way. |
| 2026-09-24 | iPhone 14, iOS 18.7.2 | 64d7124 | After deploy | All passed: opened from the Home Screen online, then in Airplane Mode. |
