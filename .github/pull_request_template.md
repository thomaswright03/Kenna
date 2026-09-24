## What changes for the person using Kenna

<!-- One or two sentences. -->

## Before merging into the published branch

All of these are required: don't merge until every box is ticked.

- [ ] `npm run build` run, and what it changed is committed
- [ ] `npm test` passes locally
- [ ] If a rule's value changed (a limit, a threshold, a reminder interval), [REQUIREMENTS.md](../REQUIREMENTS.md) is updated in this pull request
- [ ] The "Before merging" part of [RELEASE-CHECKLIST.md](../RELEASE-CHECKLIST.md) was gone through on an iPhone on this pull request's last commit, and its row is added to the Record table in a commit that changes only that file, with every step's result by number (`1 passed; 2 passed; …`)
- [ ] **Tests / test**, **Tests / webkit** and **Tests / release-record** are green on this pull request's head commit. Links to the runs for that commit:
  - Tests / test: (paste the link to its run, https://github.com/thomaswright03/kenna/actions/runs/…)
  - Tests / webkit: (paste the link to its run)

## After Pages deploys

- [ ] The "After Pages deploys" part of RELEASE-CHECKLIST.md was gone through on the live app, and its row added
